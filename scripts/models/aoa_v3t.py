#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
aoa_v3t.py
----------
Area of Applicability (AOA) / Dissimilarity Index (DI) de Meyer & Pebesma
(2021) para el modelo FINAL v3-T (9 features, transferible) extrapolado de
Valencia a Algemesi. Equivalente a aoa_analysis.py pero para el set lozo9 y
con los pesos = permutation importance del propio v3-T (calculada inline).

Responde: ¿en que fraccion de Algemesi predice v3-T dentro del dominio de
features visto en entrenamiento (AOA) y donde extrapola a ciegas? Es la cifra
que la web y la memoria reportan como cobertura del AOA del modelo desplegado.

Salidas:
  results/model/aoa_v3t.json
  results/maps/05_extrapolation/aoa_inside_algemesi_v3t.tif  (1=dentro, 0=fuera)

Uso:
  .venv/Scripts/python.exe scripts/models/aoa_v3t.py [--n-ref 200000]
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
import rasterio
from scipy.spatial import cKDTree
from scipy.spatial.distance import pdist
from sklearn.inspection import permutation_importance
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score

from river_feature import add_distance_to_river

RIVER = "distance_to_river"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RS = 42
N_DBAR = 3000


def _metrics(y, proba, thr):
    pred = (proba >= thr).astype("int8")
    out = {"n": int(len(y)), "n_pos": int(y.sum()),
           "f1": float(f1_score(y, pred, zero_division=0)),
           "precision": float(precision_score(y, pred, zero_division=0)),
           "recall": float(recall_score(y, pred, zero_division=0))}
    try:
        out["auc_roc"] = float(roc_auc_score(y, proba)) if y.min() != y.max() else None
    except ValueError:
        out["auc_roc"] = None
    return out


def _write_mask(values, rows, cols, ref_path, out_path, dtype, nodata):
    with rasterio.open(ref_path) as ref:
        H, W = ref.height, ref.width
        prof = ref.profile
    grid = np.full((H, W), nodata, dtype=dtype)
    grid[rows, cols] = values.astype(dtype)
    for k in ("blockxsize", "blockysize", "tiled"):
        prof.pop(k, None)
    prof.update(driver="GTiff", dtype=dtype, count=1, nodata=nodata, compress="lzw")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **prof) as dst:
        dst.write(grid, 1)
    log.info("  raster: %s", out_path.relative_to(REPO))


def main() -> int:
    t0 = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-ref", type=int, default=200_000)
    ap.add_argument("--chunk", type=int, default=2_000_000)
    args = ap.parse_args()
    rng = np.random.default_rng(RS)

    model = joblib.load(REPO / "models/random_forest_v3t.joblib")
    cal = joblib.load(REPO / "models/v3t_calibrator.joblib")
    iso, FEATS, THR = cal["isotonic"], cal["features"], cal["threshold"]
    PARQUET_FEATS = [f for f in FEATS if f != RIVER]
    log.info("v3-T: %d features, umbral=%.3f", len(FEATS), THR)

    # ---- Valencia (referencia) ----
    val = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                          columns=["row", "col", "flood_label", *PARQUET_FEATS])
    val = val.loc[np.isfinite(val[PARQUET_FEATS].to_numpy()).all(1)].reset_index(drop=True)
    if RIVER in FEATS:
        val = add_distance_to_river(val, "valencia", REPO)
        val = val.loc[np.isfinite(val[RIVER].to_numpy())].reset_index(drop=True)
    Xv = val[FEATS].to_numpy("float64")
    mu, sd = Xv.mean(0), Xv.std(0)
    sd[sd < 1e-9] = 1e-9

    # Pesos = permutation importance v3-T (inline, sample), clamp>=0, norm a 1.
    s_idx = rng.choice(len(val), min(80_000, len(val)), replace=False)
    pi = permutation_importance(model, val.loc[s_idx, FEATS].to_numpy("float32"),
                                val.loc[s_idx, "flood_label"].to_numpy("int8"),
                                scoring="roc_auc", n_repeats=3, random_state=RS, n_jobs=-1)
    w = np.clip(pi.importances_mean, 0, None)
    w = w / w.sum() if w.sum() > 0 else np.ones(len(FEATS)) / len(FEATS)
    log.info("  pesos top: %s", ", ".join(
        f"{FEATS[i]}={w[i]:.3f}" for i in np.argsort(w)[::-1][:4]))

    n_ref = min(args.n_ref, len(Xv))
    ref_idx = rng.choice(len(Xv), n_ref, replace=False)
    Xw_ref = (((Xv[ref_idx] - mu) / sd) * w).astype("float32")
    del Xv

    sub = Xw_ref[rng.choice(n_ref, min(N_DBAR, n_ref), replace=False)]
    d_bar = float(pdist(sub.astype("float64")).mean())
    tree = cKDTree(Xw_ref)
    nn_tr, _ = tree.query(Xw_ref, k=2, workers=-1)
    di_train = nn_tr[:, 1] / d_bar
    q75, q25 = np.percentile(di_train, [75, 25])
    aoa_thr = float(q75 + 1.5 * (q75 - q25))
    log.info("  d_bar=%.5f  umbral AOA=%.4f", d_bar, aoa_thr)

    # ---- Algemesi: DI + proba ----
    alg = pd.read_parquet(REPO / "data/dataset/training_dataset_algemesi.parquet",
                          columns=["row", "col", "flood_label", *PARQUET_FEATS])
    alg = alg.loc[np.isfinite(alg[PARQUET_FEATS].to_numpy()).all(1)].reset_index(drop=True)
    if RIVER in FEATS:
        alg = add_distance_to_river(alg, "algemesi", REPO)
        alg = alg.loc[np.isfinite(alg[RIVER].to_numpy())].reset_index(drop=True)
    n = len(alg)
    di = np.empty(n, "float32"); proba = np.empty(n, "float32")
    Xa = alg[FEATS].to_numpy("float64")
    for s in range(0, n, args.chunk):
        e = min(s + args.chunk, n)
        Xw = (((Xa[s:e] - mu) / sd) * w).astype("float32")
        nn, _ = tree.query(Xw, k=1, workers=-1)
        di[s:e] = (nn / d_bar).astype("float32")
        proba[s:e] = iso.predict(model.predict_proba(Xa[s:e])[:, 1]).astype("float32")
    y = alg["flood_label"].to_numpy("int8")
    inside = di <= aoa_thr
    pct_inside = float(100.0 * inside.mean())
    log.info("  Algemesi dentro de AOA: %.1f%% (fuera %.1f%%)", pct_inside, 100 - pct_inside)

    m_all, m_in, m_out = _metrics(y, proba, THR), _metrics(y[inside], proba[inside], THR), _metrics(y[~inside], proba[~inside], THR)
    for tag, m in [("TODO", m_all), ("DENTRO", m_in), ("FUERA", m_out)]:
        log.info("  %-7s n=%8d pos=%6d R=%.3f P=%.4f", tag, m["n"], m["n_pos"], m["recall"], m["precision"])

    out = {"method": "Meyer & Pebesma 2021 (LOO-NN DI, umbral Q75+1.5*IQR)",
           "model": f"v3-T ({len(FEATS)} features)", "features": list(FEATS),
           "n_ref": n_ref, "d_bar": d_bar,
           "aoa_threshold": aoa_thr, "operational_threshold": THR,
           "algemesi": {"n_total": n, "pct_inside_aoa": pct_inside,
                        "di_median": float(np.median(di)), "di_p90": float(np.percentile(di, 90))},
           "metrics": {"all": m_all, "inside_aoa": m_in, "outside_aoa": m_out},
           "weights": {f: float(w[i]) for i, f in enumerate(FEATS)}}
    (REPO / "results/model/aoa_v3t.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("  JSON: results/model/aoa_v3t.json")

    ref_grid = REPO / "data/extrapolation/features/sar/water_frequency_algemesi.tif"
    if ref_grid.exists():
        _write_mask(inside.astype("uint8"),
                    alg["row"].to_numpy("int32"), alg["col"].to_numpy("int32"),
                    ref_grid, REPO / "results/maps/05_extrapolation/aoa_inside_algemesi_v3t.tif",
                    "uint8", 255)
    else:
        log.warning("  Sin rejilla de referencia; se omite el raster de mascara.")
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
