#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
finalize_v3t.py
---------------
Consolida el modelo-nucleo TRANSFERIBLE del TFG (RF v3-T) con el conjunto
de features elegido tras la comparacion LOZO (`build_v3t.py`).

Por defecto usa el set `lozo9` (9 features) = el coherente con la tesis de
extrapolacion CIEGA del TFG (funcionar en zona nueva sin reentrenar ni
recalibrar): quita las dos features no transferibles identificadas con
datos —`elevation` (rompe el ranking, ablacion LOZO) y `distance_to_coast`
(rompe la decision/recall, A/B)— ademas de slope, std_vv y vv_vh_ratio.

Entrena en muestra grande de Valencia (rebalanceada al 20% de positivos,
junto con class_weight, para que el clasificador aprenda la clase minoritaria),
y calibra con isotonica sobre un hold-out DISJUNTO (sin fuga) construido a la
PREVALENCIA NATURAL de despliegue (~8% en Valencia). Esto es clave: la
isotonica aprende P(y=1|score) bajo la base rate del hold-out; calibrarla a la
prevalencia real evita que las probabilidades sobre-prediquen en produccion.
El umbral operacional (recall>=0,75) se fija sobre ese mismo hold-out natural.

Salidas (sobrescriben las del build):
  models/random_forest_v3t.joblib
  models/v3t_calibrator.joblib   ({isotonic, features, threshold})
  results/model/v3t_final.json

Uso:
  .venv/Scripts/python.exe scripts/models/finalize_v3t.py [--set lozo9|lozo10|v2_full]
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
from sklearn.ensemble import RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import recall_score

from river_feature import add_distance_to_river

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RS = 42
N_EST = 150
MAX_DEPTH = 12
N_FINAL = 2_000_000
N_CALIB = 400_000

FEATURES_FULL = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]
DROP_LOZO = ["elevation", "slope", "std_sigma0_vv", "mean_vv_vh_ratio"]
LOZO10 = [f for f in FEATURES_FULL if f not in DROP_LOZO]
LOZO9 = [f for f in LOZO10 if f != "distance_to_coast"]
# lozo9r = nucleo transferible (9) + distance_to_river (A/B ganador: mejora
# in-domain Y transferencia porque es un feature de PROCESO hidrologico, no un
# proxy espacial). distance_to_river NO esta en el parquet; se muestrea del
# raster en tiempo de carga (river_feature.add_distance_to_river).
RIVER = "distance_to_river"
LOZO9R = LOZO9 + [RIVER]
SETS = {"v2_full": FEATURES_FULL, "lozo10": LOZO10, "lozo9": LOZO9, "lozo9r": LOZO9R}


def _strat(df, n, rng, pos_frac=0.2):
    """Muestrea n indices con una fraccion de positivos `pos_frac`.
    Train: 0.2 (rebalanceo). Calibracion/umbral: prevalencia natural (~0.08)."""
    pos = df.index[df["flood_label"] == 1].to_numpy()
    neg = df.index[df["flood_label"] == 0].to_numpy()
    npos = min(len(pos), int(n * pos_frac))
    idx = np.concatenate([rng.choice(pos, npos, replace=False),
                          rng.choice(neg, min(len(neg), n - npos), replace=False)])
    rng.shuffle(idx)
    return idx


def _thr_at_recall(y, p, target=0.75):
    best = 0.02
    for t in np.linspace(0.02, 0.98, 97):
        if recall_score(y, p >= t, zero_division=0) >= target:
            best = t
    return float(best)


def main() -> int:
    t0 = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", dest="set_name", default="lozo9r", choices=list(SETS))
    args = ap.parse_args()
    feats = SETS[args.set_name]
    rng = np.random.default_rng(RS)
    log.info("Consolidando v3-T con set '%s' (%d features): %s",
             args.set_name, len(feats), feats)

    parq_cols = ["flood_label", "row", "col", *FEATURES_FULL]
    val = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                          columns=parq_cols)
    val = val.loc[np.isfinite(val[FEATURES_FULL].to_numpy()).all(1)].reset_index(drop=True)
    if RIVER in feats:
        val = add_distance_to_river(val, "valencia", REPO)
        val = val.loc[np.isfinite(val[RIVER].to_numpy())].reset_index(drop=True)
    log.info("Valencia=%d filas", len(val))

    # Train + calibracion DISJUNTOS.
    # Train: rebalanceado al 20% (clasificador identico al validado).
    # Calib: PREVALENCIA NATURAL de despliegue -> calibracion sin sesgo de base rate.
    nat_prev = float(val["flood_label"].mean())
    fin_idx = _strat(val, N_FINAL, rng)                       # train @ 20% pos
    train_F = val.loc[fin_idx]
    pool = val.drop(index=fin_idx).reset_index(drop=True)
    cal_idx = _strat(pool, N_CALIB, rng, pos_frac=nat_prev)   # calib @ prevalencia natural
    cal_F = pool.loc[cal_idx].reset_index(drop=True)
    yF = train_F["flood_label"].to_numpy("int8")
    yC = cal_F["flood_label"].to_numpy("int8")
    log.info("prevalencia natural Valencia = %.4f", nat_prev)
    log.info("train=%d (pos %d, %.1f%%)  calib=%d (pos %d, %.2f%%)",
             len(train_F), yF.sum(), 100 * yF.mean(), len(cal_F), yC.sum(), 100 * yC.mean())

    log.info("Entrenando RF...")
    m = RandomForestClassifier(n_estimators=N_EST, max_depth=MAX_DEPTH,
                               class_weight="balanced_subsample", n_jobs=-1,
                               random_state=RS)
    m.fit(train_F[feats].to_numpy("float32"), yF)

    log.info("Calibrando (isotonica, hold-out disjunto)...")
    p_cal = m.predict_proba(cal_F[feats].to_numpy("float32"))[:, 1]
    iso = IsotonicRegression(out_of_bounds="clip").fit(p_cal, yC)
    thr = _thr_at_recall(yC, iso.predict(p_cal))
    log.info("Umbral operacional (recall>=0,75 en holdout Valencia): %.3f", thr)

    joblib.dump(m, REPO / "models/random_forest_v3t.joblib", compress=3)
    joblib.dump({"isotonic": iso, "features": feats, "threshold": thr},
                REPO / "models/v3t_calibrator.joblib", compress=3)
    meta = {
        "set": args.set_name, "n_features": len(feats), "features": feats,
        "n_train": int(len(train_F)), "n_calib": int(len(cal_F)),
        "n_estimators": N_EST, "max_depth": MAX_DEPTH,
        "operational_threshold": thr,
        "gini_importance": dict(sorted(
            zip(feats, m.feature_importances_.astype(float)),
            key=lambda kv: kv[1], reverse=True)),
        "note": "v3-T = nucleo transferible. Aplicar a zona nueva: predict_proba "
                "-> isotonic.predict -> umbral. Acotar con AOA (scripts/models/aoa_analysis.py).",
    }
    (REPO / "results/model/v3t_final.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("GUARDADO: models/random_forest_v3t.joblib (+ v3t_calibrator.joblib)")
    log.info("Meta: results/model/v3t_final.json")
    log.info("Importancia Gini top: %s",
             ", ".join(f"{k}={v:.3f}" for k, v in list(meta["gini_importance"].items())[:5]))
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
