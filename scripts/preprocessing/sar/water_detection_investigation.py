"""
Investigacion de las 2 escenas anomalas en deteccion de agua:
  - 20240117 (Otsu=-9.44 dB, 72.9% agua clasificada)
  - 20240210 (Otsu=-9.19 dB, 74.6% agua clasificada)

Compara 3 estrategias de umbralizacion sobre las 24 escenas baseline:

  (A) Otsu por escena    --> binario, sufre si la distribucion no es bimodal
  (B) Fijo -17 dB        --> fisicamente motivado, independiente de la escena
  (C) Multi-Otsu (3 cls) --> separa tierra seca / tierra humeda / agua;
                             se usa el umbral inferior (clase 2<->3).

Salidas:
  - results/diagnostics/anomalous_scenes/histograms_otsu_vs_fixed_vs_multi.png
  - results/diagnostics/anomalous_scenes/water_frequency_comparison.png
  - data/sentinel1/water_masks/water_frequency_alt_fixed17.tif
  - data/sentinel1/water_masks/water_frequency_alt_multiotsu.tif

NO sobreescribe data/sentinel1/water_masks/water_frequency.tif.

Uso:
    python scripts/preprocessing/sar/water_detection_investigation.py
"""
from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import rasterio.transform as rt
import yaml
from matplotlib import pyplot as plt
from pyproj import Transformer
from rasterio.warp import Resampling, reproject
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks
from skimage.filters import threshold_multiotsu, threshold_otsu


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXED_TH_DB = -17.0   # umbral fisico (literatura S1: agua P(agua)>95% por debajo)

# Reutiliza helpers del script principal
sys.path.insert(0, str(Path(__file__).parent))
from water_detection import (  # type: ignore  # noqa: E402
    _date_from_name,
    _linear_to_db,
    _load_yaml,
    _mask_profile_from,
    _vv_band_index,
)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def _read_vv_db(tif: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    """Devuelve (vv_db, mascara_validos, profile)."""
    with rasterio.open(tif) as ds:
        vv_lin = ds.read(_vv_band_index(ds)).astype(np.float32)
        profile = ds.profile.copy()
    vv_db, valid = _linear_to_db(vv_lin)
    return vv_db, valid, profile


def _count_modes(values: np.ndarray) -> tuple[int, list[float]]:
    """Cuenta modos mediante histograma suavizado + find_peaks."""
    hist, edges = np.histogram(values, bins=500, range=(-40, 10))
    smoothed = gaussian_filter1d(hist.astype(float), sigma=3)
    prominence = smoothed.max() * 0.05 if smoothed.max() > 0 else 1.0
    peaks, _ = find_peaks(smoothed, prominence=prominence)
    centers = (edges[:-1] + edges[1:]) / 2
    return len(peaks), [float(centers[p]) for p in peaks]


# ---------------------------------------------------------------------------
# Graficas
# ---------------------------------------------------------------------------

def plot_histograms(scenes: dict, out_path: Path) -> None:
    """3 subplots: histograma dB + los 3 umbrales superpuestos."""
    n = len(scenes)
    fig, axes = plt.subplots(n, 1, figsize=(11, 4 * n), sharex=True)
    if n == 1:
        axes = [axes]
    for ax, (date, info) in zip(axes, scenes.items()):
        values = info["db"][np.isfinite(info["db"])]
        ax.hist(values, bins=200, color="steelblue", alpha=0.65, edgecolor="none",
                label=f"{values.size:,} pixeles validos")
        ax.axvline(info["th_otsu"], color="crimson", ls="--", lw=1.6,
                   label=f"Otsu      = {info['th_otsu']:+6.2f} dB")
        ax.axvline(FIXED_TH_DB, color="darkgreen", ls=":", lw=2.0,
                   label=f"Fijo      = {FIXED_TH_DB:+6.2f} dB")
        ax.axvline(info["th_multi"], color="purple", ls="-.", lw=1.6,
                   label=f"MultiOtsu = {info['th_multi']:+6.2f} dB")
        n_modes, modes = info["modes"]
        for m in modes:
            ax.axvline(m, color="black", alpha=0.25, lw=0.9)
        modal = {1: "unimodal", 2: "bimodal", 3: "trimodal"}.get(n_modes, f"{n_modes}-modal")
        modes_s = [f"{m:+.1f}" for m in modes]
        ax.set_title(f"Escena {date}  —  {modal}  (modos dB: {modes_s})")
        ax.set_xlabel("Sigma0_VV (dB)")
        ax.set_ylabel("Numero de pixeles")
        ax.set_xlim(-35, 5)
        ax.legend(loc="upper right", fontsize=9)
        ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=130)
    plt.close(fig)


def plot_frequency_comparison(maps: dict, n_scenes: int, out_path: Path) -> None:
    """3 mapas water_frequency comparados lado a lado, misma escala."""
    n = len(maps)
    fig, axes = plt.subplots(1, n, figsize=(6.5 * n, 6.5))
    if n == 1:
        axes = [axes]
    for ax, (name, freq) in zip(axes, maps.items()):
        im = ax.imshow(freq, cmap="Blues", vmin=0, vmax=n_scenes,
                       interpolation="nearest")
        ax.set_title(name, fontsize=12)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.colorbar(im, ax=axes, shrink=0.72,
                 label=f"Veces clasificado agua (de {n_scenes})")
    fig.savefig(out_path, dpi=130, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Sanity check
# ---------------------------------------------------------------------------

SANITY_POINTS = [
    # (nombre, lon, lat, categoria_esperada)
    ("Albufera (centro)", -0.335, 39.335, "agua"),
    ("Mar (E costa)",     -0.28,  39.35,  "agua"),
    ("Urbano Valencia",   -0.376, 39.475, "tierra"),
    ("Huerta (L'Horta)",  -0.46,  39.40,  "tierra"),
]


def sanity_check(freq: np.ndarray, transform) -> dict:
    """Media de water_count en ventana 20x20 sobre puntos conocidos."""
    t_ll_utm = Transformer.from_crs("EPSG:4326", "EPSG:32630", always_xy=True)
    out = {}
    H, W = freq.shape
    for name, lon, lat, _cat in SANITY_POINTS:
        x, y = t_ll_utm.transform(lon, lat)
        r, c = rt.rowcol(transform, x, y)
        r, c = int(r), int(c)
        r0, r1 = max(0, r - 10), min(H, r + 10)
        c0, c1 = max(0, c - 10), min(W, c + 10)
        if r1 <= r0 or c1 <= c0:
            out[name] = float("nan")
            continue
        out[name] = float(freq[r0:r1, c0:c1].mean())
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    t0 = time.time()
    paths = _load_yaml(REPO_ROOT / "config" / "paths.yaml")
    processed_dir = REPO_ROOT / paths["data"]["sentinel1"]["processed"]
    masks_dir = REPO_ROOT / paths["data"]["sentinel1"]["water_masks"]
    diag_dir = REPO_ROOT / "results" / "diagnostics" / "anomalous_scenes"
    diag_dir.mkdir(parents=True, exist_ok=True)

    tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*_orb*.tif")
                  if p.is_file())
    if not tifs:
        logger.error("Sin escenas en %s", processed_dir)
        return 1

    # ------------------------------------------------------------------
    # Paso 1. Analisis individual de las 2 anomalas + referencia
    # ------------------------------------------------------------------
    scene_map = {_date_from_name(t.name): t for t in tifs}
    focus_dates = ["20240117", "20240210", "20230615"]
    logger.info("=" * 80)
    logger.info("Paso 1: analisis de distribuciones (3 escenas)")
    logger.info("=" * 80)
    scenes: dict = {}
    for date in focus_dates:
        if date not in scene_map:
            logger.warning("No existe escena %s", date)
            continue
        vv_db, valid, _ = _read_vv_db(scene_map[date])
        finite = vv_db[valid]
        th_otsu = float(threshold_otsu(finite))
        th_multi = float(threshold_multiotsu(finite, classes=3)[0])
        n_modes, modes = _count_modes(finite)
        scenes[date] = {
            "db": vv_db, "th_otsu": th_otsu, "th_multi": th_multi,
            "modes": (n_modes, modes),
        }
        logger.info("%s  Otsu=%+6.2f  Fijo=%+6.2f  MultiOtsu=%+6.2f  modos=%d %s",
                    date, th_otsu, FIXED_TH_DB, th_multi, n_modes,
                    [round(m, 1) for m in modes])

    hist_path = diag_dir / "histograms_otsu_vs_fixed_vs_multi.png"
    plot_histograms(scenes, hist_path)
    logger.info("Escrito %s", hist_path)

    # ------------------------------------------------------------------
    # Paso 2. Recalcular water_frequency con los 3 metodos (24 escenas)
    # ------------------------------------------------------------------
    with rasterio.open(tifs[0]) as ds0:
        canonical_shape = (ds0.height, ds0.width)
        canonical_transform = ds0.transform
        canonical_crs = ds0.crs
        base_profile = ds0.profile.copy()

    acc_otsu = np.zeros(canonical_shape, dtype=np.uint16)
    acc_fixed = np.zeros(canonical_shape, dtype=np.uint16)
    acc_multi = np.zeros(canonical_shape, dtype=np.uint16)

    pcts = {"otsu": [], "fixed": [], "multi": []}
    ths = {"otsu": [], "multi": []}

    logger.info("=" * 80)
    logger.info("Paso 2: reconstruccion de water_frequency (3 metodos, %d escenas)",
                len(tifs))
    logger.info("=" * 80)
    for i, tif in enumerate(tifs, 1):
        vv_db, valid, profile = _read_vv_db(tif)
        finite = vv_db[valid]
        th_o = float(threshold_otsu(finite))
        th_m = float(threshold_multiotsu(finite, classes=3)[0])

        methods = [
            (th_o, "otsu", acc_otsu),
            (FIXED_TH_DB, "fixed", acc_fixed),
            (th_m, "multi", acc_multi),
        ]
        for th, key, acc in methods:
            mask = np.zeros(vv_db.shape, dtype=np.uint8)
            mask[valid & (vv_db < th)] = 1
            pcts[key].append(100.0 * mask.sum() / valid.sum())
            aligned = np.zeros(canonical_shape, dtype=np.uint8)
            reproject(
                source=mask, destination=aligned,
                src_transform=profile["transform"], src_crs=profile["crs"],
                dst_transform=canonical_transform, dst_crs=canonical_crs,
                resampling=Resampling.nearest,
            )
            acc += aligned
        ths["otsu"].append(th_o)
        ths["multi"].append(th_m)
        logger.info("[%2d/%d] %s  O=%+6.2f(%5.2f%%)  F(%5.2f%%)  M=%+6.2f(%5.2f%%)",
                    i, len(tifs), tif.name,
                    th_o, pcts["otsu"][-1], pcts["fixed"][-1],
                    th_m, pcts["multi"][-1])

    # Escribir mapas alternativos (NO tocar water_frequency.tif original)
    for name, acc in [("alt_fixed17", acc_fixed), ("alt_multiotsu", acc_multi)]:
        out = masks_dir / f"water_frequency_{name}.tif"
        with rasterio.open(out, "w", **_mask_profile_from(base_profile)) as dst:
            dst.write(acc.astype(np.uint8), 1)
            dst.descriptions = (f"water_count_{name}",)
        logger.info("Escrito %s  (max=%d)", out.name, int(acc.max()))

    # ------------------------------------------------------------------
    # Paso 3. Comparacion visual
    # ------------------------------------------------------------------
    maps = {
        "Original Otsu (por escena)": acc_otsu.astype(np.uint8),
        f"Fijo {FIXED_TH_DB:+.0f} dB":      acc_fixed.astype(np.uint8),
        "Multi-Otsu (3 clases)":      acc_multi.astype(np.uint8),
    }
    comp_path = diag_dir / "water_frequency_comparison.png"
    plot_frequency_comparison(maps, len(tifs), comp_path)
    logger.info("Escrito %s", comp_path)

    # ------------------------------------------------------------------
    # Paso 4. Resumen comparativo + sanity check
    # ------------------------------------------------------------------
    n = len(tifs)

    def stats(freq: np.ndarray) -> dict:
        tot = freq.size
        return {
            "never": 100.0 * (freq == 0).sum() / tot,
            "occ": 100.0 * ((freq >= 1) & (freq <= 5)).sum() / tot,
            "per": 100.0 * (freq > 5).sum() / tot,
            "always": 100.0 * (freq == n).sum() / tot,
            "max": int(freq.max()),
            "mean_pct": float(100.0 * freq.mean() / n),
        }

    logger.info("=" * 80)
    logger.info("COMPARATIVA DE METODOS (24 escenas)")
    logger.info("=" * 80)
    header = f"{'metodo':<28} {'nunca':>8} {'ocasional':>10} {'persist':>10} {'siempre':>10} {'max':>5} {'media%':>8}"
    logger.info(header)
    logger.info("-" * len(header))
    for name, freq in maps.items():
        s = stats(freq)
        logger.info("%-28s %7.2f%% %9.2f%% %9.2f%% %9.2f%% %5d %7.2f%%",
                    name, s["never"], s["occ"], s["per"], s["always"],
                    s["max"], s["mean_pct"])

    logger.info("")
    logger.info("SANITY CHECK  (media water_count ventana 20x20 sobre puntos conocidos)")
    logger.info("esperado: Albufera/Mar ~= %d,  Urbano/Huerta ~= 0", n)
    for name, freq in maps.items():
        sc = sanity_check(freq, canonical_transform)
        parts = "  ".join(f"{k}={v:5.2f}" for k, v in sc.items())
        logger.info("  %-28s  %s", name, parts)

    # % escenas con Otsu fuera de rango razonable (diagnostico anomalia)
    otsu_arr = np.array(ths["otsu"])
    multi_arr = np.array(ths["multi"])
    logger.info("")
    logger.info("Otsu     min=%+6.2f  max=%+6.2f  mediana=%+6.2f  std=%5.2f",
                otsu_arr.min(), otsu_arr.max(), float(np.median(otsu_arr)),
                float(otsu_arr.std()))
    logger.info("MultiOtsu min=%+6.2f  max=%+6.2f  mediana=%+6.2f  std=%5.2f",
                multi_arr.min(), multi_arr.max(), float(np.median(multi_arr)),
                float(multi_arr.std()))

    logger.info("")
    logger.info("TIEMPO TOTAL: %.1f s", time.time() - t0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
