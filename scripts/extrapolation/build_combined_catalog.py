"""
Construye el catalogo combinado de 26 escenas Sentinel-1 GRD IW
(24 baseline + 2 evento DANA) para la re-descarga necesaria en la
extrapolacion a Algemesi (Semana 4).

Pasos:
  1. Carga data/catalogo_escenas_filtrado.csv (24 baseline existentes).
  2. Consulta el catalogo OData de Copernicus Data Space para localizar
     las dos escenas evento (20241019 y 20241031, orbita ASCENDING 103,
     IW GRDH SDV) que cubren tanto Valencia como Algemesi.
  3. Concatena ambos dataframes y escribe data/catalogo_escenas_combinado.csv
     con las mismas columnas que el filtrado original.

Salida: data/catalogo_escenas_combinado.csv (26 filas).
"""
from __future__ import annotations

import csv
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[2]
ODATA_URL = (
    "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
)
DOWNLOAD_TEMPLATE = (
    "https://download.dataspace.copernicus.eu/odata/v1/Products(%s)/$value"
)

# Bbox combinado Valencia+Algemesi (intersect con la huella S1)
BBOX_INTERSECT_WKT = (
    "POLYGON((-0.698 39.007, -0.166 39.007, -0.166 39.555, "
    "-0.698 39.555, -0.698 39.007))"
)

EVENT_DATES = ("2024-10-19", "2024-10-31")


def query_event_scene(date_iso: str) -> dict | None:
    """Localiza la escena S1 GRDH IW SDV ASCENDING clasica (.SAFE) del dia dado.

    Filtra explicitamente derivados COG y CARD_BS para quedarnos con el GRDH
    de Level-1 estandar que esa_snappy puede leer con manifest.safe.
    """
    start_dt = datetime.fromisoformat(date_iso)
    end_dt = start_dt + timedelta(days=1)
    start = start_dt.strftime("%Y-%m-%dT00:00:00.000Z")
    end = end_dt.strftime("%Y-%m-%dT00:00:00.000Z")

    flt = (
        "Collection/Name eq 'SENTINEL-1' "
        "and contains(Name,'IW_GRDH') and contains(Name,'1SDV') "
        "and not contains(Name,'_COG') and not contains(Name,'CARD_BS') "
        f"and ContentDate/Start ge {start} "
        f"and ContentDate/Start lt {end} "
        f"and OData.CSC.Intersects(area=geography'SRID=4326;{BBOX_INTERSECT_WKT}') "
        "and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'orbitDirection' "
        "and att/OData.CSC.StringAttribute/Value eq 'ASCENDING')"
    )
    params = {
        "$filter": flt,
        "$orderby": "ContentDate/Start asc",
        "$top": "10",
    }
    logger.info("Consultando OData para %s ...", date_iso)
    resp = requests.get(ODATA_URL, params=params, timeout=60)
    resp.raise_for_status()
    items = resp.json().get("value", [])

    # Filtra a posteriori por si el filtro OData deja pasar variantes
    items = [
        it for it in items
        if "_COG" not in it["Name"] and "CARD_BS" not in it["Name"]
    ]

    # Preferir tamanos coherentes con GRDH normal (~1.6 GB, no CARD ~5 GB)
    items = [
        it for it in items
        if 1.0e9 < float(it["ContentLength"]) < 2.0e9
    ]
    if not items:
        logger.error("Sin resultados OData GRDH clasico para %s", date_iso)
        return None

    # Preferir ASCENDING orbit_number 103 (relativo). En la zona de Valencia
    # hay 1 unica escena ASCENDING/dia, asi que tomamos la primera por fecha.
    chosen = items[0]
    logger.info("  -> %s  (%.0f MB)", chosen["Name"], chosen["ContentLength"] / 1e6)
    return chosen


def to_catalog_row(item: dict) -> dict:
    """Transforma un item OData al esquema del catalogo filtrado."""
    name = item["Name"]
    title_no_safe = name[:-5] if name.endswith(".SAFE") else name
    date_iso = item["ContentDate"]["Start"][:10]
    size_mb = float(item["ContentLength"]) / (1024 * 1024)
    pid = item["Id"]
    return {
        "product_id": pid,
        "title": title_no_safe,
        "date": date_iso,
        "orbit_number": 103,           # ascending sobre Valencia
        "orbit_direction": "ASCENDING",
        "size_mb": round(size_mb, 1),
        "download_url": DOWNLOAD_TEMPLATE % pid,
    }


def main() -> int:
    src = REPO_ROOT / "data" / "catalogo_escenas_filtrado.csv"
    dst = REPO_ROOT / "data" / "catalogo_escenas_combinado.csv"

    if not src.exists():
        logger.error("No existe %s", src)
        return 1

    # Leer baseline
    rows: list[dict] = []
    with src.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames
        for r in reader:
            rows.append(r)
    logger.info("Baseline cargado: %d escenas", len(rows))

    # Localizar 2 escenas evento
    existing_dates = {r["date"] for r in rows}
    for date_iso in EVENT_DATES:
        if date_iso in existing_dates:
            logger.info("Escena %s ya esta en el catalogo, skip", date_iso)
            continue
        item = query_event_scene(date_iso)
        if item is None:
            logger.error("FATAL: no se pudo localizar la escena %s", date_iso)
            return 2
        rows.append(to_catalog_row(item))

    # Ordenar por fecha y guardar
    rows.sort(key=lambda r: r["date"])
    with dst.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    logger.info("=" * 60)
    logger.info("Catalogo combinado escrito: %s", dst)
    logger.info("Escenas totales: %d", len(rows))
    logger.info("Tamano estimado: %.1f GB",
                sum(float(r["size_mb"]) for r in rows) / 1024)
    logger.info("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
