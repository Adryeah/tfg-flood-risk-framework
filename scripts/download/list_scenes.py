"""
Consulta la API OData de Copernicus Data Space y genera un catálogo CSV con
todas las escenas Sentinel-1 GRD IW disponibles para el área y período base
definidos en config/params.yaml (2022-01-01 → 2024-09-30).

Salida: data/catalogo_escenas.csv
Columnas: product_id, title, date, orbit_number, orbit_direction, size_mb, download_url

Uso:
    python scripts/download/list_scenes.py [--config config/params.yaml]
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import yaml

# ---------------------------------------------------------------------------
# Constantes de la API
# ---------------------------------------------------------------------------
ODATA_BASE = "https://catalogue.dataspace.copernicus.eu/odata/v1"
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PAGE_SIZE = 100  # máximo permitido por la API
RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 2.0  # segundos entre reintentos

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Carga de configuración
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_config(repo_root: Path) -> tuple[dict, dict, dict]:
    """Devuelve (params, paths, credentials)."""
    params = _load_yaml(repo_root / "config" / "params.yaml")
    paths = _load_yaml(repo_root / "config" / "paths.yaml")
    creds_path = repo_root / "config" / "copernicus_credentials.yaml"
    if not creds_path.exists():
        raise FileNotFoundError(
            f"No se encontró {creds_path}. "
            "Crea el fichero con los campos 'username' y 'password'."
        )
    credentials = _load_yaml(creds_path)
    return params, paths, credentials


# ---------------------------------------------------------------------------
# Autenticación — token OAuth2
# ---------------------------------------------------------------------------

def get_access_token(username: str, password: str) -> str:
    """Obtiene un token de acceso OAuth2 de Copernicus Identity Service."""
    response = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "password",
            "client_id": "cdse-public",
            "username": username,
            "password": password,
        },
        timeout=30,
    )
    response.raise_for_status()
    token: str = response.json()["access_token"]
    logger.info("Token de acceso obtenido correctamente.")
    return token


# ---------------------------------------------------------------------------
# Construcción del filtro OData
# ---------------------------------------------------------------------------

def build_odata_filter(params: dict) -> str:
    """
    Construye el $filter OData para S1 GRD IW en el bbox y período base.
    La API acepta fechas en formato ISO-8601 con 'Z' de zona UTC.
    """
    sa = params["study_area"]
    lon_min, lat_min, lon_max, lat_max = sa["bbox"]
    dates = params["dates"]
    date_start = dates["baseline_start"]
    date_end = dates["baseline_end"]
    s1 = params["sentinel1"]
    product_type = s1["product_type"]   # GRD
    mode = s1["mode"]                   # IW
    orbit = s1["orbit"]                 # ASCENDING

    # Polígono del bbox en WKT (sentido horario requerido por OGC)
    wkt_polygon = (
        f"POLYGON(("
        f"{lon_min} {lat_min},"
        f"{lon_max} {lat_min},"
        f"{lon_max} {lat_max},"
        f"{lon_min} {lat_max},"
        f"{lon_min} {lat_min}"
        f"))"
    )

    filters = [
        "Collection/Name eq 'SENTINEL-1'",
        f"Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq '{product_type}')",
        f"Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'operationalMode' and att/OData.CSC.StringAttribute/Value eq '{mode}')",
        f"Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'orbitDirection' and att/OData.CSC.StringAttribute/Value eq '{orbit}')",
        f"ContentDate/Start ge {date_start}T00:00:00.000Z",
        f"ContentDate/Start le {date_end}T23:59:59.000Z",
        f"OData.CSC.Intersects(area=geography'SRID=4326;{wkt_polygon}')",
    ]
    return " and ".join(filters)


# ---------------------------------------------------------------------------
# Paginación y extracción de resultados
# ---------------------------------------------------------------------------

def _parse_product(item: dict[str, Any]) -> dict[str, Any]:
    """Extrae los campos de interés de un producto OData."""
    attrs: dict[str, str] = {
        a["Name"]: a.get("Value", "")
        for a in item.get("Attributes", [])
    }
    size_bytes = item.get("ContentLength", 0)
    size_mb = round(size_bytes / (1024 * 1024), 1) if size_bytes else None

    content_date = item.get("ContentDate", {})
    date_str = content_date.get("Start", "")[:10]  # 'YYYY-MM-DD'

    product_id: str = item.get("Id", "")
    title: str = item.get("Name", "")
    download_url = (
        f"https://download.dataspace.copernicus.eu/odata/v1/Products({product_id})/$value"
    )

    return {
        "product_id": product_id,
        "title": title,
        "date": date_str,
        "orbit_number": attrs.get("relativeOrbitNumber", attrs.get("orbitNumber", "")),
        "orbit_direction": attrs.get("orbitDirection", ""),
        "size_mb": size_mb,
        "download_url": download_url,
    }


def fetch_all_scenes(odata_filter: str, token: str) -> list[dict[str, Any]]:
    """
    Itera sobre todas las páginas de la API OData y devuelve la lista
    completa de productos que cumplen el filtro.
    """
    headers = {"Authorization": f"Bearer {token}"}
    skip = 0
    all_products: list[dict] = []

    while True:
        params_req = {
            "$filter": odata_filter,
            "$orderby": "ContentDate/Start asc",
            "$top": PAGE_SIZE,
            "$skip": skip,
            "$expand": "Attributes",
        }

        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                resp = requests.get(
                    f"{ODATA_BASE}/Products",
                    headers=headers,
                    params=params_req,
                    timeout=60,
                )
                resp.raise_for_status()
                break
            except requests.RequestException as exc:
                logger.warning("Intento %d/%d fallido: %s", attempt, RETRY_ATTEMPTS, exc)
                if attempt == RETRY_ATTEMPTS:
                    raise
                time.sleep(RETRY_BACKOFF * attempt)

        data = resp.json()
        items: list[dict] = data.get("value", [])
        if not items:
            break

        page_products = [_parse_product(item) for item in items]
        all_products.extend(page_products)
        logger.info("Página skip=%d → %d productos (total acumulado: %d)", skip, len(items), len(all_products))

        # La API no expone @odata.count fiable; salimos cuando la página viene incompleta
        if len(items) < PAGE_SIZE:
            break

        skip += PAGE_SIZE

    return all_products


# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Lista escenas S1 GRD disponibles en Copernicus Data Space y guarda catálogo CSV."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Raíz del repositorio (por defecto: dos niveles sobre este script).",
    )
    args = parser.parse_args()
    repo_root: Path = args.repo_root

    # Carga de configuración
    params, paths, credentials = load_config(repo_root)
    username: str = credentials["username"]
    password: str = credentials["password"]

    # Ruta de salida desde paths.yaml
    catalog_path = repo_root / paths["data"]["catalog"]
    catalog_path.parent.mkdir(parents=True, exist_ok=True)

    # Autenticación
    token = get_access_token(username, password)

    # Construcción del filtro
    odata_filter = build_odata_filter(params)
    logger.info("Filtro OData construido.")
    logger.debug("Filtro: %s", odata_filter)

    # Búsqueda paginada
    logger.info(
        "Buscando escenas S1 GRD IW ASCENDING entre %s y %s para bbox %s …",
        params["dates"]["baseline_start"],
        params["dates"]["baseline_end"],
        params["study_area"]["bbox"],
    )
    products = fetch_all_scenes(odata_filter, token)

    if not products:
        logger.warning("No se encontraron escenas con los filtros especificados.")
        return

    # Guardado del catálogo
    df = pd.DataFrame(products, columns=["product_id", "title", "date", "orbit_number", "orbit_direction", "size_mb", "download_url"])
    df.to_csv(catalog_path, index=False, encoding="utf-8")
    logger.info(
        "Catálogo guardado en %s — %d escenas encontradas.",
        catalog_path,
        len(df),
    )

    # Resumen rápido
    logger.info("Rango de fechas: %s → %s", df["date"].min(), df["date"].max())
    logger.info("Órbitas únicas: %s", sorted(df["orbit_number"].unique().tolist()))
    total_gb = df["size_mb"].sum() / 1024 if df["size_mb"].notna().any() else 0
    logger.info("Tamaño total estimado: %.1f GB", total_gb)


if __name__ == "__main__":
    main()
