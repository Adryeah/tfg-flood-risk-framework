#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_data_availability_algemesi.py
-----------------------------------
Verifica los datos disponibles para extrapolar el modelo v2 a la zona de
Algemesi (Ribera Alta del Jucar) durante el mismo evento DANA octubre 2024.

Comprobaciones (sin descargar S1/S2 grandes):
  1. Activacion EMSR773: ¿hay AOI especifico para Ribera Alta / Algemesi?
     Intenta descargar AOI02-AOI06 vector packages para identificarlo.
  2. Limites municipales OSM de Algemesi y municipios afectados cercanos
     para definir un bbox candidato con buffer.
  3. Cobertura DEM Copernicus GLO-30: el tile N39W001 ya descargado para
     Valencia, ¿cubre el bbox Algemesi?
  4. Cobertura Sentinel-2 NDVI: ¿la escena T30SYJ del 23 jul 2024 cubre
     Algemesi o hace falta otra?
  5. Sentinel-1: confirmar que la huella S1 GRD IW (orbita 103) que ya
     usamos cubre Algemesi (probable, swath 250 km, pero los GeoTIFFs
     locales estan recortados al bbox Valencia).

Uso:
    python scripts/extrapolation/check_data_availability_algemesi.py
"""

from __future__ import annotations

import logging
import math
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import geopandas as gpd
import rasterio
import yaml
from shapely.geometry import box
from shapely.ops import unary_union

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# Municipios DANA del Real Decreto-ley 6/2024 que caen en la zona Algemesi/Ribera
ALGEMESI_MUNICIPALITIES = [
    "Algemesí",
    "Alzira",
    "Carcaixent",
    "Sueca",
    "Cullera",
    "Albalat de la Ribera",
    "Polinyà del Xúquer",
    "Riola",
    "Fortaleny",
    "Corbera",
    "Llaurí",
    "Favara",
]

EMSR773_AOI_PATTERNS = [
    # Patrones de URL probados del portal Copernicus EMS rapid mapping
    "https://emergency.copernicus.eu/mapping/download/EMSR773_AOI{aoi:02d}_DEL_PRODUCT_v1_vector.zip",
    "https://emergency.copernicus.eu/mapping/system/files/components/EMSR773_AOI{aoi:02d}_DEL_PRODUCT_v1_vector.zip",
]
BUFFER_DEG = 0.05


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _hr(c: str = "=") -> None:
    log.info(c * 78)


# ---------------------------------------------------------------------------
# 1. Intento de descarga de AOIs adicionales de EMSR773
# ---------------------------------------------------------------------------

def try_download_emsr773_aoi(aoi_num: int, dest_dir: Path) -> Optional[Path]:
    """Intenta descargar el paquete vector de un AOI dado. Devuelve path o None."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname = f"EMSR773_AOI{aoi_num:02d}_DEL_PRODUCT_v1_vector.zip"
    out = dest_dir / fname
    if out.exists() and out.stat().st_size > 1000:
        log.info("  cacheado: %s (%.1f KB)", out.name, out.stat().st_size / 1024)
        return out
    for url_pattern in EMSR773_AOI_PATTERNS:
        url = url_pattern.format(aoi=aoi_num)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            # Heuristica: zip valido empieza por "PK\x03\x04"
            if len(data) > 1000 and data[:2] == b"PK":
                with open(out, "wb") as fh:
                    fh.write(data)
                log.info("  descargado: %s desde %s", out.name, url)
                return out
        except Exception as exc:
            log.debug("  fallo %s: %s", url, exc)
    return None


def inspect_aoi_zip(zip_path: Path) -> Optional[dict]:
    """Extrae el .shp del areaOfInterest de un ZIP y lee su geometria."""
    import zipfile
    import tempfile
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if "areaOfInterestA" in n]
        if not names:
            return None
        with tempfile.TemporaryDirectory() as td:
            zf.extractall(td)
            # Reabrimos
            tdp = Path(td)
            shps = list(tdp.glob("*areaOfInterestA*.shp"))
            if not shps:
                return None
            g = gpd.read_file(shps[0])
            row = g.iloc[0]
            return {
                "locality": row.get("locality", "?"),
                "bounds_wgs": list(g.geometry.iloc[0].bounds),
                "n_polygons": len(g),
            }


def check_emsr773_aois(dest_dir: Path) -> Dict[int, dict]:
    _hr()
    log.info("1. EMSR773  —  buscar AOI para Algemesi (Ribera Alta)")
    _hr()
    found: Dict[int, dict] = {}
    for aoi in range(1, 8):
        log.info("Probando AOI%02d...", aoi)
        zip_path = try_download_emsr773_aoi(aoi, dest_dir)
        if zip_path is None:
            log.info("  no disponible (URL no responde o no es ZIP).")
            continue
        info = inspect_aoi_zip(zip_path)
        if info is None:
            log.info("  ZIP descargado pero sin areaOfInterestA dentro.")
            continue
        b = info["bounds_wgs"]
        log.info("  locality=%r  bounds=lon[%.3f..%.3f] lat[%.3f..%.3f]",
                 info["locality"], b[0], b[2], b[1], b[3])
        found[aoi] = info
    if not found:
        log.warning("Ningun AOI descargable automaticamente.")
        log.info("Acceso manual: https://rapidmapping.emergency.copernicus.eu/EMSR773")
        log.info("Buscar AOI de localidad 'Ribera Alta' / 'Alzira' / 'Algemesi'")
        log.info("y descargar el paquete vector zip a data/ems/algemesi/")
    return found


# ---------------------------------------------------------------------------
# 2. Bbox candidato basado en municipios OSM
# ---------------------------------------------------------------------------

def fetch_municipal_bbox(repo: Path) -> Tuple[List[float], gpd.GeoDataFrame]:
    """Descarga limites municipales de Algemesi y vecinos para definir el bbox."""
    _hr()
    log.info("2. Bbox candidato a partir de municipios DANA (OSM)")
    _hr()
    cache = repo / "data" / "auxiliary" / "municipios" / "algemesi_zone_municipalities.geojson"
    if cache.exists():
        log.info("Usando cache: %s", cache)
        gdf = gpd.read_file(cache)
    else:
        import osmnx as ox
        rows = []
        for name in ALGEMESI_MUNICIPALITIES:
            q = f"{name}, Valencia, Spain"
            try:
                log.info("  geocode: %s", q)
                g = ox.geocode_to_gdf(q)
                if not g.empty:
                    r = g.iloc[0]
                    rows.append({"name": name, "geometry": r.geometry,
                                 "osm_name": r.get("display_name", "")})
            except Exception as exc:
                log.warning("    fallo: %s", exc)
        if not rows:
            raise RuntimeError("Ningun municipio descargable")
        gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
        cache.parent.mkdir(parents=True, exist_ok=True)
        gdf.to_file(cache, driver="GeoJSON")
        log.info("Cacheado: %s", cache)

    # Bbox combinado de los municipios + buffer
    union = unary_union(gdf.geometry.tolist())
    bb = union.bounds  # lon_min, lat_min, lon_max, lat_max
    bbox = [bb[0] - BUFFER_DEG, bb[1] - BUFFER_DEG,
            bb[2] + BUFFER_DEG, bb[3] + BUFFER_DEG]
    log.info("Bbox combinado de %d municipios:", len(gdf))
    log.info("  Sin buffer: lon[%.3f..%.3f] lat[%.3f..%.3f]", bb[0], bb[2], bb[1], bb[3])
    log.info("  Con buffer %.2f deg: lon[%.3f..%.3f] lat[%.3f..%.3f]",
             BUFFER_DEG, bbox[0], bbox[2], bbox[1], bbox[3])
    log.info("  Tamaño aproximado: %.1f km Este-Oeste x %.1f km Norte-Sur",
             (bbox[2] - bbox[0]) * 90, (bbox[3] - bbox[1]) * 111)
    log.info("Municipios encontrados:")
    for _, r in gdf.iterrows():
        log.info("  %-22s  %s", r["name"], r.get("osm_name", "")[:80])
    return bbox, gdf


# ---------------------------------------------------------------------------
# 3. Cobertura DEM
# ---------------------------------------------------------------------------

def check_dem_coverage(repo: Path, bbox: List[float]) -> dict:
    _hr()
    log.info("3. DEM Copernicus GLO-30  —  cobertura del bbox Algemesi")
    _hr()
    raw = repo / "data" / "dem" / "raw"
    have = sorted(p.name for p in raw.glob("cop30_N*_W*.tif"))
    log.info("Tiles ya descargados:")
    for h in have:
        log.info("  %s", h)

    lon_min, lat_min, lon_max, lat_max = bbox
    lat_start = math.floor(lat_min); lat_end = math.floor(lat_max)
    lon_start = math.floor(lon_min); lon_end = math.floor(lon_max)
    needed = []
    for lat in range(lat_start, lat_end + 1):
        for lon in range(lon_start, lon_end + 1):
            lat_pfx = "N" if lat >= 0 else "S"
            lon_pfx = "E" if lon >= 0 else "W"
            needed.append(f"cop30_{lat_pfx}{abs(lat):02d}_{lon_pfx}{abs(lon):03d}.tif")
    missing = [n for n in needed if n not in have]
    log.info("Tiles requeridos para Algemesi: %s", needed)
    log.info("Tiles que faltan:               %s",
             missing if missing else "ninguno (cobertura completa)")
    return {"needed": needed, "have": have, "missing": missing}


# ---------------------------------------------------------------------------
# 4. Cobertura S2 (MGRS tile)
# ---------------------------------------------------------------------------

def mgrs_tile_for_lonlat(lon: float, lat: float) -> str:
    """Devuelve la etiqueta MGRS del tile S2 (~100x100 km) que contiene (lon, lat).

    Aproximacion: zona UTM = floor((lon + 180) / 6) + 1, banda = letra latitud.
    Para los detalles exactos del 100km grid letter usamos el shapefile MGRS de
    referencia si esta disponible; aqui devolvemos solo zona+banda+pareja.
    """
    zone = int((lon + 180) / 6) + 1
    bands = "CDEFGHJKLMNPQRSTUVWX"
    band_idx = int((lat + 80) / 8)
    band = bands[band_idx] if 0 <= band_idx < len(bands) else "?"
    return f"T{zone:02d}{band}??  (zona {zone}, banda {band})"


def check_s2_coverage(repo: Path, bbox: List[float]) -> dict:
    _hr()
    log.info("4. Sentinel-2  —  cobertura NDVI baseline")
    _hr()
    log.info("Escena S2 ya descargada para Valencia: T30SYJ (23 jul 2024)")
    log.info("Cobertura aproximada T30SYJ: lat 39.45..40.40 (norte de Valencia)")

    # Centroide del bbox Algemesi
    cx = (bbox[0] + bbox[2]) / 2
    cy = (bbox[1] + bbox[3]) / 2
    log.info("Centroide bbox Algemesi: lon=%.3f lat=%.3f", cx, cy)
    log.info("Tile MGRS aproximado para Algemesi: %s",
             mgrs_tile_for_lonlat(cx, cy))
    log.info("Como Algemesi cae en lat ~%.2f y T30SYJ empieza en lat ~39.45,",
             cy)
    log.info("es MUY probable que la escena Valencia NO cubra Algemesi (esta")
    log.info("al sur). Tiles candidatos: T30SYH (mas al sur), T30SYG.")
    log.info("ACCION: descargar nueva escena S2 L2A para julio 2024 (1 GB).")
    return {"need_new_s2_scene": True, "candidate_tiles": ["T30SYH", "T30SYG"]}


# ---------------------------------------------------------------------------
# 5. Cobertura S1 (estado actual y necesidad de redescarga)
# ---------------------------------------------------------------------------

def check_s1_coverage(repo: Path, bbox: List[float], target_crs_epsg: int) -> dict:
    _hr()
    log.info("5. Sentinel-1  —  cobertura del bbox Algemesi")
    _hr()
    proc = repo / "data" / "sentinel1" / "processed"
    tifs = sorted(p for p in proc.glob("S1_sigma0_*.tif") if "event" not in p.parts)
    if not tifs:
        log.error("No hay GeoTIFFs S1 procesados.")
        return {"covers": False}

    with rasterio.open(tifs[0]) as ds:
        s1_b = ds.bounds
    log.info("Bounds S1 actuales (recortados a bbox Valencia, EPSG:32630):")
    log.info("  UTM left=%.0f bottom=%.0f right=%.0f top=%.0f",
             s1_b.left, s1_b.bottom, s1_b.right, s1_b.top)

    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{target_crs_epsg}", always_xy=True)
    x_min, y_min = tr.transform(bbox[0], bbox[1])
    x_max, y_max = tr.transform(bbox[2], bbox[3])
    log.info("Bbox Algemesi en EPSG:%d:", target_crs_epsg)
    log.info("  UTM left=%.0f bottom=%.0f right=%.0f top=%.0f",
             x_min, y_min, x_max, y_max)

    s1_box = box(s1_b.left, s1_b.bottom, s1_b.right, s1_b.top)
    al_box = box(x_min, y_min, x_max, y_max)
    inter = s1_box.intersects(al_box)
    inter_pct = (100.0 * s1_box.intersection(al_box).area / al_box.area) if inter else 0.0
    log.info("¿GeoTIFFs S1 actuales cubren Algemesi? %s  (%.1f%% del bbox AL cubierto)",
             inter, inter_pct)
    log.info("Distancia entre bbox: dy=%.1f km al sur",
             max(0, s1_b.bottom - y_max) / 1000.0)

    log.warning("Como en el caso Vega Baja: los .SAFE originales fueron borrados")
    log.warning("tras procesar (politica de espacio CLAUDE.md). Para Algemesi hay")
    log.warning("que RE-DESCARGAR las 26 escenas con bbox combinado Valencia+Algemesi.")
    log.info("Tamaño total a descargar: ~49 GB (39 baseline + 10 evento aprox)")
    log.info("Tiempo estimado:")
    log.info("  - Descarga         : ~3-4 h")
    log.info("  - Procesado batch  : ~1.5 h (DEM cacheado, bbox combinado)")
    log.info("  - Features SAR     : ~10 min")
    return {
        "covers":       inter,
        "covers_pct":   inter_pct,
        "redownload":   not inter,
        "n_scenes":     len(tifs) + 2,
    }


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

def print_plan(bbox: List[float], dem_info: dict, s2_info: dict, s1_info: dict,
                ems_aois: Dict[int, dict]) -> None:
    _hr()
    log.info("PLAN DE TRABAJO ESTIMADO")
    _hr()

    log.info("Bbox propuesto Algemesi (con buffer %.2f deg):", BUFFER_DEG)
    log.info("  lon[%.3f..%.3f]  lat[%.3f..%.3f]", bbox[0], bbox[2], bbox[1], bbox[3])
    log.info("Para añadir a config/params.yaml bajo extrapolation_area_algemesi:")
    log.info("  extrapolation_area_algemesi:")
    log.info("    name: \"Algemesi - Ribera Alta del Jucar\"")
    log.info("    bbox: [%.3f, %.3f, %.3f, %.3f]",
             bbox[0], bbox[1], bbox[2], bbox[3])
    log.info("    epsg: 32630")
    log.info("")

    log.info("PASO 0 — EMS Algemesi:")
    if ems_aois:
        log.info("  AOIs descargados automaticamente: %s",
                 list(ems_aois.keys()))
    else:
        log.info("  ! Ningun AOI adicional descargable. ACCION MANUAL:")
        log.info("    1. Abrir https://rapidmapping.emergency.copernicus.eu/EMSR773")
        log.info("    2. Identificar AOI de Ribera Alta / Algemesi / Alzira")
        log.info("    3. Descargar paquete 'Vector data ZIP'")
        log.info("    4. Extraer en data/ems/algemesi/")
        log.info("  Tiempo estimado: 5-10 min manual")
    log.info("")

    log.info("PASO 1 — Re-descarga + reproc S1 (bbox combinado Valencia+Algemesi):")
    if s1_info.get("redownload", True):
        log.info("  - Re-descargar 26 escenas (~49 GB):    3-4 h")
        log.info("  - Reprocesar pipeline 5 pasos:         1.5 h")
        log.info("  - Total:                                4.5-5.5 h")
        log.info("  Nota: el bbox combinado Valencia+Algemesi cabe en una sola")
        log.info("  llamada al pipeline; los GeoTIFFs resultantes contendran")
        log.info("  ambas zonas y serviran para los dos analisis.")
    else:
        log.info("  - GeoTIFFs ya cubren Algemesi (caso improbable). Solo re-feature.")
    log.info("")

    log.info("PASO 2 — Features para bbox Algemesi:")
    if dem_info["missing"]:
        log.info("  - Descargar tiles DEM faltantes: %s   (~%d MB)",
                 dem_info["missing"], 37 * len(dem_info["missing"]))
    else:
        log.info("  - DEM: tile N39W001 ya cubre Algemesi  (sin descarga DEM extra)")
    log.info("  - prepare_dem.py + extract_advanced_features.py:  ~30 s")
    log.info("  - extract_sar_features.py (sobre nuevo bbox):      ~5 min")
    if s2_info["need_new_s2_scene"]:
        log.info("  - Descargar nueva escena S2 (T30SYH):              5 min + 1 min proc")
    log.info("")

    log.info("PASO 3 — Build dataset Algemesi + clipping municipal: ~10 s")
    log.info("PASO 4 — Aplicar models/random_forest_v2.joblib:       ~30 s")
    log.info("PASO 5 — Validacion + buffer metrics + PNGs:           ~5 min")
    log.info("")

    total_h = 4.5 + 0.5 if s1_info.get("redownload", True) else 0.5
    log.info("TIEMPO TOTAL ESTIMADO: %.1f horas (dominado por re-descarga S1)",
             total_h)
    log.info("ESPACIO ADICIONAL EN DISCO:")
    log.info("  - 26 .SAFE temporales: ~49 GB (se borran tras procesar)")
    log.info("  - 26 GeoTIFFs nuevos (bbox combinado mayor): ~120-150 MB")
    log.info("  - 1 escena S2: ~1 GB temporal (se borra tras NDVI)")
    log.info("  - Tiles DEM extra: %d MB", 37 * len(dem_info["missing"]))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    repo = _repo_root()
    params = _load_yaml(repo / "config" / "params.yaml")

    target_crs = int(params["study_area"]["epsg"])

    ems_dir = repo / "data" / "ems" / "algemesi"
    ems_aois = check_emsr773_aois(ems_dir)

    bbox, gdf = fetch_municipal_bbox(repo)

    dem_info = check_dem_coverage(repo, bbox)
    s2_info  = check_s2_coverage(repo, bbox)
    s1_info  = check_s1_coverage(repo, bbox, target_crs)

    print_plan(bbox, dem_info, s2_info, s1_info, ems_aois)

    _hr()
    log.info("VERIFICACION COMPLETADA — no se ha procesado ni descargado")
    log.info("nada de S1/S2 grandes (solo limites OSM y posibles AOI EMSR773 pequeños).")
    _hr()


if __name__ == "__main__":
    main()
