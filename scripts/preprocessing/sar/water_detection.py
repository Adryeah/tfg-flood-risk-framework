"""
Deteccion de agua sobre Sigma0_VV (Sentinel-1 GRD post-pipeline SAR).

Metodo por defecto: **Multi-Otsu con 3 clases**, usando el umbral bajo
(clase 2 <-> 3) como frontera de agua. Justificacion y comparativa con
Otsu binario y umbral fijo en:
  scripts/preprocessing/sar/README_water_detection_method.md

Para cada escena S1 GRD ya procesada (output del pipeline SAR de 5 pasos):
  1. Lee la banda Sigma0_VV (lineal).
  2. Convierte a dB: 10 * log10(sigma0_lineal). Los ceros/NoData se
     marcan como NaN y quedan fuera del calculo.
  3. Calcula el umbral por escena (ver --method).
  4. Genera mascara binaria uint8: pixeles por debajo del umbral = agua
     (sigma0 bajo por reflexion especular), por encima = tierra.
  5. Reproyecta cada mascara al grid canonico (primera escena) y las
     acumula en water_frequency (0..N) = feature 'water_count' del modelo.
  6. Produce PNGs de diagnostico (histograma y mapa de frecuencia).

NO incluye las escenas del evento DANA (data/sentinel1/processed/event/)
para no contaminar el pool de entrenamiento.

Uso:
    python scripts/preprocessing/sar/water_detection.py
    python scripts/preprocessing/sar/water_detection.py --method multiotsu
    python scripts/preprocessing/sar/water_detection.py --method otsu
    python scripts/preprocessing/sar/water_detection.py --method fixed --fixed-db -17.0
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import yaml
from matplotlib import pyplot as plt
from rasterio.warp import Resampling, reproject
from skimage.filters import threshold_multiotsu, threshold_otsu


METHODS = ("multiotsu", "otsu", "fixed")
DEFAULT_METHOD = "multiotsu"
DEFAULT_FIXED_DB = -17.0


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _vv_band_index(ds: rasterio.DatasetReader) -> int:
    """Devuelve el indice 1-based de la banda Sigma0_VV segun descripciones."""
    for i, desc in enumerate(ds.descriptions, start=1):
        if desc == "Sigma0_VV":
            return i
    # Fallback: SNAP escribe en orden alfabetico (VH, VV) -> VV es la 2.
    logger.warning("'Sigma0_VV' no esta en descripciones; uso banda 2.")
    return 2


def _date_from_name(name: str) -> str:
    m = re.search(r"(\d{8})", name)
    return m.group(1) if m else "UNKNOWN"


def _linear_to_db(vv_lin: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Convierte Sigma0 lineal a dB. Devuelve (vv_db_con_nan, mascara_validos)."""
    valid = vv_lin > 0
    vv_db = np.full(vv_lin.shape, np.nan, dtype=np.float32)
    vv_db[valid] = 10.0 * np.log10(vv_lin[valid])
    return vv_db, valid


def compute_threshold(method: str, finite_db: np.ndarray,
                      fixed_db: float = DEFAULT_FIXED_DB) -> float:
    """Devuelve el umbral dB de separacion agua/tierra segun el metodo.

    - multiotsu: Multi-Otsu con 3 clases; umbral bajo (clase 2<->3) = agua.
                 Recomendado: robusto a distribuciones no bimodales.
    - otsu:      Otsu binario clasico. Sensible a escenas unimodales
                 (oleaje, saturacion generalizada).
    - fixed:     Umbral fisico constante (default -17 dB).
    """
    if method == "multiotsu":
        return float(threshold_multiotsu(finite_db, classes=3)[0])
    if method == "otsu":
        return float(threshold_otsu(finite_db))
    if method == "fixed":
        return float(fixed_db)
    raise ValueError(f"method desconocido: {method!r} (validos: {METHODS})")


# ---------------------------------------------------------------------------
# Procesamiento por escena
# ---------------------------------------------------------------------------

def _mask_profile_from(profile: dict) -> dict:
    """Profile para GeoTIFF uint8 1-banda sin opciones de tiling heredadas."""
    mp = {k: v for k, v in profile.items()
          if k not in ("blockxsize", "blockysize", "tiled", "interleave", "photometric")}
    mp.update({
        "driver": "GTiff",
        "dtype": "uint8",
        "count": 1,
        "nodata": 255,
        "compress": "lzw",
    })
    return mp


def process_scene(
    tif_path: Path,
    masks_dir: Path,
    canonical_transform,
    canonical_crs,
    canonical_shape: tuple[int, int],
    accumulator: np.ndarray,
    method: str = DEFAULT_METHOD,
    fixed_db: float = DEFAULT_FIXED_DB,
) -> tuple[float, float]:
    """Genera la mascara binaria, la escribe y actualiza el acumulador.

    - La mascara por escena se guarda en su grid nativo (para inspeccion).
    - Se reproyecta (vecino mas cercano) al grid canonico para acumular:
      SNAP produce grids ligeramente desalineados entre escenas.
    Devuelve (umbral_dB, porcentaje_pixeles_agua).
    """
    with rasterio.open(tif_path) as ds:
        vv_idx = _vv_band_index(ds)
        vv_lin = ds.read(vv_idx).astype(np.float32)
        profile = ds.profile.copy()
        native_transform = ds.transform
        native_crs = ds.crs

    vv_db, valid = _linear_to_db(vv_lin)
    finite = vv_db[valid]
    if finite.size == 0:
        raise RuntimeError(f"Sin pixeles validos en {tif_path.name}")

    threshold = compute_threshold(method, finite, fixed_db=fixed_db)

    water_mask = np.zeros(vv_db.shape, dtype=np.uint8)
    water_mask[valid & (vv_db < threshold)] = 1
    pct_water = 100.0 * water_mask.sum() / valid.sum()

    # Mascara nativa -> GeoTIFF (inspeccion por escena)
    date_str = _date_from_name(tif_path.name)
    out_path = masks_dir / f"water_mask_{date_str}.tif"
    with rasterio.open(out_path, "w", **_mask_profile_from(profile)) as dst:
        dst.write(water_mask, 1)
        dst.descriptions = ("water_mask",)

    # Reproyeccion al grid canonico para acumulador
    aligned = np.zeros(canonical_shape, dtype=np.uint8)
    reproject(
        source=water_mask,
        destination=aligned,
        src_transform=native_transform,
        src_crs=native_crs,
        dst_transform=canonical_transform,
        dst_crs=canonical_crs,
        resampling=Resampling.nearest,
    )
    accumulator += aligned
    return threshold, pct_water


# ---------------------------------------------------------------------------
# Diagnosticos (PNG)
# ---------------------------------------------------------------------------

def plot_histogram(vv_db: np.ndarray, threshold: float, scene_name: str,
                   method: str, out_path: Path) -> None:
    """Histograma de sigma0_VV con el umbral del metodo elegido marcado."""
    values = vv_db[np.isfinite(vv_db)]
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.hist(values, bins=200, color="steelblue", alpha=0.75, edgecolor="none")
    ax.axvline(threshold, color="crimson", linestyle="--", linewidth=1.6,
               label=f"{method} = {threshold:.2f} dB")
    ax.set_xlabel("Sigma0_VV (dB)")
    ax.set_ylabel("Numero de pixeles")
    ax.set_title(f"Histograma Sigma0_VV y umbral ({method})\nEscena representativa: {scene_name}")
    ax.legend(loc="upper right")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=130)
    plt.close(fig)


def plot_frequency_map(freq: np.ndarray, n_scenes: int, out_path: Path) -> None:
    """Mapa de frecuencia de agua (0 -> blanco, N -> azul oscuro)."""
    fig, ax = plt.subplots(figsize=(8, 7))
    im = ax.imshow(freq, cmap="Blues", vmin=0, vmax=n_scenes,
                   interpolation="nearest")
    cbar = fig.colorbar(im, ax=ax, shrink=0.82)
    cbar.set_label(f"Veces clasificado como agua (de {n_scenes} escenas)")
    ax.set_title(f"Frecuencia de agua — {n_scenes} escenas baseline (2022-2024)")
    ax.set_xticks([])
    ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(out_path, dpi=130)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deteccion de agua sobre Sigma0_VV de escenas S1 GRD procesadas."
    )
    parser.add_argument(
        "--method", choices=METHODS, default=DEFAULT_METHOD,
        help=f"Metodo de umbralizacion (default: {DEFAULT_METHOD}).",
    )
    parser.add_argument(
        "--fixed-db", type=float, default=DEFAULT_FIXED_DB,
        help=f"Umbral dB para --method fixed (default: {DEFAULT_FIXED_DB}).",
    )
    args = parser.parse_args()
    method = args.method
    fixed_db = args.fixed_db

    t_global = time.time()

    paths = _load_yaml(REPO_ROOT / "config" / "paths.yaml")

    processed_dir = REPO_ROOT / paths["data"]["sentinel1"]["processed"]
    masks_dir = REPO_ROOT / paths["data"]["sentinel1"]["water_masks"]
    diag_dir = REPO_ROOT / "results" / "diagnostics"
    masks_dir.mkdir(parents=True, exist_ok=True)
    diag_dir.mkdir(parents=True, exist_ok=True)

    # No recursivo: excluye data/sentinel1/processed/event/
    tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*_orb*.tif")
                  if p.is_file())
    if not tifs:
        logger.error("No hay escenas procesadas en %s", processed_dir)
        return 1

    logger.info("=" * 72)
    logger.info("Deteccion de agua (%s sobre Sigma0_VV)",
                method + (f" th={fixed_db:+.2f}dB" if method == "fixed" else ""))
    logger.info("Entrada:  %s  (%d escenas)", processed_dir, len(tifs))
    logger.info("Mascaras: %s", masks_dir)
    logger.info("Diagnost: %s", diag_dir)
    logger.info("=" * 72)

    # Grid canonico = primera escena. SNAP produce grids ligeramente
    # desalineados entre escenas (shape 2850..2851 x 2663..2664, offsets
    # sub-pixel). Reproyectamos todas las mascaras a este grid antes de
    # acumular.
    with rasterio.open(tifs[0]) as ds0:
        canonical_shape = (ds0.height, ds0.width)
        canonical_transform = ds0.transform
        canonical_crs = ds0.crs
        base_profile = ds0.profile.copy()
    accumulator = np.zeros(canonical_shape, dtype=np.uint16)

    thresholds: list[float] = []
    pct_waters: list[float] = []
    per_scene: list[tuple[str, float, float]] = []   # (date, th, pct)

    for i, tif in enumerate(tifs, start=1):
        t0 = time.time()
        try:
            threshold, pct_water = process_scene(
                tif, masks_dir,
                canonical_transform, canonical_crs, canonical_shape,
                accumulator,
                method=method, fixed_db=fixed_db,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Fallo en %s: %s", tif.name, exc)
            continue
        thresholds.append(threshold)
        pct_waters.append(pct_water)
        per_scene.append((_date_from_name(tif.name), threshold, pct_water))
        logger.info("[%2d/%d] %s  th=%+6.2f dB  agua=%5.2f%%  (%.1fs)",
                    i, len(tifs), tif.name, threshold, pct_water,
                    time.time() - t0)

    if not thresholds:
        logger.error("Ninguna escena procesada correctamente.")
        return 1

    # ------------------------------------------------------------------
    # water_frequency.tif (feature 'water_count')
    # ------------------------------------------------------------------
    freq = accumulator.astype(np.uint8)   # max n <= 24 < 255
    freq_path = masks_dir / "water_frequency.tif"
    with rasterio.open(freq_path, "w", **_mask_profile_from(base_profile)) as dst:
        dst.write(freq, 1)
        dst.descriptions = ("water_count",)
    logger.info("Escrito %s  (max=%d)", freq_path.name, int(freq.max()))

    # ------------------------------------------------------------------
    # Diagnosticos: elegir escena representativa = mediana de umbrales
    # ------------------------------------------------------------------
    med_th = float(np.median(thresholds))
    rep_idx = int(np.argmin([abs(t - med_th) for t in thresholds]))
    rep_tif = tifs[rep_idx]
    rep_threshold = thresholds[rep_idx]
    with rasterio.open(rep_tif) as ds:
        vv_lin = ds.read(_vv_band_index(ds)).astype(np.float32)
    vv_db_rep, _ = _linear_to_db(vv_lin)

    hist_path = diag_dir / "water_otsu_histogram.png"
    freq_png_path = diag_dir / "water_frequency_map.png"
    plot_histogram(vv_db_rep, rep_threshold, rep_tif.name, method, hist_path)
    plot_frequency_map(freq, len(tifs), freq_png_path)
    logger.info("Escrito %s", hist_path.name)
    logger.info("Escrito %s", freq_png_path.name)

    # ------------------------------------------------------------------
    # Resumen
    # ------------------------------------------------------------------
    n = len(thresholds)
    total_px = freq.size
    pct_never = 100.0 * (freq == 0).sum() / total_px
    pct_always = 100.0 * (freq == n).sum() / total_px
    pct_ocasional = 100.0 * ((freq >= 1) & (freq <= 5)).sum() / total_px
    pct_persistente = 100.0 * (freq > 5).sum() / total_px

    logger.info("=" * 72)
    logger.info("RESUMEN DETECCION DE AGUA (%s)", method)
    logger.info("  Escenas procesadas OK:         %d / %d", n, len(tifs))
    logger.info("  Umbrales (dB):                 min=%6.2f  max=%6.2f  mediana=%6.2f  std=%.2f",
                min(thresholds), max(thresholds), med_th, float(np.std(thresholds)))
    logger.info("  Pixeles clasificados agua:     min=%5.2f%%  max=%5.2f%%  media=%5.2f%%",
                min(pct_waters), max(pct_waters), float(np.mean(pct_waters)))
    logger.info("  water_frequency:")
    logger.info("    nunca agua (=0):             %6.2f %%", pct_never)
    logger.info("    ocasional (1-5):             %6.2f %%  <- candidatos zona inundable",
                pct_ocasional)
    logger.info("    persistente (>5):            %6.2f %%", pct_persistente)
    logger.info("    siempre agua (=%d):          %6.2f %%  <- Albufera, rios",
                n, pct_always)
    logger.info("  Escena representativa (hist.): %s (%s=%.2f dB)",
                rep_tif.name, method, rep_threshold)
    logger.info("  Tiempo total:                  %.1f s", time.time() - t_global)
    logger.info("=" * 72)

    return 0


if __name__ == "__main__":
    sys.exit(main())
