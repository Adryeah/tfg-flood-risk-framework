#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
threshold_tuning.py
-------------------
Recalibra el threshold de decisión del Random Forest a partir de las
probabilidades de cada uno de los 5 folds de la CV espacial.

El RF entrenado con class_weight='balanced' produce probabilidades bien
calibradas para discriminar (AUC alto, recall alto), pero el threshold
0.5 estándar produce F1 bajo cuando hay desbalance fuerte. Este script
explora 100 thresholds entre 0.05 y 0.95 y encuentra el óptimo bajo tres
criterios distintos.

Inputs:
  - data/dataset/training_dataset.parquet  (para reconstruir splits y X)
  - models/folds/{tag}/rf_fold_{i}.joblib   (modelos por fold)
    Nota: si existen models/folds/{tag}/predictions_fold_{i}.npz, se
    usan las predicciones cacheadas y no se recargan los modelos.

Salidas:
  - results/diagnostics/model/threshold_analysis.png
  - results/model/threshold_tuning_{tag}.json

Uso:
    python scripts/models/threshold_tuning.py [--folds-dir DIR] [--tag NAME]
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (confusion_matrix, f1_score,
                              precision_score, recall_score)
from sklearn.model_selection import GroupKFold

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

# Mismas constantes que train_random_forest.py
FEATURE_NAMES = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
]
BLOCK_SIZE_PIXELS = 100
N_THRESHOLDS = 100
THRESH_MIN = 0.05
THRESH_MAX = 0.95
RECALL_TARGET = 0.75


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _assign_blocks(rows, cols, block_size, n_cols_total):
    n_col_blocks = int(np.ceil(n_cols_total / block_size))
    return ((rows // block_size) * n_col_blocks + (cols // block_size)).astype("int32")


# ---------------------------------------------------------------------------
# Reconstrucción de splits + predicciones
# ---------------------------------------------------------------------------

def _load_predictions_or_predict(
    folds_dir: Path,
    parquet_path: Path,
) -> List[Tuple[np.ndarray, np.ndarray]]:
    """
    Devuelve lista [(y_val, proba_val), ...] para cada fold.

    Si existen .npz cacheados los usa. Si no, reconstruye los splits y
    aplica el modelo de cada fold sobre su val_idx.
    """
    cached = sorted(folds_dir.glob("predictions_fold_*.npz"))
    if len(cached) == 5:
        log.info("Predicciones cacheadas encontradas en %s", folds_dir)
        out = []
        for p in cached:
            d = np.load(p)
            out.append((d["y_val"], d["proba_val"]))
            log.info("  %s  n=%d  pos=%d (%.2f%%)",
                     p.name, len(d["y_val"]),
                     int(d["y_val"].sum()),
                     100.0 * d["y_val"].sum() / len(d["y_val"]))
        return out

    log.info("Sin cache. Reconstruyendo splits y prediciendo desde modelos...")
    log.info("Cargando dataset desde %s", parquet_path)
    df = pd.read_parquet(parquet_path)
    rows = df["row"].values.astype("int32")
    cols = df["col"].values.astype("int32")
    y    = df["flood_label"].values.astype("int8")
    X    = df[FEATURE_NAMES].values.astype("float32")
    n_cols_total = int(cols.max() + 1)
    groups = _assign_blocks(rows, cols, BLOCK_SIZE_PIXELS, n_cols_total)
    del df, rows, cols

    out: List[Tuple[np.ndarray, np.ndarray]] = []
    gkf = GroupKFold(n_splits=5)
    for fold_idx, (_, val_idx) in enumerate(gkf.split(X, y, groups=groups)):
        model_path = folds_dir / f"rf_fold_{fold_idx + 1}.joblib"
        if not model_path.exists():
            raise FileNotFoundError(model_path)
        log.info("  Fold %d/5: cargando %s y prediciendo n=%d...",
                 fold_idx + 1, model_path.name, len(val_idx))
        rf = joblib.load(model_path)
        proba = rf.predict_proba(X[val_idx])[:, 1].astype("float32")
        out.append((y[val_idx].copy(), proba))
        del rf
    return out


# ---------------------------------------------------------------------------
# Sweep de thresholds
# ---------------------------------------------------------------------------

def _metrics_at_thresholds(
    fold_preds: List[Tuple[np.ndarray, np.ndarray]],
    thresholds: np.ndarray,
) -> Dict[str, np.ndarray]:
    """
    Para cada threshold, calcula métricas medias entre folds.

    Devuelve dict con shape (n_thresholds,) por métrica:
        f1, precision, recall, specificity
    Y stds (folds_std_*) con la dispersión entre folds.
    """
    n_t = len(thresholds)
    n_f = len(fold_preds)
    f1_mat   = np.zeros((n_f, n_t))
    prec_mat = np.zeros((n_f, n_t))
    rec_mat  = np.zeros((n_f, n_t))
    spec_mat = np.zeros((n_f, n_t))

    for fi, (y_val, proba) in enumerate(fold_preds):
        n_pos = int(y_val.sum())
        n_neg = int(len(y_val) - n_pos)
        for ti, t in enumerate(thresholds):
            pred = (proba >= t).astype("int8")
            tp = int(((pred == 1) & (y_val == 1)).sum())
            fp = int(((pred == 1) & (y_val == 0)).sum())
            fn = int(((pred == 0) & (y_val == 1)).sum())
            tn = int(((pred == 0) & (y_val == 0)).sum())
            prec_mat[fi, ti] = tp / max(tp + fp, 1)
            rec_mat[fi,  ti] = tp / max(tp + fn, 1)
            spec_mat[fi, ti] = tn / max(tn + fp, 1)
            denom = (2 * tp + fp + fn)
            f1_mat[fi,   ti] = (2 * tp / denom) if denom > 0 else 0.0

    return {
        "f1":            f1_mat.mean(axis=0),
        "f1_std":        f1_mat.std(axis=0),
        "precision":     prec_mat.mean(axis=0),
        "precision_std": prec_mat.std(axis=0),
        "recall":        rec_mat.mean(axis=0),
        "recall_std":    rec_mat.std(axis=0),
        "specificity":   spec_mat.mean(axis=0),
        "specificity_std": spec_mat.std(axis=0),
    }


def _find_optimal_thresholds(
    thresholds: np.ndarray,
    metrics: Dict[str, np.ndarray],
    recall_target: float = RECALL_TARGET,
) -> Dict[str, dict]:
    """
    Aplica los 3 criterios de selección. Devuelve dict con threshold + métricas.
    """
    f1   = metrics["f1"]
    prec = metrics["precision"]
    rec  = metrics["recall"]
    spec = metrics["specificity"]

    # 1) max F1
    i_f1 = int(np.argmax(f1))

    # 2) min |precision - recall|, excluyendo casos degenerados (ambos 0)
    diff = np.abs(prec - rec)
    valid = (prec > 0.01) & (rec > 0.01)
    if valid.any():
        diff_masked = np.where(valid, diff, np.inf)
        i_bal = int(np.argmin(diff_masked))
    else:
        i_bal = int(np.argmin(diff))

    # 3) threshold más alto que aún cumple recall >= target
    above = np.where(rec >= recall_target)[0]
    if len(above) == 0:
        log.warning("Ningún threshold alcanza recall >= %.2f. Tomando el de menor threshold.",
                    recall_target)
        i_rec = 0
    else:
        i_rec = int(above.max())

    def _pack(idx: int) -> dict:
        return {
            "threshold":   float(thresholds[idx]),
            "f1":          float(f1[idx]),
            "precision":   float(prec[idx]),
            "recall":      float(rec[idx]),
            "specificity": float(spec[idx]),
            "f1_std":      float(metrics["f1_std"][idx]),
        }

    return {
        "max_f1":         _pack(i_f1),
        "balanced":       _pack(i_bal),
        "recall_target":  _pack(i_rec),
    }


# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------

def _plot_threshold_curves(
    thresholds: np.ndarray,
    metrics: Dict[str, np.ndarray],
    candidates: Dict[str, dict],
    out_path: Path,
    title_suffix: str = "",
) -> None:
    if not HAS_MPL:
        return
    fig, ax = plt.subplots(figsize=(11, 7))
    metric_styles = [
        ("f1",          "F1",          "#e63946", 2.5),
        ("precision",   "Precision",   "#4c8bf5", 1.6),
        ("recall",      "Recall",      "#2a9d8f", 1.6),
        ("specificity", "Specificity", "#f4a261", 1.4),
    ]
    for key, lab, color, lw in metric_styles:
        ax.plot(thresholds, metrics[key], color=color, lw=lw, label=lab)
        # Banda ±1 std entre folds
        std = metrics.get(key + "_std", None)
        if std is not None:
            ax.fill_between(thresholds, metrics[key] - std, metrics[key] + std,
                            color=color, alpha=0.12)

    cand_styles = [
        ("max_f1",        "max F1",         "#e63946"),
        ("balanced",      "|P-R| min",      "#9b5de5"),
        ("recall_target", f"recall>={RECALL_TARGET:.2f}", "#2a9d8f"),
    ]
    ymax = 1.02
    for key, lab, color in cand_styles:
        c = candidates[key]
        ax.axvline(c["threshold"], color=color, ls="--", lw=1.2, alpha=0.85)
        ax.text(
            c["threshold"], ymax - 0.02 * (1 + cand_styles.index((key, lab, color))),
            f" {lab}: t={c['threshold']:.2f}\n  F1={c['f1']:.3f}  P={c['precision']:.3f}  R={c['recall']:.3f}",
            color=color, fontsize=9, va="top", ha="left",
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, alpha=0.9),
        )

    ax.set_xlim(THRESH_MIN, THRESH_MAX)
    ax.set_ylim(0, ymax)
    ax.set_xlabel("Threshold de decisión sobre P(inundado)")
    ax.set_ylabel("Valor de la métrica")
    ax.set_title(f"Análisis de threshold — CV espacial 5 folds{title_suffix}",
                 fontsize=12)
    ax.legend(loc="center right", fontsize=10)
    ax.grid(True, alpha=0.3)
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
        description="Tunea el threshold del RF a partir de las predicciones de los 5 folds."
    )
    parser.add_argument("--folds-dir", type=Path,
                        default=Path("models/folds"),
                        help="Directorio con rf_fold_{i}.joblib (relativo a la raíz del repo).")
    parser.add_argument("--tag", type=str, default="default",
                        help="Etiqueta para el JSON de salida (ej: 'quick', 'full').")
    parser.add_argument("--out-png", type=Path, default=None,
                        help="Override path del PNG (default: results/diagnostics/model/threshold_analysis_{tag}.png).")
    args = parser.parse_args()

    root = _repo_root()
    folds_dir = root / args.folds_dir if not args.folds_dir.is_absolute() else args.folds_dir
    parquet   = root / "data" / "dataset" / "training_dataset.parquet"
    diag_dir  = root / "results" / "diagnostics" / "model"
    res_dir   = root / "results" / "model"
    diag_dir.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)

    out_png  = args.out_png or (diag_dir / f"threshold_analysis_{args.tag}.png")
    out_json = res_dir / f"threshold_tuning_{args.tag}.json"

    log.info("Folds dir: %s", folds_dir)
    log.info("Tag      : %s", args.tag)

    # 1) Recopilar (y_val, proba_val) por fold
    fold_preds = _load_predictions_or_predict(folds_dir, parquet)

    # 2) Sweep
    thresholds = np.linspace(THRESH_MIN, THRESH_MAX, N_THRESHOLDS)
    log.info("Calculando métricas en %d thresholds entre %.2f y %.2f...",
             len(thresholds), THRESH_MIN, THRESH_MAX)
    metrics = _metrics_at_thresholds(fold_preds, thresholds)

    # 3) Thresholds candidatos
    candidates = _find_optimal_thresholds(thresholds, metrics, RECALL_TARGET)

    log.info("=" * 75)
    log.info("THRESHOLDS ÓPTIMOS — CV espacial (media 5 folds)")
    log.info("=" * 75)
    log.info("  %-22s  %-9s  %-9s  %-9s  %-9s  %-11s",
             "Criterio", "threshold", "F1", "Precision", "Recall", "Specificity")
    crit_names = {
        "max_f1":         "1. max F1",
        "balanced":       "2. |P-R| mínima (balanced)",
        "recall_target":  f"3. recall ≥ {RECALL_TARGET:.2f} (recall_75)",
    }
    for key, label in crit_names.items():
        c = candidates[key]
        log.info("  %-26s  %.3f      %.4f     %.4f     %.4f     %.4f",
                 label, c["threshold"], c["f1"], c["precision"],
                 c["recall"], c["specificity"])
    log.info("=" * 75)

    # 4) Plot
    _plot_threshold_curves(thresholds, metrics, candidates, out_png,
                           title_suffix=f"  ({args.tag})")

    # 5) JSON
    out = {
        "tag":          args.tag,
        "folds_dir":    str(folds_dir),
        "n_folds":      len(fold_preds),
        "n_thresholds": len(thresholds),
        "threshold_range": [THRESH_MIN, THRESH_MAX],
        "candidates":   candidates,
        "curve":        {
            "thresholds":   thresholds.tolist(),
            "f1":           metrics["f1"].tolist(),
            "precision":    metrics["precision"].tolist(),
            "recall":       metrics["recall"].tolist(),
            "specificity":  metrics["specificity"].tolist(),
            "f1_std":       metrics["f1_std"].tolist(),
        },
        "elapsed_s":    time.time() - t0,
    }
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    log.info("JSON: %s", out_json)
    log.info("Tiempo total: %.1f s", time.time() - t0)


if __name__ == "__main__":
    main()
