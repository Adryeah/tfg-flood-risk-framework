"""
Construye training_dataset_algemesi.parquet con las 14 features extrapoladas
(misma lista que v2 de Valencia) + flood_label clipped por los 12 municipios
DANA del bbox Algemesi.

Inputs (todos alineados al canonical_grid Algemesi @ 10 m EPSG:32630):

  SAR (6):
    data/extrapolation/features/sar/{mean,std,min,cv}_sigma0_vv.tif
    data/extrapolation/features/sar/mean_vv_vh_ratio.tif
    data/extrapolation/features/sar/water_count.tif

  DEM basicas (4):
    data/extrapolation/dem/{elevation,slope,distance_to_stream,flow_accumulation}.tif

  Optica (1):
    data/extrapolation/features/optical/ndvi_mean.tif

  Avanzadas DEM (3):
    data/extrapolation/dem/{distance_to_coast,twi,hand}.tif

  Etiqueta:
    data/labels/algemesi/flood_mask_algemesi_clipped.tif

Output:
  data/dataset/training_dataset_algemesi.parquet (uint8 flood_label)

Verifica que todas las features esten alineadas (mismo shape/transform/CRS) y
descarta filas con cualquier NaN/inf en las features.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]

FEATURE_PATHS = [
    ("mean_sigma0_vv",     "data/extrapolation/features/sar/mean_sigma0_vv.tif"),
    ("std_sigma0_vv",      "data/extrapolation/features/sar/std_sigma0_vv.tif"),
    ("min_sigma0_vv",      "data/extrapolation/features/sar/min_sigma0_vv.tif"),
    ("cv_sigma0_vv",       "data/extrapolation/features/sar/cv_sigma0_vv.tif"),
    ("mean_vv_vh_ratio",   "data/extrapolation/features/sar/mean_vv_vh_ratio.tif"),
    ("water_count",        "data/extrapolation/features/sar/water_count.tif"),
    ("elevation",          "data/extrapolation/dem/elevation.tif"),
    ("slope",              "data/extrapolation/dem/slope.tif"),
    ("distance_to_stream", "data/extrapolation/dem/distance_to_stream.tif"),
    ("flow_accumulation",  "data/extrapolation/dem/flow_accumulation.tif"),
    ("ndvi_mean",          "data/extrapolation/features/optical/ndvi_mean.tif"),
    ("distance_to_coast",  "data/extrapolation/dem/distance_to_coast.tif"),
    ("twi",                "data/extrapolation/dem/twi.tif"),
    ("hand",               "data/extrapolation/dem/hand.tif"),
]
LABEL_PATH = "data/labels/algemesi/flood_mask_algemesi_clipped.tif"


def _verify_alignment(paths):
    log.info("Verificando alineacion de %d features + label...", len(paths))
    ref_shape = ref_t = ref_crs = None
    for name, rel in paths:
        p = REPO_ROOT / rel
        if not p.exists():
            raise FileNotFoundError(f"Falta {name}: {p}")
        with rasterio.open(p) as ds:
            if ref_shape is None:
                ref_shape = (ds.height, ds.width); ref_t = ds.transform; ref_crs = ds.crs
                log.info("  %-22s  shape=%s  CRS=%s  px=%.0f m  REF",
                         name, ref_shape, ref_crs, ref_t.a)
            else:
                ok = (ds.height, ds.width) == ref_shape and ds.crs == ref_crs
                same_t = (abs(ds.transform.a - ref_t.a) < 1e-6 and
                          abs(ds.transform.e - ref_t.e) < 1e-6 and
                          abs(ds.transform.c - ref_t.c) < 1e-6 and
                          abs(ds.transform.f - ref_t.f) < 1e-6)
                if ok and same_t:
                    log.info("  %-22s  OK", name)
                else:
                    log.warning("  %-22s  MISMATCH shape=%s CRS=%s transform_eq=%s",
                                name, (ds.height, ds.width), ds.crs, same_t)
    return ref_shape, ref_t, ref_crs


def main() -> int:
    t0 = time.time()
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    out_dir = REPO_ROOT / "data" / "dataset"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_parquet = out_dir / "training_dataset_algemesi.parquet"
    out_csv     = out_dir / "training_sample_algemesi.csv"

    if out_parquet.exists() and not args.force:
        log.info("training_dataset_algemesi.parquet ya existe. --force para regenerar.")
        return 0

    paths = FEATURE_PATHS + [("flood_label", LABEL_PATH)]
    ref_shape, ref_t, ref_crs = _verify_alignment(paths)

    rows, cols = ref_shape
    n_feat = len(FEATURE_PATHS)
    log.info("Shape: %dx%d = %.1f Mpx | features: %d", rows, cols,
             rows * cols / 1e6, n_feat)

    log.info("Cargando features y label en RAM...")
    stack = np.empty((n_feat, rows, cols), dtype="float32")
    for i, (name, rel) in enumerate(FEATURE_PATHS):
        with rasterio.open(REPO_ROOT / rel) as ds:
            arr = ds.read(1).astype("float32")
            nd = ds.nodata
        if nd is not None and not np.isnan(nd):
            arr[arr == nd] = np.nan
        stack[i] = arr

    with rasterio.open(REPO_ROOT / LABEL_PATH) as ds:
        label = ds.read(1)

    # Build dataframe
    log.info("Construyendo DataFrame...")
    rr, cc = np.indices((rows, cols))
    data = {
        "row": rr.ravel().astype("int32"),
        "col": cc.ravel().astype("int32"),
    }
    for i, (name, _) in enumerate(FEATURE_PATHS):
        data[name] = stack[i].ravel()
    data["flood_label"] = label.ravel().astype("int8")
    df = pd.DataFrame(data)
    log.info("  Total px: %d", len(df))

    # Filter NaN / inf
    feat_names = [name for name, _ in FEATURE_PATHS]
    nan_mask = df[feat_names].isna().any(axis=1)
    df_clean = df.loc[~nan_mask].reset_index(drop=True)
    inf_mask = np.isinf(df_clean[feat_names]).any(axis=1)
    df_clean = df_clean.loc[~inf_mask].reset_index(drop=True)
    log.info("  Tras descartar NaN/inf: %d filas (-%.1f%%)",
             len(df_clean), 100 * (1 - len(df_clean) / max(len(df), 1)))

    counts = df_clean["flood_label"].value_counts().sort_index()
    p0 = 100 * counts.get(0, 0) / len(df_clean)
    p1 = 100 * counts.get(1, 0) / len(df_clean)
    ratio = counts.get(0, 0) / max(counts.get(1, 0), 1)
    log.info("  Clase 0 (no inundado): %d (%.2f%%)", counts.get(0, 0), p0)
    log.info("  Clase 1 (inundado)   : %d (%.2f%%)", counts.get(1, 0), p1)
    log.info("  Ratio neg:pos        : %.1f : 1", ratio)

    df_clean.to_parquet(out_parquet, index=False, compression="snappy")
    log.info("Parquet guardado: %s (%.2f MB)",
             out_parquet, out_parquet.stat().st_size / 1e6)

    # Sample CSV para inspeccion rapida
    sample_n = min(10_000, len(df_clean))
    df_clean.sample(sample_n, random_state=42).to_csv(out_csv, index=False)
    log.info("Sample CSV: %s (%d filas)", out_csv, sample_n)

    elapsed = time.time() - t0
    log.info("=" * 70)
    log.info("RESUMEN build_algemesi_dataset: %.1f s", elapsed)
    log.info("  Filas finales: %d", len(df_clean))
    log.info("  Columnas: %d (row, col, %d features, flood_label)",
             len(df_clean.columns), n_feat)
    log.info("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
