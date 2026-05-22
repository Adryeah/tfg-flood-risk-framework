"""
Calcula las 6 features SAR temporales para Algemesi a partir de las 24
escenas baseline reprocesadas con bbox combinado Valencia+Algemesi.

Replica la metodologia de Semana 3 (extract_sar_features.py + water_detection.py):
  - Para cada GeoTIFF S1_sigma0_YYYYMMDD_orb103.tif (excluyendo event/):
      a) Lee Sigma0_VV y Sigma0_VH en lineal.
      b) Reproyecta al grid canonico Algemesi (10 m UTM30N).
      c) Convierte a dB.
      d) Aplica Multi-Otsu (3 clases) sobre VV en dB -> umbral.
      e) Acumula mascara de agua y stacks VV/VH en memoria.
  - Tras procesar las 24 escenas:
      mean_sigma0_vv, std_sigma0_vv, min_sigma0_vv, cv_sigma0_vv,
      mean_vv_vh_ratio, water_count (suma de mascaras de agua, 0-24).

Outputs (data/extrapolation/features/sar/):
  mean_sigma0_vv.tif, std_sigma0_vv.tif, min_sigma0_vv.tif, cv_sigma0_vv.tif,
  mean_vv_vh_ratio.tif, water_count.tif, water_frequency_algemesi.tif

Diagnosticos: results/diagnostics/sar_features_algemesi/*.png
"""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject
from skimage.filters import threshold_multiotsu

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

REPO_ROOT = Path(__file__).resolve().parents[2]
NAN_FRACTION_THRESHOLD = 0.20
MIN_LINEAR = 1e-9


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _date_from_name(p: Path) -> str:
    stem = p.stem
    for part in stem.split("_"):
        if len(part) == 8 and part.isdigit():
            return part
    return stem


def _band_index(src_path: Path, name: str) -> int:
    with rasterio.open(src_path) as ds:
        for i, desc in enumerate(ds.descriptions, start=1):
            if desc and name.lower() in desc.lower():
                return i
    return 2 if name.upper() == "VV" else 1


def _reproject_to_canon_db(
    src_path: Path, band_idx: int,
    canon_transform, canon_crs: CRS, canon_shape: tuple,
) -> np.ndarray:
    """Reproyecta una banda lineal al grid canonico Algemesi y devuelve dB."""
    rows, cols = canon_shape
    dst = np.empty((rows, cols), dtype="float32")
    with rasterio.open(src_path) as src:
        rio_reproject(
            source=rasterio.band(src, band_idx), destination=dst,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=canon_transform, dst_crs=canon_crs,
            resampling=Resampling.bilinear,
            src_nodata=src.nodata, dst_nodata=np.nan,
        )
    with np.errstate(divide="ignore", invalid="ignore"):
        db = np.where(dst > MIN_LINEAR, 10.0 * np.log10(dst), np.nan).astype("float32")
    return db


def _multi_otsu_threshold(vv_db: np.ndarray) -> float | None:
    """Devuelve umbral bajo (clase 2-3) de Multi-Otsu 3 clases. None si falla."""
    finite = vv_db[np.isfinite(vv_db)]
    if finite.size < 1000:
        log.warning("    multi-Otsu: insuficientes pixeles validos (%d)", finite.size)
        return None
    try:
        thresholds = threshold_multiotsu(finite, classes=3)
        return float(thresholds[0])
    except Exception as exc:
        log.warning("    multi-Otsu fallo: %s", exc)
        return None


def main() -> int:
    t0 = time.time()
    paths = _load_yaml(REPO_ROOT / "config" / "paths.yaml")

    # 1. Grid canonico
    canon_path = REPO_ROOT / paths["data"]["extrapolation"]["dem"] / "canonical_grid.tif"
    if not canon_path.exists():
        log.error("Falta canonical_grid.tif: %s", canon_path)
        return 1
    with rasterio.open(canon_path) as ref:
        canon_transform = ref.transform
        canon_crs       = ref.crs
        canon_shape     = (ref.height, ref.width)
    log.info("Grid canonico Algemesi: %s  px=%.0f m  CRS=%s",
             canon_shape, canon_transform.a, canon_crs)

    # 2. Lista de escenas baseline reprocesadas
    processed_dir = REPO_ROOT / paths["data"]["sentinel1"]["processed"]
    tifs = sorted(
        p for p in processed_dir.glob("S1_sigma0_*.tif")
        if "event" not in p.parts
    )
    if len(tifs) == 0:
        log.error("No hay escenas baseline en %s", processed_dir)
        return 1
    log.info("Escenas baseline: %d", len(tifs))

    # 3. Procesar escena por escena (memoria: stacks VV/VH dB + water_count)
    rows, cols = canon_shape
    n = len(tifs)
    mem_est_mb = 2 * n * rows * cols * 4 / 1e6
    log.info("Memoria estimada para 2 stacks float32 (%dx%dx%d): %.0f MB",
             n, rows, cols, mem_est_mb)
    vv_stack = np.empty((n, rows, cols), dtype="float32")
    vh_stack = np.empty((n, rows, cols), dtype="float32")
    water_count = np.zeros(canon_shape, dtype="int32")
    n_valid_per_pixel = np.zeros(canon_shape, dtype="int16")
    thresholds = []

    vv_idx = _band_index(tifs[0], "VV")
    vh_idx = _band_index(tifs[0], "VH")

    for i, tif in enumerate(tifs):
        d = _date_from_name(tif)
        vv_db = _reproject_to_canon_db(tif, vv_idx, canon_transform, canon_crs, canon_shape)
        vh_db = _reproject_to_canon_db(tif, vh_idx, canon_transform, canon_crs, canon_shape)
        vv_stack[i] = vv_db
        vh_stack[i] = vh_db
        valid = np.isfinite(vv_db)
        n_valid_per_pixel += valid.astype("int16")
        # Multi-Otsu
        thr = _multi_otsu_threshold(vv_db)
        if thr is not None:
            water_mask = valid & (vv_db < thr)
            water_count += water_mask.astype("int32")
        thresholds.append(thr if thr is not None else np.nan)
        log.info("  [%2d/%d] %s  VV %.1f...%.1f dB  thr=%s  valid=%.1f%%",
                 i + 1, n, d,
                 float(np.nanmin(vv_db)) if np.any(valid) else np.nan,
                 float(np.nanmax(vv_db)) if np.any(valid) else np.nan,
                 f"{thr:.2f}" if thr is not None else "n/a",
                 100.0 * valid.mean())

    # 4. Calcular features
    log.info("=" * 60)
    log.info("Calculando features SAR temporales...")
    log.info("=" * 60)
    invalid = (np.isnan(vv_stack).sum(axis=0) / n) > NAN_FRACTION_THRESHOLD
    pct_inv = 100.0 * invalid.mean()
    log.info("  Pixels invalidos (NaN > %.0f%%): %.2f%%",
             NAN_FRACTION_THRESHOLD * 100, pct_inv)

    mean_vv = np.nanmean(vv_stack, axis=0).astype("float32")
    std_vv  = np.nanstd(vv_stack, axis=0).astype("float32")
    min_vv  = np.nanmin(vv_stack, axis=0).astype("float32")
    with np.errstate(divide="ignore", invalid="ignore"):
        cv_vv = np.where(np.abs(mean_vv) > 0.5, std_vv / np.abs(mean_vv), np.nan).astype("float32")
    diff = vv_stack - vh_stack
    mean_ratio = np.nanmean(diff, axis=0).astype("float32")

    for arr in (mean_vv, std_vv, min_vv, cv_vv, mean_ratio):
        arr[invalid] = np.nan

    # water_count: poner NaN en pixels totalmente invalidos
    wc = water_count.astype("float32")
    wc[n_valid_per_pixel == 0] = np.nan

    # Liberar stacks
    del vv_stack, vh_stack, diff

    # 5. Guardar features
    out_dir = REPO_ROOT / "data" / "extrapolation" / "features" / "sar"
    out_dir.mkdir(parents=True, exist_ok=True)

    def _write(arr: np.ndarray, name: str) -> Path:
        p = out_dir / f"{name}.tif"
        prof = {
            "driver": "GTiff", "dtype": "float32", "count": 1,
            "width": cols, "height": rows, "crs": canon_crs,
            "transform": canon_transform, "nodata": np.nan, "compress": "lzw",
        }
        with rasterio.open(p, "w", **prof) as dst:
            dst.write(arr.astype("float32"), 1)
        log.info("  %-35s  %.2f MB", p.name, p.stat().st_size / 1e6)
        return p

    log.info("Guardando features Algemesi en %s", out_dir)
    _write(mean_vv,    "mean_sigma0_vv")
    _write(std_vv,     "std_sigma0_vv")
    _write(min_vv,     "min_sigma0_vv")
    _write(cv_vv,      "cv_sigma0_vv")
    _write(mean_ratio, "mean_vv_vh_ratio")
    _write(wc,         "water_count")
    _write(wc,         "water_frequency_algemesi")  # alias para visualizacion

    # 6. Diagnosticos
    if HAS_MPL:
        diag_dir = REPO_ROOT / "results" / "diagnostics" / "sar_features_algemesi"
        diag_dir.mkdir(parents=True, exist_ok=True)
        feats = {
            "mean_sigma0_vv":   ("viridis",  "mean sigma0_VV (dB)"),
            "std_sigma0_vv":    ("magma",    "std sigma0_VV (dB)"),
            "min_sigma0_vv":    ("Blues_r",  "min sigma0_VV (dB)"),
            "cv_sigma0_vv":     ("YlOrRd",   "CV sigma0_VV"),
            "mean_vv_vh_ratio": ("RdBu",     "mean (VV-VH) dB"),
            "water_count":      ("Blues",    "water_count (0-24)"),
        }
        for name, (cmap, label) in feats.items():
            arr_path = out_dir / f"{name}.tif"
            with rasterio.open(arr_path) as ds:
                arr = ds.read(1).astype("float32")
                if ds.nodata is not None and not np.isnan(ds.nodata):
                    arr[arr == ds.nodata] = np.nan
            valid = arr[np.isfinite(arr)]
            if len(valid) == 0:
                continue
            vmin, vmax = np.percentile(valid, [2, 98])
            fig, ax = plt.subplots(figsize=(10, 8))
            img = ax.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax,
                            interpolation="nearest")
            plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label=label)
            ax.set_title(f"Algemesi - {name}", fontsize=12)
            ax.axis("off")
            plt.tight_layout()
            png = diag_dir / f"{name}.png"
            plt.savefig(png, dpi=150, bbox_inches="tight")
            plt.close()
            log.info("  PNG: %s", png.name)

    elapsed = time.time() - t0
    log.info("=" * 70)
    log.info("RESUMEN extract_algemesi_sar_features")
    log.info("  Escenas baseline procesadas: %d", n)
    log.info("  Multi-Otsu thresholds (dB): mean=%.2f std=%.2f",
             float(np.nanmean(thresholds)), float(np.nanstd(thresholds)))
    log.info("  Tiempo total: %.1f min", elapsed / 60)
    log.info("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
