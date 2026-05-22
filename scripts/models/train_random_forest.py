#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
train_random_forest.py
----------------------
Entrena el modelo Random Forest predictivo de inundación a partir del
dataset tabular regenerado con la máscara EMSR773 recortada a municipios DANA
(ground truth corregido — ver scripts/features/README_ground_truth_methodology.md).

Flujo:
  1. Carga el dataset (data/dataset/training_dataset.parquet).
  2. Asigna a cada píxel un identificador de bloque espacial 1000 x 1000 m.
  3. Validación cruzada espacial con GroupKFold (5 folds): cada fold
     entrena en bloques disjuntos de los del fold de validación, evitando
     contaminación por autocorrelación espacial.
  4. Por cada fold registra AUC-ROC, F1, precision, recall, accuracy y la
     matriz de confusión. Guarda el modelo del fold y las probabilidades.
  5. Entrena el modelo final con todo el dataset (sin split) → modelo de
     producción guardado en models/random_forest_v1.joblib.
  6. Feature importance built-in + permutation importance (n_repeats=5).
  7. Seis diagnósticos PNG y un JSON con los resultados completos.

Uso:
    python scripts/models/train_random_forest.py [--quick] [--no-final]
"""

from __future__ import annotations

import argparse
import gc
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
import psutil
import yaml
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score, auc, confusion_matrix, f1_score,
    precision_recall_curve, precision_score, recall_score,
    roc_auc_score, roc_curve,
)
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

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
FEATURE_NAMES_V1: List[str] = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
]
FEATURE_NAMES_V2: List[str] = FEATURE_NAMES_V1 + [
    "distance_to_coast", "twi", "hand",
]
FEATURE_NAMES = FEATURE_NAMES_V1   # default backward compatible
LEAKAGE_THRESHOLD = 0.97        # umbral por encima del cual avisar
BLOCK_SIZE_PIXELS = 100         # 100 px × 10 m/px = 1000 m
PERM_SAMPLE_SIZE  = 100_000     # subsample para permutation importance
PERM_N_REPEATS    = 5
PIXEL_SIZE_M      = 10
RANDOM_STATE      = 42


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _format_secs(s: float) -> str:
    if s < 60:
        return f"{s:.1f}s"
    return f"{int(s//60)}m{int(s%60):02d}s"


def _log_memory(stage: str, abort_gb: float = 0.0) -> float:
    """Log resident memory of this process. Aborts if > abort_gb (GB)."""
    p = psutil.Process()
    rss_gb = p.memory_info().rss / (1024 ** 3)
    sys_used_gb = psutil.virtual_memory().used / (1024 ** 3)
    sys_total_gb = psutil.virtual_memory().total / (1024 ** 3)
    log.info("  [RAM] %-30s  proceso: %.2f GB   sistema: %.2f / %.2f GB",
             stage, rss_gb, sys_used_gb, sys_total_gb)
    if abort_gb > 0 and rss_gb > abort_gb:
        log.error("ABORT: RAM proceso %.2f GB > limite %.2f GB", rss_gb, abort_gb)
        raise MemoryError(f"RAM exceeded ({rss_gb:.2f} GB > {abort_gb} GB)")
    return rss_gb


def _assign_blocks(
    rows: np.ndarray,
    cols: np.ndarray,
    block_size: int,
    n_cols_total: int,
) -> np.ndarray:
    """block_id = (row // block_size) * n_col_blocks + (col // block_size)."""
    n_col_blocks = int(np.ceil(n_cols_total / block_size))
    block_row = rows // block_size
    block_col = cols // block_size
    return (block_row * n_col_blocks + block_col).astype("int32")


# ---------------------------------------------------------------------------
# Carga de datos
# ---------------------------------------------------------------------------

def load_dataset(parquet_path: Path) -> pd.DataFrame:
    log.info("Cargando dataset: %s", parquet_path)
    if not parquet_path.exists():
        raise FileNotFoundError(parquet_path)
    df = pd.read_parquet(parquet_path)
    log.info("  Filas=%d  Columnas=%d", len(df), len(df.columns))
    log.info("  Memoria: %.0f MB", df.memory_usage(deep=True).sum() / 1e6)
    return df


# ---------------------------------------------------------------------------
# Cross-validation espacial
# ---------------------------------------------------------------------------

def _train_fold(
    fold_idx: int,
    train_idx: np.ndarray,
    val_idx: np.ndarray,
    X: np.ndarray,
    y: np.ndarray,
    groups: np.ndarray,
    rf_params: dict,
    fold_dir: Path,
    save_predictions: bool = False,
    ram_limit_gb: float = 0.0,
) -> dict:
    """Entrena un fold y devuelve un dict con métricas + path al modelo."""
    t0 = time.time()
    n_train, n_val = len(train_idx), len(val_idx)
    n_train_blocks = len(np.unique(groups[train_idx]))
    n_val_blocks   = len(np.unique(groups[val_idx]))

    log.info("=" * 72)
    log.info("FOLD %d/5  train=%d (%d blocks)  val=%d (%d blocks)",
             fold_idx + 1, n_train, n_train_blocks, n_val, n_val_blocks)

    pos_train = int(y[train_idx].sum())
    pos_val   = int(y[val_idx].sum())
    log.info("  positivos train: %d (%.2f%%)  val: %d (%.2f%%)",
             pos_train, 100*pos_train/n_train, pos_val, 100*pos_val/n_val)

    # Entrenar
    log.info("  Entrenando RF (%d trees, max_depth=%d)...",
             rf_params["n_estimators"], rf_params["max_depth"])
    rf = RandomForestClassifier(**rf_params)
    rf.fit(X[train_idx], y[train_idx])
    t_train = time.time() - t0
    log.info("  Tiempo entrenamiento: %s", _format_secs(t_train))

    # Predicción de probabilidades en val
    log.info("  Prediciendo probabilidades sobre val...")
    proba_val = rf.predict_proba(X[val_idx])[:, 1]
    pred_val  = (proba_val >= 0.5).astype("int8")
    y_val     = y[val_idx]

    # Métricas
    auc_roc = float(roc_auc_score(y_val, proba_val))
    f1      = float(f1_score(y_val, pred_val))
    prec    = float(precision_score(y_val, pred_val, zero_division=0))
    rec     = float(recall_score(y_val, pred_val))
    acc     = float(accuracy_score(y_val, pred_val))
    cm      = confusion_matrix(y_val, pred_val).tolist()
    log.info("  AUC=%.4f  F1=%.4f  Prec=%.4f  Rec=%.4f  Acc=%.4f",
             auc_roc, f1, prec, rec, acc)

    # ROC y PR curves (guardar puntos para superponer luego)
    fpr, tpr, _ = roc_curve(y_val, proba_val)
    pr_p, pr_r, _ = precision_recall_curve(y_val, proba_val)
    auc_pr = float(auc(pr_r, pr_p))

    # Guardar modelo del fold
    model_path = fold_dir / f"rf_fold_{fold_idx + 1}.joblib"
    fold_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(rf, model_path, compress=3)
    log.info("  Modelo guardado: %s (%.1f MB)",
             model_path.name, model_path.stat().st_size / 1e6)

    # Guardar predicciones del fold para threshold tuning posterior
    if save_predictions:
        preds_path = fold_dir / f"predictions_fold_{fold_idx + 1}.npz"
        np.savez_compressed(
            preds_path,
            val_idx=val_idx.astype("int32"),
            y_val=y_val.astype("int8"),
            proba_val=proba_val.astype("float32"),
        )
        log.info("  Predicciones guardadas: %s (%.1f MB)",
                 preds_path.name, preds_path.stat().st_size / 1e6)

    # Liberar memoria
    del rf
    gc.collect()
    _log_memory(f"tras fold {fold_idx + 1}", abort_gb=ram_limit_gb)

    return {
        "fold":            fold_idx + 1,
        "n_train":         n_train,
        "n_val":           n_val,
        "n_train_blocks":  n_train_blocks,
        "n_val_blocks":    n_val_blocks,
        "pos_train":       pos_train,
        "pos_val":         pos_val,
        "auc_roc":         auc_roc,
        "auc_pr":          auc_pr,
        "f1":              f1,
        "precision":       prec,
        "recall":          rec,
        "accuracy":        acc,
        "confusion_matrix": cm,
        "train_time_s":    t_train,
        "model_path":      str(model_path),
        # Curvas (samplear para no inflar JSON)
        "_roc_fpr":        fpr,
        "_roc_tpr":        tpr,
        "_pr_recall":      pr_r,
        "_pr_precision":   pr_p,
    }


# ---------------------------------------------------------------------------
# Importancia de features
# ---------------------------------------------------------------------------

def _feature_importance(
    model: RandomForestClassifier,
    X: np.ndarray,
    y: np.ndarray,
    feature_names: List[str],
    rng: np.random.Generator,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Devuelve (importance_builtin, perm_mean, perm_std).

    Permutation importance se calcula sobre un subsample para velocidad.
    """
    builtin = model.feature_importances_

    if len(X) > PERM_SAMPLE_SIZE:
        idx_sample = rng.choice(len(X), size=PERM_SAMPLE_SIZE, replace=False)
        X_perm, y_perm = X[idx_sample], y[idx_sample]
    else:
        X_perm, y_perm = X, y

    log.info("  Permutation importance sobre %d píxeles, %d repeats...",
             len(X_perm), PERM_N_REPEATS)
    t0 = time.time()
    pi = permutation_importance(
        model, X_perm, y_perm,
        n_repeats=PERM_N_REPEATS,
        random_state=RANDOM_STATE,
        n_jobs=-1,
        scoring="roc_auc",
    )
    log.info("  Permutation importance: %s", _format_secs(time.time() - t0))
    return builtin, pi.importances_mean, pi.importances_std


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

def _plot_roc_curves(folds: List[dict], out_path: Path) -> None:
    if not HAS_MPL:
        return
    fig, ax = plt.subplots(figsize=(8, 7))
    mean_fpr = np.linspace(0, 1, 200)
    tprs_interp = []
    for f in folds:
        ax.plot(f["_roc_fpr"], f["_roc_tpr"], lw=1.0, alpha=0.6,
                label=f"Fold {f['fold']} (AUC={f['auc_roc']:.3f})")
        tprs_interp.append(np.interp(mean_fpr, f["_roc_fpr"], f["_roc_tpr"]))
    ax.plot(mean_fpr, np.mean(tprs_interp, axis=0), color="black", lw=2.4,
            label=f"Media (AUC={np.mean([f['auc_roc'] for f in folds]):.3f})")
    ax.plot([0, 1], [0, 1], color="gray", lw=0.8, ls="--", label="Aleatorio")
    ax.set_xlabel("FPR — Falsos positivos")
    ax.set_ylabel("TPR — Verdaderos positivos (Recall)")
    ax.set_title("Curva ROC — 5 folds (CV espacial GroupKFold)")
    ax.legend(loc="lower right", fontsize=9)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


def _plot_pr_curves(folds: List[dict], baseline: float, out_path: Path) -> None:
    if not HAS_MPL:
        return
    fig, ax = plt.subplots(figsize=(8, 7))
    mean_recall = np.linspace(0, 1, 200)
    pr_interp = []
    for f in folds:
        ax.plot(f["_pr_recall"], f["_pr_precision"], lw=1.0, alpha=0.6,
                label=f"Fold {f['fold']} (AUC-PR={f['auc_pr']:.3f})")
        # Para interpolar, ordenar por recall ascendente
        order = np.argsort(f["_pr_recall"])
        pr_interp.append(np.interp(mean_recall,
                                    f["_pr_recall"][order],
                                    f["_pr_precision"][order]))
    ax.plot(mean_recall, np.mean(pr_interp, axis=0), color="black", lw=2.4,
            label=f"Media (AUC-PR={np.mean([f['auc_pr'] for f in folds]):.3f})")
    ax.axhline(baseline, color="red", lw=0.8, ls="--",
               label=f"Baseline = {baseline:.4f} (frac. clase 1)")
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("Curva Precision-Recall — 5 folds (CV espacial)")
    ax.legend(loc="upper right", fontsize=9)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


def _plot_confusion_matrix(cm: List[List[int]], out_path: Path, title: str) -> None:
    if not HAS_MPL:
        return
    cm_arr = np.array(cm)
    total = cm_arr.sum()
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm_arr, cmap="Blues")
    ax.set_xticks([0, 1]); ax.set_yticks([0, 1])
    ax.set_xticklabels(["No inundado", "Inundado"])
    ax.set_yticklabels(["No inundado", "Inundado"])
    ax.set_xlabel("Predicción")
    ax.set_ylabel("Verdadero")
    ax.set_title(title, fontsize=12)
    for i in range(2):
        for j in range(2):
            v = cm_arr[i, j]
            pct = 100 * v / total
            ax.text(j, i, f"{v}\n({pct:.2f}%)",
                    ha="center", va="center",
                    color="white" if v > total * 0.3 else "black",
                    fontsize=11)
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


def _plot_feature_importance(
    importance: np.ndarray,
    feature_names: List[str],
    out_path: Path,
    title: str,
    err: np.ndarray | None = None,
    color: str = "#4c8bf5",
) -> None:
    if not HAS_MPL:
        return
    order = np.argsort(importance)
    names_sorted = [feature_names[i] for i in order]
    vals_sorted  = importance[order]
    err_sorted   = err[order] if err is not None else None

    fig, ax = plt.subplots(figsize=(8, 6))
    bars = ax.barh(names_sorted, vals_sorted, color=color,
                   xerr=err_sorted, ecolor="#666",
                   capsize=3 if err_sorted is not None else 0)
    for bar, v in zip(bars, vals_sorted):
        ax.text(v, bar.get_y() + bar.get_height() / 2,
                f"  {v:.4f}", va="center", fontsize=9)
    ax.set_xlabel("Importancia")
    ax.set_title(title, fontsize=12)
    ax.grid(True, axis="x", alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


def _plot_cv_metrics_distribution(folds: List[dict], out_path: Path) -> None:
    if not HAS_MPL:
        return
    metrics = ["auc_roc", "f1", "precision", "recall", "accuracy"]
    labels  = ["AUC-ROC", "F1", "Precision", "Recall", "Accuracy"]
    data = [[f[m] for f in folds] for m in metrics]

    fig, ax = plt.subplots(figsize=(9, 6))
    bp = ax.boxplot(data, labels=labels, patch_artist=True, showmeans=True,
                    meanprops=dict(marker="D", mfc="red", mec="red", ms=6))
    for patch in bp["boxes"]:
        patch.set(facecolor="#4c8bf5", alpha=0.55)
    ax.set_ylim(0, 1.02)
    ax.set_ylabel("Valor")
    ax.set_title("Distribución de métricas en los 5 folds (CV espacial)")
    ax.grid(True, axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("  PNG: %s", out_path.name)


# ---------------------------------------------------------------------------
# Aggregations
# ---------------------------------------------------------------------------

def _aggregate_metrics(folds: List[dict]) -> Dict[str, Dict[str, float]]:
    """Devuelve dict {metric: {mean,std,min,max}} sobre los 5 folds."""
    metrics = ["auc_roc", "auc_pr", "f1", "precision", "recall", "accuracy"]
    out = {}
    for m in metrics:
        vals = np.array([f[m] for f in folds])
        out[m] = {
            "mean": float(vals.mean()),
            "std":  float(vals.std()),
            "min":  float(vals.min()),
            "max":  float(vals.max()),
        }
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Entrena el RF predictivo de inundación con CV espacial."
    )
    parser.add_argument("--quick", action="store_true",
                        help="Modo rápido (n_estimators=50, max_depth=8) para depurar.")
    parser.add_argument("--no-final", action="store_true",
                        help="No entrenar el modelo final tras la CV (solo evaluación).")
    parser.add_argument("--n-estimators", type=int, default=None,
                        help="Override n_estimators (sobre params.yaml).")
    parser.add_argument("--max-depth", type=int, default=None,
                        help="Override max_depth (sobre params.yaml).")
    parser.add_argument("--ram-limit-gb", type=float, default=0.0,
                        help="Aborta si la RAM del proceso supera este límite (0 = sin límite).")
    parser.add_argument("--save-predictions", action="store_true",
                        help="Guarda y_val/proba_val por fold en .npz para tuning posterior.")
    parser.add_argument("--dataset", type=Path, default=None,
                        help="Path al .parquet de entrada (default: data/dataset/training_dataset.parquet).")
    parser.add_argument("--features", choices=["v1", "v2"], default="v1",
                        help="Conjunto de features: v1 (11) ó v2 (14, +distance_to_coast/TWI/HAND).")
    parser.add_argument("--output-tag", type=str, default="",
                        help="Sufijo para los outputs (folds/{tag}/, model_{tag}.joblib, results_{tag}.json).")
    args = parser.parse_args()

    t_global = time.time()

    root   = _repo_root()
    paths  = _load_yaml(root / "config" / "paths.yaml")
    params = _load_yaml(root / "config" / "params.yaml")

    # Selección de features (v1 / v2)
    feature_names = FEATURE_NAMES_V2 if args.features == "v2" else FEATURE_NAMES_V1
    log.info("Conjunto de features: %s (%d features)", args.features, len(feature_names))

    # Dataset path
    if args.dataset is not None:
        parquet_path = (root / args.dataset) if not args.dataset.is_absolute() else args.dataset
    else:
        parquet_path = root / "data" / "dataset" / "training_dataset.parquet"

    # Tag para outputs
    tag = args.output_tag.strip()
    suffix = f"_{tag}" if tag else ""

    models_dir   = root / "models"
    folds_dir    = models_dir / "folds" if not tag else models_dir / f"folds_{tag}"
    diag_dir     = root / "results" / "diagnostics" / "model"
    results_dir  = root / "results" / "model"
    for d in (models_dir, folds_dir, diag_dir, results_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1) Dataset
    df = load_dataset(parquet_path)

    # 2) X, y, row, col
    log.info("Construyendo X, y con %d features...", len(feature_names))
    X = df[feature_names].values.astype("float32")
    y = df["flood_label"].values.astype("int8")
    rows = df["row"].values.astype("int32")
    cols = df["col"].values.astype("int32")

    n_rows_total = int(rows.max() + 1)
    n_cols_total = int(cols.max() + 1)
    log.info("  Grid implícito: %d x %d", n_rows_total, n_cols_total)

    # Liberar el DataFrame
    del df
    gc.collect()

    pct_pos = float(y.sum() / len(y))
    log.info("  X: %s float32  → %.0f MB", X.shape, X.nbytes / 1e6)
    log.info("  y: clase 0=%d (%.2f%%)  clase 1=%d (%.2f%%)",
             int((y == 0).sum()), 100*(1-pct_pos),
             int(y.sum()), 100*pct_pos)

    # 3) Bloques espaciales
    groups = _assign_blocks(rows, cols, BLOCK_SIZE_PIXELS, n_cols_total)
    n_blocks = len(np.unique(groups))
    log.info("  Bloques espaciales (%dx%d m, %dx%d px): %d totales",
             BLOCK_SIZE_PIXELS * PIXEL_SIZE_M, BLOCK_SIZE_PIXELS * PIXEL_SIZE_M,
             BLOCK_SIZE_PIXELS, BLOCK_SIZE_PIXELS, n_blocks)
    del rows, cols
    gc.collect()

    # 4) Hiperparámetros
    model_cfg = params.get("model", {})
    if args.quick:
        rf_params = dict(n_estimators=50, max_depth=8,
                         class_weight="balanced", n_jobs=-1,
                         random_state=RANDOM_STATE)
        log.warning("MODO QUICK activado: n_estimators=50, max_depth=8")
    else:
        rf_params = dict(
            n_estimators = int(model_cfg.get("n_estimators", 500)),
            max_depth    = int(model_cfg.get("max_depth", 15)),
            class_weight = "balanced",
            n_jobs       = -1,
            random_state = int(model_cfg.get("random_state", RANDOM_STATE)),
        )
    if args.n_estimators is not None:
        rf_params["n_estimators"] = args.n_estimators
    if args.max_depth is not None:
        rf_params["max_depth"] = args.max_depth
    log.info("Hiperparámetros RF: %s", rf_params)
    if args.ram_limit_gb > 0:
        log.info("Límite RAM proceso: %.1f GB (abortará si se supera)", args.ram_limit_gb)
    _log_memory("tras carga dataset", abort_gb=args.ram_limit_gb)

    # 5) CV espacial
    log.info("=" * 72)
    log.info("VALIDACIÓN CRUZADA ESPACIAL — GroupKFold(5)")
    log.info("=" * 72)
    gkf = GroupKFold(n_splits=5)
    fold_results: List[dict] = []
    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups=groups)):
        res = _train_fold(fold_idx, train_idx, val_idx, X, y, groups,
                          rf_params, folds_dir,
                          save_predictions=args.save_predictions,
                          ram_limit_gb=args.ram_limit_gb)
        fold_results.append(res)

    # 6) Métricas agregadas
    agg = _aggregate_metrics(fold_results)
    log.info("=" * 72)
    log.info("MÉTRICAS AGREGADAS sobre 5 folds (media ± std)")
    log.info("=" * 72)
    for m, d in agg.items():
        log.info("  %-12s  %.4f ± %.4f   [min=%.4f  max=%.4f]",
                 m, d["mean"], d["std"], d["min"], d["max"])
    log.info("=" * 72)

    # Interpretación
    objetivos = {"auc_roc": 0.80, "f1": 0.70, "recall": 0.75}
    interp = {}
    for m, target in objetivos.items():
        ok = agg[m]["mean"] > target
        interp[m] = {"mean": agg[m]["mean"], "target": target, "ok": ok}
        log.info("  %s media=%.4f  objetivo>%.2f  → %s",
                 m, agg[m]["mean"], target, "OK" if ok else "NO ALCANZADO")

    # Aviso de leakage
    leakage_alerts = []
    for m in ("auc_roc", "f1", "precision", "recall", "accuracy"):
        if agg[m]["mean"] > LEAKAGE_THRESHOLD:
            leakage_alerts.append(m)
            log.warning("ALERTA POSIBLE LEAKAGE: %s media=%.4f > %.2f",
                        m, agg[m]["mean"], LEAKAGE_THRESHOLD)

    # 7) Modelo final
    final_model_path = models_dir / f"random_forest{suffix or '_v1'}.joblib"
    final_train_time = 0.0
    importance_builtin = importance_perm_mean = importance_perm_std = None

    if not args.no_final:
        log.info("=" * 72)
        log.info("ENTRENANDO MODELO FINAL (todo el dataset)")
        log.info("=" * 72)
        t0 = time.time()
        rf_final = RandomForestClassifier(**rf_params)
        rf_final.fit(X, y)
        final_train_time = time.time() - t0
        log.info("  Tiempo modelo final: %s", _format_secs(final_train_time))
        joblib.dump(rf_final, final_model_path, compress=3)
        log.info("  Guardado: %s (%.1f MB)",
                 final_model_path, final_model_path.stat().st_size / 1e6)

        # Feature importance
        log.info("Calculando feature importance...")
        rng = np.random.default_rng(RANDOM_STATE)
        importance_builtin, importance_perm_mean, importance_perm_std = \
            _feature_importance(rf_final, X, y, feature_names, rng)

        # Top 5
        log.info("-" * 72)
        log.info("TOP 5 features (built-in importance):")
        order_b = np.argsort(importance_builtin)[::-1][:5]
        for rank, i in enumerate(order_b, 1):
            log.info("  %d. %-22s  %.4f", rank, feature_names[i], importance_builtin[i])
        log.info("TOP 5 features (permutation importance):")
        order_p = np.argsort(importance_perm_mean)[::-1][:5]
        for rank, i in enumerate(order_p, 1):
            log.info("  %d. %-22s  %.4f ± %.4f", rank, feature_names[i],
                     importance_perm_mean[i], importance_perm_std[i])
        del rf_final
        gc.collect()

    # 8) Diagnostics
    log.info("=" * 72)
    log.info("Generando PNGs de diagnóstico...")
    _plot_roc_curves(fold_results, diag_dir / f"roc_curves{suffix}.png")
    _plot_pr_curves(fold_results, pct_pos, diag_dir / f"precision_recall_curves{suffix}.png")

    # Confusion matrix del fold con mejor F1
    best_fold = max(fold_results, key=lambda f: f["f1"])
    _plot_confusion_matrix(
        best_fold["confusion_matrix"],
        diag_dir / f"confusion_matrix{suffix}.png",
        f"Matriz de confusión — Fold {best_fold['fold']} (mejor F1={best_fold['f1']:.3f}){' — ' + tag if tag else ''}",
    )

    if importance_builtin is not None:
        _plot_feature_importance(
            importance_builtin, feature_names,
            diag_dir / f"feature_importance_builtin{suffix}.png",
            f"Importancia built-in (mean decrease in impurity){' — ' + tag if tag else ''}",
            color="#4c8bf5",
        )
        _plot_feature_importance(
            importance_perm_mean, feature_names,
            diag_dir / f"feature_importance_permutation{suffix}.png",
            f"Permutation importance ({PERM_N_REPEATS} repeats, AUC-ROC){' — ' + tag if tag else ''}",
            err=importance_perm_std,
            color="#e63946",
        )
    _plot_cv_metrics_distribution(fold_results, diag_dir / f"cv_metrics_distribution{suffix}.png")

    # 9) JSON de resultados
    results_json = {
        "timestamp":      datetime.now().isoformat(timespec="seconds"),
        "dataset":        str(parquet_path),
        "n_samples":      int(len(y)),
        "class_balance":  {
            "n_class_0": int((y == 0).sum()),
            "n_class_1": int(y.sum()),
            "frac_positive": pct_pos,
        },
        "spatial_blocks": {
            "block_size_m": BLOCK_SIZE_PIXELS * PIXEL_SIZE_M,
            "n_blocks":     int(n_blocks),
        },
        "rf_params":      rf_params,
        "folds":          [{k: v for k, v in f.items() if not k.startswith("_")}
                            for f in fold_results],
        "aggregate":      agg,
        "objectives":     interp,
        "leakage_alerts": leakage_alerts,
        "final_model":    {
            "path":         str(final_model_path) if not args.no_final else None,
            "train_time_s": final_train_time,
        },
        "feature_set":    args.features,
        "feature_importance": (
            {
                "feature_names": feature_names,
                "builtin": importance_builtin.tolist() if importance_builtin is not None else None,
                "permutation_mean": importance_perm_mean.tolist() if importance_perm_mean is not None else None,
                "permutation_std":  importance_perm_std.tolist()  if importance_perm_std  is not None else None,
            }
            if importance_builtin is not None else None
        ),
        "total_time_s":   time.time() - t_global,
    }
    json_path = results_dir / f"training_results{suffix}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(results_json, fh, indent=2, ensure_ascii=False)
    log.info("Resultados guardados: %s", json_path)

    # 10) Reporte final
    log.info("=" * 72)
    log.info("RESUMEN FINAL — TRAIN_RANDOM_FOREST")
    log.info("=" * 72)
    log.info("  Tiempo total                : %s", _format_secs(time.time() - t_global))
    log.info("  Folds                       : 5 (GroupKFold espacial 1000x1000 m)")
    log.info("  Bloques totales             : %d", n_blocks)
    log.info("  Hiperparámetros             : %s", rf_params)
    log.info("  AUC-ROC (CV)                : %.4f ± %.4f  → %s",
             agg["auc_roc"]["mean"], agg["auc_roc"]["std"],
             "OK (>0.80)" if interp["auc_roc"]["ok"] else "NO ALCANZADO (<0.80)")
    log.info("  F1      (CV)                : %.4f ± %.4f  → %s",
             agg["f1"]["mean"], agg["f1"]["std"],
             "OK (>0.70)" if interp["f1"]["ok"] else "NO ALCANZADO (<0.70)")
    log.info("  Recall  (CV)                : %.4f ± %.4f  → %s",
             agg["recall"]["mean"], agg["recall"]["std"],
             "OK (>0.75)" if interp["recall"]["ok"] else "NO ALCANZADO (<0.75)")
    log.info("  Precision (CV)              : %.4f ± %.4f",
             agg["precision"]["mean"], agg["precision"]["std"])
    log.info("  Accuracy  (CV)              : %.4f ± %.4f",
             agg["accuracy"]["mean"], agg["accuracy"]["std"])
    if importance_builtin is not None:
        i_top = int(np.argmax(importance_builtin))
        log.info("  Feature más importante      : %s (importance=%.3f)",
                 feature_names[i_top], importance_builtin[i_top])
    if leakage_alerts:
        log.warning("  ALERTAS DE LEAKAGE          : %s (>%.2f)",
                    leakage_alerts, LEAKAGE_THRESHOLD)
    else:
        log.info("  Sin alertas de leakage (todas las métricas <%.2f)",
                 LEAKAGE_THRESHOLD)
    if not args.no_final:
        log.info("  Modelo final                : %s", final_model_path)
    log.info("  JSON resultados             : %s", json_path)
    log.info("=" * 72)


if __name__ == "__main__":
    main()
