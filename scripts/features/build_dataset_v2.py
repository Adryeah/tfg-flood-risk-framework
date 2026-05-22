#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_dataset_v2.py
-------------------
Construye training_dataset_v2.parquet con 14 features (las 11 originales
del v1 + 3 hidrogeomorfológicas: distance_to_coast, twi, hand) y la misma
flood_label corregida (clipping municipal).

Uso:
    python scripts/features/build_dataset_v2.py [--force]
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from sklearn.metrics import pairwise as _pw  # noqa
from scipy.stats import spearmanr

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

FEATURE_PATHS = [
    # SAR (6)
    ("mean_sigma0_vv",     "data/features/sar/mean_sigma0_vv.tif"),
    ("std_sigma0_vv",      "data/features/sar/std_sigma0_vv.tif"),
    ("min_sigma0_vv",      "data/features/sar/min_sigma0_vv.tif"),
    ("cv_sigma0_vv",       "data/features/sar/cv_sigma0_vv.tif"),
    ("mean_vv_vh_ratio",   "data/features/sar/mean_vv_vh_ratio.tif"),
    ("water_count",        "data/features/sar/water_count.tif"),
    # DEM básicas (4)
    ("elevation",          "data/dem/elevation.tif"),
    ("slope",              "data/dem/slope.tif"),
    ("distance_to_stream", "data/dem/distance_to_stream.tif"),
    ("flow_accumulation",  "data/dem/flow_accumulation.tif"),
    # Óptica (1)
    ("ndvi_mean",          "data/features/optical/ndvi_mean.tif"),
    # NUEVAS hidrogeomorfológicas (3)
    ("distance_to_coast",  "data/dem/distance_to_coast.tif"),
    ("twi",                "data/dem/twi.tif"),
    ("hand",               "data/dem/hand.tif"),
]
LABEL_PATH = "data/labels/flood_mask_emsr773_clipped.tif"


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _verify_alignment(paths):
    log.info("Verificando alineación de las %d features...", len(paths))
    ref_shape = ref_t = ref_crs = None
    for name, p in paths:
        if not p.exists():
            raise FileNotFoundError(p)
        with rasterio.open(p) as ds:
            if ref_shape is None:
                ref_shape = (ds.height, ds.width)
                ref_t = ds.transform
                ref_crs = ds.crs
                log.info("  REF  %-22s  shape=%s  CRS=%s", name, ref_shape, ref_crs)
                continue
            if (ds.height, ds.width) != ref_shape:
                raise ValueError(f"{name}: shape mismatch {(ds.height,ds.width)} vs {ref_shape}")
            if ds.crs != ref_crs:
                raise ValueError(f"{name}: CRS mismatch {ds.crs} vs {ref_crs}")
            if any(abs(a-b) > 1e-6 for a, b in zip(ds.transform, ref_t)):
                raise ValueError(f"{name}: transform mismatch")
            log.info("  OK   %-22s", name)
    return ref_shape, ref_t, ref_crs


def _build_stack(paths, shape):
    n = len(paths)
    rows, cols = shape
    stack = np.empty((n, rows, cols), dtype="float32")
    for i, (name, p) in enumerate(paths):
        with rasterio.open(p) as ds:
            arr = ds.read(1).astype("float32")
            nodata = ds.nodata
        if nodata is not None and not np.isnan(nodata):
            arr[arr == nodata] = np.nan
        stack[i] = arr
    log.info("Stack 3D: shape=%s  memoria=%.0f MB", stack.shape, stack.nbytes / 1e6)
    return stack


def _plot_correlation(df, feature_names, out_path):
    if not HAS_MPL:
        return []
    n = len(df)
    sample = df[feature_names].sample(min(500_000, n), random_state=42)
    rho, _ = spearmanr(sample.values, axis=0)
    rho_df = pd.DataFrame(rho, index=feature_names, columns=feature_names)
    pairs = []
    for i, fa in enumerate(feature_names):
        for j, fb in enumerate(feature_names):
            if j <= i: continue
            r = float(rho_df.iloc[i, j])
            if abs(r) > 0.8:
                pairs.append((fa, fb, r))
    pairs.sort(key=lambda x: -abs(x[2]))

    fig, ax = plt.subplots(figsize=(13, 11))
    img = ax.imshow(rho_df.values, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(feature_names)))
    ax.set_yticks(range(len(feature_names)))
    ax.set_xticklabels(feature_names, rotation=45, ha="right")
    ax.set_yticklabels(feature_names)
    for i in range(len(feature_names)):
        for j in range(len(feature_names)):
            ax.text(j, i, f"{rho_df.iloc[i,j]:.2f}",
                    ha="center", va="center", fontsize=7,
                    color="white" if abs(rho_df.iloc[i,j]) > 0.5 else "black")
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="ρ Spearman")
    ax.set_title("Matriz de correlación Spearman — 14 features (v2)", fontsize=12)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)
    return pairs


def main():
    t0 = time.time()
    parser = argparse.ArgumentParser(description="Build training_dataset_v2 (14 features).")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = _repo_root()
    paths = [(name, root / rel) for name, rel in FEATURE_PATHS]
    feature_names = [n for n, _ in paths]

    out_parquet = root / "data" / "dataset" / "training_dataset_v2.parquet"
    out_csv     = root / "data" / "dataset" / "training_sample_v2.csv"
    diag_dir    = root / "results" / "diagnostics" / "dataset"
    diag_dir.mkdir(parents=True, exist_ok=True)
    out_parquet.parent.mkdir(parents=True, exist_ok=True)

    if out_parquet.exists() and not args.force:
        log.info("v2 ya existe. Usa --force para regenerar.")
        return

    # 1) Verificar alineación
    shape, transform, crs = _verify_alignment(paths)

    # 2) Cargar stack
    stack = _build_stack(paths, shape)

    # 3) Cargar máscara (label)
    label_path = root / LABEL_PATH
    log.info("Cargando label: %s", label_path)
    with rasterio.open(label_path) as ds:
        flood_mask = ds.read(1)
    pct = 100 * (flood_mask == 1).sum() / flood_mask.size
    log.info("  Label: %d pixels=1 (%.2f%%)", int((flood_mask==1).sum()), pct)

    # 4) DataFrame
    rows, cols = shape
    rr, cc = np.indices((rows, cols))
    data = {"row": rr.ravel().astype("int32"), "col": cc.ravel().astype("int32")}
    for i, name in enumerate(feature_names):
        data[name] = stack[i].ravel()
    data["flood_label"] = flood_mask.ravel().astype("int8")

    df = pd.DataFrame(data)
    nan_mask = df[feature_names].isna().any(axis=1)
    pct_nan = 100 * nan_mask.sum() / len(df)
    log.info("  Filas con NaN: %d (%.2f%%)", int(nan_mask.sum()), pct_nan)
    df = df.loc[~nan_mask].reset_index(drop=True)

    # Inf check
    inf_mask = np.isinf(df[feature_names].values).any(axis=1)
    if inf_mask.sum() > 0:
        log.warning("Reemplazando %d inf por NaN y filtrando...", int(inf_mask.sum()))
        df[feature_names] = df[feature_names].replace([np.inf, -np.inf], np.nan)
        df = df.dropna(subset=feature_names).reset_index(drop=True)

    log.info("Dataset v2 final: %d filas × %d columnas", len(df), len(df.columns))

    # 5) Guardar
    df.to_parquet(out_parquet, index=False, compression="snappy")
    log.info("Parquet: %s (%.2f MB)", out_parquet, out_parquet.stat().st_size / 1e6)
    df.sample(min(10_000, len(df)), random_state=42).to_csv(out_csv, index=False)
    log.info("CSV sample: %s", out_csv)

    # 6) Distribución de clases
    counts = df["flood_label"].value_counts().sort_index()
    pct_0 = 100 * counts.get(0, 0) / len(df)
    pct_1 = 100 * counts.get(1, 0) / len(df)
    ratio = counts.get(0, 0) / max(counts.get(1, 0), 1)
    log.info("=" * 70)
    log.info("DISTRIBUCIÓN CLASE OBJETIVO (v2)")
    log.info("  Clase 0 (no inundado): %d (%.2f%%)", counts.get(0, 0), pct_0)
    log.info("  Clase 1 (inundado)   : %d (%.2f%%)", counts.get(1, 0), pct_1)
    log.info("  Ratio neg:pos        : %.1f : 1", ratio)
    log.info("=" * 70)

    # 7) Correlaciones
    log.info("Calculando matriz de correlación Spearman (sample 500k)...")
    high_pairs = _plot_correlation(df, feature_names,
                                    diag_dir / "feature_correlation_matrix_v2.png")
    if high_pairs:
        log.info("Pares con |ρ| > 0.8 (n=%d):", len(high_pairs))
        for a, b, r in high_pairs:
            log.info("  %-22s  ↔  %-22s  ρ=%+.3f", a, b, r)
    else:
        log.info("Ningún par con |ρ| > 0.8")

    log.info("=" * 70)
    log.info("RESUMEN build_dataset_v2  —  Tiempo total: %.1f s", time.time() - t0)
    log.info("  Filas              : %d", len(df))
    log.info("  Columnas           : %d  (row, col, 14 features, flood_label)", len(df.columns))
    log.info("  Tamaño parquet     : %.2f MB", out_parquet.stat().st_size / 1e6)
    log.info("=" * 70)


if __name__ == "__main__":
    main()
