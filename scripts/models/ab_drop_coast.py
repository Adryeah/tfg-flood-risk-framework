#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ab_drop_coast.py
----------------
Experimento A/B controlado: ¿mejora la transferibilidad Valencia -> Algemesi
si se elimina el spatial proxy `distance_to_coast`?

Motivacion (Mila et al. 2024, GMD 17:6007; Meyer et al. 2019; AOA Meyer &
Pebesma 2021): los campos de distancia geografica (distance_to_coast) son
spatial proxies que extrapolan mal a regiones nuevas. La AOA de este repo ya
mostro que el 100% de las inundaciones de Algemesi caen FUERA del dominio,
empujadas por distance_to_coast (peso 0.31) + elevation (0.21).

Diseno (unica variable = el set de features):
  - FULL    : 14 features v2 (incluye distance_to_coast)
  - NOCOAST : 13 features    (sin distance_to_coast)
  Mismos hiperparametros, misma semilla, mismos datos. Para cada set:
    1. CV espacial (GroupKFold, bloques 1 km) sobre muestra de Valencia
       -> AUC-ROC, AUC-PR OOF + umbral operacional (criterio recall>=0.75).
    2. Modelo final entrenado en TODO Valencia.
    3. Aplicacion a TODO Algemesi -> AUC-ROC, AUC-PR, recall/precision al
       umbral propio de cada modelo.
    4. Cobertura AOA de Algemesi (DI Meyer-Pebesma, pesos = importancia
       Gini del propio modelo) + nº de inundaciones dentro de AOA.

NO se tunea el umbral sobre Algemesi (seria fuga): el umbral sale de la CV
de Valencia y se aplica a ciegas, igual que en produccion.

Salidas:
  models/random_forest_v2_full.joblib, models/random_forest_v2_nocoast.joblib
  results/model/ab_drop_coast.json

Uso:
  .venv/Scripts/python.exe scripts/models/ab_drop_coast.py [--smoke]
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from scipy.spatial.distance import pdist
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (average_precision_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RANDOM_STATE = 42
N_ESTIMATORS = 300
N_ESTIMATORS_CV = 200          # CV: menos arboles, el umbral/AUC son estables
MAX_DEPTH = 12
BLOCK_PX = 100                 # 100 px * 10 m = bloques de 1 km
RECALL_TARGET = 0.75
N_REF_AOA = 200_000
N_DBAR = 3000

FEATURES_FULL = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]
DROP = "distance_to_coast"
FEATURES_NOCOAST = [f for f in FEATURES_FULL if f != DROP]


def _assign_blocks(rows, cols, block_px, n_cols_total):
    ncb = int(np.ceil(n_cols_total / block_px))
    return ((rows // block_px) * ncb + (cols // block_px)).astype("int32")


def _threshold_at_recall(y, proba, target=RECALL_TARGET):
    """Umbral mas alto que aun cumple recall>=target (mismo criterio que
    el threshold operacional v2 = 0.614)."""
    ts = np.linspace(0.02, 0.98, 97)
    best = ts[0]
    for t in ts:
        if recall_score(y, proba >= t, zero_division=0) >= target:
            best = t  # sigue subiendo mientras se cumpla
    return float(best)


def _spatial_cv(X, y, groups, n_est):
    """OOF proba via GroupKFold espacial. Devuelve (auc, auc_pr, threshold)."""
    gkf = GroupKFold(n_splits=5)
    oof = np.full(len(y), np.nan, dtype="float32")
    for k, (tr, va) in enumerate(gkf.split(X, y, groups=groups), 1):
        clf = RandomForestClassifier(
            n_estimators=n_est, max_depth=MAX_DEPTH,
            class_weight="balanced_subsample", n_jobs=-1, random_state=RANDOM_STATE)
        clf.fit(X[tr], y[tr])
        oof[va] = clf.predict_proba(X[va])[:, 1].astype("float32")
        log.info("    CV fold %d/5 ok", k)
    auc = float(roc_auc_score(y, oof))
    auc_pr = float(average_precision_score(y, oof))
    thr = _threshold_at_recall(y, oof)
    return auc, auc_pr, thr


def _weighted_space(X, mu, sd, w):
    return ((X - mu) / sd) * w


def _aoa_coverage(X_tr, mu, sd, w, X_alg_chunks, y_alg, rng):
    """% de Algemesi dentro de AOA + nº de inundaciones dentro.
    X_alg_chunks: callable -> itera (slice) de features de Algemesi ya cargadas.
    Devuelve dict."""
    n_ref = min(N_REF_AOA, len(X_tr))
    ref = _weighted_space(X_tr[rng.choice(len(X_tr), n_ref, replace=False)],
                          mu, sd, w).astype("float32")
    sub = ref[rng.choice(n_ref, min(N_DBAR, n_ref), replace=False)]
    d_bar = float(pdist(sub.astype("float64")).mean())
    tree = cKDTree(ref)
    nn_tr, _ = tree.query(ref, k=2, workers=-1)
    di_train = nn_tr[:, 1] / d_bar
    q75, q25 = np.percentile(di_train, [75, 25])
    aoa_thr = float(q75 + 1.5 * (q75 - q25))

    di_alg = np.empty(len(y_alg), dtype="float32")
    pos = 0
    for sl, Xc in X_alg_chunks():
        Xw = _weighted_space(Xc, mu, sd, w).astype("float32")
        nn, _ = tree.query(Xw, k=1, workers=-1)
        di_alg[sl] = (nn / d_bar).astype("float32")
    inside = di_alg <= aoa_thr
    return {
        "aoa_threshold": aoa_thr,
        "pct_inside": float(100.0 * inside.mean()),
        "flood_inside": int(((y_alg == 1) & inside).sum()),
        "flood_total": int((y_alg == 1).sum()),
    }


def _metrics_alg(y, proba, thr):
    pred = proba >= thr
    return {
        "auc_roc": float(roc_auc_score(y, proba)) if y.min() != y.max() else None,
        "auc_pr": float(average_precision_score(y, proba)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "threshold": thr,
    }


def main() -> int:
    t0 = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true",
                    help="Muestras minúsculas para validar el pipeline rápido.")
    ap.add_argument("--n-final", type=int, default=None,
                    help="Filas de Valencia para el modelo final (None=todas).")
    ap.add_argument("--n-cv", type=int, default=2_000_000,
                    help="Filas para la CV espacial (umbral/AUC).")
    ap.add_argument("--n-alg", type=int, default=None,
                    help="Filas de Algemesi a evaluar (None=todas).")
    ap.add_argument("--n-est", type=int, default=N_ESTIMATORS,
                    help="Árboles del modelo final.")
    ap.add_argument("--n-est-cv", type=int, default=N_ESTIMATORS_CV,
                    help="Árboles en cada fold de CV.")
    args = ap.parse_args()
    rng = np.random.default_rng(RANDOM_STATE)

    if args.smoke:
        n_cv, n_final, n_alg, n_est, n_est_cv = 50_000, 80_000, 60_000, 60, 60
    else:
        n_cv, n_final, n_alg = args.n_cv, args.n_final, args.n_alg
        n_est, n_est_cv = args.n_est, args.n_est_cv
    chunk = 2_000_000

    # ---- Cargar Valencia ----
    log.info("Cargando Valencia...")
    df = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet")
    fin = np.isfinite(df[FEATURES_FULL].to_numpy()).all(axis=1)
    df = df.loc[fin].reset_index(drop=True)
    if n_final:
        df = df.sample(min(n_final, len(df)), random_state=RANDOM_STATE).reset_index(drop=True)
    n_cols_total = int(df["col"].max() + 1)
    groups_full = _assign_blocks(df["row"].to_numpy(), df["col"].to_numpy(), BLOCK_PX, n_cols_total)
    y_full = df["flood_label"].to_numpy("int8")
    log.info("Valencia: %d filas  pos=%d (%.2f%%)", len(df), y_full.sum(), 100*y_full.mean())

    # muestra para CV (estratificada)
    pos = df.index[y_full == 1].to_numpy()
    neg = df.index[y_full == 0].to_numpy()
    n_pos_cv = min(len(pos), int(n_cv * 0.2))
    n_neg_cv = min(len(neg), n_cv - n_pos_cv)
    cv_idx = np.concatenate([rng.choice(pos, n_pos_cv, replace=False),
                             rng.choice(neg, n_neg_cv, replace=False)])
    rng.shuffle(cv_idx)
    groups_cv = groups_full[cv_idx]
    y_cv = y_full[cv_idx]

    # ---- Cargar Algemesi ----
    log.info("Cargando Algemesi...")
    cols = ["row", "col", "flood_label", *FEATURES_FULL]
    dfa = pd.read_parquet(REPO / "data/dataset/training_dataset_algemesi.parquet", columns=cols)
    fina = np.isfinite(dfa[FEATURES_FULL].to_numpy()).all(axis=1)
    dfa = dfa.loc[fina].reset_index(drop=True)
    if n_alg:
        dfa = dfa.sample(min(n_alg, len(dfa)), random_state=RANDOM_STATE).reset_index(drop=True)
    y_alg = dfa["flood_label"].to_numpy("int8")
    log.info("Algemesi: %d filas  pos=%d", len(dfa), y_alg.sum())

    results = {}
    for tag, feats in [("full", FEATURES_FULL), ("nocoast", FEATURES_NOCOAST)]:
        log.info("==================== SET: %s (%d features) ====================", tag, len(feats))
        Xv = df[feats].to_numpy("float32")
        Xv_cv = Xv[cv_idx]

        # 1) CV espacial -> AUC + threshold
        log.info("  [%s] CV espacial...", tag)
        auc_cv, aucpr_cv, thr = _spatial_cv(Xv_cv, y_cv, groups_cv, n_est_cv)
        log.info("  [%s] CV Valencia: AUC=%.4f  AUC-PR=%.4f  thr@recall0.75=%.3f", tag, auc_cv, aucpr_cv, thr)

        # 2) Modelo final en TODO Valencia
        log.info("  [%s] Entrenando modelo final (%d filas)...", tag, len(Xv))
        clf = RandomForestClassifier(
            n_estimators=n_est, max_depth=MAX_DEPTH,
            class_weight="balanced_subsample", n_jobs=-1, random_state=RANDOM_STATE)
        clf.fit(Xv, y_full)
        mp = REPO / f"models/random_forest_v2_{tag}.joblib"
        joblib.dump(clf, mp, compress=3)
        log.info("  [%s] modelo: %s (%.1f MB)", tag, mp.name, mp.stat().st_size/1e6)

        # 3) Aplicar a Algemesi (chunked)
        Xa = dfa[feats].to_numpy("float32")
        proba_a = np.empty(len(Xa), dtype="float32")
        for s in range(0, len(Xa), chunk):
            e = min(s + chunk, len(Xa))
            proba_a[s:e] = clf.predict_proba(Xa[s:e])[:, 1].astype("float32")
        m_alg = _metrics_alg(y_alg, proba_a, thr)
        log.info("  [%s] Algemesi: AUC=%.4f AUC-PR=%.5f recall=%.4f prec=%.4f @thr=%.3f",
                 tag, m_alg["auc_roc"], m_alg["auc_pr"], m_alg["recall"], m_alg["precision"], thr)

        # 4) AOA con pesos = importancia Gini del modelo
        w = clf.feature_importances_.astype("float64")
        w = w / w.sum() if w.sum() > 0 else np.ones(len(feats)) / len(feats)
        mu = Xv.mean(axis=0); sd = Xv.std(axis=0); sd[sd < 1e-9] = 1e-9

        def _chunks(Xa=Xa, mu=mu, sd=sd):
            for s in range(0, len(Xa), chunk):
                e = min(s + chunk, len(Xa))
                yield slice(s, e), Xa[s:e].astype("float64")
        aoa = _aoa_coverage(Xv.astype("float64"), mu, sd, w, _chunks, y_alg, rng)
        log.info("  [%s] AOA: %.1f%% dentro  inundaciones dentro=%d/%d  (thr=%.3f)",
                 tag, aoa["pct_inside"], aoa["flood_inside"], aoa["flood_total"], aoa["aoa_threshold"])

        results[tag] = {"valencia_cv": {"auc_roc": auc_cv, "auc_pr": aucpr_cv, "threshold": thr},
                        "algemesi": m_alg, "aoa": aoa, "n_features": len(feats)}

    # ---- Tabla comparativa ----
    out = REPO / "results/model/ab_drop_coast.json"
    out.write_text(json.dumps({"smoke": args.smoke, "results": results}, indent=2, ensure_ascii=False),
                   encoding="utf-8")

    f, nc = results["full"], results["nocoast"]
    print("\n" + "=" * 78)
    print("  A/B  -  quitar distance_to_coast        FULL(14)      NOCOAST(13)    delta")
    print("=" * 78)
    rows = [
        ("Valencia CV  AUC-ROC", f["valencia_cv"]["auc_roc"], nc["valencia_cv"]["auc_roc"]),
        ("Valencia CV  AUC-PR",  f["valencia_cv"]["auc_pr"],  nc["valencia_cv"]["auc_pr"]),
        ("Algemesi     AUC-ROC", f["algemesi"]["auc_roc"],    nc["algemesi"]["auc_roc"]),
        ("Algemesi     AUC-PR",  f["algemesi"]["auc_pr"],     nc["algemesi"]["auc_pr"]),
        ("Algemesi     Recall",  f["algemesi"]["recall"],     nc["algemesi"]["recall"]),
        ("Algemesi     Precision", f["algemesi"]["precision"], nc["algemesi"]["precision"]),
        ("AOA  % dentro",        f["aoa"]["pct_inside"],      nc["aoa"]["pct_inside"]),
    ]
    for name, a, b in rows:
        print(f"  {name:<24s}  {a:>10.4f}    {b:>10.4f}    {b-a:+.4f}")
    print(f"  {'AOA inundaciones dentro':<24s}  {f['aoa']['flood_inside']:>10d}    "
          f"{nc['aoa']['flood_inside']:>10d}    {nc['aoa']['flood_inside']-f['aoa']['flood_inside']:+d}")
    print("=" * 78)
    print(f"  JSON: {out.relative_to(REPO)}")
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
