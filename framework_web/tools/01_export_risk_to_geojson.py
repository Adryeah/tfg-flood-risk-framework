"""
01_export_risk_to_geojson.py
-----------------------------
Vectoriza los GeoTIFF de probabilidad de riesgo (Valencia y Algemesi)
y los ground truth EMSR773 a GeoJSON simplificado en EPSG:4326 para
servir desde el backend FastAPI.

Inputs:
  - results/maps/04_risk_prediction/risk_probability.tif
  - results/maps/05_extrapolation/risk_probability_algemesi.tif
  - data/labels/flood_mask_emsr773_clipped.tif
  - data/labels/algemesi/flood_mask_algemesi_clipped.tif
  - data/auxiliary/municipios/dana_affected_municipalities.geojson

Outputs (framework_web/backend/data_processed/):
  - valencia_risk.geojson
  - algemesi_risk.geojson
  - ground_truth_valencia.geojson
  - ground_truth_algemesi.geojson
  - municipalities.geojson

Bins de probabilidad: [0-0.25, 0.25-0.5, 0.5-0.75, 0.75-1.0].
Tolerancia de simplificacion: 0.0001 grados (~10 m).
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import shapes as rio_shapes
from rasterio.warp import transform_bounds
from shapely.geometry import shape as shp_shape, mapping
from shapely.ops import unary_union

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "framework_web" / "backend" / "data_processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

#
# Bin schema for the frontend.
#
# Eight fine-grained bins between p=0.25 and p=1.00 give the map a near-
# continuous yellow→red gradient. Pixels below 0.25 are dropped (the
# basemap shows through and looks correct on the enterprise theme).
# `color` is baked in so the frontend can style features in O(1) without
# a colormap lookup.
#
# Tuple: (p_min, p_max, risk_level, label, color)
PROB_BINS = [
    (0.25, 0.34, "bin_1", "low",         "#FEF3C7"),  # amber-100
    (0.34, 0.43, "bin_2", "low_medium",  "#FDE68A"),  # amber-200
    (0.43, 0.52, "bin_3", "medium_low",  "#FCD34D"),  # amber-300
    (0.52, 0.61, "bin_4", "medium",      "#FBBF24"),  # amber-400
    (0.61, 0.70, "bin_5", "medium_high", "#F87171"),  # red-400
    (0.70, 0.79, "bin_6", "high",        "#EF4444"),  # red-500
    (0.79, 0.88, "bin_7", "very_high",   "#DC2626"),  # red-600
    (0.88, 1.01, "bin_8", "extreme",     "#991B1B"),  # red-800
]

# Tail bins — the low-probability shoulder p ∈ [0, 0.25). Rendered as a
# muted grey ramp so the user can opt-in to see the "background" prediction
# without competing with the amber→red risk gradient. Filtering is more
# aggressive (bigger polygons only, coarser simplification) because this
# layer covers ~75 % of the bbox by area and would otherwise dwarf the
# risk file.
TAIL_BINS = [
    (0.00, 0.06, "tail_1", "background",  "#E5E7EB"),  # gray-200
    (0.06, 0.13, "tail_2", "very_low",    "#D1D5DB"),  # gray-300
    (0.13, 0.19, "tail_3", "low_minus",   "#B3BAC4"),  # gray-400-ish
    (0.19, 0.25, "tail_4", "low_shoulder", "#9CA3AF"),  # gray-500
]

SIMPLIFY_TOL_DEG = 0.0008           # ~89 m, conservative single pass
MIN_AREA_DEG2    = 2e-7             # ~2400 m^2, preserves urban block detail
SIMPLIFY_TOL_DEG_TAIL = 0.0015      # ~165 m, coarser for the background ramp
MIN_AREA_DEG2_TAIL    = 1e-6        # ~12,000 m^2, 5x more aggressive
MAX_SIZE_MB = 16.0                  # generous; tolerance is fixed (no escalation)


def _vectorize_probability(
    tif_path: Path,
    name: str,
    bins=PROB_BINS,
    simplify_tol: float = SIMPLIFY_TOL_DEG,
    min_area: float = MIN_AREA_DEG2,
) -> Path:
    """Vectoriza un GeoTIFF de probabilidad usando el `bins` indicado.

    Por defecto usa los 8 bins principales (p ∈ [0.25, 1.0]); con `TAIL_BINS`
    y los parámetros `_TAIL` se genera el shoulder bajo opt-in.
    """
    log.info("Vectorizando %s ...", tif_path.name)
    t0 = time.time()
    with rasterio.open(tif_path) as ds:
        arr = ds.read(1)
        src_crs = ds.crs
        src_transform = ds.transform
        nodata = ds.nodata

    valid = np.isfinite(arr)
    if nodata is not None and not np.isnan(nodata):
        valid &= (arr != nodata)
    log.info("  Pixels validos: %d (%.1f%%)", int(valid.sum()),
             100 * valid.mean())

    # Each output feature is ONE polygon (no per-bin Multi merging).
    # That preserves urban-block granularity instead of merging the
    # whole bin into a single amorphous Multi.
    import warnings

    log.info("  Extrayendo poligonos por bin...")
    rows = []

    for idx, (lo, hi, risk_level, label, color) in enumerate(bins):
        mask = (valid & (arr >= lo) & (arr < hi)).astype("uint8")
        if mask.sum() == 0:
            continue

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            geoms = [
                shp_shape(g)
                for g, v in rio_shapes(mask, mask=mask.astype(bool),
                                        transform=src_transform)
                if v == 1
            ]
        log.info("    bin %-12s [%.2f, %.2f): %d geoms (raw)",
                 risk_level, lo, hi, len(geoms))
        if not geoms:
            continue

        # Reproyectar en bloque a EPSG:4326 (mas rapido que en geoms sueltos)
        gdf_bin = gpd.GeoDataFrame(
            {"geometry": geoms}, crs=src_crs
        ).to_crs("EPSG:4326")

        # Simplificar una sola vez con la tolerancia indicada
        gdf_bin["geometry"] = gdf_bin.geometry.simplify(
            simplify_tol, preserve_topology=True
        )

        # Filtrar polygons mas pequeños que min_area
        gdf_bin = gdf_bin[gdf_bin.geometry.area >= min_area]
        gdf_bin = gdf_bin[gdf_bin.geometry.is_valid & gdf_bin.geometry.notna()]
        if gdf_bin.empty:
            continue

        log.info("        kept %d geoms after simplify+area filter",
                 len(gdf_bin))

        # Append rows with per-feature properties
        for geom in gdf_bin.geometry:
            rows.append({
                "geometry": geom,
                "bin_id": idx,
                "risk_level": risk_level,
                "label": label,
                "probability_bin": f"{lo:.2f}-{hi:.2f}",
                "probability_min": float(lo),
                "probability_max": float(min(hi, 1.0)),
                "color": color,
            })

    if not rows:
        log.warning("Sin features en %s", name)
        return None

    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    out_path = OUT_DIR / f"{name}.geojson"
    if out_path.exists():
        out_path.unlink()
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1e6
    log.info("  %s  %.2f MB  %d features  (%.1fs)",
             out_path.name, size_mb, len(gdf), time.time() - t0)

    if size_mb > MAX_SIZE_MB:
        log.warning("  >%.0f MB; tolerance is fixed by design — "
                    "consider raising MIN_AREA_DEG2 or SIMPLIFY_TOL_DEG.",
                    MAX_SIZE_MB)

    return out_path


def _vectorize_mask(tif_path: Path, name: str) -> Path:
    log.info("Vectorizando ground truth %s ...", tif_path.name)
    t0 = time.time()
    with rasterio.open(tif_path) as ds:
        arr = ds.read(1)
        src_crs = ds.crs
        src_transform = ds.transform

    mask = (arr == 1).astype("uint8")
    if mask.sum() == 0:
        log.warning("  Mascara vacia en %s", name)
        return None

    geoms = []
    for geom, value in rio_shapes(mask, mask=mask.astype(bool),
                                   transform=src_transform):
        if value == 1:
            geoms.append(shp_shape(geom))
    log.info("  %d poligonos extraidos", len(geoms))

    merged = unary_union(geoms)
    gdf = gpd.GeoDataFrame([{"label": "flooded_emsr773",
                             "geometry": merged}], crs=src_crs)
    gdf = gdf.to_crs("EPSG:4326")
    gdf["geometry"] = gdf.geometry.simplify(
        SIMPLIFY_TOL_DEG, preserve_topology=True
    )
    out_path = OUT_DIR / f"{name}.geojson"
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1e6
    log.info("  %s  %.2f MB  (%.1fs)", out_path.name, size_mb,
             time.time() - t0)
    return out_path


def _reproject_geojson(src_path: Path, name: str) -> Path:
    log.info("Reproyectando %s ...", src_path.name)
    gdf = gpd.read_file(src_path)
    if gdf.crs is None:
        gdf.set_crs("EPSG:4326", inplace=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    out_path = OUT_DIR / f"{name}.geojson"
    gdf.to_file(out_path, driver="GeoJSON")
    size_mb = out_path.stat().st_size / 1e6
    log.info("  %s  %.2f MB  (%d features)", out_path.name, size_mb, len(gdf))
    return out_path


def main() -> int:
    log.info("=" * 60)
    log.info("Export risk + ground truth + municipios -> GeoJSON")
    log.info("Output dir: %s", OUT_DIR)
    log.info("=" * 60)

    # --- Risk maps ---
    val_prob = REPO / "results" / "maps" / "04_risk_prediction" / "risk_probability_v2.tif"
    alg_prob = REPO / "results" / "maps" / "05_extrapolation" / "risk_probability_algemesi.tif"

    if val_prob.exists():
        _vectorize_probability(val_prob, "valencia_risk")
        _vectorize_probability(
            val_prob, "valencia_risk_tail",
            bins=TAIL_BINS,
            simplify_tol=SIMPLIFY_TOL_DEG_TAIL,
            min_area=MIN_AREA_DEG2_TAIL,
        )
    else:
        log.error("Falta %s", val_prob)

    if alg_prob.exists():
        _vectorize_probability(alg_prob, "algemesi_risk")
        _vectorize_probability(
            alg_prob, "algemesi_risk_tail",
            bins=TAIL_BINS,
            simplify_tol=SIMPLIFY_TOL_DEG_TAIL,
            min_area=MIN_AREA_DEG2_TAIL,
        )
    else:
        log.error("Falta %s", alg_prob)

    # --- Ground truth ---
    val_gt = REPO / "data" / "labels" / "flood_mask_emsr773_clipped.tif"
    alg_gt = REPO / "data" / "labels" / "algemesi" / "flood_mask_algemesi_clipped.tif"

    if val_gt.exists():
        _vectorize_mask(val_gt, "ground_truth_valencia")
    else:
        log.error("Falta %s", val_gt)

    if alg_gt.exists():
        _vectorize_mask(alg_gt, "ground_truth_algemesi")
    else:
        log.error("Falta %s", alg_gt)

    # --- Municipios ---
    munis = REPO / "data" / "auxiliary" / "municipios" / "dana_affected_municipalities.geojson"
    if munis.exists():
        _reproject_geojson(munis, "municipalities")
    else:
        log.error("Falta %s", munis)

    log.info("=" * 60)
    log.info("Resumen:")
    for f in sorted(OUT_DIR.glob("*.geojson")):
        log.info("  %s  %.2f MB", f.name, f.stat().st_size / 1e6)
    log.info("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
