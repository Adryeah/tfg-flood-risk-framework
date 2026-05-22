#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_dataset.py
----------------
Construye el dataset tabular de entrenamiento del modelo Random Forest a
partir de las 11 features espaciales (6 SAR + 4 DEM + 1 NDVI) y la máscara
oficial de inundación de Copernicus EMS EMSR773.

Cada fila del dataset = un píxel del bbox de estudio.
Cada columna = una feature, más [row, col, flood_label].

Ground truth: shapefile EMSR773_AOI01_DEL_PRODUCT_observedEventA_v1.shp
  - 1488 polígonos clasificados como '5-Flood / Flash flood' por Copernicus EMS
  - Cubre toda la provincia de Valencia; se rasteriza al grid canónico S1
  - Es la delineación oficial completa de la inundación (no solo donde se
    pudo estimar profundidad → eso es floodDepthA, descartado por
    parcialidad para una clasificación binaria)

Salidas:
  - data/labels/flood_mask_emsr773.tif         (uint8, 0 / 1)
  - data/dataset/training_dataset.parquet      (todas las filas válidas)
  - data/dataset/training_sample.csv           (10000 filas para inspección)
  - results/diagnostics/dataset/*.png          (3 diagnósticos)

Uso:
    python scripts/features/build_dataset.py [--force] [--label-source SOURCE]
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import Dict, List, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.features import rasterize
from scipy.stats import spearmanr

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

# Orden de las features = orden de columnas en el dataset y de capas en el stack
FEATURE_PATHS: List[Tuple[str, str]] = [
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

# Shapefiles de EMSR773 disponibles
EMS_SOURCES: Dict[str, str] = {
    "observedEventA":  "EMSR773_AOI01_DEL_PRODUCT_observedEventA_v1.shp",
    "floodDepthA":     "EMSR773_AOI01_DEL_PRODUCT_floodDepthA_v1.shp",
}

# Tope de filas para el cálculo de la matriz de correlación
CORR_SAMPLE_SIZE = 500_000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ---------------------------------------------------------------------------
# 1. Verificar alineación de las 11 features
# ---------------------------------------------------------------------------

def _verify_alignment(feature_paths: List[Path]) -> Tuple[Tuple[int, int], rasterio.Affine, CRS]:
    """
    Verifica que todas las features tienen idéntico shape, CRS y transform.

    Falla con error claro si alguna no coincide. Devuelve (shape, transform, crs)
    de referencia.
    """
    log.info("Verificando alineación de las %d features...", len(feature_paths))
    ref_shape = ref_transform = ref_crs = ref_path = None

    for path in feature_paths:
        if not path.exists():
            raise FileNotFoundError(f"Falta feature: {path}")
        with rasterio.open(path) as ds:
            shape = (ds.height, ds.width)
            transform = ds.transform
            crs = ds.crs
        if ref_shape is None:
            ref_shape, ref_transform, ref_crs, ref_path = shape, transform, crs, path
            log.info("  REF  %s  shape=%s  CRS=%s  px=%.0f m",
                     path.name, shape, crs, transform.a)
            continue
        if shape != ref_shape:
            raise ValueError(
                f"Discrepancia de shape:\n  REF {ref_path.name}: {ref_shape}\n  "
                f"DIF {path.name}: {shape}"
            )
        if crs != ref_crs:
            raise ValueError(
                f"Discrepancia de CRS:\n  REF {ref_path.name}: {ref_crs}\n  "
                f"DIF {path.name}: {crs}"
            )
        if not _transforms_equal(transform, ref_transform):
            raise ValueError(
                f"Discrepancia de transform:\n  REF {ref_path.name}: {ref_transform}\n  "
                f"DIF {path.name}: {transform}"
            )
        log.info("  OK   %s  shape=%s  CRS=%s  px=%.0f m",
                 path.name, shape, crs, transform.a)

    log.info("Alineación verificada. Grid canónico: shape=%s  px=%.0f m  CRS=%s",
             ref_shape, ref_transform.a, ref_crs)
    return ref_shape, ref_transform, ref_crs


def _transforms_equal(a, b, atol: float = 1e-6) -> bool:
    """Comparación robusta de Affine con tolerancia subpíxel."""
    return all(abs(x - y) < atol for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# 2. Stack 3D de features
# ---------------------------------------------------------------------------

def _build_feature_stack(
    feature_paths: List[Path],
    shape: Tuple[int, int],
) -> np.ndarray:
    """Apila las 11 features en un array (n_features, H, W) float32."""
    n = len(feature_paths)
    rows, cols = shape
    stack = np.empty((n, rows, cols), dtype="float32")

    for i, path in enumerate(feature_paths):
        with rasterio.open(path) as ds:
            arr = ds.read(1).astype("float32")
            nodata = ds.nodata
        if nodata is not None and not np.isnan(nodata):
            arr[arr == nodata] = np.nan
        stack[i] = arr

    log.info("Stack 3D construido: shape=%s  memoria=%.0f MB",
             stack.shape, stack.nbytes / 1e6)
    return stack


# ---------------------------------------------------------------------------
# 3. Rasterizar la máscara EMSR773
# ---------------------------------------------------------------------------

def _rasterize_flood_mask(
    shp_path: Path,
    ref_transform,
    ref_shape: Tuple[int, int],
    target_crs: CRS,
    out_path: Path,
) -> np.ndarray:
    """
    Lee el shapefile EMSR773, lo reproyecta al CRS canónico, lo rasteriza
    al grid de referencia y guarda la máscara binaria como GeoTIFF.

    Devuelve el array uint8 (0 / 1).
    """
    log.info("Leyendo shapefile EMSR773: %s", shp_path.name)
    gdf = gpd.read_file(shp_path)
    log.info("  Polígonos: %d  CRS original: %s", len(gdf), gdf.crs)

    if gdf.crs != target_crs:
        log.info("  Reproyectando %s → %s", gdf.crs, target_crs)
        gdf = gdf.to_crs(target_crs)

    rows, cols = ref_shape
    log.info("Rasterizando al grid canónico (%dx%d)...", rows, cols)
    mask = rasterize(
        ((geom, 1) for geom in gdf.geometry if geom is not None and not geom.is_empty),
        out_shape=(rows, cols),
        transform=ref_transform,
        fill=0,
        dtype="uint8",
        all_touched=False,   # solo píxeles cuyo centro cae dentro del polígono
    )
    log.info("  Píxeles inundados rasterizados: %d (%.2f%%)",
             int(mask.sum()), 100.0 * mask.sum() / mask.size)

    # Guardar GeoTIFF
    out_path.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver":    "GTiff",
        "dtype":     "uint8",
        "width":     cols,
        "height":    rows,
        "count":     1,
        "crs":       target_crs,
        "transform": ref_transform,
        "nodata":    255,
        "compress":  "lzw",
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(mask, 1)
    log.info("Máscara guardada: %s (%.2f MB)",
             out_path, out_path.stat().st_size / 1e6)
    return mask


# ---------------------------------------------------------------------------
# 4. Ensamblar dataset tabular
# ---------------------------------------------------------------------------

def _stack_to_dataframe(
    stack: np.ndarray,
    flood_mask: np.ndarray,
    feature_names: List[str],
) -> Tuple[pd.DataFrame, int, int]:
    """
    Convierte el stack 3D + máscara en un DataFrame con columnas
    [row, col, *features, flood_label].

    Filtra filas con cualquier NaN en las features. Devuelve también el
    n total de píxeles antes y después del filtrado.
    """
    n_feat, rows, cols = stack.shape
    n_total = rows * cols

    log.info("Aplanando stack a tabla (%d filas iniciales)...", n_total)

    # Construir DataFrame en una pasada
    rr, cc = np.indices((rows, cols))
    data = {
        "row": rr.ravel().astype("int32"),
        "col": cc.ravel().astype("int32"),
    }
    for i, name in enumerate(feature_names):
        data[name] = stack[i].ravel()
    data["flood_label"] = flood_mask.ravel().astype("int8")

    df = pd.DataFrame(data)

    # Filtrar NaN (cualquier feature)
    feature_cols = feature_names
    nan_mask = df[feature_cols].isna().any(axis=1)
    pct_nan = 100.0 * nan_mask.sum() / len(df)
    log.info("  Filas con algún NaN: %d (%.2f%%)", int(nan_mask.sum()), pct_nan)

    df_clean = df.loc[~nan_mask].reset_index(drop=True)
    log.info("  Dataset final: %d filas × %d columnas",
             len(df_clean), len(df_clean.columns))

    # Verificar finitos en todas las columnas numéricas
    inf_count = (~np.isfinite(df_clean[feature_cols].values)).sum()
    if inf_count > 0:
        log.warning("Valores no finitos detectados: %d. Reemplazando por NaN y filtrando...", inf_count)
        df_clean[feature_cols] = df_clean[feature_cols].replace([np.inf, -np.inf], np.nan)
        df_clean = df_clean.dropna(subset=feature_cols).reset_index(drop=True)

    return df_clean, n_total, len(df_clean)


# ---------------------------------------------------------------------------
# 5. Diagnósticos
# ---------------------------------------------------------------------------

def _plot_flood_mask_overlay(
    flood_mask: np.ndarray,
    mean_vv: np.ndarray,
    out_path: Path,
) -> None:
    """Superpone la máscara EMSR773 sobre mean_sigma0_vv para verificar alineación."""
    if not HAS_MPL:
        return

    bg = mean_vv.astype(float).copy()
    bg[~np.isfinite(bg)] = np.nan

    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(bg, cmap="gray", vmin=np.nanpercentile(bg, 2),
                    vmax=np.nanpercentile(bg, 98), interpolation="nearest")
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="mean σ⁰_VV (dB)")

    # Overlay rojo translúcido en píxeles inundados
    overlay = np.zeros((*flood_mask.shape, 4), dtype="float32")
    overlay[flood_mask == 1] = [1.0, 0.15, 0.15, 0.55]
    ax.imshow(overlay, interpolation="nearest")

    ax.set_title("Máscara EMSR773 (rojo) sobre mean σ⁰_VV  —  EPSG:32630  10 m/px",
                 fontsize=13)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


def _plot_correlation_matrix(
    df: pd.DataFrame,
    feature_names: List[str],
    out_path: Path,
) -> List[Tuple[str, str, float]]:
    """
    Calcula y dibuja la matriz de correlación de Spearman entre features.
    Devuelve la lista de pares más correlacionados (|ρ|>0.8) ordenada.
    """
    if not HAS_MPL:
        return []

    n = len(df)
    if n > CORR_SAMPLE_SIZE:
        log.info("  Subsampleando %d → %d filas para correlación...", n, CORR_SAMPLE_SIZE)
        sample = df[feature_names].sample(CORR_SAMPLE_SIZE, random_state=42)
    else:
        sample = df[feature_names]

    rho, _ = spearmanr(sample.values, axis=0)
    rho_df = pd.DataFrame(rho, index=feature_names, columns=feature_names)

    # Pares con |ρ| > 0.8
    pairs = []
    for i, fa in enumerate(feature_names):
        for j, fb in enumerate(feature_names):
            if j <= i:
                continue
            r = rho_df.iloc[i, j]
            if abs(r) > 0.8:
                pairs.append((fa, fb, float(r)))
    pairs.sort(key=lambda x: -abs(x[2]))

    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(rho_df.values, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(feature_names)))
    ax.set_yticks(range(len(feature_names)))
    ax.set_xticklabels(feature_names, rotation=45, ha="right")
    ax.set_yticklabels(feature_names)
    for i in range(len(feature_names)):
        for j in range(len(feature_names)):
            ax.text(j, i, f"{rho_df.iloc[i,j]:.2f}",
                    ha="center", va="center",
                    color="white" if abs(rho_df.iloc[i,j]) > 0.5 else "black",
                    fontsize=8)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="ρ Spearman")
    ax.set_title("Matriz de correlación de Spearman entre features", fontsize=13)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)
    return pairs


def _plot_class_distribution(
    df: pd.DataFrame,
    out_path: Path,
) -> Tuple[float, float]:
    """Gráfico de barras del desbalance de clase. Devuelve (pct_0, pct_1)."""
    if not HAS_MPL:
        return (0.0, 0.0)

    counts = df["flood_label"].value_counts().sort_index()
    pct = 100 * counts / counts.sum()

    fig, ax = plt.subplots(figsize=(7, 5))
    bars = ax.bar(["No inundado (0)", "Inundado (1)"],
                  [counts.get(0, 0), counts.get(1, 0)],
                  color=["#4c8bf5", "#e63946"])
    for bar, p in zip(bars, [pct.get(0, 0), pct.get(1, 0)]):
        ax.text(bar.get_x() + bar.get_width() / 2,
                bar.get_height(),
                f"{p:.2f}%",
                ha="center", va="bottom", fontsize=11)
    ax.set_ylabel("Número de píxeles")
    ax.set_title("Distribución de la clase objetivo  —  EMSR773 ground truth")
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)
    return float(pct.get(0, 0)), float(pct.get(1, 0))


# ---------------------------------------------------------------------------
# 6. Sanity checks
# ---------------------------------------------------------------------------

def _sanity_checks(
    df: pd.DataFrame,
    feature_names: List[str],
    n_total: int,
) -> None:
    """Reporta estadísticas y validaciones del dataset final."""
    log.info("=" * 75)
    log.info("SANITY CHECKS  —  Dataset")
    log.info("=" * 75)
    log.info("  Píxeles totales bbox          : %d", n_total)
    log.info("  Filas tras filtrar NaN        : %d (%.2f%%)",
             len(df), 100 * len(df) / n_total)

    # Distribución clase
    counts = df["flood_label"].value_counts().sort_index()
    pct_0 = 100 * counts.get(0, 0) / len(df)
    pct_1 = 100 * counts.get(1, 0) / len(df)
    ratio = counts.get(0, 0) / max(counts.get(1, 0), 1)
    log.info("  Clase 0 (no inundado)         : %d (%.2f%%)", counts.get(0, 0), pct_0)
    log.info("  Clase 1 (inundado)            : %d (%.2f%%)", counts.get(1, 0), pct_1)
    log.info("  Ratio negativos:positivos     : %.1f : 1", ratio)
    log.info("  → Sugerencia class_weight     : {0: 1.0, 1: %.1f}  o  'balanced'", ratio)

    # Estadísticas por feature
    log.info("-" * 75)
    log.info("  %-22s  %10s  %10s  %10s  %10s  %s",
             "Feature", "min", "p50", "max", "std", "n_finite")
    for f in feature_names:
        v = df[f].values
        finite = np.isfinite(v)
        if finite.sum() == 0:
            log.warning("  %s: NO HAY VALORES FINITOS", f)
            continue
        v = v[finite]
        log.info("  %-22s  %10.3f  %10.3f  %10.3f  %10.3f  %d",
                 f, v.min(), np.median(v), v.max(), v.std(), len(v))

    # Comprobar infinitos
    inf_total = sum((~np.isfinite(df[f].values)).sum() for f in feature_names)
    if inf_total > 0:
        log.warning("  Quedan %d valores no finitos en el dataset (no debería ocurrir)", inf_total)
    else:
        log.info("  Sin valores no finitos: OK")
    log.info("=" * 75)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()

    parser = argparse.ArgumentParser(
        description="Construye el dataset tabular de entrenamiento del modelo Random Forest."
    )
    parser.add_argument("--force", action="store_true",
                        help="Regenerar aunque los outputs ya existan.")
    parser.add_argument("--label-source", choices=list(EMS_SOURCES.keys()),
                        default="observedEventA",
                        help="Shapefile EMSR773 a usar como ground truth (default: observedEventA).")
    args = parser.parse_args()

    root = _repo_root()
    paths = _load_yaml(root / "config" / "paths.yaml")

    # Rutas de entrada
    feature_paths = [(name, root / rel) for name, rel in FEATURE_PATHS]
    feature_names = [n for n, _ in feature_paths]
    feature_files = [p for _, p in feature_paths]

    # Rutas de salida
    labels_dir   = root / "data" / "labels"
    dataset_dir  = root / "data" / "dataset"
    diag_dir     = root / "results" / "diagnostics" / "dataset"
    labels_dir.mkdir(parents=True, exist_ok=True)
    dataset_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    out_mask     = labels_dir / "flood_mask_emsr773.tif"
    out_parquet  = dataset_dir / "training_dataset.parquet"
    out_csv      = dataset_dir / "training_sample.csv"

    if all(p.exists() for p in (out_mask, out_parquet, out_csv)) and not args.force:
        log.info("Outputs ya existen. Usa --force para regenerar.")
        df = pd.read_parquet(out_parquet)
        n_total = (df["row"].max() + 1) * (df["col"].max() + 1)
        _sanity_checks(df, feature_names, n_total)
        return

    # 1) Verificar alineación
    ref_shape, ref_transform, ref_crs = _verify_alignment(feature_files)

    # 2) Stack 3D
    log.info("Cargando 11 features y construyendo stack 3D...")
    stack = _build_feature_stack(feature_files, ref_shape)

    # 3) Rasterizar máscara EMSR773
    shp_path = root / paths["data"]["ems"] / EMS_SOURCES[args.label_source]
    log.info("Ground truth seleccionado: %s", args.label_source)
    flood_mask = _rasterize_flood_mask(shp_path, ref_transform, ref_shape,
                                        ref_crs, out_mask)

    # 4) Ensamblar DataFrame
    df, n_total, n_clean = _stack_to_dataframe(stack, flood_mask, feature_names)

    # Liberar stack para reducir memoria pico antes de guardar
    del stack

    # 5) Guardar parquet + sample csv
    log.info("Guardando dataset...")
    df.to_parquet(out_parquet, index=False, compression="snappy")
    log.info("  Parquet: %s (%.2f MB)", out_parquet, out_parquet.stat().st_size / 1e6)

    sample_n = min(10_000, len(df))
    df.sample(sample_n, random_state=42).to_csv(out_csv, index=False)
    log.info("  CSV sample (%d filas): %s (%.2f MB)",
             sample_n, out_csv, out_csv.stat().st_size / 1e6)

    # 6) Diagnósticos
    log.info("Generando PNGs de diagnóstico...")
    # Reload mean_vv para overlay
    with rasterio.open(feature_files[0]) as ds:
        mean_vv = ds.read(1).astype("float32")
    _plot_flood_mask_overlay(flood_mask, mean_vv, diag_dir / "flood_mask_visualization.png")
    top_pairs = _plot_correlation_matrix(df, feature_names, diag_dir / "feature_correlation_matrix.png")
    _plot_class_distribution(df, diag_dir / "class_distribution.png")

    # 7) Sanity checks
    _sanity_checks(df, feature_names, n_total)

    # 8) Reporte top correlaciones
    if top_pairs:
        log.info("=" * 75)
        log.info("Top pares de features con |ρ Spearman| > 0.8 (%d pares)", len(top_pairs))
        for fa, fb, r in top_pairs[:5]:
            log.info("  %-22s  ↔  %-22s  ρ = %+.3f", fa, fb, r)
        log.info("=" * 75)
    else:
        log.info("Ningún par de features tiene |ρ| > 0.8 (no hay redundancia fuerte).")

    # 9) Reporte final
    elapsed = time.time() - t0
    log.info("=" * 75)
    log.info("RESUMEN BUILD_DATASET")
    log.info("  Tiempo total                : %.1f s", elapsed)
    log.info("  Píxeles totales del bbox    : %d", n_total)
    log.info("  Filas válidas dataset       : %d", n_clean)
    log.info("  Columnas                    : %d  (row, col, 11 features, flood_label)",
             len(df.columns))
    log.info("  Tamaño parquet              : %.2f MB", out_parquet.stat().st_size / 1e6)
    log.info("  Ground truth shapefile      : %s", EMS_SOURCES[args.label_source])
    log.info("  Outputs:")
    log.info("    %s", out_mask)
    log.info("    %s", out_parquet)
    log.info("    %s", out_csv)
    for p in diag_dir.glob("*.png"):
        log.info("    %s", p)
    log.info("=" * 75)


if __name__ == "__main__":
    main()
