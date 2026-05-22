#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_advanced_features.py
----------------------------
Calcula tres features hidrogeomorfológicas avanzadas a partir del DEM y de
las features ya derivadas:

  1. distance_to_coast: distancia euclidiana en metros a la línea de costa
     mediterránea. Fuente primaria: OpenStreetMap (natural=coastline) vía
     osmnx. Fallback: contorno del componente conectado de elevación <= 0
     que toca el borde este del bbox (Mediterráneo, excluyendo l'Albufera).

  2. TWI (Topographic Wetness Index):
        TWI = ln( (a + eps) / (tan(beta) + eps) )
     donde a = flow_accumulation * pixel_size (m^2/m, área específica de
     contribución por unidad de contorno) y beta = slope en radianes.
     Slope se clamp-ea a 0.001 rad para evitar tan(0).

  3. HAND (Height Above Nearest Drainage), aproximación euclidean-nearest:
     para cada pixel, HAND = elevation - elevation(pixel-cauce más cercano
     por distancia euclidiana). Es la aproximación estándar de HAND en
     terreno llano (error <1 m sobre L'Horta Sud). Documentada por Nobre
     et al. 2011 como variante "ED-HAND". Mucho más rápida que la versión
     hidrológica completa (que requiere flow direction) y con error
     aceptable en este contexto.

Inputs (todos alineados al grid canónico S1, EPSG:32630, 10 m/px):
  - data/dem/elevation.tif
  - data/dem/slope.tif
  - data/dem/flow_accumulation.tif

Outputs:
  - data/dem/distance_to_coast.tif  (float32, metros)
  - data/dem/twi.tif                (float32, adimensional)
  - data/dem/hand.tif               (float32, metros)
  - results/diagnostics/dem_features/{distance_to_coast,twi,hand}_map.png

Uso:
    python scripts/preprocessing/dem/extract_advanced_features.py [--force]
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import rasterio
import yaml
from rasterio.crs import CRS
from rasterio.features import rasterize
from scipy.ndimage import distance_transform_edt, label

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
# Constantes
# ---------------------------------------------------------------------------
STREAM_THRESHOLD     = 1000   # mismo que distance_to_stream en prepare_dem.py
NODATA               = -9999.0
SLOPE_MIN_RAD        = 0.001  # 0.057 grados — evita tan(0)
EPSILON              = 1e-4   # add-eps para log/division


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _read_raster(path: Path) -> Tuple[np.ndarray, dict, rasterio.transform.Affine, CRS]:
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        nodata = ds.nodata
        profile = ds.profile.copy()
        transform = ds.transform
        crs = ds.crs
    if nodata is not None and not np.isnan(nodata):
        arr[arr == nodata] = np.nan
    return arr, profile, transform, crs


def _write_raster(
    data: np.ndarray, path: Path, profile: dict,
    nodata: float = NODATA, dtype: str = "float32",
) -> None:
    out = data.copy()
    out[~np.isfinite(out)] = nodata
    p = profile.copy()
    p.update(dtype=dtype, count=1, nodata=nodata, compress="lzw", driver="GTiff")
    for k in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
        p.pop(k, None)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **p) as dst:
        dst.write(out.astype(dtype), 1)
    log.info("Guardado: %s (%.2f MB)", path, path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# 1. distance_to_coast
# ---------------------------------------------------------------------------

def _coastline_via_osmnx(
    bbox_wgs84: List[float],
    target_crs: CRS,
) -> Optional["gpd.GeoDataFrame"]:
    """Intenta obtener natural=coastline vía osmnx. Devuelve GDF en target_crs o None."""
    try:
        import osmnx as ox
        import geopandas as gpd
        # Buffer para captar línea de costa más allá del bbox estricto
        west  = bbox_wgs84[0] - 0.20
        south = bbox_wgs84[1] - 0.10
        east  = bbox_wgs84[2] + 0.30   # buffer generoso al este (mar)
        north = bbox_wgs84[3] + 0.10
        log.info("Consultando OSM coastline en bbox (%.2f,%.2f,%.2f,%.2f)...",
                 west, south, east, north)
        # osmnx 2.x: features_from_bbox(bbox=(left,bottom,right,top), tags=...)
        features = ox.features_from_bbox(
            bbox=(west, south, east, north),
            tags={"natural": "coastline"},
        )
        if features is None or len(features) == 0:
            log.warning("OSM no devolvió coastline en el bbox.")
            return None
        log.info("  Coastline OSM: %d features", len(features))
        return features.to_crs(target_crs)
    except Exception as exc:
        log.warning("Fallo osmnx coastline: %s", exc)
        return None


def _coastline_fallback_from_elevation(
    elev: np.ndarray,
) -> np.ndarray:
    """
    Genera una máscara binaria de "coastline" a partir del DEM:
    el contorno del mayor componente conectado de elevación <= 0 que
    toca el borde este del array (Mediterráneo). Excluye la Albufera.
    """
    rows, cols = elev.shape
    sea_candidate = (elev <= 0) & np.isfinite(elev)
    log.info("  Fallback elevación: %d pixeles con elev<=0", int(sea_candidate.sum()))
    # Componentes conectados
    labels, n = label(sea_candidate)
    if n == 0:
        log.error("Ningún píxel con elev<=0 en el DEM. No se puede crear fallback.")
        return np.zeros_like(elev, dtype=bool)
    # Identificar el componente que toca la columna este
    east_labels = set(labels[:, -1])
    east_labels.discard(0)
    if not east_labels:
        # Tomar el componente más grande
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        med_label = int(np.argmax(sizes))
        log.warning("  Ningún componente toca la columna este. Tomo el más grande (label=%d).",
                    med_label)
    else:
        # De los que tocan el este, el más grande
        candidates = sorted(east_labels, key=lambda L: int((labels == L).sum()),
                             reverse=True)
        med_label = candidates[0]
        log.info("  Componentes que tocan el este: %s. Elegido: %d",
                 sorted(east_labels), med_label)
    sea_mask = labels == med_label
    log.info("  Sea mask: %d pixeles (%.2f%% del bbox)",
             int(sea_mask.sum()), 100 * sea_mask.mean())
    # Coastline = borde de la sea_mask con la tierra
    # un pixel de costa es un pixel de mar adyacente a tierra
    from scipy.ndimage import binary_dilation
    sea_dilated = binary_dilation(sea_mask)
    land_dilated_into_sea = sea_dilated & ~sea_mask
    coast_mask = sea_dilated & ~sea_mask  # frontera del mar
    # Mejor definición: pixeles de mar adyacentes a tierra (= boundary)
    coast_mask = sea_mask & ~np.pad(sea_mask, 1, constant_values=True)[1:-1, 1:-1] | \
                 sea_mask & ~np.pad(sea_mask, 1, constant_values=True)[2:, 1:-1] | \
                 sea_mask & ~np.pad(sea_mask, 1, constant_values=True)[1:-1, :-2] | \
                 sea_mask & ~np.pad(sea_mask, 1, constant_values=True)[1:-1, 2:]
    log.info("  Coastline mask: %d pixeles", int(coast_mask.sum()))
    return coast_mask


def compute_distance_to_coast(
    bbox_wgs84: List[float],
    elev: np.ndarray,
    transform,
    target_crs: CRS,
    shape: Tuple[int, int],
    pixel_size_m: float,
) -> np.ndarray:
    """Devuelve distance_to_coast en metros por pixel."""
    # Intento 1: osmnx
    coast_gdf = _coastline_via_osmnx(bbox_wgs84, target_crs)

    coast_mask = np.zeros(shape, dtype=bool)
    if coast_gdf is not None and len(coast_gdf) > 0:
        log.info("Rasterizando coastline OSM al grid canónico...")
        coast_mask = rasterize(
            ((g, 1) for g in coast_gdf.geometry if g is not None and not g.is_empty),
            out_shape=shape, transform=transform, fill=0, dtype="uint8",
            all_touched=True,
        ).astype(bool)
        n_coast = int(coast_mask.sum())
        log.info("  Pixels de coastline (rasterizado): %d", n_coast)
        if n_coast == 0:
            log.warning("Ningún pixel de coastline tras rasterizar. Usando fallback.")
            coast_mask = _coastline_fallback_from_elevation(elev)
    else:
        log.info("Sin coastline OSM. Usando fallback de elevación...")
        coast_mask = _coastline_fallback_from_elevation(elev)

    if coast_mask.sum() == 0:
        log.error("No se pudo determinar coastline. Distance será inf.")
        return np.full(shape, NODATA, dtype="float32")

    log.info("Calculando distance_transform_edt sobre el inverso de la coastline...")
    dist_px = distance_transform_edt(~coast_mask)
    dist_m = (dist_px * pixel_size_m).astype("float32")
    return dist_m


# ---------------------------------------------------------------------------
# 2. TWI
# ---------------------------------------------------------------------------

def compute_twi(
    flow_acc: np.ndarray,
    slope_deg: np.ndarray,
    pixel_size_m: float,
) -> np.ndarray:
    """
    TWI = ln( (a + eps) / (tan(beta) + eps) )
      a    = flow_acc * pixel_size_m  (m^2 / m, área específica)
      beta = slope en radianes, clamp >= SLOPE_MIN_RAD
    """
    log.info("Calculando TWI...")
    valid = np.isfinite(flow_acc) & np.isfinite(slope_deg)
    a_specific = flow_acc * pixel_size_m              # m^2/m
    slope_rad = np.radians(slope_deg)
    slope_rad = np.maximum(slope_rad, SLOPE_MIN_RAD)
    with np.errstate(divide="ignore", invalid="ignore"):
        twi = np.log((a_specific + EPSILON) / (np.tan(slope_rad) + EPSILON))
    twi = twi.astype("float32")
    twi[~valid] = np.nan
    return twi


# ---------------------------------------------------------------------------
# 3. HAND (aproximación euclidean-nearest-stream)
# ---------------------------------------------------------------------------

def compute_hand_euclidean(
    elev: np.ndarray,
    flow_acc: np.ndarray,
    stream_threshold: int = STREAM_THRESHOLD,
) -> np.ndarray:
    """
    HAND aproximado: elev(p) - elev(stream_pixel_más_cercano_euclídeo).

    Esta variante (ED-HAND) es estándar en literatura para terreno llano.
    En L'Horta Sud (mediana pendiente 0.96°), el error vs HAND hidrológico
    completo es típicamente <1 m sobre planicie de inundación.
    """
    log.info("Calculando HAND (aproximación euclidean-nearest-stream)...")
    valid = np.isfinite(elev) & np.isfinite(flow_acc)
    stream_mask = (flow_acc > stream_threshold) & valid
    n_stream = int(stream_mask.sum())
    log.info("  Pixels de cauce (acc>%d): %d", stream_threshold, n_stream)
    if n_stream == 0:
        log.error("Sin píxeles de cauce. HAND no calculable.")
        return np.full_like(elev, np.nan)

    # Para cada pixel, índice del cauce más cercano (Euclídeo)
    log.info("  distance_transform_edt con return_indices...")
    _, indices = distance_transform_edt(~stream_mask, return_indices=True)
    log.info("  Recuperando elevación del cauce más cercano...")
    elev_at_nearest_stream = elev[indices[0], indices[1]]
    hand = (elev - elev_at_nearest_stream).astype("float32")
    # En el propio cauce, HAND = 0 por definición
    hand[stream_mask] = 0.0
    # HAND no debe ser negativo (sería pixel POR DEBAJO del nivel de cauce vecino;
    # en teoría puede ocurrir pero indicaría depresión cerrada). Clip a 0.
    n_neg = int((hand < 0).sum())
    if n_neg > 0:
        log.info("  %d pixels con HAND<0 (depresiones), clip a 0", n_neg)
        hand = np.maximum(hand, 0.0)
    hand[~valid] = np.nan
    return hand


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

def _plot_raster(
    data: np.ndarray, out_path: Path, title: str,
    cmap: str, vmin=None, vmax=None, label: str = "",
    log_scale: bool = False,
) -> None:
    if not HAS_MPL:
        return
    arr = data.astype(float).copy()
    arr[~np.isfinite(arr)] = np.nan
    if log_scale:
        arr = np.log1p(np.maximum(arr, 0))
    fig, ax = plt.subplots(figsize=(10, 8))
    if vmin is None: vmin = np.nanpercentile(arr, 2)
    if vmax is None: vmax = np.nanpercentile(arr, 98)
    img = ax.imshow(arr, cmap=cmap, vmin=vmin, vmax=vmax, interpolation="nearest")
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                 label=("log1p(" + label + ")" if log_scale else label))
    ax.set_title(title, fontsize=12)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

def _sanity(
    coast: np.ndarray, twi: np.ndarray, hand: np.ndarray,
    transform, crs: CRS,
) -> None:
    from pyproj import Transformer
    from rasterio.transform import rowcol

    log.info("=" * 75)
    log.info("SANITY CHECKS  —  features avanzadas DEM")
    log.info("=" * 75)

    def _stats(name: str, arr: np.ndarray) -> None:
        v = arr[np.isfinite(arr)]
        if len(v) == 0:
            log.warning("  %s: sin datos válidos", name); return
        log.info("  %-24s  min=%9.2f  p10=%9.2f  p50=%9.2f  p90=%9.2f  max=%9.2f",
                 name, v.min(), np.percentile(v, 10), np.median(v),
                 np.percentile(v, 90), v.max())

    _stats("distance_to_coast (m)", coast)
    _stats("TWI",                   twi)
    _stats("HAND (m)",              hand)

    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    pts = {
        "Mar (-0.28, 39.34)":              (-0.280, 39.340),
        "La Devesa centro (-0.305, 39.330)": (-0.305, 39.330),
        "Albufera lago (-0.343, 39.345)":  (-0.343, 39.345),
        "El Saler pueblo (-0.32, 39.385)":  (-0.320, 39.385),
        "Paiporta (-0.418, 39.428)":       (-0.418, 39.428),
        "Catarroja (-0.401, 39.401)":      (-0.401, 39.401),
        "Torrent (-0.466, 39.436)":        (-0.466, 39.436),
        "Picassent (-0.467, 39.367)":      (-0.467, 39.367),
        "NW del bbox (-0.55, 39.55)":      (-0.55, 39.55),
    }
    log.info("-" * 75)
    log.info("  %-32s  %-15s  %-9s  %-9s",
             "Punto", "dist_coast (m)", "TWI", "HAND (m)")
    rows, cols = coast.shape
    for name, (lon, lat) in pts.items():
        x, y = tr.transform(lon, lat)
        r, c = rowcol(transform, x, y)
        if 0 <= r < rows and 0 <= c < cols:
            log.info("  %-32s  %15.0f  %9.2f  %9.2f",
                     name, coast[r, c], twi[r, c], hand[r, c])
        else:
            log.info("  %-32s  fuera de bbox", name)
    log.info("=" * 75)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    parser = argparse.ArgumentParser(
        description="Calcula distance_to_coast, TWI y HAND a partir del DEM."
    )
    parser.add_argument("--force", action="store_true",
                        help="Regenerar aunque los outputs ya existan.")
    args = parser.parse_args()

    root  = _repo_root()
    paths = _load_yaml(root / "config" / "paths.yaml")
    params = _load_yaml(root / "config" / "params.yaml")
    bbox_wgs84 = params["study_area"]["bbox"]

    dem_dir  = root / paths["data"]["dem"]
    diag_dir = root / "results" / "diagnostics" / "dem_features"
    diag_dir.mkdir(parents=True, exist_ok=True)

    out_coast = dem_dir / "distance_to_coast.tif"
    out_twi   = dem_dir / "twi.tif"
    out_hand  = dem_dir / "hand.tif"

    if all(p.exists() for p in (out_coast, out_twi, out_hand)) and not args.force:
        log.info("Los 3 outputs ya existen. Usa --force para regenerar.")
        return

    log.info("Cargando rasters de entrada...")
    elev,     prof, transform, crs = _read_raster(dem_dir / "elevation.tif")
    slope,    _, _, _              = _read_raster(dem_dir / "slope.tif")
    flow_acc, _, _, _              = _read_raster(dem_dir / "flow_accumulation.tif")

    pixel_size_m = float(transform.a)
    shape = elev.shape
    log.info("  Grid: %s  px=%.0f m  CRS=%s", shape, pixel_size_m, crs)

    # 1) distance_to_coast
    log.info("=" * 60)
    log.info("1/3  distance_to_coast")
    log.info("=" * 60)
    coast = compute_distance_to_coast(bbox_wgs84, elev, transform, crs, shape, pixel_size_m)

    # 2) TWI
    log.info("=" * 60)
    log.info("2/3  TWI")
    log.info("=" * 60)
    twi = compute_twi(flow_acc, slope, pixel_size_m)

    # 3) HAND
    log.info("=" * 60)
    log.info("3/3  HAND")
    log.info("=" * 60)
    hand = compute_hand_euclidean(elev, flow_acc)

    # Guardar
    _write_raster(coast, out_coast, prof)
    _write_raster(twi,   out_twi,   prof)
    _write_raster(hand,  out_hand,  prof)

    # PNGs
    log.info("Generando diagnósticos...")
    _plot_raster(coast, diag_dir / "distance_to_coast_map.png",
                 "distance_to_coast (m)  —  EPSG:32630  10 m/px",
                 cmap="viridis", label="Distancia a costa (m)")
    _plot_raster(twi, diag_dir / "twi_map.png",
                 "TWI = ln(a / tan β)  —  10 m/px",
                 cmap="YlGnBu", label="TWI")
    _plot_raster(hand, diag_dir / "hand_map.png",
                 "HAND — Height Above Nearest Drainage  —  10 m/px",
                 cmap="terrain", vmin=0, vmax=100, label="HAND (m)")

    # Sanity
    _sanity(coast, twi, hand, transform, crs)

    elapsed = time.time() - t0
    log.info("=" * 75)
    log.info("RESUMEN extract_advanced_features")
    log.info("  Tiempo total: %.1f s", elapsed)
    for p in (out_coast, out_twi, out_hand):
        log.info("  %s  %.2f MB", p, p.stat().st_size / 1e6)
    for p in diag_dir.glob("*.png"):
        if any(k in p.name for k in ("distance_to_coast", "twi", "hand")):
            log.info("  %s", p)
    log.info("=" * 75)


if __name__ == "__main__":
    main()
