"""
Procesa una unica escena Sentinel-1 GRD con el pipeline SAR de 5 pasos
usando esa_snappy.

IMPORTANTE: esta pensado para ser llamado desde batch_process.py via
subprocess.run(). No llamar en bucle desde el mismo proceso Python: el
esa_snappy tiene fugas de memoria conocidas y .dispose() no libera RAM.

Pipeline (orden estricto, ver CLAUDE.md):
  1. Apply-Orbit-File        (efemerides precisas)
  2. ThermalNoiseRemoval     (sustrae LUT de ruido termico)
  3. Calibration             (Sigma0, lineal)
  4. Speckle-Filter          (Lee 7x7)
  5. Terrain-Correction      (SRTM 3Sec, WGS84 DD, 10 m)

Salida: data/sentinel1/processed/S1_sigma0_{YYYYMMDD}_orb{NNN}.tif
con bandas Sigma0_VV y Sigma0_VH.

Uso:
    python scripts/preprocessing/sar/process_single_scene.py <ruta.SAFE>
    python scripts/preprocessing/sar/process_single_scene.py <ruta.SAFE> --keep-safe
"""

# ---------------------------------------------------------------------------
# Configuracion JVM: DEBE ir antes de importar esa_snappy
# ---------------------------------------------------------------------------
import os
os.environ.setdefault("_JAVA_OPTIONS", "-Xmx12G")

import argparse
import importlib
import logging
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path


import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _load_snappy():
    """Carga esa_snappy de forma diferida para evitar errores de import en analisis estatico."""
    try:
        snappy = importlib.import_module("esa_snappy")
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "No se pudo importar 'esa_snappy'. "
            "Activa el entorno de SNAP/esa_snappy antes de ejecutar este script."
        ) from exc
    return snappy.ProductIO, snappy.GPF, snappy.HashMap


def _relative_orbit_from_abs(abs_orbit: int, platform: str = "S1A") -> int:
    """Convierte orbita absoluta a relativa (formula oficial ESA)."""
    base = 73 if platform == "S1A" else 27  # S1B empieza en 27
    return ((abs_orbit - base) % 175) + 1


def _remove_tree_long_path(path: Path) -> None:
    """Borrado de arbol robusto en Windows (sortea el limite de 260 chars)."""
    if os.name == "nt":
        empty = path.parent / "__empty_trash__"
        empty.mkdir(exist_ok=True)
        try:
            subprocess.run(
                ["robocopy", str(empty), str(path), "/MIR", "/R:1", "/W:1",
                 "/NFL", "/NDL", "/NJH", "/NJS"],
                capture_output=True,
            )
            path.rmdir()
        except OSError as exc:
            logger.warning("No se pudo borrar %s: %s", path, exc)
        finally:
            try:
                empty.rmdir()
            except OSError:
                pass
    else:
        shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------------------
# Pipeline SAR
# ---------------------------------------------------------------------------

def process(safe_path: Path, params: dict, out_dir: Path) -> Path:
    """
    Ejecuta los 5 pasos sobre el .SAFE y escribe el GeoTIFF resultado.
    Devuelve la ruta del GeoTIFF final.
    """
    # Import diferido: esa_snappy arranca la JVM al importarse.
    ProductIO, GPF, HashMap = _load_snappy()

    # ------------------------------------------------------------------
    # Lectura de parametros (desde params.yaml + defaults del enunciado)
    # ------------------------------------------------------------------
    pp = params.get("preprocessing", {})
    speckle_filter = pp.get("speckle_filter", "Lee")
    speckle_window = int(pp.get("speckle_window", 7))

    dem_name_raw = pp.get("dem", "SRTM 1Sec HGT")
    dem_name = dem_name_raw.replace("_", " ").replace("SRTM 3 Sec", "SRTM 3Sec")
    valid_dems = (
        "SRTM 3Sec",
        "SRTM 1Sec HGT",
        "ASTER 1sec GDEM",
        "Copernicus 30m Global DEM",
        "Copernicus 90m Global DEM",
    )
    if dem_name not in valid_dems:
        logger.warning("Nombre DEM '%s' no reconocido; usando 'SRTM 1Sec HGT'.", dem_name)
        dem_name = "SRTM 1Sec HGT"

    pixel_spacing = 10.0          # metros (spec del enunciado)
    # CRS UTM 30N (EPSG:32630) — regla de CLAUDE.md, coherente con spacing en metros.
    utm_epsg = int(params["study_area"].get("epsg", 32630))
    map_projection = f"EPSG:{utm_epsg}"

    # Recorte al area de procesamiento. Si existe processing_bbox (bbox extendido
    # que cubre Valencia + zona de extrapolacion), se usa ese; si no, study_area.
    if "processing_bbox" in params and params["processing_bbox"].get("bbox"):
        bbox = params["processing_bbox"]["bbox"]
        bbox_label = params["processing_bbox"].get("name", "processing_bbox")
    else:
        bbox = params["study_area"]["bbox"]
        bbox_label = params["study_area"].get("name", "study_area")
    lon_min, lat_min, lon_max, lat_max = bbox
    logger.info("Bbox de recorte: %s -> %s", bbox_label, bbox)
    subset_wkt = (
        f"POLYGON(({lon_min} {lat_min}, {lon_max} {lat_min}, "
        f"{lon_max} {lat_max}, {lon_min} {lat_max}, {lon_min} {lat_min}))"
    )

    # ------------------------------------------------------------------
    # Lectura del producto
    # ------------------------------------------------------------------
    logger.info("Leyendo %s", safe_path.name)
    t0 = time.time()
    product = ProductIO.readProduct(str(safe_path / "manifest.safe"))
    if product is None:
        raise RuntimeError(f"SNAP no pudo abrir {safe_path}")
    logger.info("  Lectura: %.1fs", time.time() - t0)

    # Fecha y orbita relativa para el nombre del fichero
    name = product.getName()
    m = re.search(r"(\d{8})T\d{6}", name)
    date_str = m.group(1) if m else "UNKNOWN"
    platform = "S1A" if name.startswith("S1A") else "S1B"
    try:
        abs_orbit = (
            product.getMetadataRoot()
            .getElement("Abstracted_Metadata")
            .getAttributeInt("ABS_ORBIT")
        )
        rel_orbit = _relative_orbit_from_abs(int(abs_orbit), platform)
    except Exception:  # noqa: BLE001
        logger.warning("No se pudo leer ABS_ORBIT; usando 103 por defecto.")
        rel_orbit = 103

    # ------------------------------------------------------------------
    # Paso 1: Apply-Orbit-File
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[1/5] Apply-Orbit-File")
    p1_params = HashMap()
    p1_params.put("orbitType", "Sentinel Precise (Auto Download)")
    p1_params.put("polyDegree", "3")
    p1_params.put("continueOnFail", "false")
    p1 = GPF.createProduct("Apply-Orbit-File", p1_params, product)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Paso 2: ThermalNoiseRemoval
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[2/5] ThermalNoiseRemoval")
    p2_params = HashMap()
    p2_params.put("removeThermalNoise", "true")
    p2_params.put("selectedPolarisations", "VV,VH")
    p2 = GPF.createProduct("ThermalNoiseRemoval", p2_params, p1)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Paso 3: Calibration (Sigma0 en lineal) -- SIEMPRE antes del speckle
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[3/5] Calibration (Sigma0)")
    p3_params = HashMap()
    p3_params.put("outputSigmaBand", "true")
    p3_params.put("outputBetaBand", "false")
    p3_params.put("outputGammaBand", "false")
    p3_params.put("outputImageScaleInDb", "false")
    p3_params.put("selectedPolarisations", "VV,VH")
    p3 = GPF.createProduct("Calibration", p3_params, p2)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Paso 4: Speckle-Filter (Lee 7x7)
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[4/5] Speckle-Filter (%s %dx%d)", speckle_filter, speckle_window, speckle_window)
    p4_params = HashMap()
    p4_params.put("filter", speckle_filter)
    p4_params.put("filterSizeX", str(speckle_window))
    p4_params.put("filterSizeY", str(speckle_window))
    p4 = GPF.createProduct("Speckle-Filter", p4_params, p3)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Paso 5: Terrain-Correction (SRTM 3Sec, WGS84 DD, 10 m)
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[5/5] Terrain-Correction (%s, %.1f m, %s)", dem_name, pixel_spacing, map_projection)
    p5_params = HashMap()
    p5_params.put("demName", dem_name)
    p5_params.put("demResamplingMethod", "BILINEAR_INTERPOLATION")
    p5_params.put("imgResamplingMethod", "BILINEAR_INTERPOLATION")
    p5_params.put("pixelSpacingInMeter", str(float(pixel_spacing)))
    p5_params.put("mapProjection", map_projection)
    p5_params.put("nodataValueAtSea", "false")
    p5_params.put("saveDEM", "false")
    p5 = GPF.createProduct("Terrain-Correction", p5_params, p4)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Recorte al area de estudio (Subset geografico, post-TC).
    # Se aplica despues del TC para evitar problemas conocidos de
    # Subset-antes-de-TC con productos S1 en slant-range.
    # ------------------------------------------------------------------
    t0 = time.time()
    logger.info("[Subset] post-TC geoRegion=%s", subset_wkt)
    sub_params = HashMap()
    sub_params.put("geoRegion", subset_wkt)
    sub_params.put("copyMetadata", "true")
    p6 = GPF.createProduct("Subset", sub_params, p5)
    logger.info("      %.1fs", time.time() - t0)

    # ------------------------------------------------------------------
    # Escritura GeoTIFF
    # ------------------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"S1_sigma0_{date_str}_orb{int(rel_orbit):03d}.tif"
    out_path = out_dir / out_name

    snap_band_names = list(p6.getBandNames())
    logger.info("Bandas SNAP (orden interno): %s", snap_band_names)

    t0 = time.time()
    logger.info("Escribiendo %s", out_path.name)
    ProductIO.writeProduct(p6, str(out_path), "GeoTIFF")
    size_mb = out_path.stat().st_size / (1024 * 1024)
    logger.info("      %.1fs  (%.1f MB)", time.time() - t0, size_mb)

    # SNAP escribe las bandas en orden alfabetico (Sigma0_VH antes que Sigma0_VV)
    # y no conserva sus nombres en el GeoTIFF. Reinyectar descripciones con
    # rasterio para que aguas abajo se pueda identificar VV y VH por nombre.
    try:
        import rasterio  # import local: no bloquear la JVM durante el pipeline
        with rasterio.open(str(out_path), "r+") as ds:
            ds.descriptions = tuple(snap_band_names)
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudieron escribir nombres de banda: %s", exc)

    # dispose() no libera memoria de forma fiable (por eso subprocess),
    # pero reduce referencias en el proceso actual.
    for p in (p6, p5, p4, p3, p2, p1, product):
        try:
            p.dispose()
        except Exception:  # noqa: BLE001
            pass

    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pipeline SAR de 5 pasos sobre un .SAFE (esa_snappy)."
    )
    parser.add_argument("safe_path", type=Path, help="Ruta al .SAFE de entrada.")
    parser.add_argument(
        "--keep-safe", action="store_true",
        help="No borrar el .SAFE tras procesarlo (por defecto se borra).",
    )
    parser.add_argument(
        "--out-dir", type=Path, default=None,
        help="Directorio de salida (default: data/sentinel1/processed/).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    params = _load_yaml(repo_root / "config" / "params.yaml")
    paths = _load_yaml(repo_root / "config" / "paths.yaml")
    out_dir = (args.out_dir.resolve() if args.out_dir is not None
               else repo_root / paths["data"]["sentinel1"]["processed"])

    safe_path = args.safe_path.resolve()
    if not safe_path.exists() or not safe_path.is_dir():
        logger.error("No existe o no es una carpeta: %s", safe_path)
        return 1
    if not safe_path.name.endswith(".SAFE"):
        logger.error("Se esperaba un .SAFE, llego: %s", safe_path.name)
        return 2

    t_global = time.time()
    logger.info("=" * 72)
    logger.info("Procesando %s", safe_path.name)
    logger.info("Salida: %s", out_dir)
    logger.info("JVM: %s", os.environ.get("_JAVA_OPTIONS", "(por defecto)"))

    try:
        out_path = process(safe_path, params, out_dir)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallo procesando %s: %s", safe_path.name, exc)
        return 3

    if not args.keep_safe:
        logger.info("Borrando .SAFE original: %s", safe_path.name)
        _remove_tree_long_path(safe_path)

    total_min = (time.time() - t_global) / 60
    logger.info("OK -> %s  (total %.1f min)", out_path.name, total_min)
    return 0


if __name__ == "__main__":
    sys.exit(main())
