"""
Extrae features avanzadas para mejora del modelo predictivo:
  1. urban_mask: NDVI < 0.2 → probable asfalto/urbano (confunde al SAR)
  2. local_std_3x3, local_range_3x3: textura local sobre mean_sigma0_vv
  3. Seasonal features: verano (abr-sep) vs invierno (oct-mar) sobre sigma0_VV
Todas salen alineadas al grid canonico de Valencia (water_frequency.tif).

Output: data/features/advanced/{urban_mask,local_*,summer_*,winter_*}.tif
"""
from __future__ import annotations

import logging, sys, time
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject
from scipy.ndimage import uniform_filter

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]

MIN_LINEAR = 1e-9
TEXTURE_WINDOW = 5  # 5x5 px = 50x50 m

def _date_from_name(p: Path) -> str:
    for part in p.stem.split("_"):
        if len(part) == 8 and part.isdigit():
            return part
    return ""

def _is_summer(date_str: str) -> bool:
    """abr-sep (meses 4-9) = verano/seco"""
    m = int(date_str[4:6])
    return 4 <= m <= 9

def _reproject_band(src_path: Path, band_idx: int, canon_transform, canon_crs, canon_shape):
    rows, cols = canon_shape
    dst = np.empty((rows, cols), dtype="float32")
    with rasterio.open(src_path) as src:
        rio_reproject(
            source=rasterio.band(src, band_idx), destination=dst,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=canon_transform, dst_crs=canon_crs,
            resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan,
        )
    with np.errstate(divide="ignore", invalid="ignore"):
        db = np.where(dst > MIN_LINEAR, 10.0 * np.log10(dst), np.nan).astype("float32")
    return db

def _band_index(src_path: Path, name: str) -> int:
    with rasterio.open(src_path) as ds:
        for i, desc in enumerate(ds.descriptions, start=1):
            if desc and name.lower() in desc.lower():
                return i
    return 2 if name.upper() == "VV" else 1

def local_texture_2d(arr: np.ndarray, window: int = TEXTURE_WINDOW) -> dict:
    """Textura local rapida: std y rango en ventana NxN con scipy uniform_filter."""
    valid = np.isfinite(arr)
    arr_filled = np.where(valid, arr, 0.0).astype("float64")

    # Media local
    kernel = np.ones((window, window)) / (window * window)
    local_mean = uniform_filter(arr_filled, size=window)
    local_sq_mean = uniform_filter(arr_filled ** 2, size=window)
    local_var = np.maximum(local_sq_mean - local_mean ** 2, 0)
    local_std = np.sqrt(local_var).astype("float32")

    # Rango local con max/min filters
    from scipy.ndimage import maximum_filter, minimum_filter
    local_max = maximum_filter(arr_filled, size=window)
    local_min = minimum_filter(arr_filled, size=window)
    local_range = (local_max - local_min).astype("float32")

    # Invalidar bordes y NaN
    local_std[~valid] = np.nan
    local_range[~valid] = np.nan

    # Border = NaN (donde la ventana sale del dominio valido)
    half = window // 2
    local_std[:half, :] = np.nan; local_std[-half:, :] = np.nan
    local_std[:, :half] = np.nan; local_std[:, -half:] = np.nan
    local_range[:half, :] = np.nan; local_range[-half:, :] = np.nan
    local_range[:, :half] = np.nan; local_range[:, -half:] = np.nan

    return {"local_std_5x5": local_std, "local_range_5x5": local_range}


def main():
    t0 = time.time()
    out_dir = REPO / "data" / "features" / "advanced"
    out_dir.mkdir(parents=True, exist_ok=True)

    # === Grid canonico ===
    water_path = REPO / "data" / "sentinel1" / "water_masks" / "water_frequency.tif"
    with rasterio.open(water_path) as ref:
        canon_t = ref.transform
        canon_crs = ref.crs
        canon_shape = (ref.height, ref.width)
    log.info("Grid canonico: %s  px=%.0f m  CRS=%s", canon_shape, canon_t.a, canon_crs)
    rows, cols = canon_shape

    # ================================================================
    # FEATURE 1: Urban mask (NDVI < 0.2 + condiciones)
    # ================================================================
    log.info("=== FEATURE 1: Urban mask ===")
    ndvi_path = REPO / "data" / "sentinel2" / "indices" / "ndvi_mean.tif"
    if ndvi_path.exists():
        with rasterio.open(ndvi_path) as src:
            ndvi = src.read(1).astype("float32")
        # Reproject to canonical grid if needed
        if src.crs != canon_crs or src.transform != canon_t or (src.height, src.width) != canon_shape:
            ndvi_r = np.full(canon_shape, np.nan, dtype="float32")
            rio_reproject(
                source=ndvi, destination=ndvi_r,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=canon_t, dst_crs=canon_crs,
                resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan,
            )
            ndvi = ndvi_r
        urban = np.where(np.isfinite(ndvi) & (ndvi < 0.2), 1.0, 0.0).astype("float32")
        urban[~np.isfinite(ndvi)] = np.nan
        prof = {"driver": "GTiff", "dtype": "float32", "count": 1,
                "width": cols, "height": rows, "crs": canon_crs,
                "transform": canon_t, "nodata": np.nan, "compress": "lzw"}
        with rasterio.open(out_dir / "urban_mask.tif", "w", **prof) as dst:
            dst.write(urban, 1)
        pct_urban = 100 * urban[np.isfinite(urban)].mean()
        log.info("  urban_mask.tif guardado — %.1f%% del area es urbano/suelo desnudo", pct_urban)
    else:
        log.warning("  No se encontro ndvi_mean.tif, saltando urban mask")

    # ================================================================
    # FEATURE 2: Textura local (std y rango en ventana 5x5)
    # ================================================================
    log.info("=== FEATURE 2: Textura local sobre mean_sigma0_vv ===")
    mean_vv_path = REPO / "data" / "features" / "sar" / "mean_sigma0_vv.tif"
    if mean_vv_path.exists():
        with rasterio.open(mean_vv_path) as src:
            mean_vv = src.read(1).astype("float32")
        log.info("  Calculando textura local ventana %dx%d...", TEXTURE_WINDOW, TEXTURE_WINDOW)
        texture = local_texture_2d(mean_vv, TEXTURE_WINDOW)
        for name, arr in texture.items():
            p = out_dir / f"{name}.tif"
            prof = {"driver": "GTiff", "dtype": "float32", "count": 1,
                    "width": cols, "height": rows, "crs": canon_crs,
                    "transform": canon_t, "nodata": np.nan, "compress": "lzw"}
            with rasterio.open(p, "w", **prof) as dst:
                dst.write(arr, 1)
            v = arr[np.isfinite(arr)]
            log.info("  %s.tif  mediana=%.4f  valido=%.1f%%", name, np.median(v) if len(v) else 0, 100*len(v)/arr.size)
    else:
        log.warning("  No se encontro mean_sigma0_vv.tif, saltando textura local")

    # ================================================================
    # FEATURE 3: Seasonal (summer vs winter) sigma0_VV statistics
    # ================================================================
    log.info("=== FEATURE 3: Seasonal features ===")
    processed_dir = REPO / "data" / "sentinel1" / "processed"
    tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*.tif") if "event" not in p.parts)
    log.info("  Escenas disponibles: %d", len(tifs))

    summer_dates = []; winter_dates = []
    for t in tifs:
        d = _date_from_name(t)
        if _is_summer(d):
            summer_dates.append((d, t))
        else:
            winter_dates.append((d, t))
    log.info("  Verano (abr-sep): %d escenas", len(summer_dates))
    log.info("  Invierno (oct-mar): %d escenas", len(winter_dates))

    vv_idx = _band_index(tifs[0], "VV")

    # Summer stack
    summer_vv = np.empty((len(summer_dates), rows, cols), dtype="float32")
    for i, (d, t) in enumerate(summer_dates):
        summer_vv[i] = _reproject_band(t, vv_idx, canon_t, canon_crs, canon_shape)
        log.info("  summer [%d/%d] %s", i+1, len(summer_dates), d)

    winter_vv = np.empty((len(winter_dates), rows, cols), dtype="float32")
    for i, (d, t) in enumerate(winter_dates):
        winter_vv[i] = _reproject_band(t, vv_idx, canon_t, canon_crs, canon_shape)
        log.info("  winter [%d/%d] %s", i+1, len(winter_dates), d)

    # Compute seasonal features
    log.info("  Calculando seasonal features...")
    summer_mean = np.nanmean(summer_vv, axis=0).astype("float32")
    winter_mean = np.nanmean(winter_vv, axis=0).astype("float32")
    summer_min = np.nanmin(summer_vv, axis=0).astype("float32")
    winter_min = np.nanmin(winter_vv, axis=0).astype("float32")
    summer_std = np.nanstd(summer_vv, axis=0).astype("float32")
    winter_std = np.nanstd(winter_vv, axis=0).astype("float32")
    diff_season = (winter_mean - summer_mean).astype("float32")  # negativo → invierno mas bajo (mas agua)

    seasonal = {
        "summer_mean_sigma0_vv": summer_mean,
        "winter_mean_sigma0_vv": winter_mean,
        "summer_min_sigma0_vv": summer_min,
        "winter_min_sigma0_vv": winter_min,
        "summer_std_sigma0_vv": summer_std,
        "winter_std_sigma0_vv": winter_std,
        "winter_minus_summer_vv": diff_season,
    }

    del summer_vv, winter_vv

    for name, arr in seasonal.items():
        p = out_dir / f"{name}.tif"
        prof = {"driver": "GTiff", "dtype": "float32", "count": 1,
                "width": cols, "height": rows, "crs": canon_crs,
                "transform": canon_t, "nodata": np.nan, "compress": "lzw"}
        with rasterio.open(p, "w", **prof) as dst:
            dst.write(arr, 1)
        v = arr[np.isfinite(arr)]
        log.info("  %s.tif  mediana=%.2f  valido=%.1f%%", name, np.median(v) if len(v) else 0, 100*len(v)/arr.size)

    elapsed = time.time() - t0
    log.info("=== COMPLETADO en %.1f min ===", elapsed / 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
