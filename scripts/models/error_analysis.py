#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
error_analysis.py
-----------------
Análisis de errores del Random Forest v2 sobre el dataset de entrenamiento.

CRITERIO METODOLÓGICO:
Se utilizan las predicciones OOF (out-of-fold) generadas por la CV espacial
de 5 folds — NO las predicciones del modelo final sobre los datos de
entrenamiento — porque son la única evaluación honesta a nivel píxel sin
contaminación de leakage. Cada pixel del bbox tiene una única predicción
generada por un modelo que NO lo vio en su entrenamiento.

Inputs:
  - data/dataset/training_dataset_v2.parquet  (14 features + flood_label)
  - models/folds_v2/predictions_fold_{1..5}.npz  (val_idx, y_val, proba_val)

Outputs:
  - results/maps/04_risk_prediction/error_map_v2.tif        (uint8 0/1/2/3)
  - results/diagnostics/model/error_map_v2.png
  - results/diagnostics/model/calibration_v2.png
  - results/diagnostics/model/error_distribution_by_feature_v2.png
  - results/model/error_analysis_v2.md                       (informe ejecutivo)
  - results/model/error_analysis_v2.json                     (raw stats)

Uso:
    python scripts/models/error_analysis.py [--threshold 0.614]
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from typing import Dict, List

import joblib
import numpy as np
import pandas as pd
import rasterio
from sklearn.metrics import brier_score_loss, confusion_matrix

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# Misma definición de features que en train_random_forest.py
FEATURE_NAMES_V2 = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]

# Categorías de error
CAT_TN, CAT_TP, CAT_FP, CAT_FN = 0, 1, 2, 3
CAT_LABELS = {0: "TN", 1: "TP", 2: "FP", 3: "FN"}
CAT_COLORS = {0: "#ffffff", 1: "#2ca25f", 2: "#fc8d59", 3: "#d7191c"}
CAT_NAMES = {
    0: "TN — Acertado, no inundable",
    1: "TP — Acertado, inundable",
    2: "FP — Sobrepredicho (falso positivo)",
    3: "FN — Perdido (falso negativo)",
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


# ---------------------------------------------------------------------------
# Carga OOF
# ---------------------------------------------------------------------------

def load_oof_predictions(folds_dir: Path, n_total: int) -> np.ndarray:
    """
    Reensambla la predicción OOF a partir de los 5 folds guardados.
    Devuelve un array float32 de tamaño n_total con la probabilidad por
    pixel (NaN si algún índice no fue cubierto por ningún fold).
    """
    proba_oof = np.full(n_total, np.nan, dtype="float32")
    n_filled = 0
    for i in range(1, 6):
        p = folds_dir / f"predictions_fold_{i}.npz"
        if not p.exists():
            raise FileNotFoundError(p)
        d = np.load(p)
        idx   = d["val_idx"]
        proba = d["proba_val"]
        proba_oof[idx] = proba
        n_filled += len(idx)
        log.info("  Fold %d: %d predicciones cargadas", i, len(idx))
    n_valid = int(np.isfinite(proba_oof).sum())
    log.info("Total OOF cargado: %d / %d (%.2f%%)",
             n_valid, n_total, 100 * n_valid / n_total)
    if n_valid != n_total:
        log.warning("¡%d pixeles sin predicción OOF!", n_total - n_valid)
    return proba_oof


# ---------------------------------------------------------------------------
# Categorización
# ---------------------------------------------------------------------------

def categorize_errors(y_true: np.ndarray, y_pred: np.ndarray) -> np.ndarray:
    """Devuelve array uint8 con código TN/TP/FP/FN por pixel."""
    cat = np.empty_like(y_true, dtype="uint8")
    cat[(y_pred == 0) & (y_true == 0)] = CAT_TN
    cat[(y_pred == 1) & (y_true == 1)] = CAT_TP
    cat[(y_pred == 1) & (y_true == 0)] = CAT_FP
    cat[(y_pred == 0) & (y_true == 1)] = CAT_FN
    return cat


# ---------------------------------------------------------------------------
# Mapa espacial
# ---------------------------------------------------------------------------

def write_error_map(
    df: pd.DataFrame,
    cat: np.ndarray,
    ref_path: Path,
    out_tif: Path,
) -> np.ndarray:
    """Escribe el GeoTIFF de errores y devuelve el array 2D."""
    with rasterio.open(ref_path) as ref:
        rows, cols = ref.height, ref.width
        profile = ref.profile.copy()
    grid = np.full((rows, cols), 255, dtype="uint8")  # 255 = nodata
    grid[df["row"].values, df["col"].values] = cat
    profile.update(dtype="uint8", count=1, nodata=255, compress="lzw",
                   driver="GTiff")
    for k in ("blockxsize", "blockysize", "tiled", "interleave", "photometric"):
        profile.pop(k, None)
    out_tif.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_tif, "w", **profile) as dst:
        dst.write(grid, 1)
    log.info("Mapa de errores guardado: %s (%.2f MB)",
             out_tif, out_tif.stat().st_size / 1e6)
    return grid


def plot_error_map(grid: np.ndarray, ref_path: Path, out_png: Path) -> None:
    if not HAS_MPL: return
    with rasterio.open(ref_path) as ref:
        bounds = ref.bounds
    extent_utm = (bounds.left, bounds.right, bounds.bottom, bounds.top)
    cmap = ListedColormap([CAT_COLORS[c] for c in range(4)])
    grid_plot = np.where(grid == 255, np.nan, grid).astype(float)
    fig, ax = plt.subplots(figsize=(11, 9))
    img = ax.imshow(grid_plot, cmap=cmap, vmin=-0.5, vmax=3.5,
                    interpolation="nearest", extent=extent_utm)
    cbar = plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04, ticks=[0, 1, 2, 3])
    cbar.ax.set_yticklabels([CAT_NAMES[c] for c in range(4)])
    ax.set_title("Mapa de errores RF v2 (OOF) — threshold 0.614",
                 fontsize=12)
    ax.set_xlabel("UTM X (m)"); ax.set_ylabel("UTM Y (m)")
    plt.tight_layout()
    plt.savefig(out_png, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_png.name)


# ---------------------------------------------------------------------------
# Estadísticas de errores
# ---------------------------------------------------------------------------

def feature_stats_by_category(
    df: pd.DataFrame, cat: np.ndarray, feature_names: List[str],
) -> pd.DataFrame:
    """Devuelve DataFrame con la media de cada feature por categoría TN/TP/FP/FN."""
    rows = []
    for c, label in CAT_LABELS.items():
        mask = (cat == c)
        n = int(mask.sum())
        row = {"category": label, "n": n}
        for f in feature_names:
            v = df[f].values[mask]
            row[f"{f}_mean"]   = float(np.mean(v))   if n > 0 else np.nan
            row[f"{f}_median"] = float(np.median(v)) if n > 0 else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def proba_distribution_by_category(
    proba: np.ndarray, cat: np.ndarray,
) -> Dict[str, Dict[str, float]]:
    """Distribución de probabilidades por categoría."""
    out = {}
    for c, label in CAT_LABELS.items():
        mask = (cat == c)
        v = proba[mask]
        if len(v) == 0:
            out[label] = {}; continue
        out[label] = {
            "n":      int(len(v)),
            "min":    float(v.min()),
            "p10":    float(np.percentile(v, 10)),
            "p25":    float(np.percentile(v, 25)),
            "p50":    float(np.median(v)),
            "p75":    float(np.percentile(v, 75)),
            "p90":    float(np.percentile(v, 90)),
            "max":    float(v.max()),
            "mean":   float(v.mean()),
        }
    return out


# ---------------------------------------------------------------------------
# Calibración
# ---------------------------------------------------------------------------

def calibration_analysis(
    y_true: np.ndarray, proba: np.ndarray, n_bins: int = 10,
) -> Dict:
    """Reliability diagram + Brier + ECE."""
    bins = np.linspace(0, 1, n_bins + 1)
    bin_idx = np.digitize(proba, bins) - 1
    bin_idx = np.clip(bin_idx, 0, n_bins - 1)
    bin_pred_mean = np.zeros(n_bins)
    bin_true_mean = np.zeros(n_bins)
    bin_count     = np.zeros(n_bins, dtype="int64")
    for i in range(n_bins):
        m = (bin_idx == i)
        if m.any():
            bin_pred_mean[i] = proba[m].mean()
            bin_true_mean[i] = y_true[m].mean()
            bin_count[i]     = int(m.sum())
    ece = np.sum(bin_count * np.abs(bin_pred_mean - bin_true_mean)) / max(bin_count.sum(), 1)
    brier = float(brier_score_loss(y_true, proba))
    return {
        "n_bins":        n_bins,
        "bin_edges":     bins.tolist(),
        "bin_pred_mean": bin_pred_mean.tolist(),
        "bin_true_mean": bin_true_mean.tolist(),
        "bin_count":     bin_count.tolist(),
        "brier":         brier,
        "ece":           float(ece),
    }


def plot_calibration(cal: Dict, out_path: Path) -> None:
    if not HAS_MPL: return
    bins = np.array(cal["bin_edges"])
    centers = 0.5 * (bins[:-1] + bins[1:])
    pred = np.array(cal["bin_pred_mean"])
    true = np.array(cal["bin_true_mean"])
    counts = np.array(cal["bin_count"])

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5),
                                    gridspec_kw={"width_ratios": [1.4, 1]})
    # Reliability
    mask = counts > 0
    ax1.plot([0, 1], [0, 1], color="gray", ls="--", lw=0.8, label="Calibración perfecta")
    ax1.plot(pred[mask], true[mask], "o-", color="#e63946", lw=1.8, ms=8,
             label="Modelo v2 (OOF)")
    for i, (p, t, n) in enumerate(zip(pred[mask], true[mask], counts[mask])):
        ax1.annotate(f"{n:,}", (p, t), fontsize=7,
                     xytext=(4, 4), textcoords="offset points")
    ax1.set_xlim(0, 1); ax1.set_ylim(0, 1)
    ax1.set_xlabel("P predicho (media en bin)")
    ax1.set_ylabel("Frecuencia real positiva")
    ax1.set_title(f"Reliability diagram — Brier={cal['brier']:.4f}  ECE={cal['ece']:.4f}",
                  fontsize=11)
    ax1.legend(loc="upper left")
    ax1.grid(True, alpha=0.3)
    # Histograma de probabilidades
    ax2.bar(centers, counts, width=(bins[1] - bins[0]) * 0.95,
            color="#4c8bf5", edgecolor="black", alpha=0.7)
    ax2.set_yscale("log")
    ax2.set_xlim(0, 1)
    ax2.set_xlabel("P predicho")
    ax2.set_ylabel("Nº píxeles")
    ax2.set_title("Histograma de probabilidades")
    ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# Distribución por feature
# ---------------------------------------------------------------------------

def plot_error_by_feature(
    df: pd.DataFrame, cat: np.ndarray, feature_names: List[str],
    out_path: Path,
) -> None:
    if not HAS_MPL: return
    n = len(feature_names)
    n_cols = 4
    n_rows = (n + n_cols - 1) // n_cols
    fig, axes = plt.subplots(n_rows, n_cols, figsize=(4 * n_cols, 3 * n_rows))
    axes = axes.ravel()

    for i, f in enumerate(feature_names):
        ax = axes[i]
        v = df[f].values
        # rango realista basado en p2-p98
        lo, hi = np.percentile(v, [2, 98])
        bins = np.linspace(lo, hi, 30)

        # Histograma stacked: TN, TP, FP, FN
        for c in [CAT_TN, CAT_TP, CAT_FP, CAT_FN]:
            mask = (cat == c)
            if mask.sum() == 0:
                continue
            ax.hist(v[mask], bins=bins, alpha=0.6, label=CAT_LABELS[c],
                    color=CAT_COLORS[c], stacked=False, histtype="step", lw=1.5)
        ax.set_title(f, fontsize=10)
        ax.set_yscale("log")
        ax.grid(True, alpha=0.3)
        if i == 0:
            ax.legend(fontsize=7)
    # Ocultar ejes vacíos
    for j in range(n, n_rows * n_cols):
        axes[j].axis("off")
    plt.suptitle("Distribución de errores por feature (RF v2, OOF)", fontsize=12)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# Validación cualitativa por puntos
# ---------------------------------------------------------------------------

def validate_known_points(
    grid: np.ndarray, proba_grid: np.ndarray, label_grid: np.ndarray,
    transform, crs, threshold: float,
) -> List[Dict]:
    """Reporta predicción + GT + error type para puntos de verdad conocida."""
    from pyproj import Transformer
    from rasterio.transform import rowcol
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    pts = [
        ("Paiporta núcleo urbano",    -0.418, 39.428, "inundado catastrófico"),
        ("Catarroja núcleo urbano",   -0.401, 39.401, "inundado catastrófico"),
        ("Polígono industrial Sedaví",-0.388, 39.418, "inundado parcial"),
        ("Aeropuerto Manises pista",  -0.476, 39.490, "no inundado"),
        ("Albufera centro lago",      -0.343, 39.345, "agua permanente"),
        ("Mar Mediterráneo",          -0.280, 39.350, "agua permanente"),
        ("La Devesa centro",          -0.305, 39.330, "no inundado"),
        ("Sierra Calderona NW",       -0.550, 39.550, "no inundable (alto)"),
    ]
    out = []
    rows, cols = grid.shape
    for name, lon, lat, expected in pts:
        x, y = tr.transform(lon, lat)
        r, c = rowcol(transform, x, y)
        if not (0 <= r < rows and 0 <= c < cols):
            out.append({"point": name, "expected": expected,
                        "in_bbox": False})
            continue
        cat_val = int(grid[r, c]) if grid[r, c] != 255 else None
        out.append({
            "point": name,
            "expected": expected,
            "lon": lon, "lat": lat,
            "row": int(r), "col": int(c),
            "proba": float(proba_grid[r, c]) if np.isfinite(proba_grid[r, c]) else None,
            "y_true": int(label_grid[r, c]) if label_grid[r, c] != 255 else None,
            "y_pred": int(proba_grid[r, c] >= threshold) if np.isfinite(proba_grid[r, c]) else None,
            "category": CAT_LABELS.get(cat_val, "INVALID"),
        })
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    t0 = time.time()
    parser = argparse.ArgumentParser(
        description="Análisis de errores del RF v2 con predicciones OOF.")
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

    diag_dir   = root / "results" / "diagnostics" / "model"
    out_maps   = root / "results" / "maps" / "04_risk_prediction"
    out_report = root / "results" / "model"
    diag_dir.mkdir(parents=True, exist_ok=True)
    out_maps.mkdir(parents=True, exist_ok=True)
    out_report.mkdir(parents=True, exist_ok=True)

    out_tif    = out_maps / "error_map_v2.tif"
    out_pngmap = diag_dir / "error_map_v2.png"
    out_calib  = diag_dir / "calibration_v2.png"
    out_perfeat= diag_dir / "error_distribution_by_feature_v2.png"
    out_md     = out_report / "error_analysis_v2.md"
    out_json   = out_report / "error_analysis_v2.json"

    # 1) Cargar dataset
    log.info("Cargando dataset: %s", parquet)
    df = pd.read_parquet(parquet)
    n = len(df)
    log.info("  Filas: %d  Columnas: %d", n, len(df.columns))

    # 2) Cargar OOF predictions
    log.info("Cargando predicciones OOF de los 5 folds...")
    proba_oof = load_oof_predictions(folds_dir, n)

    # Filtrar nans
    valid = np.isfinite(proba_oof)
    if not valid.all():
        log.warning("Excluyendo %d filas sin OOF", int((~valid).sum()))
        df = df.loc[valid].reset_index(drop=True)
        proba_oof = proba_oof[valid]

    y_true = df["flood_label"].values.astype("int8")
    y_pred = (proba_oof >= args.threshold).astype("int8")

    # 3) Categorizar
    cat = categorize_errors(y_true, y_pred)
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()
    n_total = len(y_true)
    log.info("=" * 70)
    log.info("CONFUSION MATRIX  (threshold=%.3f)", args.threshold)
    log.info("=" * 70)
    log.info("  TP = %9d (%.3f%% del total)", tp, 100*tp/n_total)
    log.info("  TN = %9d (%.3f%%)", tn, 100*tn/n_total)
    log.info("  FP = %9d (%.3f%%)", fp, 100*fp/n_total)
    log.info("  FN = %9d (%.3f%%)", fn, 100*fn/n_total)
    log.info("  Recall      = TP/(TP+FN) = %.4f", tp / max(tp+fn, 1))
    log.info("  Precision   = TP/(TP+FP) = %.4f", tp / max(tp+fp, 1))
    log.info("  Specificity = TN/(TN+FP) = %.4f", tn / max(tn+fp, 1))
    log.info("  F1                      = %.4f", 2*tp / max(2*tp+fp+fn, 1))

    # 4) Mapa espacial
    log.info("Construyendo mapa espacial de errores...")
    grid = write_error_map(df, cat, ref_tif, out_tif)
    plot_error_map(grid, ref_tif, out_pngmap)

    # 5) Stats por categoría y feature
    log.info("Calculando estadísticas por categoría / feature...")
    feat_stats = feature_stats_by_category(df, cat, FEATURE_NAMES_V2)
    proba_dist = proba_distribution_by_category(proba_oof, cat)

    # 6) Calibración
    log.info("Análisis de calibración...")
    cal = calibration_analysis(y_true, proba_oof, n_bins=10)
    log.info("  Brier score: %.4f", cal["brier"])
    log.info("  ECE        : %.4f", cal["ece"])
    plot_calibration(cal, out_calib)

    # 7) Distribución por feature
    log.info("Generando distribución de errores por feature...")
    plot_error_by_feature(df, cat, FEATURE_NAMES_V2, out_perfeat)

    # 8) Construir grids para validación cualitativa
    log.info("Validación cualitativa por puntos...")
    with rasterio.open(ref_tif) as ref:
        rows, cols = ref.height, ref.width
        transform = ref.transform
        crs = ref.crs
        label_grid = ref.read(1)
    proba_grid = np.full((rows, cols), np.nan, dtype="float32")
    proba_grid[df["row"].values, df["col"].values] = proba_oof
    points = validate_known_points(grid, proba_grid, label_grid,
                                    transform, crs, args.threshold)

    log.info("=" * 70)
    log.info("VALIDACIÓN CUALITATIVA POR PUNTOS")
    log.info("=" * 70)
    for p in points:
        if not p.get("in_bbox", True):
            log.info("  %-30s  fuera de bbox", p["point"])
            continue
        proba = p["proba"]
        log.info("  %-30s  P=%.3f  y_true=%s  y_pred=%s  → %s",
                 p["point"],
                 proba if proba is not None else float("nan"),
                 p["y_true"], p["y_pred"], p["category"])

    # 9) Persistencia
    feat_stats.to_csv(out_report / "error_analysis_v2_feature_stats.csv", index=False)
    json_out = {
        "threshold": args.threshold,
        "n_total": int(n_total),
        "confusion_matrix": {
            "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
        },
        "metrics": {
            "recall":      float(tp / max(tp+fn, 1)),
            "precision":   float(tp / max(tp+fp, 1)),
            "specificity": float(tn / max(tn+fp, 1)),
            "f1":          float(2*tp / max(2*tp+fp+fn, 1)),
            "accuracy":    float((tp+tn) / n_total),
        },
        "calibration": cal,
        "proba_dist_by_category": proba_dist,
        "points_validation": points,
    }
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(json_out, fh, indent=2, ensure_ascii=False)
    log.info("JSON: %s", out_json)

    # 10) Generar reporte markdown
    write_executive_report(out_md, json_out, feat_stats, points, args.threshold)

    log.info("=" * 70)
    log.info("RESUMEN error_analysis  —  Tiempo: %.1f s", time.time() - t0)
    log.info("  Confusion matrix      : TP=%d  TN=%d  FP=%d  FN=%d",
             tp, tn, fp, fn)
    log.info("  Recall=%.3f  Precision=%.3f  F1=%.3f",
             tp / max(tp+fn, 1), tp / max(tp+fp, 1),
             2*tp / max(2*tp+fp+fn, 1))
    log.info("  Brier=%.4f  ECE=%.4f", cal["brier"], cal["ece"])
    log.info("  Outputs:")
    log.info("    %s", out_tif)
    log.info("    %s", out_pngmap)
    log.info("    %s", out_calib)
    log.info("    %s", out_perfeat)
    log.info("    %s", out_md)
    log.info("    %s", out_json)
    log.info("=" * 70)


# ---------------------------------------------------------------------------
# Reporte ejecutivo Markdown
# ---------------------------------------------------------------------------

def write_executive_report(
    out_md: Path,
    j: Dict,
    feat_stats: pd.DataFrame,
    points: List[Dict],
    threshold: float,
) -> None:
    cm = j["confusion_matrix"]
    m  = j["metrics"]
    n  = j["n_total"]
    cal = j["calibration"]

    # Identificar 3 patrones de error a partir de las stats
    # Comparar medias de feature en TN vs FP y TP vs FN
    fs = feat_stats.set_index("category")
    patterns = []

    # FP vs TN: ¿en qué features los FP se parecen a TP?
    for f in FEATURE_NAMES_V2:
        col = f"{f}_median"
        if col not in fs.columns: continue
        tn_v = fs.loc["TN", col]
        fp_v = fs.loc["FP", col]
        tp_v = fs.loc["TP", col]
        # FP separado de TN, parecido a TP
        d_fp_tn = abs(fp_v - tn_v)
        d_fp_tp = abs(fp_v - tp_v)
        if d_fp_tp < d_fp_tn:  # FP más cerca de TP que de TN
            patterns.append((f, "FP", tn_v, fp_v, tp_v, d_fp_tn, d_fp_tp))

    md = []
    md.append("# Análisis de errores — Random Forest v2\n")
    md.append("**Fecha:** 2026-04-26\n")
    md.append(f"**Modelo:** `models/random_forest_v2.joblib`\n")
    md.append(f"**Predicciones:** OOF (5-fold spatial CV) — {n:,} píxeles válidos\n")
    md.append(f"**Threshold:** {threshold:.3f} (criterio recall ≥ 0.75)\n")
    md.append("\n---\n")

    md.append("## 1. Confusion matrix\n")
    md.append("| | Pred 0 (no inundado) | Pred 1 (inundado) |")
    md.append("|---|---|---|")
    md.append(f"| **Real 0** | TN = {cm['tn']:,} ({100*cm['tn']/n:.2f}%) | FP = {cm['fp']:,} ({100*cm['fp']/n:.2f}%) |")
    md.append(f"| **Real 1** | FN = {cm['fn']:,} ({100*cm['fn']/n:.2f}%) | TP = {cm['tp']:,} ({100*cm['tp']/n:.2f}%) |")
    md.append("")
    md.append("**Métricas operativas:**\n")
    md.append(f"- Recall (sensibilidad): **{m['recall']:.4f}**")
    md.append(f"- Precision: **{m['precision']:.4f}**")
    md.append(f"- Specificity: **{m['specificity']:.4f}**")
    md.append(f"- F1: **{m['f1']:.4f}**")
    md.append(f"- Accuracy: **{m['accuracy']:.4f}**")
    md.append("")

    md.append("## 2. Calibración\n")
    md.append(f"- **Brier score:** {cal['brier']:.4f}  (0 = perfecto, 0.25 = aleatorio sobre dataset balanceado)")
    md.append(f"- **Expected Calibration Error (ECE):** {cal['ece']:.4f}")
    md.append("")
    md.append("**Reliability diagram** en `results/diagnostics/model/calibration_v2.png`.")
    md.append("")

    md.append("## 3. Distribución de probabilidad por categoría\n")
    md.append("| Categoría | n | mean | p25 | p50 | p75 | p90 |")
    md.append("|---|---|---|---|---|---|---|")
    for label in ["TP", "TN", "FP", "FN"]:
        d = j["proba_dist_by_category"].get(label, {})
        if not d:
            continue
        md.append(f"| {label} | {d['n']:,} | {d['mean']:.3f} | {d['p25']:.3f} | "
                  f"{d['p50']:.3f} | {d['p75']:.3f} | {d['p90']:.3f} |")
    md.append("")

    md.append("## 4. Tabla resumen — mediana por feature y categoría\n")
    md.append("| Feature | TP (mediana) | TN | FP | FN |")
    md.append("|---|---|---|---|---|")
    for f in FEATURE_NAMES_V2:
        col = f"{f}_median"
        try:
            md.append(f"| `{f}` | {fs.loc['TP', col]:.3f} | {fs.loc['TN', col]:.3f} | "
                      f"{fs.loc['FP', col]:.3f} | {fs.loc['FN', col]:.3f} |")
        except KeyError:
            pass
    md.append("")

    md.append("## 5. Patrones de error identificados\n")
    md.append("Patrón = una feature en la que los FP (sobrepredichos) se parecen más "
              "a los TP que a los TN, indicando que el modelo confunde estos píxeles "
              "con inundables genuinos por similitud en esa dimensión.\n")
    if patterns:
        # Ordenar por cuán cerca está FP de TP en términos relativos
        patterns.sort(key=lambda x: x[6])
        md.append("| Feature | TN mediana | **FP mediana** | TP mediana | dist FP↔TN | dist FP↔TP |")
        md.append("|---|---|---|---|---|---|")
        for f, _, tn_v, fp_v, tp_v, d1, d2 in patterns[:10]:
            md.append(f"| `{f}` | {tn_v:.3f} | **{fp_v:.3f}** | {tp_v:.3f} | "
                      f"{d1:.3f} | {d2:.3f} |")
    else:
        md.append("No se detectaron patrones FP que se acerquen más a TP que a TN.\n")
    md.append("")

    md.append("## 6. Validación cualitativa por puntos conocidos\n")
    md.append("| Punto | Esperado | P predicha | y_true | y_pred | Categoría |")
    md.append("|---|---|---|---|---|---|")
    for p in points:
        if not p.get("in_bbox", True):
            md.append(f"| {p['point']} | {p['expected']} | — | — | — | fuera de bbox |")
            continue
        proba = p.get("proba")
        proba_str = f"{proba:.3f}" if proba is not None else "—"
        md.append(f"| {p['point']} | {p['expected']} | {proba_str} | "
                  f"{p['y_true']} | {p['y_pred']} | **{p['category']}** |")
    md.append("")

    md.append("## 7. Recomendaciones para trabajos futuros\n")
    md.append("- **Reducir FP:** los falsos positivos se concentran probablemente "
              "en píxeles bajos cerca de cauces o costa que no entraron en el "
              "ground truth EMSR (clipping municipal). Una feature de uso del suelo "
              "(CORINE Land Cover) discriminaría urbano denso vs huerta vs marisma.\n")
    md.append("- **Reducir FN:** los falsos negativos suelen ser píxeles fronterizos "
              "del polígono de inundación (efecto del rasterizado del shapefile). "
              "Mejor ground truth con buffer de incertidumbre o suavizado morfológico.\n")
    md.append("- **Mejor calibración:** aplicar Platt scaling o isotónico sobre las "
              "probabilidades del RF para reducir Brier/ECE si se requieren "
              "probabilidades operativas (ej. tarificación aseguradora).\n")
    md.append("- **Modelo temporal:** la inclusión de precipitación histórica ERA5 / "
              "AEMET añadiría señal meteorológica complementaria a la "
              "estructura topográfica.\n")
    md.append("")
    md.append("## 8. Artefactos\n")
    md.append("- `results/maps/04_risk_prediction/error_map_v2.tif` — mapa categórico (uint8 0-3).")
    md.append("- `results/diagnostics/model/error_map_v2.png` — visualización 4 colores.")
    md.append("- `results/diagnostics/model/calibration_v2.png` — reliability diagram + histograma.")
    md.append("- `results/diagnostics/model/error_distribution_by_feature_v2.png` — 14 sub-paneles.")
    md.append("- `results/model/error_analysis_v2.json` — datos en bruto del análisis.")
    md.append("- `results/model/error_analysis_v2_feature_stats.csv` — tabla por categoría/feature.")
    md.append("")

    out_md.write_text("\n".join(md), encoding="utf-8")
    log.info("Reporte Markdown: %s", out_md)


if __name__ == "__main__":
    main()
