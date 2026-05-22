#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
clip_flood_mask_to_municipalities.py
------------------------------------
Recorta la máscara EMSR773 a los municipios oficialmente declarados zona
catastrófica por la DANA del 29 de octubre de 2024 (Real Decreto-ley 6/2024,
de 5 de noviembre). Elimina así los polígonos de "Flood trace" basinales y
las marismas de la Albufera que contaminaban el ground truth.

Flujo:
  1. Descarga límites municipales de OpenStreetMap vía osmnx.
  2. Filtra a la lista oficial de municipios afectados.
  3. Intersecta con el bbox de estudio.
  4. Rasteriza al grid canónico → affected_municipalities_mask.tif.
  5. AND lógico con la máscara EMSR773 → flood_mask_emsr773_clipped.tif.
  6. Regenera training_dataset.parquet con la etiqueta corregida.
  7. Genera diagnósticos visuales y reporte cuantitativo.

Uso:
    python scripts/labels/clip_flood_mask_to_municipalities.py [--force]

Fuente legal:
    Real Decreto-ley 6/2024, de 5 de noviembre, por el que se adoptan medidas
    urgentes de respuesta ante los daños causados por la DANA en diversos
    municipios.
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import List, Optional, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.features import rasterize
from shapely.geometry import box
from shapely.ops import unary_union

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


# ---------------------------------------------------------------------------
# Lista oficial de municipios afectados por la DANA 2024
# ---------------------------------------------------------------------------
# Real Decreto-ley 6/2024, de 5 de noviembre — declarados zona catastrófica
# (extensión sobre la lista del usuario; los marcados con * caen en la zona
# de extrapolación o fuera del bbox de estudio principal y se filtrarán
# geográficamente)
DANA_MUNICIPALITIES = [
    # L'Horta Sud (afectados directamente, dentro del bbox principal)
    "Paiporta",
    "Catarroja",
    "Sedaví",
    "Alfafar",
    "Benetússer",
    "Massanassa",
    "Albal",
    "Beniparrell",
    "Picanya",
    "Picassent",
    "Aldaia",
    "Torrent",
    "Quart de Poblet",
    "Manises",
    # Ribera Alta / Baixa (algunas pueden caer fuera del bbox principal)
    "Algemesí",
    "Alzira",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ---------------------------------------------------------------------------
# 1. Descarga de límites municipales
# ---------------------------------------------------------------------------

def fetch_municipal_boundaries(
    names: List[str],
    cache_path: Path,
    force: bool = False,
) -> gpd.GeoDataFrame:
    """
    Descarga los límites municipales de OpenStreetMap vía osmnx.geocode_to_gdf
    para cada nombre. Cachea el resultado en cache_path (GeoJSON).

    Si cache_path existe y no force, devuelve el cacheado.
    """
    if cache_path.exists() and not force:
        log.info("Usando municipios cacheados: %s", cache_path)
        return gpd.read_file(cache_path)

    log.info("Descargando %d municipios desde OpenStreetMap...", len(names))
    import osmnx as ox

    rows = []
    for name in names:
        query = f"{name}, Valencia, Spain"
        try:
            log.info("  geocode: %s", query)
            gdf = ox.geocode_to_gdf(query)
            if gdf.empty:
                log.warning("    sin resultados para %s", query)
                continue
            # Tomar el primer resultado (más relevante)
            row = gdf.iloc[0]
            rows.append({
                "name":     name,
                "osm_name": row.get("display_name", ""),
                "geometry": row.geometry,
            })
        except Exception as exc:
            log.warning("    fallo geocode %s: %s", query, exc)

    if not rows:
        raise RuntimeError("No se pudo descargar ningún municipio.")

    gdf_out = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    gdf_out.to_file(cache_path, driver="GeoJSON")
    log.info("Municipios cacheados en: %s (%d features)", cache_path, len(gdf_out))
    return gdf_out


# ---------------------------------------------------------------------------
# 2. Rasterización
# ---------------------------------------------------------------------------

def _rasterize_geoms(
    gdf: gpd.GeoDataFrame,
    transform,
    shape: Tuple[int, int],
) -> np.ndarray:
    """Rasteriza un GeoDataFrame a una máscara binaria (uint8) en el grid dado."""
    rows, cols = shape
    return rasterize(
        ((g, 1) for g in gdf.geometry if g is not None and not g.is_empty),
        out_shape=(rows, cols),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=False,
    )


def _write_mask(
    mask: np.ndarray,
    out_path: Path,
    transform,
    crs: CRS,
) -> None:
    rows, cols = mask.shape
    profile = {
        "driver":    "GTiff",
        "dtype":     "uint8",
        "width":     cols,
        "height":    rows,
        "count":     1,
        "crs":       crs,
        "transform": transform,
        "nodata":    255,
        "compress":  "lzw",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(mask, 1)
    log.info("Guardado: %s (%.2f MB)", out_path, out_path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# 3. Diagnósticos
# ---------------------------------------------------------------------------

def _plot_overlay(
    bg: np.ndarray,
    overlay: np.ndarray,
    title: str,
    out_path: Path,
    overlay_color=(1.0, 0.15, 0.15, 0.55),
    extra_polys: Optional[gpd.GeoDataFrame] = None,
    transform=None,
    extent_utm=None,
) -> None:
    if not HAS_MPL:
        return
    bg_f = bg.astype(float).copy()
    bg_f[~np.isfinite(bg_f)] = np.nan

    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(bg_f, cmap="gray",
                    vmin=np.nanpercentile(bg_f, 2),
                    vmax=np.nanpercentile(bg_f, 98),
                    interpolation="nearest", extent=extent_utm)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="mean σ⁰_VV (dB)")

    if overlay is not None:
        ov = np.zeros((*overlay.shape, 4), dtype="float32")
        ov[overlay == 1] = overlay_color
        ax.imshow(ov, interpolation="nearest", extent=extent_utm)

    if extra_polys is not None:
        for _, r in extra_polys.iterrows():
            geom = r.geometry
            if geom.geom_type == "Polygon":
                xs, ys = geom.exterior.xy
                ax.plot(xs, ys, color="cyan", lw=1.2)
            elif geom.geom_type == "MultiPolygon":
                for p in geom.geoms:
                    xs, ys = p.exterior.xy
                    ax.plot(xs, ys, color="cyan", lw=1.2)
            cen = geom.centroid
            ax.text(cen.x, cen.y, r.get("name", ""),
                    fontsize=7, ha="center", color="cyan",
                    bbox=dict(boxstyle="round,pad=0.2", fc="black", alpha=0.6, ec="none"))

    ax.set_title(title, fontsize=12)
    ax.set_xlabel("UTM X (m)" if extent_utm else "")
    ax.set_ylabel("UTM Y (m)" if extent_utm else "")
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
        description="Recorta la máscara EMSR773 a los municipios afectados por la DANA."
    )
    parser.add_argument("--force", action="store_true",
                        help="Re-descarga municipios y regenera todo.")
    args = parser.parse_args()

    root  = _repo_root()
    paths = _load_yaml(root / "config" / "paths.yaml")

    # Rutas
    muni_dir   = root / "data" / "auxiliary" / "municipios"
    labels_dir = root / "data" / "labels"
    diag_dir   = root / "results" / "diagnostics" / "dataset"
    muni_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    cache_geojson = muni_dir / "dana_affected_municipalities.geojson"
    out_muni_mask = labels_dir / "affected_municipalities_mask.tif"
    out_clipped   = labels_dir / "flood_mask_emsr773_clipped.tif"

    # Grid canónico de referencia (water_frequency)
    ref_path = root / paths["data"]["sentinel1"]["water_masks"] / "water_frequency.tif"
    with rasterio.open(ref_path) as ref:
        canonical_transform = ref.transform
        canonical_crs       = ref.crs
        canonical_shape     = (ref.height, ref.width)
        canonical_bounds    = ref.bounds

    log.info("Grid canónico: shape=%s  px=%.0f m  CRS=%s",
             canonical_shape, canonical_transform.a, canonical_crs)
    log.info("Bounds bbox UTM: %s", canonical_bounds)

    log.info("Fuente legal de la lista de municipios:")
    log.info("  Real Decreto-ley 6/2024, de 5 de noviembre, por el que se "
             "adoptan medidas urgentes de respuesta ante los daños causados "
             "por la DANA en diversos municipios.")

    # 1) Descargar municipios
    munis_wgs = fetch_municipal_boundaries(DANA_MUNICIPALITIES, cache_geojson,
                                            force=args.force)
    log.info("Municipios descargados: %d", len(munis_wgs))

    # 2) Reproyectar a UTM e intersectar con bbox de estudio
    munis_utm = munis_wgs.to_crs(canonical_crs)
    bbox_geom = box(canonical_bounds.left, canonical_bounds.bottom,
                    canonical_bounds.right, canonical_bounds.top)
    munis_utm["intersects_bbox"] = munis_utm.geometry.intersects(bbox_geom)
    munis_in_bbox = munis_utm[munis_utm["intersects_bbox"]].copy()
    munis_in_bbox["area_km2"] = munis_in_bbox.geometry.area / 1e6
    munis_in_bbox["area_in_bbox_km2"] = munis_in_bbox.geometry.intersection(bbox_geom).area / 1e6

    log.info("=" * 70)
    log.info("Municipios que tocan el bbox de estudio:")
    for _, r in munis_in_bbox.sort_values("name").iterrows():
        log.info("  %-22s  área total: %6.2f km²   en bbox: %6.2f km²  (%.0f%%)",
                 r["name"], r["area_km2"], r["area_in_bbox_km2"],
                 100 * r["area_in_bbox_km2"] / r["area_km2"])
    log.info("Municipios fuera del bbox (descartados):")
    for _, r in munis_utm[~munis_utm["intersects_bbox"]].iterrows():
        log.info("  %-22s  (descartado)", r["name"])
    log.info("=" * 70)

    # 3) Rasterizar máscara municipal (usando geometrías recortadas al bbox)
    munis_clipped = munis_in_bbox.copy()
    munis_clipped["geometry"] = munis_clipped.geometry.intersection(bbox_geom)
    log.info("Rasterizando máscara municipal al grid canónico...")
    muni_mask = _rasterize_geoms(munis_clipped, canonical_transform, canonical_shape)
    pct_muni = 100.0 * muni_mask.sum() / muni_mask.size
    log.info("  Píxeles en municipios afectados: %d (%.2f%% del bbox)",
             int(muni_mask.sum()), pct_muni)
    _write_mask(muni_mask, out_muni_mask, canonical_transform, canonical_crs)

    # 4) Cargar la máscara EMSR773 original (observedEventA completo)
    original_mask_path = labels_dir / "flood_mask_emsr773.tif"
    if not original_mask_path.exists():
        log.error("No existe la máscara EMSR773 original: %s", original_mask_path)
        log.error("Ejecuta primero scripts/features/build_dataset.py")
        return
    with rasterio.open(original_mask_path) as ds:
        ems_mask = ds.read(1)
    pct_orig = 100.0 * ems_mask.sum() / ems_mask.size
    log.info("Máscara EMSR773 original: %d píxeles (%.2f%%)",
             int(ems_mask.sum()), pct_orig)

    # 5) AND lógico
    log.info("Aplicando AND lógico EMSR773 ∩ municipios...")
    clipped_mask = ((ems_mask == 1) & (muni_mask == 1)).astype("uint8")
    pct_clip = 100.0 * clipped_mask.sum() / clipped_mask.size
    log.info("  Píxeles en máscara final: %d (%.2f%%)",
             int(clipped_mask.sum()), pct_clip)
    log.info("  Reducción vs máscara original: -%.1f%% de píxeles inundados",
             100 * (1 - clipped_mask.sum() / max(ems_mask.sum(), 1)))
    _write_mask(clipped_mask, out_clipped, canonical_transform, canonical_crs)

    # 6) Regenerar training_dataset.parquet con la etiqueta corregida
    log.info("Regenerando training_dataset.parquet con la nueva etiqueta...")
    dataset_dir = root / "data" / "dataset"
    out_parquet = dataset_dir / "training_dataset.parquet"
    out_csv     = dataset_dir / "training_sample.csv"
    _regenerate_dataset(root, paths, clipped_mask, out_parquet, out_csv,
                         canonical_shape)

    # 7) Diagnósticos visuales
    log.info("Generando PNGs de diagnóstico...")
    # Cargar mean_sigma0_vv como background
    with rasterio.open(root / "data" / "features" / "sar" / "mean_sigma0_vv.tif") as ds:
        mean_vv = ds.read(1).astype("float32")

    # extent UTM para imshow
    b = canonical_bounds
    extent_utm = (b.left, b.right, b.bottom, b.top)

    # Vista A: nueva máscara superpuesta
    _plot_overlay(
        mean_vv, clipped_mask,
        "Máscara EMSR773 RECORTADA a municipios DANA  —  EPSG:32630  10 m/px",
        diag_dir / "flood_mask_visualization.png",
        extent_utm=extent_utm,
    )

    # Vista B: municipios sobre mean_vv
    _plot_overlay(
        mean_vv, None,
        "Límites municipales DANA sobre mean σ⁰_VV",
        diag_dir / "municipalities_visualization.png",
        extra_polys=munis_clipped.assign(name=munis_clipped["name"].astype(str)),
        extent_utm=extent_utm,
    )

    # Vista C: comparativa antes/después
    _plot_before_after(mean_vv, ems_mask, clipped_mask, extent_utm,
                        diag_dir / "flood_mask_before_after.png")

    # 8) Reporte final
    elapsed = time.time() - t0
    diff = ems_mask.sum() - clipped_mask.sum()
    log.info("=" * 70)
    log.info("RESUMEN CLIP_FLOOD_MASK")
    log.info("  Municipios incluidos (en bbox)      : %d", len(munis_in_bbox))
    log.info("  Fuente                              : OpenStreetMap (osmnx)")
    log.info("  Píxeles antes (observedEventA)      : %9d (%.2f%%)",
             int(ems_mask.sum()), pct_orig)
    log.info("  Píxeles después (clipping municipal): %9d (%.2f%%)",
             int(clipped_mask.sum()), pct_clip)
    log.info("  Reducción                           : -%d píxeles (-%.1f%%)",
             int(diff), 100 * diff / max(ems_mask.sum(), 1))
    log.info("  Outputs:")
    log.info("    %s", out_muni_mask)
    log.info("    %s", out_clipped)
    log.info("    %s", out_parquet)
    log.info("    %s", out_csv)
    for p in diag_dir.glob("*.png"):
        log.info("    %s", p)
    log.info("  Tiempo total                        : %.1f s", elapsed)
    log.info("=" * 70)


# ---------------------------------------------------------------------------
# Regeneración del dataset
# ---------------------------------------------------------------------------

def _regenerate_dataset(
    root: Path,
    paths: dict,
    flood_mask: np.ndarray,
    out_parquet: Path,
    out_csv: Path,
    shape: Tuple[int, int],
) -> None:
    """Reescribe training_dataset.parquet con la nueva flood_label."""
    feature_paths = [
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

    rows, cols = shape
    n = len(feature_paths)
    stack = np.empty((n, rows, cols), dtype="float32")
    for i, (name, rel) in enumerate(feature_paths):
        with rasterio.open(root / rel) as ds:
            arr = ds.read(1).astype("float32")
            nodata = ds.nodata
        if nodata is not None and not np.isnan(nodata):
            arr[arr == nodata] = np.nan
        stack[i] = arr

    rr, cc = np.indices((rows, cols))
    data = {"row": rr.ravel().astype("int32"), "col": cc.ravel().astype("int32")}
    feature_names = [name for name, _ in feature_paths]
    for i, name in enumerate(feature_names):
        data[name] = stack[i].ravel()
    data["flood_label"] = flood_mask.ravel().astype("int8")

    df = pd.DataFrame(data)
    nan_mask = df[feature_names].isna().any(axis=1)
    df = df.loc[~nan_mask].reset_index(drop=True)
    df = df[~np.isinf(df[feature_names]).any(axis=1)].reset_index(drop=True)

    log.info("  Dataset final: %d filas × %d columnas", len(df), len(df.columns))
    counts = df["flood_label"].value_counts().sort_index()
    pct_0 = 100 * counts.get(0, 0) / len(df)
    pct_1 = 100 * counts.get(1, 0) / len(df)
    ratio = counts.get(0, 0) / max(counts.get(1, 0), 1)
    log.info("  Clase 0 (no inundado): %d (%.2f%%)", counts.get(0, 0), pct_0)
    log.info("  Clase 1 (inundado)   : %d (%.2f%%)", counts.get(1, 0), pct_1)
    log.info("  Ratio neg:pos        : %.1f : 1", ratio)

    df.to_parquet(out_parquet, index=False, compression="snappy")
    log.info("  Guardado parquet: %s (%.2f MB)",
             out_parquet, out_parquet.stat().st_size / 1e6)

    sample_n = min(10_000, len(df))
    df.sample(sample_n, random_state=42).to_csv(out_csv, index=False)
    log.info("  Guardado sample CSV: %s", out_csv)


def _plot_before_after(
    mean_vv: np.ndarray,
    mask_before: np.ndarray,
    mask_after: np.ndarray,
    extent_utm,
    out_path: Path,
) -> None:
    if not HAS_MPL:
        return
    bg = mean_vv.astype(float).copy()
    bg[~np.isfinite(bg)] = np.nan
    vmin, vmax = np.nanpercentile(bg, [2, 98])

    fig, axes = plt.subplots(1, 2, figsize=(18, 8))
    for ax, mask, title in zip(
        axes, [mask_before, mask_after],
        ["ANTES: EMSR773 completo", "DESPUÉS: recortado a municipios DANA"]
    ):
        ax.imshow(bg, cmap="gray", vmin=vmin, vmax=vmax,
                  interpolation="nearest", extent=extent_utm)
        ov = np.zeros((*mask.shape, 4), dtype="float32")
        ov[mask == 1] = (1.0, 0.15, 0.15, 0.55)
        ax.imshow(ov, interpolation="nearest", extent=extent_utm)
        pct = 100.0 * mask.sum() / mask.size
        ax.set_title(f"{title}\n{int(mask.sum())} px ({pct:.2f}%)", fontsize=12)
        ax.set_xlabel("UTM X (m)")
        ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


if __name__ == "__main__":
    main()
