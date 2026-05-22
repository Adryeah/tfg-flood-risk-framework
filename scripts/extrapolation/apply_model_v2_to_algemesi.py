"""
Aplica el modelo Random Forest v2 (entrenado SOLO con datos de Valencia)
a la zona Algemesi sin reentrenar. Genera el mapa predictivo de riesgo
y realiza la validacion cuantitativa contra el ground truth EMSR773 AOI04
recortado a los 12 municipios DANA de Ribera Alta/Baixa.

Pipeline:
  1. Carga models/random_forest_v2.joblib (entrenado con 14 features Valencia).
  2. Construye matriz X de prediccion sobre todos los pixels validos
     del dataset Algemesi.
  3. predict_proba -> risk_probability_algemesi.tif (float32, en [0, 1]).
  4. Aplica threshold operacional 0.614 (mismo que Valencia v2,
     criterio recall>=0.75) -> risk_binary_algemesi.tif (uint8 0/1).
  5. Valida cuantitativamente:
       - AUC, F1, Recall, Precision, Accuracy, AUC-PR
       - Brier score, ECE (calibracion)
       - Confusion matrix
       - Buffer metrics 30/50/100 m (UN-SPIDER)
  6. Genera tabla comparativa Valencia v2 vs Algemesi extrapolado:
       results/model/extrapolation_metrics.csv
  7. Genera 4 PNGs:
       risk_algemesi.png            (mapa probabilidad solo)
       algemesi_emsr_overlay.png    (probabilidad + contorno EMSR azul)
       error_map_algemesi.png       (TP/TN/FP/FN categorico)
       valencia_vs_algemesi_metrics.png (barras agrupadas)

CRITICO: NO reentrena el modelo. Es el experimento de extrapolacion.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import List, Tuple

import joblib
import numpy as np
import pandas as pd
import rasterio
from rasterio.crs import CRS
from scipy.ndimage import binary_dilation, generate_binary_structure
from sklearn.metrics import (
    accuracy_score, average_precision_score, brier_score_loss,
    confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score,
)

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

REPO_ROOT = Path(__file__).resolve().parents[2]

FEATURE_NAMES_V2 = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]

DEFAULT_THRESHOLD_V2 = 0.614


def _ece(y_true, y_prob, n_bins: int = 10) -> float:
    """Expected Calibration Error con bins equiespaciados."""
    bins = np.linspace(0, 1, n_bins + 1)
    n = len(y_true)
    ece = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (y_prob >= lo) & (y_prob < hi)
        if mask.sum() == 0:
            continue
        accuracy = y_true[mask].mean()
        confidence = y_prob[mask].mean()
        ece += (mask.sum() / n) * abs(accuracy - confidence)
    return float(ece)


def _buffer_metrics(y_true_2d, y_pred_2d, buffer_px: int):
    """Metricas TP/FP/FN/Recall/Precision con tolerancia espacial."""
    if buffer_px == 0:
        tp = int(((y_pred_2d == 1) & (y_true_2d == 1)).sum())
        fp = int(((y_pred_2d == 1) & (y_true_2d == 0)).sum())
        fn = int(((y_pred_2d == 0) & (y_true_2d == 1)).sum())
    else:
        # Disco aproximado por dilatacion morfologica
        struct = generate_binary_structure(2, 2)
        y_true_dil = binary_dilation(y_true_2d == 1, structure=struct,
                                     iterations=buffer_px)
        y_pred_dil = binary_dilation(y_pred_2d == 1, structure=struct,
                                     iterations=buffer_px)
        tp = int(((y_pred_2d == 1) & y_true_dil).sum())
        fp = int(((y_pred_2d == 1) & ~y_true_dil).sum())
        fn = int(((y_true_2d == 1) & ~y_pred_dil).sum())
    p = tp / max(tp + fp, 1)
    r = tp / max(tp + fn, 1)
    f1 = 2 * p * r / max(p + r, 1e-9)
    return tp, fp, fn, p, r, f1


def main() -> int:
    t0 = time.time()
    parser = argparse.ArgumentParser()
    parser.add_argument("--model",
                        default="models/random_forest_v2.joblib")
    parser.add_argument("--threshold", type=float,
                        default=DEFAULT_THRESHOLD_V2)
    parser.add_argument("--dataset",
                        default="data/dataset/training_dataset_algemesi.parquet")
    args = parser.parse_args()

    model_path = REPO_ROOT / args.model
    dataset_path = REPO_ROOT / args.dataset
    threshold = args.threshold

    if not model_path.exists():
        log.error("No existe el modelo v2: %s", model_path)
        return 1
    if not dataset_path.exists():
        log.error("No existe el dataset Algemesi: %s", dataset_path)
        return 1

    log.info("Cargando modelo v2: %s", model_path)
    model = joblib.load(model_path)
    log.info("  Tipo: %s", type(model).__name__)
    log.info("  n_estimators=%s max_depth=%s",
             getattr(model, "n_estimators", "?"),
             getattr(model, "max_depth", "?"))

    log.info("Cargando dataset Algemesi: %s", dataset_path)
    df = pd.read_parquet(dataset_path)
    log.info("  Filas: %d  Cols: %s", len(df), list(df.columns))

    # Verificar features esperadas
    missing = [f for f in FEATURE_NAMES_V2 if f not in df.columns]
    if missing:
        log.error("Features faltantes: %s", missing)
        return 2

    X = df[FEATURE_NAMES_V2].to_numpy(dtype=np.float32)
    y = df["flood_label"].to_numpy(dtype=np.int8)
    log.info("X.shape=%s  y inundados=%d (%.2f%%)",
             X.shape, int((y == 1).sum()), 100 * (y == 1).mean())

    # Predict
    log.info("Aplicando predict_proba en chunks...")
    t_pred = time.time()
    chunk = 500_000
    proba = np.empty(len(X), dtype="float32")
    for i in range(0, len(X), chunk):
        proba[i:i + chunk] = model.predict_proba(X[i:i + chunk])[:, 1]
    log.info("  Inferencia: %.1f s", time.time() - t_pred)

    pred_bin = (proba >= threshold).astype("int8")

    # Reconstruir mapas 2D
    canon_path = REPO_ROOT / "data" / "extrapolation" / "dem" / "canonical_grid.tif"
    with rasterio.open(canon_path) as ref:
        canon_transform = ref.transform
        canon_crs       = ref.crs
        canon_shape     = (ref.height, ref.width)

    rows, cols = canon_shape
    proba_2d = np.full(canon_shape, np.nan, dtype="float32")
    pred_2d  = np.full(canon_shape, 255,    dtype="uint8")
    label_2d = np.full(canon_shape, 255,    dtype="uint8")
    rr = df["row"].to_numpy(); cc = df["col"].to_numpy()
    proba_2d[rr, cc] = proba
    pred_2d[rr, cc]  = pred_bin
    label_2d[rr, cc] = y.astype("uint8")

    # Guardar GeoTIFFs
    out_dir = REPO_ROOT / "results" / "maps" / "05_extrapolation"
    out_dir.mkdir(parents=True, exist_ok=True)

    def _write_tif(arr, path, dtype, nodata):
        prof = {"driver": "GTiff", "dtype": dtype, "count": 1,
                "width": cols, "height": rows, "crs": canon_crs,
                "transform": canon_transform, "nodata": nodata,
                "compress": "lzw"}
        with rasterio.open(path, "w", **prof) as dst:
            dst.write(arr.astype(dtype), 1)
        log.info("  %s  %.2f MB", path.name, path.stat().st_size / 1e6)

    out_proba = out_dir / "risk_probability_algemesi.tif"
    out_bin   = out_dir / "risk_binary_algemesi.tif"
    _write_tif(proba_2d, out_proba, "float32", np.nan)
    _write_tif(pred_2d,  out_bin,   "uint8",   255)

    # Metricas escalares
    log.info("=" * 60)
    log.info("Metricas Algemesi (extrapolacion del modelo v2 Valencia)")
    log.info("=" * 60)

    auc      = float(roc_auc_score(y, proba))
    auc_pr   = float(average_precision_score(y, proba))
    f1_      = float(f1_score(y, pred_bin))
    prec     = float(precision_score(y, pred_bin, zero_division=0))
    rec      = float(recall_score(y, pred_bin))
    acc      = float(accuracy_score(y, pred_bin))
    brier    = float(brier_score_loss(y, proba))
    ece      = _ece(y, proba)
    cm = confusion_matrix(y, pred_bin)
    tn, fp, fn, tp = cm.ravel()

    log.info("  AUC-ROC   : %.4f", auc)
    log.info("  AUC-PR    : %.4f", auc_pr)
    log.info("  F1        : %.4f", f1_)
    log.info("  Precision : %.4f", prec)
    log.info("  Recall    : %.4f", rec)
    log.info("  Accuracy  : %.4f", acc)
    log.info("  Brier     : %.4f", brier)
    log.info("  ECE       : %.4f", ece)
    log.info("  Confusion matrix:")
    log.info("    TN=%d  FP=%d  FN=%d  TP=%d", tn, fp, fn, tp)

    metrics = {
        "AUC_ROC": auc, "AUC_PR": auc_pr, "F1": f1_,
        "Precision": prec, "Recall": rec, "Accuracy": acc,
        "Brier": brier, "ECE": ece,
        "TN": int(tn), "FP": int(fp), "FN": int(fn), "TP": int(tp),
        "threshold": threshold,
    }

    # Buffer metrics 30/50/100 m con dilation
    log.info("Calculando metricas con tolerancia espacial...")
    valid_mask = (label_2d != 255) & (pred_2d != 255)
    label_for_buf = label_2d.copy()
    pred_for_buf  = pred_2d.copy()
    label_for_buf[~valid_mask] = 0
    pred_for_buf[~valid_mask]  = 0
    buffer_results = []
    for r_m in (0, 30, 50, 100):
        buf_px = round(r_m / 10.0)  # 10 m/px
        tp_b, fp_b, fn_b, p_b, r_b, f_b = _buffer_metrics(
            label_for_buf == 1, pred_for_buf == 1, buf_px,
        )
        buffer_results.append({
            "buffer_m": r_m, "TP": tp_b, "FP": fp_b, "FN": fn_b,
            "Precision": p_b, "Recall": r_b, "F1": f_b,
        })
        log.info("  buffer %3d m: TP=%d FP=%d FN=%d  P=%.3f R=%.3f F1=%.3f",
                 r_m, tp_b, fp_b, fn_b, p_b, r_b, f_b)

    # Comparativa con Valencia v2
    log.info("Cargando metricas Valencia v2 para comparativa...")
    val_metrics_path = REPO_ROOT / "results" / "model" / "metrics_v2.json"
    val_metrics = None
    if val_metrics_path.exists():
        with open(val_metrics_path) as fh:
            val_metrics = json.load(fh)
        log.info("  Metricas Valencia v2 cargadas: %s", val_metrics_path.name)

    # Guardar tabla comparativa
    out_metrics_dir = REPO_ROOT / "results" / "model"
    out_metrics_dir.mkdir(parents=True, exist_ok=True)
    out_comparison = out_metrics_dir / "extrapolation_metrics.csv"
    rows_out = []
    for m in ["AUC_ROC", "AUC_PR", "F1", "Precision", "Recall",
              "Accuracy", "Brier", "ECE"]:
        v_alge = metrics[m]
        v_val  = (val_metrics.get(m) if val_metrics else None)
        delta  = (v_alge - v_val) if v_val is not None else None
        rows_out.append({"metric": m,
                         "valencia_v2": v_val,
                         "algemesi_extrapolated": v_alge,
                         "delta": delta})
    pd.DataFrame(rows_out).to_csv(out_comparison, index=False)
    log.info("Tabla comparativa: %s", out_comparison)

    # JSON con todas las metricas
    out_json = out_metrics_dir / "extrapolation_metrics.json"
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump({
            "algemesi": metrics,
            "buffer_metrics": buffer_results,
            "valencia_v2_comparison": val_metrics,
        }, fh, indent=2)
    log.info("JSON: %s", out_json)

    # Buffer CSV
    out_buf_csv = out_metrics_dir / "buffer_metrics_algemesi.csv"
    pd.DataFrame(buffer_results).to_csv(out_buf_csv, index=False)
    log.info("Buffer CSV: %s", out_buf_csv)

    # Diagnosticos PNG
    if HAS_MPL:
        diag_dir = REPO_ROOT / "results" / "diagnostics" / "extrapolation"
        diag_dir.mkdir(parents=True, exist_ok=True)
        log.info("Generando PNGs de diagnostico...")

        # 1) Mapa probabilidad
        fig, ax = plt.subplots(figsize=(11, 9))
        m = ax.imshow(proba_2d, cmap="RdYlBu_r", vmin=0, vmax=1)
        plt.colorbar(m, ax=ax, fraction=0.046, pad=0.04, label="P(inundacion)")
        ax.set_title("Algemesi - Risk probability (modelo v2 Valencia, sin reentrenar)")
        ax.axis("off"); plt.tight_layout()
        plt.savefig(diag_dir / "risk_algemesi.png", dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: risk_algemesi.png")

        # 2) Mapa de errores (TN=0, TP=1, FP=2, FN=3)
        err_2d = np.full(canon_shape, 255, dtype="uint8")
        err_2d[(label_2d == 0) & (pred_2d == 0)] = 0  # TN
        err_2d[(label_2d == 1) & (pred_2d == 1)] = 1  # TP
        err_2d[(label_2d == 0) & (pred_2d == 1)] = 2  # FP
        err_2d[(label_2d == 1) & (pred_2d == 0)] = 3  # FN
        # Guardar tif
        _write_tif(err_2d, REPO_ROOT / "results" / "maps" / "05_extrapolation"
                   / "error_map_algemesi.tif", "uint8", 255)
        # Plot
        from matplotlib.colors import ListedColormap
        cmap_err = ListedColormap(["#dddddd", "#1a9850", "#fdae61", "#d73027"])
        fig, ax = plt.subplots(figsize=(11, 9))
        masked = np.ma.masked_equal(err_2d, 255)
        m = ax.imshow(masked, cmap=cmap_err, vmin=0, vmax=3)
        cbar = plt.colorbar(m, ax=ax, fraction=0.046, pad=0.04, ticks=[0, 1, 2, 3])
        cbar.ax.set_yticklabels(["TN", "TP", "FP", "FN"])
        ax.set_title("Algemesi - Mapa de errores (modelo v2 sin reentrenar)")
        ax.axis("off"); plt.tight_layout()
        plt.savefig(diag_dir / "error_map_algemesi.png", dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: error_map_algemesi.png")

        # 3) EMS overlay
        fig, ax = plt.subplots(figsize=(11, 9))
        m = ax.imshow(proba_2d, cmap="RdYlBu_r", vmin=0, vmax=1)
        ax.contour((label_2d == 1).astype("uint8"), levels=[0.5],
                   colors="cyan", linewidths=0.6)
        plt.colorbar(m, ax=ax, fraction=0.046, pad=0.04,
                     label="P(inundacion) - contorno azul = EMSR773 AOI04")
        ax.set_title("Algemesi - Probabilidad + contorno ground truth")
        ax.axis("off"); plt.tight_layout()
        plt.savefig(diag_dir / "algemesi_emsr_overlay.png", dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: algemesi_emsr_overlay.png")

        # 4) Barras comparativas Valencia vs Algemesi
        if val_metrics is not None:
            fig, ax = plt.subplots(figsize=(11, 6))
            metric_keys = ["AUC_ROC", "AUC_PR", "F1", "Precision", "Recall", "Accuracy"]
            x_pos = np.arange(len(metric_keys))
            w = 0.35
            v_vals = [val_metrics.get(k, 0) for k in metric_keys]
            a_vals = [metrics.get(k, 0) for k in metric_keys]
            ax.bar(x_pos - w / 2, v_vals, w, label="Valencia (entrenamiento, v2 OOF)",
                   color="#2c7fb8")
            ax.bar(x_pos + w / 2, a_vals, w, label="Algemesi (extrapolacion)",
                   color="#f46d43")
            ax.set_xticks(x_pos)
            ax.set_xticklabels(metric_keys, rotation=15)
            ax.set_ylim(0, 1.05)
            for x, v in zip(x_pos - w / 2, v_vals):
                ax.text(x, v + 0.01, f"{v:.3f}", ha="center", fontsize=8)
            for x, v in zip(x_pos + w / 2, a_vals):
                ax.text(x, v + 0.01, f"{v:.3f}", ha="center", fontsize=8)
            ax.set_ylabel("Metric value")
            ax.set_title("Valencia v2 vs Algemesi extrapolated  -  Modelo Random Forest v2")
            ax.legend(loc="lower right")
            ax.grid(True, alpha=0.3, axis="y")
            plt.tight_layout()
            plt.savefig(diag_dir / "valencia_vs_algemesi_metrics.png",
                        dpi=150, bbox_inches="tight")
            plt.close()
            log.info("  PNG: valencia_vs_algemesi_metrics.png")

    elapsed = time.time() - t0
    log.info("=" * 75)
    log.info("RESUMEN apply_model_v2_to_algemesi: %.1f min", elapsed / 60)
    log.info("  Modelo: %s", model_path.name)
    log.info("  Threshold: %.3f", threshold)
    log.info("  AUC=%.3f F1=%.3f Recall=%.3f Precision=%.3f", auc, f1_, rec, prec)
    log.info("=" * 75)
    return 0


if __name__ == "__main__":
    sys.exit(main())
