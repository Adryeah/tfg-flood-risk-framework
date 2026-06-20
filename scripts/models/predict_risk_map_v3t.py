#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
predict_risk_map_v3t.py
-----------------------
Genera los mapas de riesgo con el modelo-nucleo TRANSFERIBLE v3-T (lozo9,
9 features, calibrado) para Valencia y Algemesi.

A diferencia de predict_risk_map.py (v1/v2): usa el subconjunto lozo9,
aplica la calibracion isotonica y el umbral operacional 0,310 guardados en
models/v3t_calibrator.joblib.

NO sobrescribe los mapas v2 (escribe sufijo _v3t) — quedan como respaldo y
para comparacion.

Salidas:
  results/maps/04_risk_prediction/risk_probability_v3t.tif        (Valencia)
  results/maps/04_risk_prediction/risk_binary_v3t.tif
  results/maps/05_extrapolation/risk_probability_algemesi_v3t.tif (Algemesi)
  results/maps/05_extrapolation/risk_binary_algemesi_v3t.tif

Uso:
  .venv/Scripts/python.exe scripts/models/predict_risk_map_v3t.py
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import joblib
import numpy as np
import rasterio

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]

# Rutas de features por zona, en el ORDEN exacto de entrenamiento (lozo9).
ZONES = {
    "valencia": {
        "feat_dir_sar": "data/features/sar",
        "feat_dir_dem": "data/dem",
        "ndvi": "data/features/optical/ndvi_mean.tif",
        "out_proba": "results/maps/04_risk_prediction/risk_probability_v3t.tif",
        "out_binary": "results/maps/04_risk_prediction/risk_binary_v3t.tif",
    },
    "algemesi": {
        "feat_dir_sar": "data/extrapolation/features/sar",
        "feat_dir_dem": "data/extrapolation/dem",
        "ndvi": "data/extrapolation/features/optical/ndvi_mean.tif",
        "out_proba": "results/maps/05_extrapolation/risk_probability_algemesi_v3t.tif",
        "out_binary": "results/maps/05_extrapolation/risk_binary_algemesi_v3t.tif",
    },
}


def _feat_path(z: dict, name: str) -> Path:
    sar = {"mean_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv", "water_count"}
    if name == "ndvi_mean":
        return REPO / z["ndvi"]
    base = z["feat_dir_sar"] if name in sar else z["feat_dir_dem"]
    return REPO / base / f"{name}.tif"


def _predict_zone(zone: str, z: dict, model, iso, feats, thr) -> None:
    log.info("==== %s ====", zone)
    # Rejilla de referencia = primera feature
    ref = _feat_path(z, feats[0])
    with rasterio.open(ref) as ds:
        prof = ds.profile.copy()
        H, W = ds.height, ds.width
    log.info("  grid %dx%d (%d px)", H, W, H * W)

    # Stack de las 9 features (alineadas; mismo grid canonico por construccion)
    stack = np.empty((len(feats), H, W), dtype="float32")
    for i, name in enumerate(feats):
        p = _feat_path(z, name)
        with rasterio.open(p) as ds:
            arr = ds.read(1).astype("float32")
            nd = ds.nodata
        if nd is not None and not np.isnan(nd):
            arr[arr == nd] = np.nan
        stack[i] = arr
    log.info("  stack %.0f MB", stack.nbytes / 1e6)

    proba = np.full((H, W), np.nan, dtype="float32")
    t0 = time.time()
    CHUNK = 400
    for r0 in range(0, H, CHUNK):
        r1 = min(r0 + CHUNK, H)
        block = stack[:, r0:r1, :].reshape(len(feats), -1).T  # (npix, nfeat)
        fin = np.isfinite(block).all(axis=1)
        if fin.any():
            raw = model.predict_proba(block[fin])[:, 1]
            cal = iso.predict(raw).astype("float32")  # calibracion isotonica
            outc = np.full(block.shape[0], np.nan, dtype="float32")
            outc[fin] = cal
            proba[r0:r1, :] = outc.reshape(r1 - r0, W)
    log.info("  inferencia %.1f min", (time.time() - t0) / 60)

    binary = (proba >= thr).astype("uint8")
    binary[~np.isfinite(proba)] = 255

    pp = prof.copy()
    pp.update(dtype="float32", count=1, nodata=np.nan, compress="lzw", driver="GTiff")
    for k in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
        pp.pop(k, None)
    op = REPO / z["out_proba"]; op.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(op, "w", **pp) as dst:
        dst.write(proba, 1)
    pb = pp.copy(); pb.update(dtype="uint8", nodata=255)
    ob = REPO / z["out_binary"]
    with rasterio.open(ob, "w", **pb) as dst:
        dst.write(binary, 1)

    valid = proba[np.isfinite(proba)]
    flooded = int((valid >= thr).sum())
    log.info("  proba p50=%.3f  px>=thr(%.3f)=%d (%.2f%%)",
             float(np.median(valid)), thr, flooded, 100 * flooded / max(len(valid), 1))
    log.info("  -> %s", op.relative_to(REPO))
    log.info("  -> %s", ob.relative_to(REPO))


def main() -> int:
    t0 = time.time()
    model = joblib.load(REPO / "models/random_forest_v3t.joblib")
    cal = joblib.load(REPO / "models/v3t_calibrator.joblib")
    iso, feats, thr = cal["isotonic"], cal["features"], cal["threshold"]
    log.info("v3-T: %d features, umbral=%.3f", len(feats), thr)
    log.info("features: %s", feats)
    for zone, z in ZONES.items():
        _predict_zone(zone, z, model, iso, feats, thr)
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
