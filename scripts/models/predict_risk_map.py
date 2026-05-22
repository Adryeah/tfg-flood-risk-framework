#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
predict_risk_map.py
-------------------
Aplica el modelo Random Forest entrenado a todo el bbox de estudio (7,5 M
píxeles) y genera el mapa predictivo de riesgo de inundación.

Outputs:
  - results/maps/04_risk_prediction/risk_probability.tif  (float32, [0,1])
  - results/maps/04_risk_prediction/risk_binary.tif       (uint8, 0/1)

Diagnósticos:
  - results/diagnostics/model/risk_probability_map.png
  - results/diagnostics/model/risk_binary_map.png
  - results/diagnostics/model/risk_vs_emsr773_overlay.png

Uso:
    python scripts/models/predict_risk_map.py \\
        --model models/random_forest_v1.joblib \\
        --threshold 0.668
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import List, Tuple

import joblib
import numpy as np
import pandas as pd
import rasterio
import yaml
from rasterio.crs import CRS

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

FEATURE_PATHS_V1: List[Tuple[str, str]] = [
    ("mean_sigma0_vv",     "data/features/sar/mean_sigma0_vv.tif"),
    ("std_sigma0_vv",      "data/features/sar/std_sigma0_vv.tif"),
    ("min_sigma0_vv",      "data/features/sar/min_sigma0_vv.tif"),
    ("cv_sigma0_vv",       "data/features/sar/cv_sigma0_vv.tif"),
    ("mean_vv_vh_ratio",   "data/features/sar/mean_vv_vh_ratio.tif"),
    ("water_count",        "data/features/sar/water_count.tif"),
    ("elevation",          "data/dem/elevation.tif"),
    ("slope",              "data/dem/slope.tif"),
    ("distance_to_stream", "data/dem/distance_to_stream.tif"),
    ("flow_accumulation",  "data/dem/flow_accumulation.tif"),
    ("ndvi_mean",          "data/features/optical/ndvi_mean.tif"),
]
FEATURE_PATHS_V2: List[Tuple[str, str]] = FEATURE_PATHS_V1 + [
    ("distance_to_coast",  "data/dem/distance_to_coast.tif"),
    ("twi",                "data/dem/twi.tif"),
    ("hand",               "data/dem/hand.tif"),
]
FEATURE_PATHS = FEATURE_PATHS_V1   # default backward compatible


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _format_secs(s: float) -> str:
    if s < 60:
        return f"{s:.1f}s"
    return f"{int(s//60)}m{int(s%60):02d}s"


# ---------------------------------------------------------------------------
# Inferencia
# ---------------------------------------------------------------------------

def predict_full_bbox(
    model,
    features: List[Path],
    feature_names: List[str],
    chunk_rows: int = 500,
) -> Tuple[np.ndarray, dict, CRS]:
    """
    Aplica predict_proba sobre todo el bbox píxel a píxel, en chunks de
    filas para no saturar memoria.

    Devuelve (probability_map, profile, crs) con shape (H, W) float32.
    """
    # Leer perfil de la primera feature como referencia
    with rasterio.open(features[0]) as ds:
        ref_profile = ds.profile.copy()
        ref_shape   = (ds.height, ds.width)
        ref_crs     = ds.crs

    rows, cols = ref_shape
    log.info("Grid: %d x %d  (%d píxeles totales)", rows, cols, rows * cols)

    # Cargar las 11 features apiladas en (n_features, H, W) float32
    log.info("Cargando 11 features en stack 3D...")
    n = len(features)
    stack = np.empty((n, rows, cols), dtype="float32")
    for i, p in enumerate(features):
        with rasterio.open(p) as ds:
            arr = ds.read(1).astype("float32")
            nodata = ds.nodata
        if nodata is not None and not np.isnan(nodata):
            arr[arr == nodata] = np.nan
        stack[i] = arr
    log.info("  Stack: %.0f MB", stack.nbytes / 1e6)

    # Inferencia por chunks
    out = np.full(ref_shape, np.nan, dtype="float32")
    n_chunks = int(np.ceil(rows / chunk_rows))
    log.info("Inferencia por chunks de %d filas (%d chunks)...", chunk_rows, n_chunks)
    t0 = time.time()
    for ci in range(n_chunks):
        r0 = ci * chunk_rows
        r1 = min(r0 + chunk_rows, rows)
        block = stack[:, r0:r1, :]
        # reshape a (n_pix, n_features)
        n_pix = (r1 - r0) * cols
        X_block = block.reshape(n, -1).T   # (n_pix, n_features)

        # filtrar NaN
        finite_mask = np.isfinite(X_block).all(axis=1)
        n_valid = int(finite_mask.sum())

        if n_valid > 0:
            proba = model.predict_proba(X_block[finite_mask])[:, 1]
            out_chunk = np.full(n_pix, np.nan, dtype="float32")
            out_chunk[finite_mask] = proba.astype("float32")
            out[r0:r1, :] = out_chunk.reshape(r1 - r0, cols)

        if (ci + 1) % 10 == 0 or ci == n_chunks - 1:
            elapsed = time.time() - t0
            pct = 100 * (ci + 1) / n_chunks
            eta = elapsed / (ci + 1) * (n_chunks - ci - 1)
            log.info("  chunk %d/%d  (%.1f%%)  elapsed=%s  ETA=%s",
                     ci + 1, n_chunks, pct, _format_secs(elapsed),
                     _format_secs(eta))

    log.info("Inferencia completada en %s", _format_secs(time.time() - t0))
    log.info("Píxeles válidos predichos: %d (%.2f%%)",
             int(np.isfinite(out).sum()),
             100 * np.isfinite(out).mean())
    return out, ref_profile, ref_crs


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def _write_raster(
    data: np.ndarray,
    out_path: Path,
    profile: dict,
    nodata,
    dtype: str,
) -> None:
    p = profile.copy()
    p.update(dtype=dtype, count=1, nodata=nodata, compress="lzw", driver="GTiff")
    for k in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
        p.pop(k, None)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **p) as dst:
        dst.write(data.astype(dtype), 1)
    log.info("Guardado: %s (%.2f MB)", out_path, out_path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def _plot_probability(
    proba: np.ndarray,
    out_path: Path,
    bounds_utm,
    title: str,
) -> None:
    if not HAS_MPL:
        return
    arr = proba.copy()
    extent_utm = (bounds_utm.left, bounds_utm.right,
                  bounds_utm.bottom, bounds_utm.top)
    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(arr, cmap="YlOrRd", vmin=0, vmax=1,
                    interpolation="nearest", extent=extent_utm)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                 label="P(inundado)")
    ax.set_title(title, fontsize=12)
    ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


def _plot_binary(
    binary: np.ndarray,
    out_path: Path,
    bounds_utm,
    threshold: float,
) -> None:
    if not HAS_MPL:
        return
    extent_utm = (bounds_utm.left, bounds_utm.right,
                  bounds_utm.bottom, bounds_utm.top)
    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(binary, cmap="Reds", vmin=0, vmax=1,
                    interpolation="nearest", extent=extent_utm)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="Inundable (0/1)")
    ax.set_title(f"Mapa de riesgo binario   threshold = {threshold:.3f}",
                 fontsize=12)
    ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


def _plot_overlay(
    proba: np.ndarray,
    truth_mask: np.ndarray,
    out_path: Path,
    bounds_utm,
    title: str,
) -> None:
    if not HAS_MPL:
        return
    extent_utm = (bounds_utm.left, bounds_utm.right,
                  bounds_utm.bottom, bounds_utm.top)
    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(proba, cmap="YlOrRd", vmin=0, vmax=1,
                    interpolation="nearest", extent=extent_utm)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="P(inundado)")
    # contorno azul del ground truth
    ax.contour(truth_mask, levels=[0.5], colors="#0066ff", linewidths=0.6,
               extent=extent_utm, origin="upper")
    ax.set_title(title, fontsize=12)
    ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


def _plot_histogram(
    proba: np.ndarray,
    threshold: float,
    out_path: Path,
) -> None:
    if not HAS_MPL:
        return
    valid = proba[np.isfinite(proba)]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.hist(valid, bins=80, color="#e76f51", edgecolor="black", alpha=0.8)
    ax.axvline(threshold, color="black", lw=1.3, ls="--",
               label=f"threshold = {threshold:.3f}")
    ax.set_xlabel("P(inundado)")
    ax.set_ylabel("Nº píxeles")
    ax.set_title("Distribución de probabilidades sobre el bbox de estudio")
    ax.set_yscale("log")
    ax.grid(True, alpha=0.3)
    ax.legend()
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    parser = argparse.ArgumentParser(
        description="Aplica el RF al bbox de estudio y genera mapa de riesgo."
    )
    parser.add_argument("--model", type=Path,
                        default=Path("models/random_forest_v1.joblib"),
                        help="Path al modelo joblib (relativo a la raíz del repo).")
    parser.add_argument("--threshold", type=float, required=True,
                        help="Umbral de decisión (de threshold_tuning.py).")
    parser.add_argument("--threshold-criterion", type=str, default="custom",
                        help="Etiqueta del criterio (max_f1, balanced, recall_target).")
    parser.add_argument("--chunk-rows", type=int, default=500,
                        help="Filas por chunk en la inferencia (memoria/velocidad).")
    parser.add_argument("--output-suffix", type=str, default="",
                        help="Sufijo para los outputs (risk_probability_{suffix}.tif, ...).")
    parser.add_argument("--features", choices=["v1", "v2"], default="v1",
                        help="Conjunto de features esperado por el modelo.")
    args = parser.parse_args()

    root  = _repo_root()
    paths = _load_yaml(root / "config" / "paths.yaml")

    model_path = root / args.model if not args.model.is_absolute() else args.model
    if not model_path.exists():
        raise FileNotFoundError(model_path)

    out_dir = root / paths["results"]["maps"]["risk_prediction"]
    diag_dir = root / "results" / "diagnostics" / "model"
    out_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    log.info("=" * 72)
    log.info("PREDICT_RISK_MAP")
    log.info("  Modelo            : %s", model_path)
    log.info("  Threshold         : %.4f  (%s)", args.threshold, args.threshold_criterion)
    log.info("=" * 72)

    log.info("Cargando modelo...")
    model = joblib.load(model_path)
    log.info("  Modelo cargado: %d árboles, max_depth=%s",
             getattr(model, "n_estimators", "?"),
             getattr(model, "max_depth", "?"))

    feature_paths = FEATURE_PATHS_V2 if args.features == "v2" else FEATURE_PATHS_V1
    feature_files = [root / rel for _, rel in feature_paths]
    feature_names = [name for name, _ in feature_paths]
    log.info("  Conjunto de features  : %s (%d features)", args.features, len(feature_names))

    proba_map, profile, crs = predict_full_bbox(
        model, feature_files, feature_names,
        chunk_rows=args.chunk_rows,
    )

    # Bounds para los plots
    with rasterio.open(feature_files[0]) as ds:
        bounds_utm = ds.bounds

    # Guardar GeoTIFFs
    sfx = f"_{args.output_suffix}" if args.output_suffix else ""
    out_proba  = out_dir / f"risk_probability{sfx}.tif"
    out_binary = out_dir / f"risk_binary{sfx}.tif"
    _write_raster(proba_map, out_proba, profile, nodata=np.nan, dtype="float32")
    binary = (proba_map >= args.threshold).astype("uint8")
    binary[~np.isfinite(proba_map)] = 255   # nodata
    _write_raster(binary, out_binary, profile, nodata=255, dtype="uint8")

    # Diagnostics
    log.info("Generando PNGs...")
    _plot_probability(
        proba_map, diag_dir / f"risk_probability_map{sfx}.png", bounds_utm,
        title=f"Probabilidad de inundación predicha por Random Forest{' — ' + args.output_suffix if args.output_suffix else ''}",
    )
    _plot_binary(
        binary if binary.max() < 2 else (binary == 1).astype("uint8"),
        diag_dir / f"risk_binary_map{sfx}.png", bounds_utm, args.threshold,
    )
    _plot_histogram(proba_map, args.threshold,
                     diag_dir / f"risk_probability_histogram{sfx}.png")

    # Overlay con EMSR773 ground truth
    truth_path = root / "data" / "labels" / "flood_mask_emsr773_clipped.tif"
    if truth_path.exists():
        with rasterio.open(truth_path) as ds:
            truth = ds.read(1)
        _plot_overlay(
            proba_map, truth,
            diag_dir / f"risk_vs_emsr773_overlay{sfx}.png", bounds_utm,
            title=f"Probabilidad RF (heatmap) + ground truth EMSR773 clipped (contorno azul){' — ' + args.output_suffix if args.output_suffix else ''}",
        )
    else:
        log.warning("No existe %s — overlay no generado", truth_path)

    # Estadísticas
    valid = proba_map[np.isfinite(proba_map)]
    log.info("=" * 72)
    log.info("RESUMEN PREDICT_RISK_MAP")
    log.info("  Píxeles totales        : %d", proba_map.size)
    log.info("  Píxeles válidos        : %d (%.2f%%)",
             len(valid), 100 * len(valid) / proba_map.size)
    log.info("  P(inundado) min/p50/max: %.4f / %.4f / %.4f",
             valid.min(), np.median(valid), valid.max())
    log.info("  Píxeles con P >= %.3f  : %d (%.2f%%)",
             args.threshold,
             int((valid >= args.threshold).sum()),
             100 * (valid >= args.threshold).mean())
    log.info("  Tiempo total           : %s", _format_secs(time.time() - t0))
    log.info("=" * 72)


if __name__ == "__main__":
    main()
