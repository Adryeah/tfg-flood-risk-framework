"""
Construye el ground truth para Algemesi a partir de EMSR773 AOI04.

Replica la metodologia del clipping municipal aplicada a Valencia (AOI01)
en Semana 3, ahora sobre la zona de Ribera Alta/Baixa:

  1. Carga shapefile observedEventA de AOI04 (303 features:
     197 Flooded area + 106 Flood trace).
  2. Reproyecta a EPSG:32630 y rasteriza al grid canonico Algemesi
     (data/extrapolation/dem/canonical_grid.tif). Genera dos versiones:
       - flood_mask_emsr773_algemesi_full.tif  (Flooded area + Flood trace)
       - flood_mask_emsr773_algemesi_floodedarea.tif (solo Flooded area)
  3. Carga municipios DANA cacheados
     (data/auxiliary/municipios/algemesi_zone_municipalities.geojson).
  4. Intenta anadir Polinya del Xuquer (que fallo en geocode previo) probando
     variantes. Si todas fallan, usa solo los 11 municipios cacheados.
  5. Reproyecta + rasteriza al grid canonico -> affected_municipalities_mask_algemesi.tif.
  6. AND logico EMS_full * municipios -> flood_mask_algemesi_clipped.tif.
  7. Reporta estadisticas (antes / despues / por municipio) y PNGs.

Outputs (data/labels/algemesi/):
  flood_mask_emsr773_algemesi_full.tif
  flood_mask_emsr773_algemesi_floodedarea.tif
  affected_municipalities_mask_algemesi.tif
  flood_mask_algemesi_clipped.tif

Diagnosticos: results/diagnostics/dataset_algemesi/{flood_mask, municipalities,
              flood_mask_before_after}.png
"""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import List

import geopandas as gpd
import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.features import rasterize
from shapely.geometry import box

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

DANA_MUNICIPALITIES_ALGEMESI = [
    "Algemesí", "Alzira", "Carcaixent", "Sueca", "Cullera",
    "Albalat de la Ribera", "Polinyà del Xúquer", "Riola", "Fortaleny",
    "Corbera", "Llaurí", "Favara",
]

POLINYA_VARIANTS = [
    "Polinyà del Xúquer, Valencia, Spain",
    "Polinyà de Xúquer, Valencia, Spain",
    "Polinya del Xuquer, Valencia, Spain",
    "Polinya de Xuquer, Valencia, Spain",
    "Polinyà del Xúquer, Comunidad Valenciana, Spain",
]


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _try_add_polinya(existing_names: List[str], existing_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Si Polinya no esta, prueba variantes con osmnx; si falla, devuelve el GDF original."""
    if any("Polin" in n for n in existing_names):
        log.info("Polinya del Xuquer ya esta en el GDF de municipios.")
        return existing_gdf

    try:
        import osmnx as ox
    except ImportError:
        log.warning("osmnx no disponible; no se puede anadir Polinya.")
        return existing_gdf

    for query in POLINYA_VARIANTS:
        try:
            log.info("Probando geocode: %s", query)
            gdf = ox.geocode_to_gdf(query)
            if gdf.empty:
                continue
            row = gdf.iloc[0]
            new_row = gpd.GeoDataFrame(
                [{
                    "name": "Polinyà del Xúquer",
                    "osm_name": row.get("display_name", ""),
                    "geometry": row.geometry,
                }],
                crs="EPSG:4326",
            )
            log.info("  Polinya geocodificado correctamente con: %s", query)
            return gpd.GeoDataFrame(
                pd_concat([existing_gdf, new_row], ignore_index=True),
                crs=existing_gdf.crs,
            )
        except Exception as exc:
            log.warning("  fallo: %s", exc)
    log.warning("Polinya del Xuquer no se pudo anadir; se procede sin el (no bloquea).")
    return existing_gdf


def pd_concat(*args, **kwargs):
    """Helper: concat de DataFrames usando pandas (evita import top-level)."""
    import pandas as pd
    return pd.concat(*args, **kwargs)


def _rasterize_geoms(gdf: gpd.GeoDataFrame, transform, shape) -> np.ndarray:
    rows, cols = shape
    return rasterize(
        ((g, 1) for g in gdf.geometry if g is not None and not g.is_empty),
        out_shape=(rows, cols),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=False,
    )


def _write_mask(mask: np.ndarray, out_path: Path, transform, crs: CRS) -> None:
    rows, cols = mask.shape
    profile = {
        "driver": "GTiff", "dtype": "uint8", "width": cols, "height": rows,
        "count": 1, "crs": crs, "transform": transform, "nodata": 255,
        "compress": "lzw",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(mask, 1)
    log.info("Guardado: %s (%.2f MB)", out_path.name, out_path.stat().st_size / 1e6)


def _plot_overlay(bg: np.ndarray, mask: np.ndarray, title: str, out_path: Path,
                  extent_utm=None, extra_polys: gpd.GeoDataFrame = None) -> None:
    if not HAS_MPL:
        return
    bg_f = bg.astype(float).copy()
    bg_f[~np.isfinite(bg_f)] = np.nan
    fig, ax = plt.subplots(figsize=(11, 9))
    if np.any(np.isfinite(bg_f)):
        vmin, vmax = np.nanpercentile(bg_f, [2, 98])
        ax.imshow(bg_f, cmap="terrain", vmin=vmin, vmax=vmax,
                  interpolation="nearest", extent=extent_utm)
    if mask is not None:
        ov = np.zeros((*mask.shape, 4), dtype="float32")
        ov[mask == 1] = (1.0, 0.15, 0.15, 0.55)
        ax.imshow(ov, interpolation="nearest", extent=extent_utm)
    if extra_polys is not None:
        for _, r in extra_polys.iterrows():
            geom = r.geometry
            if geom is None or geom.is_empty:
                continue
            if geom.geom_type == "Polygon":
                xs, ys = geom.exterior.xy
                ax.plot(xs, ys, color="cyan", lw=1.0)
            elif geom.geom_type == "MultiPolygon":
                for p in geom.geoms:
                    xs, ys = p.exterior.xy
                    ax.plot(xs, ys, color="cyan", lw=1.0)
            cen = geom.centroid
            ax.text(cen.x, cen.y, r.get("name", ""), fontsize=8, ha="center",
                    color="cyan",
                    bbox=dict(boxstyle="round,pad=0.2", fc="black", alpha=0.6, ec="none"))
    ax.set_title(title, fontsize=12)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


def _plot_before_after(bg: np.ndarray, m_full: np.ndarray, m_clip: np.ndarray,
                       extent_utm, out_path: Path) -> None:
    if not HAS_MPL:
        return
    bg_f = bg.astype(float).copy()
    bg_f[~np.isfinite(bg_f)] = np.nan
    vmin, vmax = (np.nanpercentile(bg_f, [2, 98]) if np.any(np.isfinite(bg_f))
                  else (0, 1))
    fig, axes = plt.subplots(1, 2, figsize=(18, 8))
    for ax, mask, title in zip(
        axes, [m_full, m_clip],
        ["ANTES: EMSR773 AOI04 completo", "DESPUES: clipping municipal Algemesi"],
    ):
        ax.imshow(bg_f, cmap="terrain", vmin=vmin, vmax=vmax,
                  interpolation="nearest", extent=extent_utm)
        ov = np.zeros((*mask.shape, 4), dtype="float32")
        ov[mask == 1] = (1.0, 0.15, 0.15, 0.55)
        ax.imshow(ov, interpolation="nearest", extent=extent_utm)
        pct = 100.0 * mask.sum() / mask.size
        ax.set_title(f"{title}\n{int(mask.sum())} px ({pct:.2f}%)")
        ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


def main() -> int:
    t0 = time.time()
    paths = _load_yaml(REPO_ROOT / "config" / "paths.yaml")

    out_dir = REPO_ROOT / "data" / "labels" / "algemesi"
    out_dir.mkdir(parents=True, exist_ok=True)
    diag_dir = REPO_ROOT / "results" / "diagnostics" / "dataset_algemesi"
    diag_dir.mkdir(parents=True, exist_ok=True)

    # 1. Grid canonico Algemesi
    canonical_path = REPO_ROOT / paths["data"]["extrapolation"]["dem"] / "canonical_grid.tif"
    if not canonical_path.exists():
        log.error("No existe canonical_grid.tif: %s", canonical_path)
        log.error("Ejecuta primero scripts/extrapolation/prepare_algemesi_dem.py")
        return 1
    with rasterio.open(canonical_path) as ref:
        canon_transform = ref.transform
        canon_crs       = ref.crs
        canon_shape     = (ref.height, ref.width)
        canon_bounds    = ref.bounds
    log.info("Grid canonico Algemesi: %s  px=%.0f m  CRS=%s",
             canon_shape, canon_transform.a, canon_crs)

    # 2. Cargar EMS AOI04 observedEventA
    ems_path = REPO_ROOT / "data" / "ems" / "algemesi" / \
        "EMSR773_AOI04_DEL_PRODUCT_observedEventA_v1.shp"
    if not ems_path.exists():
        log.error("No existe shapefile EMS: %s", ems_path)
        return 1
    log.info("Cargando EMS AOI04 observedEventA...")
    ems_gdf = gpd.read_file(ems_path)
    log.info("  Features: %d  CRS=%s", len(ems_gdf), ems_gdf.crs)
    if "notation" in ems_gdf.columns:
        log.info("  Distribucion notation: %s",
                 dict(ems_gdf["notation"].value_counts()))
    if "obj_desc" in ems_gdf.columns:
        log.info("  Distribucion obj_desc: %s",
                 dict(ems_gdf["obj_desc"].value_counts()))

    ems_utm = ems_gdf.to_crs(canon_crs)

    # 2a. Mascara FULL (Flooded area + Flood trace)
    log.info("Rasterizando EMS AOI04 FULL al grid canonico...")
    ems_full = _rasterize_geoms(ems_utm, canon_transform, canon_shape)
    pct_full = 100.0 * ems_full.sum() / ems_full.size
    log.info("  EMS full: %d px (%.2f%%)", int(ems_full.sum()), pct_full)
    out_full = out_dir / "flood_mask_emsr773_algemesi_full.tif"
    _write_mask(ems_full, out_full, canon_transform, canon_crs)

    # 2b. Mascara solo Flooded area
    if "notation" in ems_utm.columns:
        flooded_only = ems_utm[ems_utm["notation"] == "Flooded area"]
        log.info("Rasterizando EMS AOI04 solo 'Flooded area' (%d features)...",
                 len(flooded_only))
        ems_fa = _rasterize_geoms(flooded_only, canon_transform, canon_shape)
        pct_fa = 100.0 * ems_fa.sum() / ems_fa.size
        log.info("  EMS Flooded area: %d px (%.2f%%)",
                 int(ems_fa.sum()), pct_fa)
        out_fa = out_dir / "flood_mask_emsr773_algemesi_floodedarea.tif"
        _write_mask(ems_fa, out_fa, canon_transform, canon_crs)
    else:
        ems_fa = None
        pct_fa = None

    # 3. Cargar municipios cacheados + intentar anadir Polinya
    muni_path = REPO_ROOT / "data" / "auxiliary" / "municipios" / \
        "algemesi_zone_municipalities.geojson"
    if not muni_path.exists():
        log.error("No existe cache de municipios Algemesi: %s", muni_path)
        return 1
    munis_wgs = gpd.read_file(muni_path)
    existing_names = munis_wgs["name"].tolist()
    log.info("Municipios cacheados (%d): %s", len(existing_names), existing_names)

    munis_wgs = _try_add_polinya(existing_names, munis_wgs)
    log.info("Municipios totales tras intento Polinya: %d", len(munis_wgs))

    # 4. Reproyectar municipios + recortar al bbox canonico Algemesi
    munis_utm = munis_wgs.to_crs(canon_crs)
    bbox_geom = box(canon_bounds.left, canon_bounds.bottom,
                    canon_bounds.right, canon_bounds.top)
    munis_utm["intersects_bbox"] = munis_utm.geometry.intersects(bbox_geom)
    munis_in = munis_utm[munis_utm["intersects_bbox"]].copy()
    munis_in["area_km2"] = munis_in.geometry.area / 1e6
    munis_in["area_in_bbox_km2"] = munis_in.geometry.intersection(bbox_geom).area / 1e6

    log.info("=" * 70)
    log.info("Municipios que tocan el bbox Algemesi (%d):", len(munis_in))
    for _, r in munis_in.sort_values("name").iterrows():
        pct = 100 * r["area_in_bbox_km2"] / max(r["area_km2"], 1e-6)
        log.info("  %-22s  area %6.2f km2 - en bbox %6.2f km2 (%.0f%%)",
                 r["name"], r["area_km2"], r["area_in_bbox_km2"], pct)
    log.info("=" * 70)

    # 5. Rasterizar municipios
    munis_in["geometry"] = munis_in.geometry.intersection(bbox_geom)
    log.info("Rasterizando municipios al grid canonico...")
    muni_mask = _rasterize_geoms(munis_in, canon_transform, canon_shape)
    pct_muni = 100.0 * muni_mask.sum() / muni_mask.size
    log.info("  Pixels en municipios: %d (%.2f%% del bbox)",
             int(muni_mask.sum()), pct_muni)
    _write_mask(muni_mask, out_dir / "affected_municipalities_mask_algemesi.tif",
                canon_transform, canon_crs)

    # 6. AND logico EMS_full * municipios
    log.info("Aplicando AND logico EMS_full * municipios...")
    clipped_mask = ((ems_full == 1) & (muni_mask == 1)).astype("uint8")
    pct_clip = 100.0 * clipped_mask.sum() / clipped_mask.size
    diff = ems_full.sum() - clipped_mask.sum()
    log.info("  Mascara final: %d px (%.2f%%)",
             int(clipped_mask.sum()), pct_clip)
    log.info("  Reduccion vs EMS_full: -%d px (-%.1f%%)",
             int(diff), 100 * diff / max(ems_full.sum(), 1))
    out_clip = out_dir / "flood_mask_algemesi_clipped.tif"
    _write_mask(clipped_mask, out_clip, canon_transform, canon_crs)

    # 7. Diagnosticos: usar elevation Algemesi como background
    elev_path = REPO_ROOT / paths["data"]["extrapolation"]["dem"] / "elevation.tif"
    if elev_path.exists():
        with rasterio.open(elev_path) as ds:
            bg = ds.read(1).astype("float32")
            bg_nd = ds.nodata
        if bg_nd is not None:
            bg[bg == bg_nd] = np.nan
    else:
        log.warning("elevation.tif Algemesi no disponible; usando bg=zeros")
        bg = np.zeros(canon_shape, dtype="float32")

    extent_utm = (canon_bounds.left, canon_bounds.right,
                  canon_bounds.bottom, canon_bounds.top)

    _plot_overlay(bg, clipped_mask,
                  "Algemesi - mascara EMSR773 AOI04 RECORTADA a municipios DANA",
                  diag_dir / "flood_mask_visualization.png", extent_utm)
    _plot_overlay(bg, None,
                  "Algemesi - municipios DANA sobre elevation",
                  diag_dir / "municipalities_visualization.png", extent_utm,
                  extra_polys=munis_in.assign(name=munis_in["name"].astype(str)))
    _plot_before_after(bg, ems_full, clipped_mask, extent_utm,
                       diag_dir / "flood_mask_before_after.png")

    elapsed = time.time() - t0
    log.info("=" * 75)
    log.info("RESUMEN GROUND TRUTH ALGEMESI")
    log.info("  Tiempo total: %.1f s", elapsed)
    log.info("  EMS AOI04 features: %d (Flooded area + Flood trace)", len(ems_gdf))
    log.info("  Municipios incluidos: %d", len(munis_in))
    log.info("  Pixels EMS_full       : %9d (%.2f%%)", int(ems_full.sum()), pct_full)
    if ems_fa is not None:
        log.info("  Pixels solo FloodedAr.: %9d (%.2f%%)", int(ems_fa.sum()), pct_fa)
    log.info("  Pixels clipped        : %9d (%.2f%%)", int(clipped_mask.sum()), pct_clip)
    log.info("  Reduccion             : -%d px (-%.1f%%)",
             int(diff), 100 * diff / max(ems_full.sum(), 1))
    log.info("  Outputs:")
    log.info("    %s", out_full)
    if ems_fa is not None:
        log.info("    %s", out_dir / "flood_mask_emsr773_algemesi_floodedarea.tif")
    log.info("    %s", out_dir / "affected_municipalities_mask_algemesi.tif")
    log.info("    %s", out_clip)
    log.info("=" * 75)
    return 0


if __name__ == "__main__":
    sys.exit(main())
