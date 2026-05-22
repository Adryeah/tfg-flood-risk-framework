"""
Descarga la escena Sentinel-2 L2A pre-DANA mas limpia que cubre el tile
MGRS T30SYH (Ribera Alta/Baixa - Algemesi) entre 2024-05-01 y 2024-09-30,
calcula NDVI y lo alinea al grid canonico Algemesi.

Reutiliza la logica de extract_ndvi.py pero usando:
  - bbox = params.extrapolation_area.bbox (Algemesi)
  - canonical grid = data/extrapolation/dem/canonical_grid.tif
  - output = data/extrapolation/features/optical/ndvi_mean.tif

Filtra explicitamente por tile MGRS T30SYH para asegurar cobertura
completa del bbox Algemesi (T30SYJ tambien lo intersecta pero solo en
la franja norte).
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import rasterio
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preprocessing.optical.extract_ndvi import (
    TokenManager, search_s2_scenes, download_scene, _find_band,
    _read_boa_params, _read_band_as_reflectance, _read_scl,
    _upsample_scl_to_10m, compute_ndvi, mask_clouds,
    _reproject_to_canonical, _write_ndvi, plot_diagnostics, cleanup_safe,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
# Algemesi (lat 39.0-39.4) cae mayoritariamente en T30SYJ (mismo tile que Valencia).
# T30SYH cubre lat ~38.0-39.0 pero el bbox Algemesi solo tiene 0.007 deg en esa
# franja (lat_min=39.007). En la practica T30SYJ cubre >99% del bbox.
TARGET_MGRS_TILES = ("T30SYJ", "T30SYH")


def _load_yaml(p: Path) -> dict:
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def main() -> int:
    t0 = time.time()
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-safe", action="store_true")
    parser.add_argument("--no-download", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    params = _load_yaml(REPO_ROOT / "config" / "params.yaml")
    paths  = _load_yaml(REPO_ROOT / "config" / "paths.yaml")
    bbox = params["extrapolation_area"]["bbox"]
    log.info("Algemesi bbox: %s", bbox)

    # Salidas
    raw_dir  = REPO_ROOT / "data" / "extrapolation" / "sentinel2" / "raw"
    feat_dir = REPO_ROOT / "data" / "extrapolation" / "features" / "optical"
    diag_dir = REPO_ROOT / "results" / "diagnostics" / "optical_features_algemesi"
    raw_dir.mkdir(parents=True, exist_ok=True)
    feat_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    out_ndvi = feat_dir / "ndvi_mean.tif"
    if out_ndvi.exists() and not args.force:
        log.info("ndvi_mean.tif Algemesi ya existe. --force para regenerar.")
        return 0

    # Grid canonico Algemesi
    canon_path = REPO_ROOT / paths["data"]["extrapolation"]["dem"] / "canonical_grid.tif"
    if not canon_path.exists():
        log.error("Falta canonical_grid.tif: %s", canon_path)
        return 1
    with rasterio.open(canon_path) as ref:
        canon_transform = ref.transform
        canon_crs       = ref.crs
        canon_shape     = (ref.height, ref.width)
    log.info("Grid canonico Algemesi: %s  px=%.0f m  CRS=%s",
             canon_shape, canon_transform.a, canon_crs)

    # Localizar/descargar SAFE
    safe_path: Optional[Path] = None
    product: Optional[dict] = None

    if args.no_download:
        safes = sorted(raw_dir.glob("S2*_MSIL2A_*.SAFE"))
        if not safes:
            log.error("No se encontraron .SAFE S2 L2A en %s", raw_dir)
            return 1
        # Preferir T30SYJ/T30SYH si estan presentes (tiles que cubren Algemesi)
        for tile in TARGET_MGRS_TILES:
            for s in safes:
                if tile in s.name:
                    safe_path = s
                    break
            if safe_path is not None:
                break
        if safe_path is None:
            safe_path = safes[0]
            log.warning("Ningun SAFE en tiles preferidos; usando %s", safe_path.name)
    else:
        creds = _load_yaml(REPO_ROOT / "config" / "copernicus_credentials.yaml")
        token_mgr = TokenManager(username=creds["username"], password=creds["password"])
        token = token_mgr.get()
        log.info("Buscando S2 L2A para Algemesi (cloud<10%%, mayo-sep 2024)...")
        products = search_s2_scenes(bbox, token)
        if not products:
            log.error("Sin escenas S2 disponibles para el bbox Algemesi")
            return 2

        # Filtrar por tiles preferidos (T30SYJ primario, T30SYH secundario)
        products_filtered = [p for p in products
                             if any(t in p["title"] for t in TARGET_MGRS_TILES)]
        if products_filtered:
            log.info("Escenas en tiles preferidos %s: %d (de %d totales)",
                     TARGET_MGRS_TILES, len(products_filtered), len(products))
            products = products_filtered
        else:
            log.warning("Sin escenas en %s; uso bbox-cualquier-tile",
                        TARGET_MGRS_TILES)

        # Preferir T30SYJ sobre T30SYH (cubre mayor parte de Algemesi)
        products.sort(key=lambda p: (
            0 if "T30SYJ" in p["title"] else 1,
            p["cloud_cover"],
        ))
        log.info("Mejores 5 candidatas:")
        for p in products[:5]:
            log.info("  %s  cloud=%.2f%%  size=%.0f MB  %s",
                     p["date"], p["cloud_cover"], p["size_mb"], p["title"])

        product = products[0]
        log.info("Seleccionada: %s  cloud=%.2f%%",
                 product["title"], product["cloud_cover"])
        safe_path = download_scene(product, raw_dir, token_mgr)

    # Bandas
    log.info("Localizando B04, B08 (10 m) y SCL (20 m)...")
    b04 = _find_band(safe_path, "B04", "10m")
    b08 = _find_band(safe_path, "B08", "10m")
    scl = _find_band(safe_path, "SCL", "20m")
    log.info("  B04 %s  B08 %s  SCL %s", b04.name, b08.name, scl.name)

    offset, quant = _read_boa_params(safe_path)
    log.info("BOA offset=%.0f  quant=%.0f", offset, quant)

    log.info("Leyendo B04...")
    red, red_profile = _read_band_as_reflectance(b04, offset, quant)
    log.info("Leyendo B08...")
    nir, _ = _read_band_as_reflectance(b08, offset, quant)
    log.info("Leyendo SCL y remuestreando a 10 m...")
    scl_arr, scl_profile = _read_scl(scl)
    scl_10m = _upsample_scl_to_10m(scl_arr, scl_profile, red_profile)

    log.info("Calculando NDVI...")
    ndvi_src = compute_ndvi(red, nir)
    ndvi_masked = mask_clouds(ndvi_src, scl_10m)

    log.info("Reproyectando al grid canonico Algemesi...")
    ndvi_canon = _reproject_to_canonical(
        ndvi_masked, red_profile, canon_transform, canon_crs, canon_shape
    )

    _write_ndvi(ndvi_canon, out_ndvi, canon_transform, canon_crs)

    scene_date = (product["date"] if product else safe_path.name.split("_")[2][:8])
    plot_diagnostics(ndvi_canon, diag_dir,
                     f"Algemesi  S2 L2A  {scene_date}" +
                     (f"  cloud={product['cloud_cover']:.2f}%" if product else ""))

    if not args.keep_safe:
        cleanup_safe(safe_path)

    log.info("=" * 70)
    log.info("RESUMEN extract_algemesi_ndvi: %.1f min", (time.time() - t0) / 60)
    log.info("  NDVI: %s  %.2f MB", out_ndvi.name, out_ndvi.stat().st_size / 1e6)
    log.info("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
