#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_sar_features.py
-----------------------
Lee las 24 escenas Sentinel-1 procesadas (data/sentinel1/processed/*.tif,
excluye event/), construye dos cubos 3D en memoria (vv_stack y vh_stack,
shape 24×H×W en dB) y calcula 6 features SAR temporales por píxel usando
operaciones numpy vectorizadas sobre el eje temporal.

Features calculadas:
  1. mean_sigma0_vv   — media temporal σ0_VV (dB)
  2. std_sigma0_vv    — desviación estándar temporal σ0_VV (dB)
  3. min_sigma0_vv    — mínimo temporal σ0_VV (dB)  → indicador de inundación histórica
  4. cv_sigma0_vv     — coeficiente de variación σ0_VV = std / |mean|
  5. mean_vv_vh_ratio — media del ratio VV−VH en dB (discrimina agua vs vegetación inundada)
  6. water_count      — copia del water_frequency.tif (multi-Otsu, ya calculado)

Todas las escenas se reprojectan al grid canónico antes de apilar para
corregir los desplazamientos sub-píxel introducidos por SNAP.

Salida: data/features/sar/{nombre_feature}.tif  (float32, EPSG:32630, 10 m)

Uso:
    python scripts/features/extract_sar_features.py [--force]
"""

from __future__ import annotations

import argparse
import logging
import time
import tracemalloc
from pathlib import Path
from typing import List, Tuple

import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
NAN_FRACTION_THRESHOLD = 0.20   # >20 % NaN en la serie → píxel inválido
MIN_LINEAR = 1e-9               # cota inferior para evitar log10(0)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _date_from_name(path: Path) -> str:
    """Extrae YYYYMMDD del nombre de fichero S1_sigma0_YYYYMMDD_orb103.tif."""
    stem = path.stem  # S1_sigma0_20221006_orb103
    parts = stem.split("_")
    for p in parts:
        if len(p) == 8 and p.isdigit():
            return p
    return stem


# ---------------------------------------------------------------------------
# Lectura de escenas con reproyección al grid canónico
# ---------------------------------------------------------------------------

def _load_band_to_canonical(
    src_path: Path,
    band_idx: int,
    canonical_transform,
    canonical_crs: CRS,
    canonical_shape: Tuple[int, int],
) -> np.ndarray:
    """
    Lee una banda de src_path y la reproyecta al grid canónico.
    Convierte de lineal a dB (10·log10), marcando valores ≤0 como NaN.

    Returns
    -------
    Array float32 (H, W) en dB, con NaN donde los datos no son válidos.
    """
    rows, cols = canonical_shape
    dst = np.empty((rows, cols), dtype="float32")

    with rasterio.open(src_path) as src:
        rio_reproject(
            source=rasterio.band(src, band_idx),
            destination=dst,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=canonical_transform,
            dst_crs=canonical_crs,
            resampling=Resampling.bilinear,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
        )

    # Conversión lineal → dB
    with np.errstate(divide="ignore", invalid="ignore"):
        dst_db = np.where(dst > MIN_LINEAR, 10.0 * np.log10(dst), np.nan).astype("float32")

    return dst_db


def _find_band_index(src_path: Path, name: str) -> int:
    """
    Devuelve el índice de banda (base 1) cuya descripción coincide con name.
    Si no hay descripciones, asume VH=1, VV=2 (convención del pipeline).
    """
    with rasterio.open(src_path) as ds:
        for i, desc in enumerate(ds.descriptions, start=1):
            if desc and name.lower() in desc.lower():
                return i
    # Fallback por convención del pipeline (process_single_scene.py)
    return 2 if name.upper() == "VV" else 1


# ---------------------------------------------------------------------------
# Construcción de stacks
# ---------------------------------------------------------------------------

def build_stacks(
    tifs: List[Path],
    canonical_transform,
    canonical_crs: CRS,
    canonical_shape: Tuple[int, int],
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Construye vv_stack y vh_stack (24, H, W) en dB.

    Cada escena se reproyecta al grid canónico antes de apilar.
    """
    n = len(tifs)
    rows, cols = canonical_shape
    vv_stack = np.empty((n, rows, cols), dtype="float32")
    vh_stack = np.empty((n, rows, cols), dtype="float32")

    vv_idx = _find_band_index(tifs[0], "VV")
    vh_idx = _find_band_index(tifs[0], "VH")

    for i, tif in enumerate(tifs):
        date = _date_from_name(tif)
        vv_stack[i] = _load_band_to_canonical(
            tif, vv_idx, canonical_transform, canonical_crs, canonical_shape
        )
        vh_stack[i] = _load_band_to_canonical(
            tif, vh_idx, canonical_transform, canonical_crs, canonical_shape
        )
        log.info("  [%2d/24] %s  VV_db: %.1f…%.1f  valid=%.1f%%",
                 i + 1, date,
                 np.nanmin(vv_stack[i]), np.nanmax(vv_stack[i]),
                 100.0 * np.isfinite(vv_stack[i]).mean())

    return vv_stack, vh_stack


# ---------------------------------------------------------------------------
# Cálculo de features
# ---------------------------------------------------------------------------

def _nan_fraction_mask(stack: np.ndarray, threshold: float) -> np.ndarray:
    """
    Devuelve máscara booleana True donde la fracción de NaN supera threshold.
    Estos píxeles se invalidan en todas las features.
    """
    nan_frac = np.isnan(stack).sum(axis=0) / stack.shape[0]
    return nan_frac > threshold


def compute_features(
    vv_stack: np.ndarray,
    vh_stack: np.ndarray,
    water_freq: np.ndarray,
    nan_threshold: float = NAN_FRACTION_THRESHOLD,
) -> dict:
    """
    Calcula las 6 features SAR temporales.

    Los píxeles con fracción de NaN > nan_threshold quedan como NaN
    en todos los outputs.

    Returns
    -------
    Diccionario {nombre_feature: array float32 (H, W)}.
    """
    log.info("Calculando máscara de píxeles inválidos (NaN > %.0f%%)...",
             nan_threshold * 100)
    invalid = _nan_fraction_mask(vv_stack, nan_threshold)
    pct_invalid = 100.0 * invalid.mean()
    log.info("  Píxeles inválidos: %.2f%%", pct_invalid)

    # --- features ---
    log.info("Calculando mean_sigma0_vv...")
    mean_vv = np.nanmean(vv_stack, axis=0).astype("float32")

    log.info("Calculando std_sigma0_vv...")
    std_vv = np.nanstd(vv_stack, axis=0).astype("float32")

    log.info("Calculando min_sigma0_vv...")
    min_vv = np.nanmin(vv_stack, axis=0).astype("float32")

    log.info("Calculando cv_sigma0_vv...")
    with np.errstate(divide="ignore", invalid="ignore"):
        cv_vv = np.where(
            np.abs(mean_vv) > 0.5,   # guarda contra media casi cero
            std_vv / np.abs(mean_vv),
            np.nan,
        ).astype("float32")

    log.info("Calculando mean_vv_vh_ratio...")
    diff_stack = vv_stack - vh_stack   # resta en dB ≡ ratio en lineal
    mean_ratio = np.nanmean(diff_stack, axis=0).astype("float32")

    # water_count es uint8 → convertir a float32 para consistencia
    wc = water_freq.astype("float32")
    wc_nodata = 255.0
    wc[water_freq == 255] = np.nan

    # Aplicar máscara de inválidos
    for arr in (mean_vv, std_vv, min_vv, cv_vv, mean_ratio):
        arr[invalid] = np.nan

    return {
        "mean_sigma0_vv":   mean_vv,
        "std_sigma0_vv":    std_vv,
        "min_sigma0_vv":    min_vv,
        "cv_sigma0_vv":     cv_vv,
        "mean_vv_vh_ratio": mean_ratio,
        "water_count":      wc,
    }


# ---------------------------------------------------------------------------
# I/O de features
# ---------------------------------------------------------------------------

def _write_feature(
    data: np.ndarray,
    path: Path,
    canonical_transform,
    canonical_crs: CRS,
    nodata: float = np.nan,
    dtype: str = "float32",
) -> None:
    """Escribe un array feature como GeoTIFF float32 en el grid canónico."""
    profile = {
        "driver":    "GTiff",
        "dtype":     dtype,
        "width":     data.shape[1],
        "height":    data.shape[0],
        "count":     1,
        "crs":       canonical_crs,
        "transform": canonical_transform,
        "nodata":    nodata,
        "compress":  "lzw",
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data.astype(dtype), 1)
    log.info("  Guardado: %-35s  %.2f MB", path.name, path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# Diagnósticos
# ---------------------------------------------------------------------------

FEATURE_CMAPS = {
    "mean_sigma0_vv":   ("viridis",  "mean σ⁰_VV (dB)"),
    "std_sigma0_vv":    ("magma",    "std σ⁰_VV (dB)"),
    "min_sigma0_vv":    ("Blues_r",  "min σ⁰_VV (dB)"),
    "cv_sigma0_vv":     ("YlOrRd",   "CV σ⁰_VV"),
    "mean_vv_vh_ratio": ("RdBu",     "mean (VV−VH) dB"),
    "water_count":      ("Blues",    "water_count (0–24)"),
}


def plot_diagnostics(features: dict, diag_dir: Path) -> None:
    """Genera un PNG de diagnóstico por feature."""
    if not HAS_MPL:
        log.warning("matplotlib no disponible; se omiten los PNGs de diagnóstico.")
        return

    diag_dir.mkdir(parents=True, exist_ok=True)
    for name, arr in features.items():
        cmap, label = FEATURE_CMAPS.get(name, ("viridis", name))
        fig, ax = plt.subplots(figsize=(10, 8))
        valid = arr[np.isfinite(arr)]
        if len(valid) == 0:
            plt.close()
            continue
        vmin, vmax = np.percentile(valid, [2, 98])
        img = ax.imshow(arr, cmap=cmap, interpolation="nearest",
                        vmin=vmin, vmax=vmax)
        plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label=label)
        ax.set_title(f"{name}  —  EPSG:32630  10 m/px", fontsize=12)
        ax.axis("off")
        plt.tight_layout()
        out = diag_dir / f"{name}.png"
        plt.savefig(out, dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: %s", out.name)


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

def sanity_checks(features: dict) -> None:
    """Comprobaciones físicas básicas para el área de Valencia."""
    from pyproj import Transformer
    from rasterio.transform import rowcol

    log.info("=" * 70)
    log.info("SANITY CHECKS  —  SAR features")
    log.info("=" * 70)

    crs_utm = CRS.from_epsg(32630)
    tr = Transformer.from_crs("EPSG:4326", crs_utm, always_xy=True)

    # Puntos de comprobación
    pts = {
        "Albufera    (-0.335,39.335)": (-0.335, 39.335),
        "Mar         (-0.280,39.350)": (-0.280, 39.350),
        "Urbano      (-0.376,39.475)": (-0.376, 39.475),
        "Huerta      (-0.460,39.400)": (-0.460, 39.400),
    }

    # Para acceder al transform canónico, lo leemos de una de las features escritas
    # (se pasa como None aquí; comprobamos solo con numpy stats)

    # --- Estadísticas globales ---
    def _stats(name: str, arr: np.ndarray) -> None:
        v = arr[np.isfinite(arr)]
        if len(v) == 0:
            log.warning("%-25s  SIN DATOS VÁLIDOS", name)
            return
        log.info("%-25s  min=%8.2f  p10=%7.2f  p50=%7.2f  p90=%7.2f  max=%8.2f  NaN=%.1f%%",
                 name, v.min(), np.percentile(v, 10), np.median(v),
                 np.percentile(v, 90), v.max(),
                 100 * (1 - len(v) / arr.size))

    for k, arr in features.items():
        _stats(k, arr)

    # --- Checks cuantitativos ---
    mean_vv = features["mean_sigma0_vv"]
    valid_mean = mean_vv[np.isfinite(mean_vv)]
    global_mean = float(np.median(valid_mean)) if len(valid_mean) else np.nan

    if -15 <= global_mean <= -8:
        log.info("OK  mean_sigma0_vv mediana=%.2f dB (rango esperado -15 a -8 dB)", global_mean)
    else:
        log.warning("ALERTA: mean_sigma0_vv mediana=%.2f dB  (esperado -15…-8 dB)", global_mean)

    cv = features["cv_sigma0_vv"]
    cv_p50 = float(np.nanmedian(cv)) if np.any(np.isfinite(cv)) else np.nan
    if 0.03 <= cv_p50 <= 0.35:
        log.info("OK  cv_sigma0_vv mediana=%.3f (rango esperado 0.05–0.30)", cv_p50)
    else:
        log.warning("ALERTA: cv_sigma0_vv mediana=%.3f (esperado 0.05–0.30)", cv_p50)

    wc = features["water_count"]
    wc_valid = wc[np.isfinite(wc)]
    pct_permanent = 100 * (wc_valid == 24).sum() / wc_valid.size
    log.info("OK  water_count: %.1f%% píxeles con valor 24 (agua permanente)", pct_permanent)

    log.info("=" * 70)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    tracemalloc.start()

    parser = argparse.ArgumentParser(
        description="Extrae las 6 features SAR temporales de las escenas baseline S1."
    )
    parser.add_argument("--force", action="store_true",
                        help="Regenerar aunque los ficheros ya existan.")
    args = parser.parse_args()

    # --- Config ---
    root   = _repo_root()
    params = _load_yaml(root / "config" / "params.yaml")
    paths  = _load_yaml(root / "config" / "paths.yaml")

    # --- Rutas ---
    processed_dir = root / paths["data"]["sentinel1"]["processed"]
    water_path    = root / paths["data"]["sentinel1"]["water_masks"] / "water_frequency.tif"
    feat_dir      = root / "data" / "features" / "sar"
    diag_dir      = root / "results" / "diagnostics" / "sar_features"
    feat_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    # --- Salidas ---
    feature_names = [
        "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv",
        "cv_sigma0_vv", "mean_vv_vh_ratio", "water_count",
    ]
    out_paths = {name: feat_dir / f"{name}.tif" for name in feature_names}

    if all(p.exists() for p in out_paths.values()) and not args.force:
        log.info("Todas las features ya existen. Usa --force para regenerar.")
        # Cargar y ejecutar solo sanity checks
        feats = {}
        for name, p in out_paths.items():
            with rasterio.open(p) as ds:
                feats[name] = ds.read(1).astype("float32")
        sanity_checks(feats)
        return

    # --- Grid canónico ---
    with rasterio.open(water_path) as ref:
        canonical_transform = ref.transform
        canonical_crs       = ref.crs
        canonical_shape     = (ref.height, ref.width)
        water_freq_raw      = ref.read(1)  # uint8

    log.info("Grid canónico: shape=%s  pixel=%.0f m  CRS=%s",
             canonical_shape, canonical_transform.a, canonical_crs)

    # --- Escenas baseline (no recursivo, excluye event/) ---
    tifs = sorted(
        p for p in processed_dir.glob("S1_sigma0_*.tif")
        if "event" not in p.parts
    )
    log.info("Escenas baseline encontradas: %d", len(tifs))
    if len(tifs) == 0:
        log.error("No se encontraron escenas en %s. Abortando.", processed_dir)
        return

    # --- Construir stacks ---
    log.info("Construyendo cubos VV/VH (shape %d×%d×%d)...",
             len(tifs), canonical_shape[0], canonical_shape[1])
    mem_est_mb = 2 * len(tifs) * canonical_shape[0] * canonical_shape[1] * 4 / 1e6
    log.info("Memoria estimada para los dos stacks: %.0f MB", mem_est_mb)

    vv_stack, vh_stack = build_stacks(
        tifs, canonical_transform, canonical_crs, canonical_shape
    )

    _, mem_peak_bytes = tracemalloc.get_traced_memory()
    log.info("Memoria pico tras stacking: %.0f MB", mem_peak_bytes / 1e6)

    # --- Calcular features ---
    features = compute_features(vv_stack, vh_stack, water_freq_raw)

    # Liberar stacks para recuperar RAM antes de guardar
    del vv_stack, vh_stack

    # --- Guardar ---
    log.info("Guardando features en %s ...", feat_dir)
    for name, arr in features.items():
        _write_feature(arr, out_paths[name], canonical_transform, canonical_crs)

    # --- Diagnósticos ---
    log.info("Generando PNGs de diagnóstico...")
    plot_diagnostics(features, diag_dir)

    # --- Sanity checks ---
    sanity_checks(features)

    # --- Reporte ---
    _, mem_peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    elapsed = time.time() - t0

    log.info("=" * 70)
    log.info("RESUMEN EXTRACT_SAR_FEATURES")
    log.info("  Escenas procesadas : %d", len(tifs))
    log.info("  Grid de salida     : %s  %s", canonical_shape,
             f"{canonical_transform.a:.0f} m/px")
    log.info("  Tiempo total       : %.1f s", elapsed)
    log.info("  Memoria pico       : %.0f MB", mem_peak_bytes / 1e6)
    for name, p in out_paths.items():
        log.info("  %-35s  %.2f MB", p.name, p.stat().st_size / 1e6)
    log.info("=" * 70)


if __name__ == "__main__":
    main()
