#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
generate_memoria_figures_v3t.py
-------------------------------
Genera el set de figuras PNG del modelo v3-T para la memoria del TFG, a
alta resolucion (300 dpi). Coherentes con la plataforma (colormap YlOrRd,
umbral 0,310).

Salidas en results/figures/memoria/:
  - risk_probability_{valencia,algemesi}_v3t.png   (mapa de probabilidad)
  - risk_binary_{valencia,algemesi}_v3t.png         (mapa binario @0,310)
  - feature_importance_v3t.png                      (9 features, Gini)
  - metrics_v2_vs_v3t.png                           (comparativa de barras)

(Las figuras AOA / gain-calibracion / ablacion-LOZO ya estan en
results/diagnostics/; estas son las especificas del modelo final.)

Uso: .venv/Scripts/python.exe scripts/visualization/generate_memoria_figures_v3t.py
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.plot import plotting_extent

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "results" / "figures" / "memoria"
OUT.mkdir(parents=True, exist_ok=True)
THR = 0.310

MAPS = {
    "valencia": REPO / "results/maps/04_risk_prediction/risk_probability_v3t.tif",
    "algemesi": REPO / "results/maps/05_extrapolation/risk_probability_algemesi_v3t.tif",
}
TITLES = {"valencia": "Valencia · l'Horta Sud (zona de entrenamiento)",
          "algemesi": "Algemesí · Ribera Alta del Júcar (extrapolación)"}


def _risk_maps():
    for zone, src in MAPS.items():
        with rasterio.open(src) as ds:
            p = ds.read(1).astype("float32")
            ext = plotting_extent(ds)
        p = np.where(np.isfinite(p), p, np.nan)
        # "< 0.25 transparente": enmascarar baja probabilidad (mar, suelo
        # seco) para que no se pinte — igual que la plataforma. Queda en
        # blanco/fondo, no como un valor de riesgo.
        p_vis = np.where(p >= 0.25, p, np.nan)
        # Probabilidad
        fig, ax = plt.subplots(figsize=(9, 8))
        im = ax.imshow(p_vis, cmap="YlOrRd", vmin=0, vmax=1, extent=ext, interpolation="nearest")
        cb = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
        cb.set_label("P(inundación) — RF v3-T calibrado", fontsize=10)
        ax.set_title(f"Mapa de susceptibilidad de inundación · {TITLES[zone]}", fontsize=11)
        ax.set_xlabel("UTM 30N X (m)"); ax.set_ylabel("UTM 30N Y (m)")
        plt.tight_layout()
        f = OUT / f"risk_probability_{zone}_v3t.png"
        plt.savefig(f, dpi=300, bbox_inches="tight"); plt.close()
        log.info("PNG: %s", f.relative_to(REPO))
        # Binario
        b = np.where(np.isfinite(p), (p >= THR).astype("float32"), np.nan)
        fig, ax = plt.subplots(figsize=(9, 8))
        ax.imshow(b, cmap="Reds", vmin=0, vmax=1, extent=ext, interpolation="nearest")
        ax.set_title(f"Clasificación binaria de riesgo (umbral {THR}) · {TITLES[zone]}", fontsize=11)
        ax.set_xlabel("UTM 30N X (m)"); ax.set_ylabel("UTM 30N Y (m)")
        plt.tight_layout()
        f = OUT / f"risk_binary_{zone}_v3t.png"
        plt.savefig(f, dpi=300, bbox_inches="tight"); plt.close()
        log.info("PNG: %s", f.relative_to(REPO))


def _feature_importance():
    meta = json.loads((REPO / "results/model/v3t_final.json").read_text(encoding="utf-8"))
    imp = meta["gini_importance"]
    names = list(imp.keys())[::-1]; vals = [imp[k] for k in names]
    fig, ax = plt.subplots(figsize=(9, 6))
    ax.barh(names, vals, color="#e63946")
    ax.set_xlabel("Importancia Gini")
    ax.set_title(f"RF v3-T · importancia de las {len(imp)} features transferibles")
    ax.grid(True, alpha=0.3, axis="x")
    plt.tight_layout()
    f = OUT / "feature_importance_v3t.png"
    plt.savefig(f, dpi=300, bbox_inches="tight"); plt.close()
    log.info("PNG: %s", f.relative_to(REPO))


def _v2_vs_v3t():
    d = json.loads((REPO / "framework_web/backend/data_processed/precomputed_metrics.json").read_text(encoding="utf-8"))
    # v3-T de precomputed_metrics.json; v2 = baseline documentado en la memoria.
    val_v3 = d["valencia"]["model_metrics"]; alg_v3 = d["algemesi"]["model_metrics"]
    groups = ["Valencia\nAUC", "Valencia\nRecall", "Algemesí\nAUC", "Algemesí\nRecall"]
    v2_vals = [0.922, 0.777, 0.817, 0.000]   # baseline documentado v2
    v3_vals = [val_v3["auc_mean"], val_v3["recall"], alg_v3["auc_mean"], alg_v3["recall"]]
    x = np.arange(len(groups)); w = 0.38
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.bar(x - w/2, v2_vals, w, label="RF v2 (14 feat)", color="#94a3b8")
    ax.bar(x + w/2, v3_vals, w, label="RF v3-T (10 feat)", color="#e63946")
    ax.set_xticks(x); ax.set_xticklabels(groups)
    ax.set_ylim(0, 1); ax.set_ylabel("Valor")
    ax.set_title("RF v2 vs RF v3-T — el v3-T recupera la transferencia "
                 f"(recall Algemesí 0,18 → {alg_v3['recall']:.2f})".replace(".", ","))
    ax.legend(); ax.grid(True, alpha=0.3, axis="y")
    for i, (a, b) in enumerate(zip(v2_vals, v3_vals)):
        ax.text(i - w/2, a + 0.01, f"{a:.2f}", ha="center", fontsize=8)
        ax.text(i + w/2, b + 0.01, f"{b:.2f}", ha="center", fontsize=8)
    plt.tight_layout()
    f = OUT / "metrics_v2_vs_v3t.png"
    plt.savefig(f, dpi=300, bbox_inches="tight"); plt.close()
    log.info("PNG: %s", f.relative_to(REPO))


def main() -> int:
    log.info("Generando figuras v3-T para la memoria...")
    _risk_maps()
    _feature_importance()
    _v2_vs_v3t()
    log.info("=== Figuras en %s ===", OUT.relative_to(REPO))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
