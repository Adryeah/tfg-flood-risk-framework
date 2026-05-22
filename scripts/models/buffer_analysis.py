#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
buffer_analysis.py
------------------
Análisis de tolerancia espacial sobre las predicciones OOF del modelo v2.

Aplica dilatación morfológica circular al ground truth y a las predicciones
con tres buffers (30 m, 50 m, 100 m a 10 m/px), recalcula la confusion
matrix y reporta cuánto error es atribuible a la resolución espacial del
ground truth (halo perimetral, ruido de rasterización) frente al modelo
real.

Metodología (estándar en validación de mapeo de inundación, p.ej.
Ferrari et al. 2022, GFM Copernicus, UN-SPIDER recommended practice):

  Para un buffer de radio r:
    y_true_dil = binary_dilation(y_true, disk(r))     # GT permisivo
    y_pred_dil = binary_dilation(y_pred, disk(r))     # Pred permisiva

  TP_buf  = #{y_pred & y_true_dil}   predicción cercana a verdad
  FP_buf  = #{y_pred & ~y_true_dil}  predicción lejos de toda verdad
  FN_buf  = #{y_true & ~y_pred_dil}  verdad lejos de toda predicción
  TN_buf  = total - TP - FP - FN

Inputs:
  - data/dataset/training_dataset_v2.parquet
  - models/folds_v2/predictions_fold_{1..5}.npz

Outputs:
  - results/model/buffer_metrics_v2.csv
  - results/diagnostics/model/buffer_metrics_comparison.png

Uso:
    python scripts/models/buffer_analysis.py [--threshold 0.614]
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import rasterio
from scipy.ndimage import binary_dilation

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

PIXEL_SIZE_M = 10
BUFFERS_M    = [0, 30, 50, 100]   # 0 = estricto


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _disk(radius: int) -> np.ndarray:
    """Kernel binario circular de radio `radius` píxeles."""
    if radius <= 0:
        return np.array([[True]])
    y, x = np.ogrid[-radius:radius + 1, -radius:radius + 1]
    return (x * x + y * y <= radius * radius)


# ---------------------------------------------------------------------------
# OOF loading (igual que en error_analysis.py)
# ---------------------------------------------------------------------------

def load_oof_predictions(folds_dir: Path, n_total: int) -> np.ndarray:
    proba = np.full(n_total, np.nan, dtype="float32")
    for i in range(1, 6):
        p = folds_dir / f"predictions_fold_{i}.npz"
        d = np.load(p)
        proba[d["val_idx"]] = d["proba_val"]
    return proba


# ---------------------------------------------------------------------------
# Reconstrucción a grid 2D
# ---------------------------------------------------------------------------

def grids_from_dataframe(
    df: pd.DataFrame, y_true: np.ndarray, y_pred: np.ndarray,
    ref_path: Path,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Construye los rasters 2D de y_true y y_pred junto con la máscara de
    píxeles válidos (cubiertos por el dataset).
    """
    with rasterio.open(ref_path) as ref:
        rows, cols = ref.height, ref.width

    valid = np.zeros((rows, cols), dtype=bool)
    yt = np.zeros((rows, cols), dtype=bool)
    yp = np.zeros((rows, cols), dtype=bool)

    rs = df["row"].values
    cs = df["col"].values
    valid[rs, cs] = True
    yt[rs, cs]    = (y_true == 1)
    yp[rs, cs]    = (y_pred == 1)
    return yt, yp, valid


# ---------------------------------------------------------------------------
# Métricas con buffer
# ---------------------------------------------------------------------------

def metrics_with_buffer(
    y_true_grid: np.ndarray,
    y_pred_grid: np.ndarray,
    valid_grid: np.ndarray,
    buffer_m: int,
    pixel_size_m: int = PIXEL_SIZE_M,
) -> Dict[str, float]:
    """
    Calcula confusion matrix permitiendo tolerancia espacial buffer_m.

    Devuelve dict con TP, FP, FN, TN, n, recall, precision, f1, accuracy.
    """
    if buffer_m == 0:
        yt = y_true_grid
        yp = y_pred_grid
        yt_dil = yt
        yp_dil = yp
    else:
        radius = max(1, int(round(buffer_m / pixel_size_m)))
        kernel = _disk(radius)
        yt_dil = binary_dilation(y_true_grid, structure=kernel)
        yp_dil = binary_dilation(y_pred_grid, structure=kernel)
        yt = y_true_grid
        yp = y_pred_grid

    # Restricción a píxeles válidos
    valid = valid_grid

    tp = int(((yp & yt_dil) & valid).sum())
    fp = int(((yp & ~yt_dil) & valid).sum())
    fn = int(((yt & ~yp_dil) & valid).sum())
    n  = int(valid.sum())
    tn = n - tp - fp - fn

    rec  = tp / max(tp + fn, 1)
    prec = tp / max(tp + fp, 1)
    f1   = 2 * tp / max(2 * tp + fp + fn, 1)
    acc  = (tp + tn) / max(n, 1)

    return {
        "buffer_m":    buffer_m,
        "buffer_label": "Estricto" if buffer_m == 0 else f"{buffer_m} m",
        "tp": tp, "fp": fp, "fn": fn, "tn": tn, "n": n,
        "recall":      rec,
        "precision":   prec,
        "f1":          f1,
        "accuracy":    acc,
    }


# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------

def plot_buffer_comparison(metrics: List[Dict], out_path: Path) -> None:
    if not HAS_MPL:
        return
    labels = [m["buffer_label"] for m in metrics]
    f1s    = [m["f1"]        for m in metrics]
    precs  = [m["precision"] for m in metrics]
    recs   = [m["recall"]    for m in metrics]
    accs   = [m["accuracy"]  for m in metrics]

    x = np.arange(len(labels))
    w = 0.20

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.bar(x - 1.5 * w, f1s,   w, label="F1",        color="#e63946")
    ax.bar(x - 0.5 * w, precs, w, label="Precision", color="#4c8bf5")
    ax.bar(x + 0.5 * w, recs,  w, label="Recall",    color="#2a9d8f")
    ax.bar(x + 1.5 * w, accs,  w, label="Accuracy",  color="#f4a261")

    for i, (f1, p, r, a) in enumerate(zip(f1s, precs, recs, accs)):
        ax.text(i - 1.5 * w, f1 + 0.01, f"{f1:.3f}", ha="center", fontsize=8)
        ax.text(i - 0.5 * w, p  + 0.01, f"{p:.3f}",  ha="center", fontsize=8)
        ax.text(i + 0.5 * w, r  + 0.01, f"{r:.3f}",  ha="center", fontsize=8)
        ax.text(i + 1.5 * w, a  + 0.01, f"{a:.3f}",  ha="center", fontsize=8)

    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylabel("Valor de la métrica")
    ax.set_ylim(0, 1.05)
    ax.set_title("Métricas del modelo v2 con tolerancia espacial (buffer)")
    ax.legend(loc="lower right", ncol=4)
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    parser = argparse.ArgumentParser(
        description="Análisis de tolerancia espacial (buffer) sobre predicciones OOF.")
    parser.add_argument("--threshold", type=float, default=0.614)
    parser.add_argument("--folds-dir", type=Path,
                        default=Path("models/folds_v2"))
    parser.add_argument("--dataset", type=Path,
                        default=Path("data/dataset/training_dataset_v2.parquet"))
    args = parser.parse_args()

    root = _repo_root()
    folds_dir = root / args.folds_dir
    parquet   = root / args.dataset
    ref_tif   = root / "data" / "labels" / "flood_mask_emsr773_clipped.tif"

    out_csv = root / "results" / "model" / "buffer_metrics_v2.csv"
    out_png = root / "results" / "diagnostics" / "model" / "buffer_metrics_comparison.png"
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    out_png.parent.mkdir(parents=True, exist_ok=True)

    # 1) Cargar dataset y OOF
    log.info("Cargando dataset: %s", parquet)
    df = pd.read_parquet(parquet)
    n = len(df)
    log.info("  Filas: %d", n)

    log.info("Cargando OOF predictions...")
    proba = load_oof_predictions(folds_dir, n)

    valid_mask = np.isfinite(proba)
    if not valid_mask.all():
        df = df.loc[valid_mask].reset_index(drop=True)
        proba = proba[valid_mask]

    y_true = df["flood_label"].values.astype("int8")
    y_pred = (proba >= args.threshold).astype("int8")

    log.info("Reconstruyendo grids 2D...")
    yt_grid, yp_grid, valid_grid = grids_from_dataframe(df, y_true, y_pred, ref_tif)
    log.info("  Grid: %s  válidos: %d  GT positivos: %d  Pred positivos: %d",
             yt_grid.shape, int(valid_grid.sum()),
             int(yt_grid.sum()), int(yp_grid.sum()))

    # 2) Métricas para cada buffer
    log.info("=" * 75)
    log.info("MÉTRICAS CON TOLERANCIA ESPACIAL")
    log.info("=" * 75)
    log.info("  %-10s  %8s  %9s  %7s  %8s  %10s  %10s  %10s",
             "Buffer", "F1", "Precision", "Recall", "Acc",
             "TP", "FP", "FN")
    log.info("-" * 75)

    rows = []
    for b in BUFFERS_M:
        log.info("  Calculando para buffer = %d m  (radio=%d px)...",
                 b, max(1, b // PIXEL_SIZE_M) if b > 0 else 0)
        m = metrics_with_buffer(yt_grid, yp_grid, valid_grid,
                                 buffer_m=b, pixel_size_m=PIXEL_SIZE_M)
        log.info("  %-10s  %.4f   %.4f    %.4f  %.4f   %10d  %10d  %10d",
                 m["buffer_label"], m["f1"], m["precision"],
                 m["recall"], m["accuracy"],
                 m["tp"], m["fp"], m["fn"])
        rows.append(m)

    log.info("=" * 75)

    # 3) Reducciones FP/FN
    strict = rows[0]
    log.info("REDUCCIONES vs estricto")
    log.info("  buffer_m  |  ΔFP (halo perimetral)  |  ΔFN (ruido raster)  |  TP_recover  |  FP_attribut")
    log.info("-" * 105)
    for m in rows[1:]:
        d_fp = strict["fp"] - m["fp"]
        d_fn = strict["fn"] - m["fn"]
        d_tp = m["tp"] - strict["tp"]
        # % de FP estructurales (atribuibles a halo)
        pct_fp_halo = 100.0 * d_fp / max(strict["fp"], 1)
        pct_fn_raster = 100.0 * d_fn / max(strict["fn"], 1)
        log.info("  %-9s |  %+10d (%5.1f%%)       |  %+10d (%5.1f%%)    |  %+10d  |  %5.1f%%",
                 m["buffer_label"], -d_fp, pct_fp_halo,
                 -d_fn, pct_fn_raster, d_tp, pct_fp_halo)

    log.info("=" * 75)

    # 4) CSV
    cols_csv = ["buffer_m", "buffer_label", "tp", "fp", "fn", "tn", "n",
                "recall", "precision", "f1", "accuracy"]
    df_out = pd.DataFrame(rows)[cols_csv]
    df_out.to_csv(out_csv, index=False, float_format="%.6f")
    log.info("CSV: %s", out_csv)

    # 5) Plot
    plot_buffer_comparison(rows, out_png)

    # 6) Resumen final
    log.info("=" * 75)
    log.info("RESUMEN buffer_analysis  —  Tiempo: %.1f s", time.time() - t0)
    log.info("  Threshold OOF       : %.3f", args.threshold)
    f1_strict   = strict["f1"]
    f1_30  = next(m for m in rows if m["buffer_m"] == 30)["f1"]
    f1_50  = next(m for m in rows if m["buffer_m"] == 50)["f1"]
    f1_100 = next(m for m in rows if m["buffer_m"] == 100)["f1"]
    log.info("  F1 estricto  -> 30m : %.4f -> %.4f  (Δ %+0.4f)", f1_strict, f1_30, f1_30 - f1_strict)
    log.info("  F1 estricto  -> 50m : %.4f -> %.4f  (Δ %+0.4f)", f1_strict, f1_50, f1_50 - f1_strict)
    log.info("  F1 estricto  -> 100m: %.4f -> %.4f  (Δ %+0.4f)", f1_strict, f1_100, f1_100 - f1_strict)
    log.info("=" * 75)


if __name__ == "__main__":
    main()
