#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
prepare_dem.py
--------------
Descarga el DEM Copernicus GLO-30 (público en AWS S3, ~30 m, sin autenticación),
lo reproyecta a EPSG:32630 y calcula las tres features topográficas del modelo:
pendiente (slope), acumulación de flujo D8 (pysheds) y distancia a cauces
(scipy). Todos los outputs se alinean exactamente con la cuadrícula canónica
de las escenas Sentinel-1 procesadas (water_frequency.tif como referencia).

ALTERNATIVAS DE DESCARGA si el endpoint AWS no es accesible:
  1. OpenTopography API (clave gratuita en portal.opentopography.org/requestApiKey)
     Añadir al yaml de credenciales: opentopography_key: TU_CLAVE
  2. Descarga manual: guardar el tile en data/dem/raw/ con nombre cop30_N{lat}_W{lon}.tif
     Tile para Valencia: cop30_N39_W001.tif
     URL: https://copernicus-dem-30m.s3.amazonaws.com/
          Copernicus_DSM_COG_10_N39_00_W001_00_DEM/
          Copernicus_DSM_COG_10_N39_00_W001_00_DEM.tif

Uso:
    python scripts/preprocessing/dem/prepare_dem.py

Dependencias extra (ya instaladas en requirements.txt):
    pip install pysheds
"""

from __future__ import annotations

import argparse
import logging
import math
import time
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.merge import merge as rio_merge
from rasterio.warp import calculate_default_transform, reproject
from scipy.ndimage import distance_transform_edt

# Compat: pysheds 0.5 usa np.in1d que NumPy 2.x retiro en favor de np.isin.
if not hasattr(np, "in1d"):
    np.in1d = np.isin  # type: ignore[attr-defined]

try:
    from pysheds.grid import Grid as PyshedsGrid
    HAS_PYSHEDS = True
except ImportError:
    HAS_PYSHEDS = False

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
COPDEM_BASE_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{lat_pfx}{lat:02d}_00_{lon_pfx}{lon:03d}_00_DEM/"
    "Copernicus_DSM_COG_10_{lat_pfx}{lat:02d}_00_{lon_pfx}{lon:03d}_00_DEM.tif"
)
STREAM_THRESHOLD = 1000   # celdas aguas arriba para considerar un píxel como cauce
BUFFER_DEG = 0.05         # buffer en grados alrededor del bbox para evitar efectos de borde

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers de configuración
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    """Devuelve la raíz del repositorio (3 niveles por encima del script)."""
    return Path(__file__).resolve().parent.parent.parent.parent


def _load_yaml(path: Path) -> dict:
    """Carga un fichero YAML y devuelve el diccionario."""
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ---------------------------------------------------------------------------
# Cálculo de tiles COP-DEM
# ---------------------------------------------------------------------------

def _cop_dem_tiles(bbox_wgs84: List[float]) -> List[Tuple[int, int]]:
    """
    Devuelve la lista de tiles COP-DEM GLO-30 (1°×1°) que cubren el bbox.

    Parameters
    ----------
    bbox_wgs84:
        [lon_min, lat_min, lon_max, lat_max] en WGS84.

    Returns
    -------
    Lista de tuplas (lat_tile, lon_tile) donde lat_tile es el entero de la
    esquina SW del tile (positivo = Norte) y lon_tile el de la esquina SW
    (negativo = Oeste).
    """
    lon_min, lat_min, lon_max, lat_max = bbox_wgs84
    # Añadir buffer para cubrir bordes
    lon_min -= BUFFER_DEG; lat_min -= BUFFER_DEG
    lon_max += BUFFER_DEG; lat_max += BUFFER_DEG

    lat_start = math.floor(lat_min)
    lat_end   = math.floor(lat_max)
    lon_start = math.floor(lon_min)
    lon_end   = math.floor(lon_max)

    tiles = []
    for lat in range(lat_start, lat_end + 1):
        for lon in range(lon_start, lon_end + 1):
            tiles.append((lat, lon))
    return tiles


def _cop_dem_url(lat: int, lon: int) -> str:
    """Construye la URL del tile COP-DEM GLO-30 en el bucket público de AWS."""
    lat_pfx = "N" if lat >= 0 else "S"
    lon_pfx = "E" if lon >= 0 else "W"
    return COPDEM_BASE_URL.format(
        lat_pfx=lat_pfx, lat=abs(lat),
        lon_pfx=lon_pfx, lon=abs(lon),
    )


def _tile_filename(lat: int, lon: int) -> str:
    lat_pfx = "N" if lat >= 0 else "S"
    lon_pfx = "E" if lon >= 0 else "W"
    return f"cop30_{lat_pfx}{abs(lat):02d}_{lon_pfx}{abs(lon):03d}.tif"


# ---------------------------------------------------------------------------
# Descarga de tiles
# ---------------------------------------------------------------------------

def _download_tile(url: str, dest: Path) -> bool:
    """
    Descarga un tile COP-DEM desde el endpoint público de AWS.

    Returns
    -------
    True si la descarga fue exitosa, False si hubo error.
    """
    if dest.exists():
        log.info("Tile ya existe, omitiendo descarga: %s", dest.name)
        return True

    log.info("Descargando tile COP-DEM: %s", dest.name)
    log.info("  URL: %s", url)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            with open(dest, "wb") as fh:
                while True:
                    chunk = resp.read(1 << 20)  # 1 MB chunks
                    if not chunk:
                        break
                    fh.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded / total * 100
                        log.info("  %.1f MB / %.1f MB  (%.0f%%)",
                                 downloaded / 1e6, total / 1e6, pct)
        log.info("Tile descargado correctamente: %s (%.1f MB)",
                 dest.name, dest.stat().st_size / 1e6)
        return True
    except Exception as exc:
        log.error("Error descargando %s: %s", dest.name, exc)
        if dest.exists():
            dest.unlink()
        return False


def _manual_download_instructions(tiles: List[Tuple[int, int]], raw_dir: Path) -> None:
    """Registra en log las instrucciones de descarga manual."""
    log.error("=" * 60)
    log.error("DESCARGA AUTOMÁTICA FALLIDA. Descarga manual requerida.")
    log.error("Guarda los tiles en: %s", raw_dir)
    log.error("-" * 60)
    for lat, lon in tiles:
        url = _cop_dem_url(lat, lon)
        dest = raw_dir / _tile_filename(lat, lon)
        log.error("  %s", dest.name)
        log.error("  %s", url)
    log.error("-" * 60)
    log.error("Alternativa — OpenTopography API (clave gratuita):")
    log.error("  https://portal.opentopography.org/requestApiKey")
    log.error("  Añadir opentopography_key: TU_CLAVE en config/copernicus_credentials.yaml")
    log.error("=" * 60)


# ---------------------------------------------------------------------------
# Reproyección y recorte
# ---------------------------------------------------------------------------

def _reproject_and_clip(
    src_path: Path,
    dst_path: Path,
    target_crs: CRS,
    target_bounds: Tuple[float, float, float, float],
    target_res_m: float,
) -> None:
    """
    Reproyecta src_path a target_crs y recorta al bounding box, guardando
    en dst_path con resolución target_res_m metros/píxel.
    """
    with rasterio.open(src_path) as src:
        transform_out, width, height = calculate_default_transform(
            src.crs, target_crs,
            src.width, src.height,
            left=src.bounds.left, bottom=src.bounds.bottom,
            right=src.bounds.right, top=src.bounds.top,
            resolution=target_res_m,
        )
        # Sobreescribir transform/shape para que encaje exactamente en bounds
        left, bottom, right, top = target_bounds
        width  = int(math.ceil((right - left) / target_res_m))
        height = int(math.ceil((top - bottom) / target_res_m))
        from rasterio.transform import from_bounds as _from_bounds
        transform_out = _from_bounds(left, bottom, right, top, width, height)

        profile = src.profile.copy()
        profile.update(
            crs=target_crs,
            transform=transform_out,
            width=width,
            height=height,
            driver="GTiff",
            compress="lzw",
            nodata=src.nodata if src.nodata is not None else -9999.0,
        )

        with rasterio.open(dst_path, "w", **profile) as dst:
            for band_idx in range(1, src.count + 1):
                reproject(
                    source=rasterio.band(src, band_idx),
                    destination=rasterio.band(dst, band_idx),
                    src_transform=src.transform,
                    src_crs=src.crs,
                    dst_transform=transform_out,
                    dst_crs=target_crs,
                    resampling=Resampling.bilinear,
                )


def _resample_to_canonical(
    src_path: Path,
    dst_path: Path,
    ref_transform,
    ref_shape: Tuple[int, int],
    target_crs: CRS,
    resampling: Resampling = Resampling.bilinear,
) -> None:
    """
    Remuestrea src_path a la cuadrícula canónica definida por ref_transform y
    ref_shape, guardando en dst_path. Todos los outputs del DEM se pasan por
    aquí para garantizar la alineación exacta con las escenas S1.
    """
    rows, cols = ref_shape
    with rasterio.open(src_path) as src:
        profile = src.profile.copy()
        profile.update(
            crs=target_crs,
            transform=ref_transform,
            width=cols,
            height=rows,
            driver="GTiff",
            compress="lzw",
        )
        data = np.empty((rows, cols), dtype=profile.get("dtype", "float32"))
        with rasterio.open(dst_path, "w", **profile) as dst:
            reproject(
                source=rasterio.band(src, 1),
                destination=data,
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=ref_transform,
                dst_crs=target_crs,
                resampling=resampling,
            )
            dst.write(data, 1)
    log.info("Remuestreado a grid canónico S1: %s  shape=%s", dst_path.name, ref_shape)


def _write_tif(
    data: np.ndarray,
    path: Path,
    profile: dict,
    nodata: float,
    dtype: str = "float32",
) -> None:
    """Escribe un array numpy como GeoTIFF con el perfil indicado."""
    out = data.astype(dtype)
    p = profile.copy()
    p.update(count=1, dtype=dtype, nodata=nodata, compress="lzw",
             driver="GTiff")
    # Eliminar opciones de tiling heredadas que interfieren con float32 single-band
    for key in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
        p.pop(key, None)
    with rasterio.open(path, "w", **p) as dst:
        dst.write(out, 1)
    log.info("Guardado: %s  (%.2f MB)", path, path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# Features DEM
# ---------------------------------------------------------------------------

def compute_slope(
    elev: np.ndarray,
    pixel_size_m: float,
    nodata: float,
) -> np.ndarray:
    """
    Calcula la pendiente en grados a partir del array de elevación.

    Método: derivadas parciales por el método de las diferencias finitas
    centradas (np.gradient), combinadas como arctan(sqrt(dz/dx² + dz/dy²)).
    """
    valid = (elev != nodata) & np.isfinite(elev)
    elev_f = elev.astype(float)
    elev_f[~valid] = np.nan

    dzdy, dzdx = np.gradient(elev_f, pixel_size_m)
    slope_rad = np.arctan(np.sqrt(dzdx**2 + dzdy**2))
    slope_deg = np.degrees(slope_rad)
    slope_deg[~valid] = nodata
    return slope_deg.astype("float32")


def compute_flow_accumulation(elev_path: Path, nodata: float) -> np.ndarray:
    """
    Calcula la acumulación de flujo D8 usando pysheds.

    Pasos internos:
      1. Rellenar pozos (pits)
      2. Rellenar depresiones
      3. Resolver zonas planas
      4. Calcular dirección de flujo D8
      5. Acumular píxeles aguas arriba

    Returns
    -------
    Array float32 con el número de celdas que drenan hacia cada píxel.
    """
    if not HAS_PYSHEDS:
        raise ImportError(
            "pysheds no está instalado. Ejecuta: pip install pysheds"
        )

    log.info("Calculando flow accumulation D8 con pysheds...")
    grid = PyshedsGrid.from_raster(str(elev_path))
    dem = grid.read_raster(str(elev_path))

    log.info("  Rellenando pozos...")
    pit_filled = grid.fill_pits(dem)
    log.info("  Rellenando depresiones...")
    flooded = grid.fill_depressions(pit_filled)
    log.info("  Resolviendo zonas planas...")
    inflated = grid.resolve_flats(flooded)
    log.info("  Calculando dirección de flujo D8...")
    fdir = grid.flowdir(inflated)
    log.info("  Acumulando...")
    acc = grid.accumulation(fdir)

    acc_arr = np.array(acc, dtype="float32")
    # Poner nodata en píxeles inválidos
    acc_arr[acc_arr <= 0] = nodata
    log.info("  Flow accumulation: max=%.0f, píxeles con acc>1000=%d",
             np.nanmax(acc_arr[acc_arr != nodata]),
             int((acc_arr > STREAM_THRESHOLD).sum()))
    return acc_arr


def compute_distance_to_stream(
    acc: np.ndarray,
    pixel_size_m: float,
    nodata: float,
    threshold: int = STREAM_THRESHOLD,
) -> np.ndarray:
    """
    Calcula la distancia euclidiana de cada píxel al cauce más cercano.

    Un píxel es cauce si su flow accumulation supera `threshold`.
    La distancia se expresa en metros (píxeles × tamaño de píxel).
    """
    valid = acc != nodata
    stream_mask = (acc > threshold) & valid
    log.info("  Cauces detectados (acc > %d): %d píxeles", threshold, int(stream_mask.sum()))

    # distance_transform_edt opera sobre la inversa (False = cauce)
    dist_px = distance_transform_edt(~stream_mask)
    dist_m = (dist_px * pixel_size_m).astype("float32")
    dist_m[~valid] = nodata
    return dist_m


# ---------------------------------------------------------------------------
# Mosaico de tiles
# ---------------------------------------------------------------------------

def _mosaic_tiles(tile_paths: List[Path]) -> Tuple[np.ndarray, dict]:
    """Une varios tiles rasterio en un único array + perfil."""
    datasets = [rasterio.open(p) for p in tile_paths]
    mosaic, transform = rio_merge(datasets)
    profile = datasets[0].profile.copy()
    profile.update(
        transform=transform,
        width=mosaic.shape[2],
        height=mosaic.shape[1],
    )
    for ds in datasets:
        ds.close()
    return mosaic[0], profile  # band 1


# ---------------------------------------------------------------------------
# Diagnósticos
# ---------------------------------------------------------------------------

def _plot_raster(
    data: np.ndarray,
    nodata: float,
    out_path: Path,
    title: str,
    cmap: str,
    log_scale: bool = False,
    label: str = "",
) -> None:
    """Genera un PNG de diagnóstico para un raster."""
    if not HAS_MPL:
        log.warning("matplotlib no disponible, omitiendo PNG: %s", out_path.name)
        return

    arr = data.astype(float)
    arr[arr == nodata] = np.nan
    if log_scale:
        arr = np.log1p(arr)

    fig, ax = plt.subplots(figsize=(10, 8))
    img = ax.imshow(arr, cmap=cmap, interpolation="nearest")
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                 label=("log1p(" + label + ")" if log_scale else label))
    ax.set_title(title, fontsize=13)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG guardado: %s", out_path)


def plot_all_diagnostics(
    elev: np.ndarray,
    slope: np.ndarray,
    acc: np.ndarray,
    dist: np.ndarray,
    nodata: float,
    diag_dir: Path,
) -> None:
    """Genera los 4 PNGs de diagnóstico del DEM."""
    diag_dir.mkdir(parents=True, exist_ok=True)
    _plot_raster(elev,  nodata, diag_dir / "elevation_map.png",
                 "Elevación (m)   —   EPSG:32630  10 m/px",
                 "terrain", label="Elevación (m)")
    _plot_raster(slope, nodata, diag_dir / "slope_map.png",
                 "Pendiente (°)   —   EPSG:32630  10 m/px",
                 "YlOrRd", label="Pendiente (°)")
    _plot_raster(acc,   nodata, diag_dir / "flow_accumulation_log.png",
                 "Flow accumulation D8  (escala log)   —   10 m/px",
                 "Blues", log_scale=True, label="celdas aguas arriba")
    _plot_raster(dist,  nodata, diag_dir / "distance_to_stream_map.png",
                 "Distancia a cauce (m)   —   10 m/px",
                 "RdYlGn_r", label="Distancia (m)")


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

def sanity_checks(
    elev: np.ndarray,
    slope: np.ndarray,
    acc: np.ndarray,
    dist: np.ndarray,
    nodata: float,
) -> None:
    """
    Comprueba que los valores de los 4 rasters sean físicamente plausibles
    para el área de estudio (Valencia - L'Horta Sud).
    """
    def stats(arr: np.ndarray, name: str) -> None:
        v = arr[arr != nodata]
        v = v[np.isfinite(v)]
        log.info(
            "%-25s  min=%8.1f  p25=%8.1f  p50=%8.1f  p75=%8.1f  max=%8.1f  px_validos=%d",
            name, v.min(), np.percentile(v, 25), np.median(v),
            np.percentile(v, 75), v.max(), len(v),
        )

    log.info("=" * 70)
    log.info("SANITY CHECKS  —  DEM features")
    log.info("=" * 70)
    stats(elev,  "elevation (m)")
    stats(slope, "slope (deg)")
    stats(acc,   "flow_acc (celdas)")
    stats(dist,  "dist_cauce (m)")

    # Umbrales esperados para la zona
    elev_v = elev[(elev != nodata) & np.isfinite(elev)]
    slope_v = slope[(slope != nodata) & np.isfinite(slope)]
    dist_v  = dist[(dist != nodata) & np.isfinite(dist)]

    if elev_v.min() > 10:
        log.warning("ALERTA: elevación mínima %.1f m — se esperaba cercana a 0 (costa)", elev_v.min())
    else:
        log.info("OK  elevación min=%.1f m (zona costera confirmada)", elev_v.min())

    if np.median(slope_v) > 5:
        log.warning("ALERTA: mediana pendiente %.2f° — L'Horta es llana, se esperaba <3°", np.median(slope_v))
    else:
        log.info("OK  mediana pendiente=%.2f° (zona llana confirmada)", np.median(slope_v))

    p50_dist = np.median(dist_v)
    if p50_dist > 2000:
        log.warning("ALERTA: mediana distancia cauces %.0f m — se esperaba <500 m", p50_dist)
    else:
        log.info("OK  mediana distancia cauces=%.0f m", p50_dist)
    log.info("=" * 70)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()

    parser = argparse.ArgumentParser(
        description="Descarga y preprocesa el DEM COP-DEM GLO-30 para el área de estudio."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Forzar regeneración aunque los ficheros de salida ya existan.",
    )
    args = parser.parse_args()

    # ------------------------------------------------------------------
    # 1. Configuración
    # ------------------------------------------------------------------
    root = _repo_root()
    params = _load_yaml(root / "config" / "params.yaml")
    paths  = _load_yaml(root / "config" / "paths.yaml")

    bbox_wgs84 = params["study_area"]["bbox"]  # [lon_min, lat_min, lon_max, lat_max]
    target_crs = CRS.from_epsg(params["study_area"]["epsg"])

    dem_root  = root / paths["data"]["dem"]
    raw_dir   = dem_root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    diag_dir  = root / "results" / "diagnostics" / "dem_features"
    diag_dir.mkdir(parents=True, exist_ok=True)

    # Salidas finales
    out_elev  = dem_root / "elevation.tif"
    out_slope = dem_root / "slope.tif"
    out_acc   = dem_root / "flow_accumulation.tif"
    out_dist  = dem_root / "distance_to_stream.tif"

    final_outputs = [out_elev, out_slope, out_acc, out_dist]
    if all(p.exists() for p in final_outputs) and not args.force:
        log.info("Todos los productos DEM ya existen. Usa --force para regenerar.")
        # Aun así ejecutar sanity checks
        _run_sanity_only(final_outputs, nodata=-9999.0)
        return

    # ------------------------------------------------------------------
    # 2. Cuadrícula canónica S1 (referencia para la alineación)
    # ------------------------------------------------------------------
    ref_path = root / paths["data"]["sentinel1"]["water_masks"] / "water_frequency.tif"
    if not ref_path.exists():
        log.error("No se encontró water_frequency.tif como referencia de grid S1: %s", ref_path)
        log.error("Ejecuta primero scripts/preprocessing/sar/water_detection.py")
        return

    with rasterio.open(ref_path) as ref_ds:
        ref_transform = ref_ds.transform
        ref_shape     = (ref_ds.height, ref_ds.width)
        pixel_size_m  = ref_ds.transform.a   # ancho del píxel en metros (=10)

    log.info("Grid canónico S1: shape=%s  pixel=%.0f m", ref_shape, pixel_size_m)

    # Bounds del estudio en EPSG:32630 (sacados de la misma referencia)
    with rasterio.open(ref_path) as ref_ds:
        bounds_utm = ref_ds.bounds

    # ------------------------------------------------------------------
    # 3. Descargar tiles COP-DEM
    # ------------------------------------------------------------------
    tiles = _cop_dem_tiles(bbox_wgs84)
    log.info("Tiles COP-DEM requeridos: %s", tiles)

    tile_paths: List[Path] = []
    failed: List[Tuple[int, int]] = []
    for lat, lon in tiles:
        url  = _cop_dem_url(lat, lon)
        dest = raw_dir / _tile_filename(lat, lon)
        ok   = _download_tile(url, dest)
        if ok:
            tile_paths.append(dest)
        else:
            failed.append((lat, lon))

    if failed:
        _manual_download_instructions(failed, raw_dir)
        # Intentar con los tiles que sí se descargaron
        if not tile_paths:
            log.error("No hay tiles disponibles. Abortando.")
            return

    # ------------------------------------------------------------------
    # 4. Mosaico (si hay más de un tile)
    # ------------------------------------------------------------------
    if len(tile_paths) == 1:
        mosaic_path = tile_paths[0]
    else:
        mosaic_path = raw_dir / "cop30_mosaic.tif"
        if not mosaic_path.exists() or args.force:
            log.info("Creando mosaico de %d tiles...", len(tile_paths))
            mosaic_arr, mosaic_profile = _mosaic_tiles(tile_paths)
            with rasterio.open(mosaic_path, "w", **mosaic_profile) as ds:
                ds.write(mosaic_arr, 1)
            log.info("Mosaico guardado: %s", mosaic_path)

    # ------------------------------------------------------------------
    # 5. Reproyectar a EPSG:32630 a resolución NATIVA del DEM (~30 m)
    #    para los cálculos de features (slope, flow acc, dist)
    # ------------------------------------------------------------------
    native_res_m = 30.0
    work_path = raw_dir / "cop30_work_utm.tif"
    if not work_path.exists() or args.force:
        log.info("Reproyectando DEM a EPSG:32630 @ %.0f m ...", native_res_m)
        # Bounds UTM ligeramente ampliados para el buffer de cálculo
        from pyproj import Transformer
        tr = Transformer.from_crs("EPSG:4326", target_crs, always_xy=True)
        lon_min, lat_min, lon_max, lat_max = bbox_wgs84
        buf = BUFFER_DEG * 111000  # grados → metros aproximado
        bounds_work = (
            bounds_utm.left   - buf,
            bounds_utm.bottom - buf,
            bounds_utm.right  + buf,
            bounds_utm.top    + buf,
        )
        _reproject_and_clip(mosaic_path, work_path, target_crs, bounds_work, native_res_m)
    else:
        log.info("DEM de trabajo ya existe: %s", work_path.name)

    # ------------------------------------------------------------------
    # 6. Features a resolución nativa (~30 m)
    # ------------------------------------------------------------------
    nodata_val = -9999.0

    # Leer elevación de trabajo
    with rasterio.open(work_path) as ds:
        elev_30 = ds.read(1).astype("float32")
        raw_nodata = ds.nodata
        work_profile = ds.profile.copy()
        work_pixel = ds.transform.a

    if raw_nodata is not None:
        elev_30[elev_30 == raw_nodata] = nodata_val
    elev_30[~np.isfinite(elev_30)] = nodata_val

    log.info("DEM de trabajo: shape=%s  nodata=%.0f  px=%.1f m",
             elev_30.shape, nodata_val, work_pixel)

    # 6a. Pendiente a 30 m
    log.info("Calculando pendiente (slope)...")
    slope_30 = compute_slope(elev_30, work_pixel, nodata_val)

    # 6b. Flow accumulation a 30 m
    log.info("Calculando flow accumulation D8 @ 30 m...")
    acc_path_30 = raw_dir / "cop30_flow_acc_30m.tif"
    if not acc_path_30.exists() or args.force:
        acc_30 = compute_flow_accumulation(work_path, nodata_val)
        _write_tif(acc_30, acc_path_30, work_profile, nodata_val, dtype="float32")
    else:
        log.info("Flow accumulation 30 m ya existe, cargando...")
        with rasterio.open(acc_path_30) as ds:
            acc_30 = ds.read(1).astype("float32")

    # 6c. Distancia a cauces a 30 m
    log.info("Calculando distancia a cauces @ 30 m...")
    dist_30 = compute_distance_to_stream(acc_30, work_pixel, nodata_val)

    # Guardar features intermedias a 30 m
    slope_path_30 = raw_dir / "cop30_slope_30m.tif"
    dist_path_30  = raw_dir / "cop30_dist_30m.tif"
    elev_path_30  = raw_dir / "cop30_elev_30m.tif"

    _write_tif(elev_30,  elev_path_30,  work_profile, nodata_val)
    _write_tif(slope_30, slope_path_30, work_profile, nodata_val)
    _write_tif(dist_30,  dist_path_30,  work_profile, nodata_val)

    # ------------------------------------------------------------------
    # 7. Remuestrar al grid canónico S1 @ 10 m
    # ------------------------------------------------------------------
    log.info("Remuestreando todos los productos al grid canónico S1 @ %.0f m...", pixel_size_m)

    _resample_to_canonical(elev_path_30,  out_elev,  ref_transform, ref_shape,
                           target_crs, Resampling.bilinear)
    _resample_to_canonical(slope_path_30, out_slope, ref_transform, ref_shape,
                           target_crs, Resampling.bilinear)
    _resample_to_canonical(acc_path_30,   out_acc,   ref_transform, ref_shape,
                           target_crs, Resampling.bilinear)
    _resample_to_canonical(dist_path_30,  out_dist,  ref_transform, ref_shape,
                           target_crs, Resampling.bilinear)

    # ------------------------------------------------------------------
    # 8. Cargar productos finales y diagnósticos
    # ------------------------------------------------------------------
    def _load(p: Path) -> np.ndarray:
        with rasterio.open(p) as ds:
            return ds.read(1).astype("float32")

    elev  = _load(out_elev)
    slope = _load(out_slope)
    acc   = _load(out_acc)
    dist  = _load(out_dist)

    log.info("Generando PNGs de diagnóstico...")
    plot_all_diagnostics(elev, slope, acc, dist, nodata_val, diag_dir)

    # ------------------------------------------------------------------
    # 9. Sanity checks
    # ------------------------------------------------------------------
    sanity_checks(elev, slope, acc, dist, nodata_val)

    # ------------------------------------------------------------------
    # 10. Reporte final
    # ------------------------------------------------------------------
    elapsed = time.time() - t0
    log.info("=" * 70)
    log.info("RESUMEN PREPARE_DEM")
    log.info("  Tiempo total: %.1f s", elapsed)
    log.info("  Grid de salida: shape=%s  pixel=%.0f m  CRS=EPSG:32630", ref_shape, pixel_size_m)
    for p in final_outputs:
        log.info("  %-35s  %.2f MB", p.name, p.stat().st_size / 1e6)
    for p in diag_dir.glob("*.png"):
        log.info("  Diagnóstico: %s", p.name)
    log.info("=" * 70)


def _run_sanity_only(paths: List[Path], nodata: float) -> None:
    """Ejecuta solo los sanity checks sobre productos ya generados."""
    def _load(p: Path) -> np.ndarray:
        with rasterio.open(p) as ds:
            return ds.read(1).astype("float32")
    elev, slope, acc, dist = [_load(p) for p in paths]
    sanity_checks(elev, slope, acc, dist, nodata)


if __name__ == "__main__":
    main()
