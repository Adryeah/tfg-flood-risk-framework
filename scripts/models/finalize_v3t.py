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

Entrena en muestra grande de Valencia, calibra con isotonica sobre un
hold-out DISJUNTO (sin fuga) y fija el umbral operacional (recall>=0,75)
sobre ese mismo hold-out.

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
SETS = {"v2_full": FEATURES_FULL, "lozo10": LOZO10, "lozo9": LOZO9}


def _strat(df, n, rng):
    pos = df.index[df["flood_label"] == 1].to_numpy()
    neg = df.index[df["flood_label"] == 0].to_numpy()
    npos = min(len(pos), int(n * 0.2))
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
    ap.add_argument("--set", dest="set_name", default="lozo9", choices=list(SETS))
    args = ap.parse_args()
    feats = SETS[args.set_name]
    rng = np.random.default_rng(RS)
    log.info("Consolidando v3-T con set '%s' (%d features): %s",
             args.set_name, len(feats), feats)

    val = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                          columns=["flood_label", *FEATURES_FULL])
    val = val.loc[np.isfinite(val[FEATURES_FULL].to_numpy()).all(1)].reset_index(drop=True)
    log.info("Valencia=%d filas", len(val))

    # Train + calibracion DISJUNTOS
    fin_idx = _strat(val, N_FINAL, rng)
    train_F = val.loc[fin_idx]
    pool = val.drop(index=fin_idx).reset_index(drop=True)
    cal_idx = _strat(pool, N_CALIB, rng)
    cal_F = pool.loc[cal_idx].reset_index(drop=True)
    yF = train_F["flood_label"].to_numpy("int8")
    yC = cal_F["flood_label"].to_numpy("int8")
    log.info("train=%d (pos %d)  calib=%d (pos %d)", len(train_F), yF.sum(), len(cal_F), yC.sum())

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
