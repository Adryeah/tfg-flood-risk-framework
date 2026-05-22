#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_ndvi.py
---------------
Descarga una escena Sentinel-2 L2A pre-DANA con baja nubosidad para el bbox
de estudio, calcula el NDVI a partir de las bandas B04 (Red, 665 nm) y B08
(NIR, 842 nm) a 10 m, aplica máscara de nubes vía la banda SCL, reproyecta al
grid canónico S1 y guarda el producto como data/features/optical/ndvi_mean.tif.

Flujo:
  1. Consulta OData (Copernicus Data Space Ecosystem) para S2 L2A entre
     2024-05-01 y 2024-09-30 con cloudCover < 10 %.
  2. Elige la escena de menor nubosidad.
  3. Si el .SAFE ya existe (descarga manual) se salta la descarga.
  4. Lee B04, B08 (10 m) y SCL (20 m, remuestreado a 10 m).
  5. Aplica corrección BOA (offset -1000 y quantification 10000 para
     baseline ≥ 04.00).
  6. Calcula NDVI = (B08 − B04) / (B08 + B04).
  7. Enmascara píxeles con SCL ∈ {3, 8, 9, 10} (sombra, nube media, nube alta, cirrus).
  8. Reproyecta al grid canónico S1 (2850×2664, 10 m, EPSG:32630).
  9. Guarda NDVI, genera diagnósticos y ejecuta sanity checks.
 10. Elimina el .SAFE extraído para liberar ~1 GB de disco.

Uso:
    python scripts/preprocessing/optical/extract_ndvi.py [--keep-safe] [--no-download]

Alternativa manual:
    Si la descarga OAuth2 falla, descarga manualmente la escena S2 L2A desde
    https://browser.dataspace.copernicus.eu/, descomprímela en
    data/sentinel2/raw/ y lanza el script con --no-download.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import time
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional, Tuple

import numpy as np
import rasterio
import requests
import yaml
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject
from tqdm import tqdm

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
ODATA_BASE = "https://catalogue.dataspace.copernicus.eu/odata/v1"
TOKEN_URL  = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CHUNK_SIZE = 8 * 1024 * 1024
MAX_ATTEMPTS = 3
RETRY_BACKOFF = 5.0
TOKEN_SAFETY_MARGIN = 30

DATE_START = "2024-05-01"
DATE_END   = "2024-09-30"
MAX_CLOUD_COVER = 10.0

# SCL classes to mask (Scene Classification Layer, Sentinel-2 L2A)
#   3: Cloud shadow   8: Cloud medium prob.   9: Cloud high prob.   10: Thin cirrus
SCL_CLOUD_CLASSES = (3, 8, 9, 10)

# BOA correction — baseline ≥ 04.00 (todas las escenas de 2022 en adelante)
BOA_ADD_OFFSET_DEFAULT = -1000.0
QUANTIFICATION_VALUE_DEFAULT = 10000.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _long_path(p: Path) -> str:
    """Prefijo \\\\?\\ para rutas largas en Windows."""
    import os
    if os.name != "nt":
        return str(p)
    abs_path = str(p.resolve())
    if abs_path.startswith("\\\\?\\"):
        return abs_path
    if abs_path.startswith("\\\\"):
        return "\\\\?\\UNC\\" + abs_path[2:]
    return "\\\\?\\" + abs_path


# ---------------------------------------------------------------------------
# OAuth2
# ---------------------------------------------------------------------------

@dataclass
class TokenManager:
    username: str
    password: str
    access_token: str = ""
    expires_at: float = 0.0

    def _fetch(self) -> None:
        log.info("Solicitando token de Copernicus Data Space...")
        r = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "password",
                "client_id": "cdse-public",
                "username": self.username,
                "password": self.password,
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        self.access_token = data["access_token"]
        self.expires_at = time.time() + float(data.get("expires_in", 600))

    def get(self) -> str:
        if not self.access_token or time.time() >= self.expires_at - TOKEN_SAFETY_MARGIN:
            self._fetch()
        return self.access_token


# ---------------------------------------------------------------------------
# OData search
# ---------------------------------------------------------------------------

def _build_s2_filter(bbox: List[float]) -> str:
    lon_min, lat_min, lon_max, lat_max = bbox
    wkt = (
        f"POLYGON(({lon_min} {lat_min},{lon_max} {lat_min},"
        f"{lon_max} {lat_max},{lon_min} {lat_max},{lon_min} {lat_min}))"
    )
    filters = [
        "Collection/Name eq 'SENTINEL-2'",
        "Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' "
        "and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A')",
        "Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' "
        f"and att/OData.CSC.DoubleAttribute/Value lt {MAX_CLOUD_COVER:.1f})",
        f"ContentDate/Start ge {DATE_START}T00:00:00.000Z",
        f"ContentDate/Start le {DATE_END}T23:59:59.000Z",
        f"OData.CSC.Intersects(area=geography'SRID=4326;{wkt}')",
    ]
    return " and ".join(filters)


def _parse_product(item: dict) -> dict:
    attrs = {a["Name"]: a.get("Value", "") for a in item.get("Attributes", [])}
    size_mb = round(int(item.get("ContentLength", 0)) / (1024 * 1024), 1)
    pid = item.get("Id", "")
    title = item.get("Name", "")
    return {
        "id": pid,
        "title": title,
        "date": item.get("ContentDate", {}).get("Start", "")[:10],
        "cloud_cover": float(attrs.get("cloudCover", 100.0)),
        "size_mb": size_mb,
        "download_url": f"https://download.dataspace.copernicus.eu/odata/v1/Products({pid})/$value",
    }


def search_s2_scenes(bbox: List[float], token: str) -> List[dict]:
    """Consulta OData y devuelve todas las escenas S2 L2A que cumplen los filtros."""
    headers = {"Authorization": f"Bearer {token}"}
    odata_filter = _build_s2_filter(bbox)
    all_products: List[dict] = []
    skip = 0
    while True:
        r = requests.get(
            f"{ODATA_BASE}/Products",
            headers=headers,
            params={
                "$filter": odata_filter,
                "$orderby": "ContentDate/Start asc",
                "$top": 100,
                "$skip": skip,
                "$expand": "Attributes",
            },
            timeout=60,
        )
        r.raise_for_status()
        items = r.json().get("value", [])
        if not items:
            break
        for it in items:
            try:
                all_products.append(_parse_product(it))
            except (KeyError, ValueError) as exc:
                log.warning("Producto mal formado: %s", exc)
        if len(items) < 100:
            break
        skip += 100
    return all_products


# ---------------------------------------------------------------------------
# Download + extract
# ---------------------------------------------------------------------------

def _download_zip(url: str, token: str, dst: Path, expected_mb: float, title: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    with requests.get(url, headers=headers, stream=True, timeout=(30, 600)) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0)) or int(expected_mb * 1024 * 1024)
        dst.parent.mkdir(parents=True, exist_ok=True)
        with open(dst, "wb") as fh, tqdm(
            total=total, unit="B", unit_scale=True, unit_divisor=1024,
            desc=title[:40], leave=False,
        ) as pbar:
            for chunk in r.iter_content(chunk_size=CHUNK_SIZE):
                if chunk:
                    fh.write(chunk)
                    pbar.update(len(chunk))


def _extract_safe(zip_path: Path, raw_dir: Path) -> Path:
    """Extrae el zip y devuelve el path del .SAFE resultante."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        top_dirs = {n.split("/")[0] for n in zf.namelist() if "/" in n}
        zf.extractall(_long_path(raw_dir))
    # Suele haber un único .SAFE en la raíz del zip
    safe_candidates = [raw_dir / d for d in top_dirs if d.endswith(".SAFE")]
    if not safe_candidates:
        raise RuntimeError(f"Ningún .SAFE en el zip: {top_dirs}")
    return safe_candidates[0]


def download_scene(
    product: dict,
    raw_dir: Path,
    token_mgr: TokenManager,
) -> Path:
    """Descarga el producto y lo extrae. Devuelve path al .SAFE."""
    title = product["title"]
    safe_name = title if title.endswith(".SAFE") else title + ".SAFE"
    safe_path = raw_dir / safe_name
    zip_path  = raw_dir / (safe_name + ".zip")

    if safe_path.exists() and any(safe_path.iterdir()):
        log.info("SAFE ya existe, omitiendo descarga: %s", safe_name)
        return safe_path

    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            token = token_mgr.get()
            log.info("[%d/%d] Descargando %s (%.0f MB)...",
                     attempt, MAX_ATTEMPTS, safe_name, product["size_mb"])
            _download_zip(product["download_url"], token, zip_path,
                          product["size_mb"], title)
            break
        except requests.RequestException as exc:
            last_error = exc
            log.warning("Error descarga intento %d: %s", attempt, exc)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BACKOFF * attempt)
    else:
        raise RuntimeError(f"Descarga fallida tras {MAX_ATTEMPTS} intentos: {last_error}")

    log.info("Extrayendo %s...", zip_path.name)
    safe_extracted = _extract_safe(zip_path, raw_dir)
    zip_path.unlink(missing_ok=True)
    log.info("SAFE extraído en: %s", safe_extracted)
    return safe_extracted


# ---------------------------------------------------------------------------
# Parseo metadatos y bandas
# ---------------------------------------------------------------------------

def _find_band(safe: Path, band: str, resolution: str) -> Path:
    """Localiza una banda dentro del .SAFE."""
    patterns = [
        f"GRANULE/*/IMG_DATA/R{resolution}/*_{band}_{resolution}.jp2",
    ]
    for pat in patterns:
        matches = list(safe.glob(pat))
        if matches:
            return matches[0]
    raise FileNotFoundError(f"No se encontró {band} @ {resolution} en {safe}")


def _read_boa_params(safe: Path) -> Tuple[float, float]:
    """
    Lee BOA_ADD_OFFSET y QUANTIFICATION_VALUE de MTD_MSIL2A.xml si existe.
    Devuelve defaults para baseline ≥ 04.00 si falla el parseo.
    """
    xml_path = safe / "MTD_MSIL2A.xml"
    offset = BOA_ADD_OFFSET_DEFAULT
    quant  = QUANTIFICATION_VALUE_DEFAULT
    if not xml_path.exists():
        return offset, quant
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        # Los valores están en cualquier namespace - buscar por local-name
        for elem in root.iter():
            tag = elem.tag.split("}")[-1]
            if tag == "BOA_ADD_OFFSET":
                band_id = elem.get("band_id")
                # BOA_ADD_OFFSET se aplica idénticamente a todas las bandas
                if elem.text and band_id in ("0", "3", "7"):  # B01, B04, B08
                    offset = float(elem.text)
            elif tag == "BOA_QUANTIFICATION_VALUE":
                if elem.text:
                    quant = float(elem.text)
    except (ET.ParseError, ValueError) as exc:
        log.warning("No se pudo parsear MTD_MSIL2A.xml (%s). Usando defaults.", exc)
    return offset, quant


def _read_band_as_reflectance(path: Path, offset: float, quant: float) -> Tuple[np.ndarray, dict]:
    """Lee una banda .jp2 y la convierte a reflectancia BOA (float32)."""
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        profile = ds.profile.copy()
    # uint16 DN → reflectancia
    with np.errstate(invalid="ignore"):
        refl = (arr + offset) / quant
    # Valores 0 originales = nodata
    refl[arr == 0] = np.nan
    return refl.astype("float32"), profile


def _read_scl(path: Path) -> Tuple[np.ndarray, dict]:
    """Lee la banda SCL (uint8)."""
    with rasterio.open(path) as ds:
        arr = ds.read(1)
        profile = ds.profile.copy()
    return arr, profile


# ---------------------------------------------------------------------------
# NDVI + máscara + reproyección
# ---------------------------------------------------------------------------

def compute_ndvi(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """NDVI = (NIR − RED) / (NIR + RED), en [-1, 1]."""
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir - red) / (nir + red)
    ndvi = np.clip(ndvi, -1.0, 1.0)
    return ndvi.astype("float32")


def mask_clouds(ndvi: np.ndarray, scl: np.ndarray) -> np.ndarray:
    """Pone a NaN los píxeles cuya SCL indica nube o sombra."""
    mask = np.isin(scl, SCL_CLOUD_CLASSES)
    ndvi_masked = ndvi.copy()
    ndvi_masked[mask] = np.nan
    pct_masked = 100.0 * mask.mean()
    log.info("  Píxeles enmascarados por SCL (nubes/sombras): %.2f %%", pct_masked)
    return ndvi_masked


def _upsample_scl_to_10m(
    scl: np.ndarray,
    scl_profile: dict,
    ref_profile: dict,
) -> np.ndarray:
    """Remuestrea SCL de 20 m → 10 m por vecino más próximo en la misma cuadrícula que B04/B08."""
    dst = np.empty((ref_profile["height"], ref_profile["width"]), dtype="uint8")
    reproject(
        source=scl,
        destination=dst,
        src_transform=scl_profile["transform"],
        src_crs=scl_profile["crs"],
        dst_transform=ref_profile["transform"],
        dst_crs=ref_profile["crs"],
        resampling=Resampling.nearest,
    )
    return dst


def _reproject_to_canonical(
    ndvi: np.ndarray,
    src_profile: dict,
    canonical_transform,
    canonical_crs: CRS,
    canonical_shape: Tuple[int, int],
) -> np.ndarray:
    """Reproyecta NDVI al grid canónico S1 por interpolación bilineal."""
    rows, cols = canonical_shape
    dst = np.empty((rows, cols), dtype="float32")
    reproject(
        source=ndvi,
        destination=dst,
        src_transform=src_profile["transform"],
        src_crs=src_profile["crs"],
        dst_transform=canonical_transform,
        dst_crs=canonical_crs,
        resampling=Resampling.bilinear,
        src_nodata=np.nan,
        dst_nodata=np.nan,
    )
    return dst


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def _write_ndvi(
    ndvi: np.ndarray,
    out_path: Path,
    canonical_transform,
    canonical_crs: CRS,
) -> None:
    profile = {
        "driver":    "GTiff",
        "dtype":     "float32",
        "width":     ndvi.shape[1],
        "height":    ndvi.shape[0],
        "count":     1,
        "crs":       canonical_crs,
        "transform": canonical_transform,
        "nodata":    np.nan,
        "compress":  "lzw",
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(ndvi.astype("float32"), 1)
    log.info("NDVI guardado: %s (%.2f MB)", out_path, out_path.stat().st_size / 1e6)


# ---------------------------------------------------------------------------
# Diagnósticos
# ---------------------------------------------------------------------------

def plot_diagnostics(ndvi: np.ndarray, diag_dir: Path, title_suffix: str) -> None:
    if not HAS_MPL:
        return
    diag_dir.mkdir(parents=True, exist_ok=True)

    # --- mapa ---
    fig, ax = plt.subplots(figsize=(10, 8))
    img = ax.imshow(ndvi, cmap="RdYlGn", vmin=-0.2, vmax=0.9, interpolation="nearest")
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, label="NDVI")
    ax.set_title(f"NDVI  —  {title_suffix}", fontsize=13)
    ax.axis("off")
    plt.tight_layout()
    plt.savefig(diag_dir / "ndvi_map.png", dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: ndvi_map.png")

    # --- histograma ---
    valid = ndvi[np.isfinite(ndvi)]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.hist(valid, bins=100, color="#2ca25f", edgecolor="black", alpha=0.8)
    ax.axvline(0, color="k", linestyle="--", lw=0.8, label="NDVI = 0 (agua/suelo)")
    ax.axvline(0.3, color="#f4a261", linestyle="--", lw=0.8, label="NDVI = 0.3 (suelo/cultivo)")
    ax.axvline(0.6, color="#2a9d8f", linestyle="--", lw=0.8, label="NDVI = 0.6 (vegetación sana)")
    ax.set_xlabel("NDVI")
    ax.set_ylabel("Nº de píxeles")
    ax.set_title(f"Distribución NDVI  —  {title_suffix}")
    ax.legend(loc="upper left")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(diag_dir / "histogram_ndvi.png", dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: histogram_ndvi.png")


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

def sanity_checks(
    ndvi: np.ndarray,
    canonical_transform,
    canonical_crs: CRS,
) -> None:
    from pyproj import Transformer
    from rasterio.transform import rowcol

    log.info("=" * 70)
    log.info("SANITY CHECKS  —  NDVI")
    log.info("=" * 70)

    valid = ndvi[np.isfinite(ndvi)]
    if len(valid) == 0:
        log.warning("NDVI no tiene píxeles válidos")
        return

    log.info("  NDVI stats: min=%.3f  p10=%.3f  p50=%.3f  p90=%.3f  max=%.3f  NaN=%.1f%%",
             valid.min(), np.percentile(valid, 10), np.median(valid),
             np.percentile(valid, 90), valid.max(),
             100 * (1 - len(valid) / ndvi.size))

    if not (-1.01 <= valid.min() and valid.max() <= 1.01):
        log.warning("ALERTA: NDVI fuera de [-1, 1]")
    else:
        log.info("OK  NDVI en [-1, 1]")

    # Sanity por punto
    tr = Transformer.from_crs("EPSG:4326", canonical_crs, always_xy=True)
    pts = {
        "Albufera      (-0.335, 39.335)": (-0.335, 39.335),
        "Huerta        (-0.46,  39.40)":  (-0.460, 39.400),
        "Urbano        (-0.376, 39.475)": (-0.376, 39.475),
    }
    for name, (lon, lat) in pts.items():
        x, y = tr.transform(lon, lat)
        r, c = rowcol(canonical_transform, x, y)
        if 0 <= r < ndvi.shape[0] and 0 <= c < ndvi.shape[1]:
            val = float(ndvi[r, c])
            log.info("  %s  NDVI=%.3f", name, val)

    log.info("=" * 70)


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

def cleanup_safe(safe_path: Path) -> None:
    if not safe_path.exists():
        return
    size_mb = sum(p.stat().st_size for p in safe_path.rglob("*") if p.is_file()) / 1e6
    log.info("Borrando SAFE extraído (%.0f MB)...", size_mb)
    shutil.rmtree(_long_path(safe_path), ignore_errors=True)
    log.info("  Borrado: %s", safe_path.name)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()

    parser = argparse.ArgumentParser(
        description="Descarga S2 L2A, calcula NDVI y lo alinea con el grid canónico S1."
    )
    parser.add_argument("--keep-safe", action="store_true",
                        help="No borrar el .SAFE tras el procesado.")
    parser.add_argument("--no-download", action="store_true",
                        help="Saltar descarga: usar un .SAFE existente en data/sentinel2/raw/.")
    parser.add_argument("--force", action="store_true",
                        help="Regenerar NDVI aunque ya exista.")
    args = parser.parse_args()

    # --- Config ---
    root   = _repo_root()
    params = _load_yaml(root / "config" / "params.yaml")
    paths  = _load_yaml(root / "config" / "paths.yaml")

    bbox = params["study_area"]["bbox"]

    raw_dir   = root / paths["data"]["sentinel2"]["raw"]
    feat_dir  = root / "data" / "features" / "optical"
    diag_dir  = root / "results" / "diagnostics" / "optical_features"
    water_ref = root / paths["data"]["sentinel1"]["water_masks"] / "water_frequency.tif"
    raw_dir.mkdir(parents=True, exist_ok=True)
    feat_dir.mkdir(parents=True, exist_ok=True)

    out_ndvi = feat_dir / "ndvi_mean.tif"
    if out_ndvi.exists() and not args.force:
        log.info("ndvi_mean.tif ya existe. Usa --force para regenerar.")
        return

    # --- Grid canónico S1 ---
    with rasterio.open(water_ref) as ref:
        canonical_transform = ref.transform
        canonical_crs       = ref.crs
        canonical_shape     = (ref.height, ref.width)
    log.info("Grid canónico S1: shape=%s  pixel=%.0f m  CRS=%s",
             canonical_shape, canonical_transform.a, canonical_crs)

    # --- Localizar/Descargar SAFE ---
    safe_path: Optional[Path] = None
    product: Optional[dict] = None

    if args.no_download:
        safes = sorted(raw_dir.glob("S2*_MSIL2A_*.SAFE"))
        if not safes:
            log.error("No se encontraron .SAFE S2 L2A en %s", raw_dir)
            return
        safe_path = safes[0]
        log.info("Usando SAFE existente: %s", safe_path.name)
    else:
        # Credenciales OAuth2
        creds_path = root / "config" / "copernicus_credentials.yaml"
        if not creds_path.exists():
            log.error("Faltan credenciales Copernicus: %s", creds_path)
            return
        creds = _load_yaml(creds_path)
        token_mgr = TokenManager(username=creds["username"], password=creds["password"])

        log.info("Buscando escenas S2 L2A entre %s y %s con cloudCover < %.0f %% ...",
                 DATE_START, DATE_END, MAX_CLOUD_COVER)
        token = token_mgr.get()
        products = search_s2_scenes(bbox, token)
        if not products:
            log.error("No se encontraron escenas S2 L2A con los filtros. "
                      "Abortando.")
            return

        products.sort(key=lambda p: p["cloud_cover"])
        log.info("Escenas candidatas: %d. Mejores 5 por nubosidad:", len(products))
        for p in products[:5]:
            log.info("  %s  cloud=%.1f%%  size=%.0f MB",
                     p["date"], p["cloud_cover"], p["size_mb"])

        product = products[0]
        log.info("Escena seleccionada: %s  cloud=%.2f%%",
                 product["title"], product["cloud_cover"])
        safe_path = download_scene(product, raw_dir, token_mgr)

    # --- Localizar bandas ---
    log.info("Localizando bandas B04, B08 (10 m) y SCL (20 m)...")
    b04_path = _find_band(safe_path, "B04", "10m")
    b08_path = _find_band(safe_path, "B08", "10m")
    scl_path = _find_band(safe_path, "SCL", "20m")
    log.info("  B04: %s", b04_path.name)
    log.info("  B08: %s", b08_path.name)
    log.info("  SCL: %s", scl_path.name)

    # --- Parámetros BOA ---
    offset, quant = _read_boa_params(safe_path)
    log.info("Parámetros BOA: offset=%.0f  quantification=%.0f", offset, quant)

    # --- Lectura bandas ---
    log.info("Leyendo B04 (Red)...")
    red, red_profile = _read_band_as_reflectance(b04_path, offset, quant)
    log.info("Leyendo B08 (NIR)...")
    nir, nir_profile = _read_band_as_reflectance(b08_path, offset, quant)
    log.info("Leyendo SCL y remuestreando a 10 m...")
    scl, scl_profile = _read_scl(scl_path)
    scl_10m = _upsample_scl_to_10m(scl, scl_profile, red_profile)

    log.info("B04 shape=%s  B08 shape=%s  SCL_10m shape=%s",
             red.shape, nir.shape, scl_10m.shape)

    # --- NDVI + máscara nubes ---
    log.info("Calculando NDVI...")
    ndvi_src = compute_ndvi(red, nir)
    ndvi_masked = mask_clouds(ndvi_src, scl_10m)

    # --- Reproyectar al grid canónico ---
    log.info("Reproyectando NDVI al grid canónico S1...")
    ndvi_canonical = _reproject_to_canonical(
        ndvi_masked, red_profile, canonical_transform, canonical_crs, canonical_shape
    )

    # --- Guardar ---
    _write_ndvi(ndvi_canonical, out_ndvi, canonical_transform, canonical_crs)

    # --- Diagnósticos ---
    scene_date = (product["date"] if product else safe_path.name.split("_")[2][:8])
    scene_label = f"S2 L2A  {scene_date}" + (
        f"  cloud={product['cloud_cover']:.2f}%" if product else ""
    )
    plot_diagnostics(ndvi_canonical, diag_dir, scene_label)

    # --- Sanity checks ---
    sanity_checks(ndvi_canonical, canonical_transform, canonical_crs)

    # --- Cleanup ---
    if not args.keep_safe:
        cleanup_safe(safe_path)

    # --- Reporte ---
    elapsed = time.time() - t0
    log.info("=" * 70)
    log.info("RESUMEN EXTRACT_NDVI")
    if product:
        log.info("  Escena         : %s", product["title"])
        log.info("  Fecha          : %s", product["date"])
        log.info("  Nubosidad      : %.2f %%", product["cloud_cover"])
        log.info("  Tamaño descarga: %.0f MB", product["size_mb"])
    else:
        log.info("  SAFE usado     : %s", safe_path.name if safe_path else "-")
    log.info("  Tiempo total   : %.1f s", elapsed)
    log.info("  NDVI           : %s (%.2f MB)", out_ndvi, out_ndvi.stat().st_size / 1e6)
    for p in diag_dir.glob("*.png"):
        log.info("  Diagnóstico    : %s", p.name)
    log.info("=" * 70)


if __name__ == "__main__":
    main()
