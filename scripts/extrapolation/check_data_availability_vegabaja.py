#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_data_availability_vegabaja.py
-----------------------------------
Verifica qué datos del proyecto se pueden reutilizar para la extrapolación
geográfica del modelo v2 a la zona de Vega Baja del Segura, sin descargar
ni procesar nada todavía.

Comprobaciones:
  1. EMSR Copernicus EMS: ¿la activación EMSR773 cubre Vega Baja? Si no,
     listar candidatos a investigar manualmente.
  2. Sentinel-1: ¿las 26 escenas ya procesadas (24 baseline + 2 evento)
     cubren el bbox de Vega Baja? Si no, ¿cuántas escenas adicionales?
  3. DEM Copernicus GLO-30: qué tiles 1°×1° hacen falta y cuáles ya tenemos.
  4. Features SAR/DEM/NDVI: qué se puede recalcular del nuevo bbox sin
     reprocesar el pipeline desde cero.

Uso:
    python scripts/extrapolation/check_data_availability_vegabaja.py
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import List, Tuple

import geopandas as gpd
import rasterio
import yaml
from shapely.geometry import box

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _hr(c: str = "=") -> None:
    log.info(c * 78)


# ---------------------------------------------------------------------------
# 1. EMS coverage
# ---------------------------------------------------------------------------

def check_ems_coverage(
    repo: Path, bbox_vb_wgs: List[float], bbox_val_wgs: List[float],
) -> dict:
    _hr()
    log.info("1. COPERNICUS EMS  —  cobertura de Vega Baja")
    _hr()

    ems_dir = repo / "data" / "ems"
    aoi_path = ems_dir / "EMSR773_AOI01_DEL_PRODUCT_areaOfInterestA_v1.shp"
    if not aoi_path.exists():
        log.error("No existe %s", aoi_path)
        return {"emsr773_covers_vegabaja": False}

    aoi = gpd.read_file(aoi_path)
    aoi_geom = aoi.geometry.iloc[0]
    aoi_bounds = aoi_geom.bounds
    log.info("EMSR773 AOI01 (Valencia province):")
    log.info("  CRS:    %s", aoi.crs)
    log.info("  Bounds: lon=%.4f..%.4f  lat=%.4f..%.4f",
             aoi_bounds[0], aoi_bounds[2], aoi_bounds[1], aoi_bounds[3])
    log.info("  Locality: %s", aoi.iloc[0].get("locality", "?"))

    bbox_vb = box(*bbox_vb_wgs)
    bbox_val = box(*bbox_val_wgs)
    log.info("Bbox Vega Baja del Segura:")
    log.info("  Bounds: lon=%.4f..%.4f  lat=%.4f..%.4f",
             *[bbox_vb_wgs[i] for i in (0, 2, 1, 3)])
    log.info("Bbox Valencia (referencia, ya procesado):")
    log.info("  Bounds: lon=%.4f..%.4f  lat=%.4f..%.4f",
             *[bbox_val_wgs[i] for i in (0, 2, 1, 3)])

    inter_vb = aoi_geom.intersects(bbox_vb)
    inter_area_pct = (
        100.0 * aoi_geom.intersection(bbox_vb).area / bbox_vb.area
        if inter_vb else 0.0
    )
    log.info("¿EMSR773 AOI01 intersecta Vega Baja? %s  (%.1f%% del bbox VB cubierto)",
             inter_vb, inter_area_pct)

    if inter_area_pct < 50:
        log.warning("EMSR773 AOI01 NO cubre suficientemente Vega Baja.")
        log.info("Posibles vías a investigar manualmente:")
        log.info("  - https://emergency.copernicus.eu/mapping/list-of-activations-rapid")
        log.info("  - Buscar EMSR cercanos a EMSR773 (oct/nov 2024) en Murcia/Alicante:")
        log.info("    EMSR774, EMSR775, EMSR776, EMSR777 (consultar uno por uno)")
        log.info("  - EMSR773 puede tener AOI02/AOI03/... (no descargados localmente)")
        log.info("  - Revisar en cada activación si la 'locality' incluye:")
        log.info("    Vega Baja, Murcia, Almoradí, Orihuela, Dolores, Albatera, Catral.")

    return {
        "emsr773_aoi01_bounds":   list(aoi_bounds),
        "emsr773_covers_vegabaja": inter_vb,
        "intersection_pct_bbox_vb": inter_area_pct,
        "candidate_emsr_to_check": ["EMSR774", "EMSR775", "EMSR776", "EMSR777"],
    }


# ---------------------------------------------------------------------------
# 2. Sentinel-1 coverage
# ---------------------------------------------------------------------------

def check_s1_coverage(
    repo: Path, bbox_vb_wgs: List[float], target_crs_epsg: int,
) -> dict:
    _hr()
    log.info("2. SENTINEL-1  —  cobertura de Vega Baja")
    _hr()

    processed_dir = repo / "data" / "sentinel1" / "processed"
    tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*.tif")
                  if "event" not in p.parts)
    event_tifs = sorted((processed_dir / "event").glob("*.tif")) \
        if (processed_dir / "event").exists() else []

    log.info("Escenas baseline en data/sentinel1/processed/  : %d", len(tifs))
    log.info("Escenas evento en  data/sentinel1/processed/event/: %d", len(event_tifs))

    if not tifs:
        log.error("No se encontraron GeoTIFFs S1 procesados. Aborto.")
        return {"s1_covers_vegabaja": False}

    # Bounds reales de los GeoTIFFs procesados (ya en EPSG:32630, recortados al bbox Valencia)
    with rasterio.open(tifs[0]) as ds:
        s1_bounds_utm = ds.bounds
        s1_crs = ds.crs

    log.info("Bounds GeoTIFFs S1 procesados (recortados a bbox Valencia):")
    log.info("  CRS: %s", s1_crs)
    log.info("  UTM left=%.0f bottom=%.0f right=%.0f top=%.0f",
             s1_bounds_utm.left, s1_bounds_utm.bottom,
             s1_bounds_utm.right, s1_bounds_utm.top)

    # Bbox Vega Baja en UTM30N
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{target_crs_epsg}", always_xy=True)
    x_min, y_min = tr.transform(bbox_vb_wgs[0], bbox_vb_wgs[1])
    x_max, y_max = tr.transform(bbox_vb_wgs[2], bbox_vb_wgs[3])
    log.info("Bbox Vega Baja en EPSG:%d:", target_crs_epsg)
    log.info("  UTM left=%.0f bottom=%.0f right=%.0f top=%.0f",
             x_min, y_min, x_max, y_max)

    # Distancia entre los dos bbox
    dx = max(0, max(s1_bounds_utm.left, x_min) - min(s1_bounds_utm.right, x_max))
    dy = max(0, max(s1_bounds_utm.bottom, y_min) - min(s1_bounds_utm.top, y_max))
    s1_box = box(s1_bounds_utm.left, s1_bounds_utm.bottom,
                 s1_bounds_utm.right, s1_bounds_utm.top)
    vb_box = box(x_min, y_min, x_max, y_max)
    intersects = s1_box.intersects(vb_box)
    inter_pct = 100.0 * s1_box.intersection(vb_box).area / vb_box.area if intersects else 0.0
    log.info("¿GeoTIFFs S1 actuales intersectan Vega Baja? %s  (%.1f%% del bbox VB cubierto)",
             intersects, inter_pct)
    if not intersects:
        log.info("  Distancia entre bbox: dx=%.1f km, dy=%.1f km",
                 dx / 1000.0, dy / 1000.0)

    log.warning(
        "IMPORTANTE: los GeoTIFFs procesados estan SUBSET-EADOS al bbox Valencia. "
        "El swath S1 GRD IW original es ~250 km de ancho y muy probablemente "
        "cubria Vega Baja antes del recorte. Pero los .SAFE originales fueron "
        "borrados tras procesar (CLAUDE.md: politica de espacio en disco)."
    )
    log.info("Implicaciones:")
    log.info("  a) Re-descargar las 26 escenas (~39 GB baseline + ~10 GB evento)")
    log.info("     y re-procesar con bbox Vega Baja (~2-3 h batch).")
    log.info("  b) O alternativamente, re-descargar SOLO si confirmamos via OData")
    log.info("     que la huella S1 incluye Vega Baja (lo es para la mayoria con")
    log.info("     orbita 103 ASCENDING que ya usamos).")
    log.info("  c) Confirmar con consulta OData usando el catalogo ya generado.")

    catalog_filt = repo / "data" / "catalogo_escenas_filtrado.csv"
    if catalog_filt.exists():
        log.info("Catalogo filtrado disponible: %s (24 escenas + 2 evento descargables)",
                 catalog_filt)
    else:
        log.info("No se encuentra catalogo_escenas_filtrado.csv; reuso de list_scenes.py")

    return {
        "s1_processed_covers_vegabaja": intersects,
        "s1_processed_pct_vb":          inter_pct,
        "s1_bounds_utm":                [s1_bounds_utm.left, s1_bounds_utm.bottom,
                                         s1_bounds_utm.right, s1_bounds_utm.top],
        "vb_bounds_utm":                [x_min, y_min, x_max, y_max],
        "redownload_required":          not intersects,
        "n_scenes_to_redownload":       len(tifs) + len(event_tifs),
    }


# ---------------------------------------------------------------------------
# 3. DEM tiles
# ---------------------------------------------------------------------------

def check_dem_tiles(repo: Path, bbox_vb_wgs: List[float]) -> dict:
    _hr()
    log.info("3. DEM Copernicus GLO-30  —  tiles necesarios")
    _hr()

    raw_dir = repo / "data" / "dem" / "raw"
    have = sorted(p.name for p in raw_dir.glob("cop30_*.tif"))
    log.info("Tiles ya descargados en %s:", raw_dir)
    for h in have:
        log.info("  %s", h)

    # Tiles necesarios para Vega Baja con buffer
    BUFFER_DEG = 0.05
    lon_min, lat_min, lon_max, lat_max = bbox_vb_wgs
    lon_min -= BUFFER_DEG; lat_min -= BUFFER_DEG
    lon_max += BUFFER_DEG; lat_max += BUFFER_DEG
    lat_start = math.floor(lat_min); lat_end = math.floor(lat_max)
    lon_start = math.floor(lon_min); lon_end = math.floor(lon_max)
    needed = []
    for lat in range(lat_start, lat_end + 1):
        for lon in range(lon_start, lon_end + 1):
            lat_pfx = "N" if lat >= 0 else "S"
            lon_pfx = "E" if lon >= 0 else "W"
            tile_name = f"cop30_{lat_pfx}{abs(lat):02d}_{lon_pfx}{abs(lon):03d}.tif"
            needed.append(tile_name)

    log.info("Tiles requeridos para bbox Vega Baja (con buffer 0.05°):")
    missing = []
    for t in needed:
        present = t in have
        log.info("  %s  %s", t, "OK" if present else "FALTA")
        if not present:
            missing.append(t)

    log.info("Resumen: %d tile(s) necesarios, %d ya disponible(s), %d a descargar",
             len(needed), len(needed) - len(missing), len(missing))
    if missing:
        log.info("Las URLs de descarga (publicas, sin autenticacion):")
        for t in missing:
            # cop30_N38_W001.tif → Copernicus_DSM_COG_10_N38_00_W001_00_DEM
            parts = t.replace("cop30_", "").replace(".tif", "").split("_")
            lat_part, lon_part = parts[0], parts[1]
            url = (f"https://copernicus-dem-30m.s3.amazonaws.com/"
                   f"Copernicus_DSM_COG_10_{lat_part}_00_{lon_part}_00_DEM/"
                   f"Copernicus_DSM_COG_10_{lat_part}_00_{lon_part}_00_DEM.tif")
            log.info("  %s", url)

    return {
        "dem_tiles_needed":    needed,
        "dem_tiles_have":      have,
        "dem_tiles_missing":   missing,
    }


# ---------------------------------------------------------------------------
# 4. Reuse plan
# ---------------------------------------------------------------------------

def reuse_plan(s1_info: dict, dem_info: dict, ems_info: dict) -> None:
    _hr()
    log.info("4. PLAN DE REUTILIZACION")
    _hr()

    log.info("Que se REUTILIZA sin reprocesar:")
    log.info("  - Modelo v2 entrenado: models/random_forest_v2.joblib")
    log.info("    (las 14 features se aplican identicas en cualquier bbox)")
    log.info("  - Threshold elegido: 0.614 (criterio recall>=0.75)")
    log.info("  - Configuracion del pipeline: config/params.yaml + paths.yaml")
    log.info("    (basta con cambiar study_area.bbox -> extrapolation_area.bbox)")
    log.info("  - Scripts del pipeline: list/filter/download/process/water/features")
    log.info("    (todos parametrizados por bbox)")

    log.info("")
    log.info("Que hay que REGENERAR para Vega Baja:")
    log.info("  a) Tiles DEM faltantes: %s", dem_info["dem_tiles_missing"] or "ninguno")
    log.info("  b) Features DEM (elevation, slope, dist_stream, flow_acc):")
    log.info("     -> ejecutar prepare_dem.py con bbox extrapolation")
    log.info("     Tiempo estimado: ~30 s")
    log.info("  c) Features hidrogeomorfologicas (distance_to_coast, TWI, HAND):")
    log.info("     -> ejecutar extract_advanced_features.py con nuevo bbox")
    log.info("     Tiempo estimado: ~30 s")
    log.info("  d) Features SAR temporales sobre nuevo bbox:")
    if s1_info["redownload_required"]:
        log.info("     -> Re-descargar 26 escenas + reprocesar (sin recortar):")
        log.info("        list_scenes.py -> filter_scenes.py -> download_scenes.py")
        log.info("        -> process_single_scene.py (sin --bbox o con bbox que abarque ambos)")
        log.info("     -> Tiempo estimado: 4 h descarga + 1.5 h batch SAR + 30 min features")
        log.info("        TOTAL: ~6 h")
    else:
        log.info("     -> reutilizar GeoTIFFs S1 existentes (cubren Vega Baja)")
        log.info("        + ejecutar extract_sar_features.py con nuevo bbox")
        log.info("        Tiempo estimado: ~5 min")
    log.info("  e) NDVI baseline Sentinel-2:")
    log.info("     La escena S2 del 23 jul 2024 (T30SYJ) cubre Valencia y CASI")
    log.info("     toda la franja peninsular este. Verificar si tile T30SYJ se")
    log.info("     extiende a Vega Baja, o si necesitamos otra (T30SXG, T30SXH).")
    log.info("     -> ejecutar extract_ndvi.py con nuevo bbox")
    log.info("     Tiempo estimado: 5 min si reutilizable, 5 min descarga + 1 min")
    log.info("        si necesita escena nueva")
    log.info("  f) Ground truth EMS:")
    if ems_info.get("emsr773_covers_vegabaja", False):
        log.info("     -> reutilizar EMSR773 con clipping municipal nuevo")
    else:
        log.info("     -> investigar y descargar EMSR adicional (Murcia/Alicante DANA)")
        log.info("     -> aplicar clipping municipal para municipios Vega Baja")
        log.info("        (Almoradi, Dolores, Catral, Albatera, Orihuela, Rojales, etc.)")

    log.info("")
    log.info("Que NO se REGENERA:")
    log.info("  - Modelo Random Forest v2 (mismo modelo, aplicado al nuevo dataset)")
    log.info("  - Threshold")
    log.info("  - Configuracion algoritmica")

    log.info("")
    log.info("ESCENARIOS DE TIEMPO TOTAL:")
    if s1_info["redownload_required"]:
        log.info("  Escenario A (S1 redescarga + EMS disponible):     ~6.5 h")
        log.info("  Escenario B (S1 redescarga + investigar EMS):     ~7.5 h")
    else:
        log.info("  Escenario A (S1 reutilizado + EMS disponible):    ~30 min")
        log.info("  Escenario B (S1 reutilizado + investigar EMS):    ~1 h")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    repo = _repo_root()
    params = _load_yaml(repo / "config" / "params.yaml")

    bbox_vb  = params["extrapolation_area"]["bbox"]
    bbox_val = params["study_area"]["bbox"]
    target_crs = int(params["extrapolation_area"]["epsg"])

    log.info("Verificacion de datos para extrapolacion a Vega Baja del Segura")
    log.info("Bbox Vega Baja:          %s", bbox_vb)
    log.info("Bbox Valencia (ref):     %s", bbox_val)
    log.info("CRS objetivo:            EPSG:%d", target_crs)

    ems_info = check_ems_coverage(repo, bbox_vb, bbox_val)
    s1_info  = check_s1_coverage(repo, bbox_vb, target_crs)
    dem_info = check_dem_tiles(repo, bbox_vb)
    reuse_plan(s1_info, dem_info, ems_info)

    _hr()
    log.info("VERIFICACION COMPLETADA — no se ha descargado ni procesado nada.")
    _hr()


if __name__ == "__main__":
    main()
