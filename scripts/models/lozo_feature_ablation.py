#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
lozo_feature_ablation.py
------------------------
Selección de features GUIADA POR TRANSFERENCIA mediante Leave-One-Zone-Out
(LOZO) bidireccional. Responde con datos: ¿qué features DAÑAN la
transferibilidad del RF entre zonas?

Diseño: dos zonas (Valencia v2, Algemesí). Dos direcciones de transferencia:
    A→B: entrena Valencia, testea Algemesí
    B→A: entrena Algemesí, testea Valencia
Métrica = AUC-ROC cruzado (ranking; robusto a prevalencia y umbral).

Ablación leave-one-feature-out: para cada feature f se reentrena SIN f y se
mide el AUC cruzado. delta = AUC(sin f) - AUC(baseline 14 feat).
    delta > 0  => quitar f MEJORA la transferencia (feature no transferible).
    delta < 0  => f es útil para transferir (mantener).
Se promedian las dos direcciones para robustez. El set "transferible"
candidato = todas las features salvo las de delta medio claramente positivo;
se verifica entrenando con ese set y comparando AUC cruzado vs baseline.

Train estratificado (positivos garantizados); test a prevalencia natural.
No hay fuga: el modelo nunca ve la zona donde se testea.

Salidas:
  results/model/lozo_feature_ablation.json
  results/diagnostics/model/lozo_feature_ablation.png

Uso:
  .venv/Scripts/python.exe scripts/models/lozo_feature_ablation.py
      [--n-train 600000] [--n-test 1500000] [--n-est 100]
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RANDOM_STATE = 42
MAX_DEPTH = 12

FEATURES = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]


def _load_zone(path: Path, rng):
    df = pd.read_parquet(path, columns=["flood_label", *FEATURES])
    fin = np.isfinite(df[FEATURES].to_numpy()).all(axis=1)
    return df.loc[fin].reset_index(drop=True)


def _strat_sample(df, n, rng):
    """Muestra con ~20% positivos garantizados (para que el train tenga
    señal incluso con prevalencia 0,3% como Algemesí)."""
    pos = df.index[df["flood_label"] == 1].to_numpy()
    neg = df.index[df["flood_label"] == 0].to_numpy()
    n_pos = min(len(pos), int(n * 0.2))
    n_neg = min(len(neg), n - n_pos)
    idx = np.concatenate([rng.choice(pos, n_pos, replace=False),
                          rng.choice(neg, n_neg, replace=False)])
    rng.shuffle(idx)
    return df.loc[idx].reset_index(drop=True)


def _auc(feats, Xtr_df, ytr, Xte_df, yte, n_est):
    clf = RandomForestClassifier(n_estimators=n_est, max_depth=MAX_DEPTH,
                                 class_weight="balanced_subsample",
                                 n_jobs=-1, random_state=RANDOM_STATE)
    clf.fit(Xtr_df[feats].to_numpy("float32"), ytr)
    p = clf.predict_proba(Xte_df[feats].to_numpy("float32"))[:, 1]
    return float(roc_auc_score(yte, p))


def main() -> int:
    t0 = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-train", type=int, default=600_000)
    ap.add_argument("--n-test", type=int, default=1_500_000)
    ap.add_argument("--n-est", type=int, default=100)
    args = ap.parse_args()
    rng = np.random.default_rng(RANDOM_STATE)

    log.info("Cargando zonas...")
    val = _load_zone(REPO / "data/dataset/training_dataset_v2.parquet", rng)
    alg = _load_zone(REPO / "data/dataset/training_dataset_algemesi.parquet", rng)
    log.info("Valencia=%d (pos %.2f%%)  Algemesi=%d (pos %.3f%%)",
             len(val), 100*val["flood_label"].mean(),
             len(alg), 100*alg["flood_label"].mean())

    train_V = _strat_sample(val, args.n_train, rng)
    train_A = _strat_sample(alg, args.n_train, rng)
    test_V = val.sample(min(args.n_test, len(val)), random_state=RANDOM_STATE)
    test_A = alg.sample(min(args.n_test, len(alg)), random_state=RANDOM_STATE)
    yV_tr, yA_tr = train_V["flood_label"].to_numpy("int8"), train_A["flood_label"].to_numpy("int8")
    yV_te, yA_te = test_V["flood_label"].to_numpy("int8"), test_A["flood_label"].to_numpy("int8")
    log.info("train_V pos=%d  train_A pos=%d  test_V pos=%d  test_A pos=%d",
             yV_tr.sum(), yA_tr.sum(), yV_te.sum(), yA_te.sum())

    directions = [
        ("A2B (Valencia->Algemesi)", train_V, yV_tr, test_A, yA_te),
        ("B2A (Algemesi->Valencia)", train_A, yA_tr, test_V, yV_te),
    ]

    per_dir = {}
    for name, Xtr, ytr, Xte, yte in directions:
        log.info("==== %s ====", name)
        base = _auc(FEATURES, Xtr, ytr, Xte, yte, args.n_est)
        log.info("  baseline (14 feat) AUC=%.4f", base)
        deltas = {}
        for i, f in enumerate(FEATURES, 1):
            feats = [x for x in FEATURES if x != f]
            a = _auc(feats, Xtr, ytr, Xte, yte, args.n_est)
            deltas[f] = a - base
            log.info("  [%2d/14] drop %-20s AUC=%.4f  delta=%+.4f", i, f, a, a - base)
        per_dir[name] = {"baseline_auc": base, "delta": deltas}

    # Promedio bidireccional
    mean_delta = {f: float(np.mean([per_dir[d]["delta"][f] for d in per_dir]))
                  for f in FEATURES}
    ranked = sorted(mean_delta.items(), key=lambda kv: kv[1], reverse=True)
    log.info("==== delta medio (quitar => +AUC transfiere mejor) ====")
    for f, d in ranked:
        log.info("  %-20s %+.4f", f, d)

    # Set transferible candidato. Criterio ROBUSTO al ruido: quitar f solo
    # si daña la transferencia en AMBAS direcciones (los dos deltas > 0) Y
    # el delta medio supera un margen real (no ruido). Aísla las features
    # consistentemente no transferibles sin sobre-podar.
    TOL = 0.003
    drop = [f for f in FEATURES
            if all(per_dir[d]["delta"][f] > 0 for d in per_dir) and mean_delta[f] > TOL]
    keep = [f for f in FEATURES if f not in drop]
    log.info("Candidato a QUITAR (%d): %s", len(drop), drop)
    log.info("Set transferible KEEP (%d): %s", len(keep), keep)

    # Verificación: AUC cruzado con el set candidato vs baseline
    verify = {}
    for name, Xtr, ytr, Xte, yte in directions:
        a = _auc(keep, Xtr, ytr, Xte, yte, args.n_est) if keep else None
        verify[name] = {"baseline": per_dir[name]["baseline_auc"], "keep_set": a,
                        "delta": (a - per_dir[name]["baseline_auc"]) if a else None}
        log.info("  VERIFY %s: baseline=%.4f  keep_set=%.4f  delta=%+.4f",
                 name, verify[name]["baseline"], a, verify[name]["delta"])

    out = {
        "n_train": args.n_train, "n_test": args.n_test, "n_est": args.n_est,
        "per_direction": per_dir,
        "mean_delta": mean_delta,
        "candidate_drop": drop,
        "transferable_keep_set": keep,
        "verification": verify,
    }
    jp = REPO / "results/model/lozo_feature_ablation.json"
    jp.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("JSON: %s", jp.relative_to(REPO))

    if HAS_MPL:
        diag = REPO / "results/diagnostics/model"
        diag.mkdir(parents=True, exist_ok=True)
        names = [f for f, _ in ranked]
        d_a = [per_dir[directions[0][0]]["delta"][f] for f in names]
        d_b = [per_dir[directions[1][0]]["delta"][f] for f in names]
        y = np.arange(len(names))
        fig, ax = plt.subplots(figsize=(10, 8))
        ax.barh(y - 0.2, d_a, 0.4, label=directions[0][0], color="#2c7fb8")
        ax.barh(y + 0.2, d_b, 0.4, label=directions[1][0], color="#f46d43")
        ax.axvline(0, color="black", lw=0.6)
        ax.set_yticks(y); ax.set_yticklabels(names)
        ax.invert_yaxis()
        ax.set_xlabel("Δ AUC cruzado al QUITAR la feature  (>0 = no transferible)")
        ax.set_title("Ablación LOZO bidireccional — features que dañan la transferencia")
        ax.legend(); ax.grid(True, alpha=0.3, axis="x")
        plt.tight_layout()
        png = diag / "lozo_feature_ablation.png"
        plt.savefig(png, dpi=150, bbox_inches="tight")
        plt.close()
        log.info("PNG: %s", png.relative_to(REPO))

    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
