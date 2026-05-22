#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
compare_risk_maps.py
--------------------
Genera un PNG side-by-side comparando risk_probability.tif (v1, 11 features)
contra risk_probability_v2.tif (v2, 14 features con distance_to_coast/TWI/HAND).

Output: results/diagnostics/model/risk_v1_vs_v2.png

Uso:
    python scripts/models/compare_risk_maps.py
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import numpy as np
import rasterio

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_proba(path: Path):
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        bounds = ds.bounds
    arr[~np.isfinite(arr)] = np.nan
    return arr, bounds


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v1", type=Path,
                        default=Path("results/maps/04_risk_prediction/risk_probability.tif"))
    parser.add_argument("--v2", type=Path,
                        default=Path("results/maps/04_risk_prediction/risk_probability_v2.tif"))
    parser.add_argument("--out", type=Path,
                        default=Path("results/diagnostics/model/risk_v1_vs_v2.png"))
    args = parser.parse_args()

    root = _repo_root()
    p_v1 = root / args.v1 if not args.v1.is_absolute() else args.v1
    p_v2 = root / args.v2 if not args.v2.is_absolute() else args.v2
    out  = root / args.out if not args.out.is_absolute() else args.out

    if not p_v1.exists():
        raise FileNotFoundError(p_v1)
    if not p_v2.exists():
        raise FileNotFoundError(p_v2)

    log.info("Cargando v1: %s", p_v1)
    arr_v1, bounds = _load_proba(p_v1)
    log.info("Cargando v2: %s", p_v2)
    arr_v2, _ = _load_proba(p_v2)

    extent_utm = (bounds.left, bounds.right, bounds.bottom, bounds.top)

    # Etiqueta zona Devesa/El Saler / Mediterráneo (zonas de sobrepredicción v1)
    fig, axes = plt.subplots(1, 2, figsize=(20, 9))
    titles = [
        f"v1 — 11 features\nP>=0.568: {100*np.nanmean(arr_v1 >= 0.568):.1f}% del bbox",
        f"v2 — 14 features (+coast, TWI, HAND)\nP>=0.568: {100*np.nanmean(arr_v2 >= 0.568):.1f}% del bbox",
    ]
    for ax, arr, title in zip(axes, [arr_v1, arr_v2], titles):
        img = ax.imshow(arr, cmap="YlOrRd", vmin=0, vmax=1,
                        interpolation="nearest", extent=extent_utm)
        ax.set_title(title, fontsize=12)
        ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    fig.colorbar(img, ax=axes, fraction=0.025, pad=0.02, label="P(inundado)")
    fig.suptitle("Comparativa mapa de riesgo  v1 vs v2", fontsize=14)
    out.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s (%.2f MB)", out, out.stat().st_size / 1e6)

    # Diferencia v2 - v1 (cuánto baja la sobrepredicción)
    diff = arr_v2 - arr_v1
    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(diff, cmap="RdBu_r", vmin=-0.5, vmax=0.5,
                    interpolation="nearest", extent=extent_utm)
    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                 label="Δ P  (v2 − v1)\nazul = v2 reduce riesgo;  rojo = v2 aumenta")
    ax.set_title(f"Diferencia v2 − v1 — media={np.nanmean(diff):+.4f}, std={np.nanstd(diff):.4f}",
                 fontsize=12)
    ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    out_diff = out.with_name("risk_v2_minus_v1.png")
    plt.tight_layout()
    plt.savefig(out_diff, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_diff)

    # Stats
    log.info("=" * 70)
    log.info("RESUMEN COMPARATIVA  v1 vs v2")
    log.info("=" * 70)
    log.info("  v1 — mediana P:  %.4f   p90 P:  %.4f   P>=0.5: %5.2f%%   P>=0.568: %5.2f%%",
             np.nanmedian(arr_v1), np.nanpercentile(arr_v1, 90),
             100 * np.nanmean(arr_v1 >= 0.5),
             100 * np.nanmean(arr_v1 >= 0.568))
    log.info("  v2 — mediana P:  %.4f   p90 P:  %.4f   P>=0.5: %5.2f%%   P>=0.568: %5.2f%%",
             np.nanmedian(arr_v2), np.nanpercentile(arr_v2, 90),
             100 * np.nanmean(arr_v2 >= 0.5),
             100 * np.nanmean(arr_v2 >= 0.568))
    log.info("  Δ media (v2-v1): %+.4f", np.nanmean(diff))
    n_v1_05 = int(np.nansum(arr_v1 >= 0.5))
    n_v2_05 = int(np.nansum(arr_v2 >= 0.5))
    log.info("  Δ pixeles a 0.5:  v1=%d, v2=%d, Δ=%+d (%+.1f%%)",
             n_v1_05, n_v2_05, n_v2_05 - n_v1_05,
             100 * (n_v2_05 - n_v1_05) / max(n_v1_05, 1))
    log.info("=" * 70)


if __name__ == "__main__":
    main()
