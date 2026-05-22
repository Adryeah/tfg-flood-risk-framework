"""
Genera todas las features DEM/topograficas para la zona de Algemesi
(Ribera Alta/Baixa) usando el mismo pipeline que se uso para Valencia
en Semana 3.

A diferencia de Valencia, donde water_frequency.tif (derivado de los
GeoTIFFs S1) definia la cuadricula canonica, aqui el grid se construye
analiticamente a partir del bbox extrapolation_area + 10 m UTM30N
(snap a multiplo de 10). Las escenas S1 reprocesadas con bbox combinado
se resamplearan a esta cuadricula mas adelante.

Pasos:
  1. Construye grid canonico Algemesi (10 m, EPSG:32630, snap pixel).
  2. Reproyecta el tile DEM N39W001 (ya descargado) a EPSG:32630 @ 30 m
     y lo recorta al bbox extendido Algemesi (con buffer 0.05 deg).
  3. Calcula slope, flow accumulation D8, distance_to_stream a 30 m.
  4. Calcula distance_to_coast (osmnx + EDT), TWI, HAND a 30 m.
  5. Remuestrea las 7 features al grid canonico Algemesi @ 10 m.
  6. Sanity checks + diagnosticos PNG.

Outputs (data/extrapolation/dem/):
  - canonical_grid.tif (raster vacio, sirve de plantilla)
  - elevation.tif, slope.tif, flow_accumulation.tif, distance_to_stream.tif
  - distance_to_coast.tif, twi.tif, hand.tif
"""
from __future__ import annotations

import logging
import sys
import time
import math
from pathlib import Path

import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_bounds, rowcol
from rasterio.warp import reproject, calculate_default_transform
from scipy.ndimage import distance_transform_edt
from pyproj import Transformer

# importar funciones del pipeline Valencia
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preprocessing.dem.prepare_dem import (
    compute_slope, compute_flow_accumulation, compute_distance_to_stream,
    _reproject_and_clip, _resample_to_canonical, _write_tif, plot_all_diagnostics,
)
from preprocessing.dem.extract_advanced_features import (
    compute_distance_to_coast, compute_twi, compute_hand_euclidean, _plot_raster,
    _read_raster, _write_raster, NODATA,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET_RES_M = 10.0
NATIVE_RES_M = 30.0
BUFFER_DEG = 0.05
BUFFER_M = BUFFER_DEG * 111_000


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _build_canonical_grid(bbox_wgs84: list[float], target_crs: CRS, res_m: float):
    """Define el grid canonico Algemesi: 10 m UTM30N, alineado a multiplo de 10 m.

    Devuelve (transform, height, width, bounds_utm).
    """
    tr = Transformer.from_crs("EPSG:4326", target_crs, always_xy=True)
    lon_min, lat_min, lon_max, lat_max = bbox_wgs84

    # Cuatro esquinas en UTM y bounding box envolvente
    xs, ys = tr.transform(
        [lon_min, lon_min, lon_max, lon_max],
        [lat_min, lat_max, lat_min, lat_max],
    )
    left   = math.floor(min(xs) / res_m) * res_m
    right  = math.ceil(max(xs)  / res_m) * res_m
    bottom = math.floor(min(ys) / res_m) * res_m
    top    = math.ceil(max(ys)  / res_m) * res_m

    width  = int(round((right - left) / res_m))
    height = int(round((top - bottom) / res_m))
    transform = from_bounds(left, bottom, right, top, width, height)
    return transform, height, width, (left, bottom, right, top)


def _save_canonical_grid(out_path: Path, transform, h: int, w: int, target_crs: CRS) -> None:
    profile = {
        "driver": "GTiff", "dtype": "uint8", "count": 1,
        "width": w, "height": h, "crs": target_crs, "transform": transform,
        "compress": "lzw", "nodata": 0,
    }
    arr = np.zeros((h, w), dtype="uint8")
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(arr, 1)
    log.info("Grid canonico Algemesi: %s  shape=(%d,%d)  bounds=%s",
             out_path.name, h, w, rasterio.open(out_path).bounds)


def main() -> int:
    t0 = time.time()
    params = _load_yaml(REPO_ROOT / "config" / "params.yaml")
    paths  = _load_yaml(REPO_ROOT / "config" / "paths.yaml")

    bbox_wgs84 = params["extrapolation_area"]["bbox"]
    target_crs = CRS.from_epsg(int(params["extrapolation_area"]["epsg"]))
    log.info("Algemesi bbox WGS84: %s", bbox_wgs84)
    log.info("CRS objetivo:        %s", target_crs)

    # --------------------------- directorios ---------------------------
    out_dir = REPO_ROOT / paths["data"]["extrapolation"]["dem"]
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = REPO_ROOT / paths["data"]["dem"] / "raw"  # ya descargado N39W001
    diag_dir = REPO_ROOT / "results" / "diagnostics" / "dem_features_algemesi"
    diag_dir.mkdir(parents=True, exist_ok=True)

    # --------------------------- 1. grid canonico ----------------------
    transform, height, width, bounds_utm = _build_canonical_grid(
        bbox_wgs84, target_crs, TARGET_RES_M
    )
    canonical_path = out_dir / "canonical_grid.tif"
    if not canonical_path.exists():
        _save_canonical_grid(canonical_path, transform, height, width, target_crs)
    else:
        log.info("Grid canonico ya existe: %s", canonical_path.name)
    log.info("  bounds UTM: %s", bounds_utm)
    log.info("  shape canonico: (%d, %d) -> %d Mpixel", height, width, height * width / 1e6)

    # --------------------------- 2. reproyectar DEM tile ---------------
    tile_path = raw_dir / "cop30_N39_W001.tif"
    if not tile_path.exists():
        log.error("No existe tile DEM: %s", tile_path)
        return 1
    log.info("Tile DEM: %s", tile_path.name)

    # Bounds de trabajo (con buffer en metros)
    work_bounds = (
        bounds_utm[0] - BUFFER_M, bounds_utm[1] - BUFFER_M,
        bounds_utm[2] + BUFFER_M, bounds_utm[3] + BUFFER_M,
    )
    work_path = out_dir / "raw_cop30_work_utm.tif"
    if not work_path.exists():
        log.info("Reproyectando DEM a EPSG:32630 @ %.0f m (buffer)...", NATIVE_RES_M)
        _reproject_and_clip(tile_path, work_path, target_crs, work_bounds, NATIVE_RES_M)
    else:
        log.info("DEM trabajo ya existe: %s", work_path.name)

    # --------------------------- 3. features 30 m ----------------------
    nodata_val = -9999.0
    with rasterio.open(work_path) as ds:
        elev_30 = ds.read(1).astype("float32")
        raw_nd = ds.nodata
        work_profile = ds.profile.copy()
        work_pixel = ds.transform.a
    if raw_nd is not None:
        elev_30[elev_30 == raw_nd] = nodata_val
    elev_30[~np.isfinite(elev_30)] = nodata_val
    log.info("DEM trabajo: shape=%s pixel=%.1f m", elev_30.shape, work_pixel)

    elev_path_30  = out_dir / "raw_elev_30m.tif"
    slope_path_30 = out_dir / "raw_slope_30m.tif"
    acc_path_30   = out_dir / "raw_flow_acc_30m.tif"
    dist_path_30  = out_dir / "raw_dist_stream_30m.tif"

    log.info("=" * 60)
    log.info("Calculando features 30 m...")
    log.info("=" * 60)
    slope_30 = compute_slope(elev_30, work_pixel, nodata_val)
    if not acc_path_30.exists():
        acc_30 = compute_flow_accumulation(work_path, nodata_val)
        _write_tif(acc_30, acc_path_30, work_profile, nodata_val)
    else:
        with rasterio.open(acc_path_30) as ds:
            acc_30 = ds.read(1).astype("float32")
    dist_30 = compute_distance_to_stream(acc_30, work_pixel, nodata_val)

    _write_tif(elev_30,  elev_path_30,  work_profile, nodata_val)
    _write_tif(slope_30, slope_path_30, work_profile, nodata_val)
    _write_tif(dist_30,  dist_path_30,  work_profile, nodata_val)

    # --------------------------- 4. features avanzadas 30 m -----------
    log.info("=" * 60)
    log.info("Calculando features avanzadas (coast, TWI, HAND) @ 30 m...")
    log.info("=" * 60)

    elev_for_adv = elev_30.copy()
    elev_for_adv[elev_for_adv == nodata_val] = np.nan
    flow_for_adv = acc_30.copy()
    flow_for_adv[flow_for_adv == nodata_val] = np.nan
    slope_for_adv = slope_30.copy()
    slope_for_adv[slope_for_adv == nodata_val] = np.nan

    coast_30 = compute_distance_to_coast(
        bbox_wgs84, elev_for_adv,
        work_profile["transform"], target_crs, elev_30.shape, work_pixel,
    )
    twi_30 = compute_twi(flow_for_adv, slope_for_adv, work_pixel)
    hand_30 = compute_hand_euclidean(elev_for_adv, flow_for_adv)

    coast_path_30 = out_dir / "raw_coast_30m.tif"
    twi_path_30   = out_dir / "raw_twi_30m.tif"
    hand_path_30  = out_dir / "raw_hand_30m.tif"
    _write_raster(coast_30, coast_path_30, work_profile)
    _write_raster(twi_30,   twi_path_30,   work_profile)
    _write_raster(hand_30,  hand_path_30,  work_profile)

    # --------------------------- 5. resample al grid canonico ---------
    log.info("=" * 60)
    log.info("Remuestreando 7 features al grid canonico @ %.0f m...", TARGET_RES_M)
    log.info("=" * 60)
    ref_shape = (height, width)
    final = {
        "elevation":           (elev_path_30,  Resampling.bilinear),
        "slope":               (slope_path_30, Resampling.bilinear),
        "flow_accumulation":   (acc_path_30,   Resampling.bilinear),
        "distance_to_stream":  (dist_path_30,  Resampling.bilinear),
        "distance_to_coast":   (coast_path_30, Resampling.bilinear),
        "twi":                 (twi_path_30,   Resampling.bilinear),
        "hand":                (hand_path_30,  Resampling.bilinear),
    }
    for name, (src, method) in final.items():
        dst = out_dir / f"{name}.tif"
        _resample_to_canonical(src, dst, transform, ref_shape, target_crs, method)

    # --------------------------- 6. diagnostico + sanity --------------
    log.info("Generando PNGs de diagnostico Algemesi...")

    def _load(p: Path) -> np.ndarray:
        with rasterio.open(p) as ds:
            arr = ds.read(1).astype("float32")
            nd = ds.nodata
        if nd is not None:
            arr[arr == nd] = np.nan
        return arr

    elev = _load(out_dir / "elevation.tif")
    slope = _load(out_dir / "slope.tif")
    acc   = _load(out_dir / "flow_accumulation.tif")
    dist  = _load(out_dir / "distance_to_stream.tif")
    coast = _load(out_dir / "distance_to_coast.tif")
    twi   = _load(out_dir / "twi.tif")
    hand  = _load(out_dir / "hand.tif")

    plot_all_diagnostics(elev, slope, acc, dist, np.nan, diag_dir)
    _plot_raster(coast, diag_dir / "distance_to_coast_map.png",
                 "distance_to_coast Algemesi (m)", "viridis",
                 label="Distancia a costa (m)")
    _plot_raster(twi, diag_dir / "twi_map.png",
                 "TWI Algemesi", "YlGnBu", label="TWI")
    _plot_raster(hand, diag_dir / "hand_map.png",
                 "HAND Algemesi (m)", "terrain",
                 vmin=0, vmax=100, label="HAND (m)")

    # Stats rapidas
    log.info("=" * 75)
    log.info("SANITY CHECKS  Algemesi  (canonical grid %dx%d)", height, width)
    log.info("=" * 75)
    for name, arr in [("elev", elev), ("slope", slope), ("flow_acc", acc),
                      ("dist_stream", dist), ("coast", coast), ("twi", twi),
                      ("hand", hand)]:
        v = arr[np.isfinite(arr)]
        if len(v) == 0:
            log.warning("  %-15s sin datos validos", name); continue
        log.info("  %-15s  min=%9.2f  p10=%9.2f  p50=%9.2f  p90=%9.2f  max=%9.2f",
                 name, float(v.min()), float(np.percentile(v, 10)),
                 float(np.median(v)), float(np.percentile(v, 90)), float(v.max()))

    elapsed = time.time() - t0
    log.info("=" * 75)
    log.info("RESUMEN prepare_algemesi_dem: %.1f min", elapsed / 60)
    for fn in ("canonical_grid", "elevation", "slope", "flow_accumulation",
               "distance_to_stream", "distance_to_coast", "twi", "hand"):
        p = out_dir / f"{fn}.tif"
        if p.exists():
            log.info("  %s  %.2f MB", p.name, p.stat().st_size / 1e6)
    log.info("=" * 75)
    return 0


if __name__ == "__main__":
    sys.exit(main())
