"""
train_improved_model_v3.py
--------------------------
Extrae la mascara urbana (desde NDVI real), construye dataset extendido
con features avanzadas (textura local, estacionales), y entrena:
  - Random Forest v3 (14 features originales + 10 nuevas = 24)
  - XGBoost (mismas features, para comparativa)

Compara metricas v2 vs v3 vs XGBoost.
Output: models/random_forest_v3.joblib, models/xgboost_v3.joblib
"""
from __future__ import annotations
import argparse, json, logging, sys, time
from datetime import datetime
from pathlib import Path
from typing import List

import joblib, numpy as np, pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, auc, confusion_matrix, f1_score,
    precision_recall_curve, precision_score, recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import GroupKFold
from xgboost import XGBClassifier

try:
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt; HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
RANDOM_STATE = 42
N_ESTIMATORS = 300
MAX_DEPTH = 12
BLOCK_M = 1000
PIXEL_M = 10

FEATURES_V3 = [
    # SAR temporales (6)
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    # DEM basicas (4)
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    # NDVI (1)
    "ndvi_mean",
    # DEM avanzadas (3)
    "distance_to_coast", "twi", "hand",
    # Urban mask (1)
    "urban_mask",
    # Textura local (2)
    "local_std_5x5", "local_range_5x5",
    # Estacionales (7)
    "summer_mean_sigma0_vv", "winter_mean_sigma0_vv",
    "summer_min_sigma0_vv", "winter_min_sigma0_vv",
    "summer_std_sigma0_vv", "winter_std_sigma0_vv",
    "winter_minus_summer_vv",
]

def _assign_blocks(rows, cols, block_px, n_cols_tot):
    ncb = int(np.ceil(n_cols_tot / block_px))
    return (rows // block_px * ncb + cols // block_px).astype("int32")


def main():
    t0 = time.time()

    # ================================================================
    # 1. Generar urban mask (desde NDVI correcto)
    # ================================================================
    log.info("=== 1. Generando urban mask ===")
    ndvi_path = REPO / "data" / "features" / "optical" / "ndvi_mean.tif"
    wf_path = REPO / "data" / "sentinel1" / "water_masks" / "water_frequency.tif"
    adv_dir = REPO / "data" / "features" / "advanced"
    adv_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(wf_path) as ref:
        canon_t = ref.transform; canon_crs = ref.crs; canon_shape = (ref.height, ref.width)
    rows, cols = canon_shape

    with rasterio.open(ndvi_path) as src:
        ndvi_arr = src.read(1).astype("float32")
    if src.crs != canon_crs or (src.height, src.width) != canon_shape:
        ndvi_r = np.full(canon_shape, np.nan, dtype="float32")
        rio_reproject(source=ndvi_arr, destination=ndvi_r,
                       src_transform=src.transform, src_crs=src.crs,
                       dst_transform=canon_t, dst_crs=canon_crs,
                       resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan)
        ndvi_arr = ndvi_r
    urban = np.where(np.isfinite(ndvi_arr) & (ndvi_arr < 0.2), 1.0, 0.0).astype("float32")
    urban[~np.isfinite(ndvi_arr)] = np.nan
    prof = {"driver":"GTiff","dtype":"float32","count":1,"width":cols,"height":rows,
            "crs":canon_crs,"transform":canon_t,"nodata":np.nan,"compress":"lzw"}
    with rasterio.open(adv_dir / "urban_mask.tif", "w", **prof) as dst:
        dst.write(urban, 1)
    log.info("  urban_mask.tif — %.1f%% urbano", 100*urban[np.isfinite(urban)].mean())

    # ================================================================
    # 2. Cargar todas las features en un stack
    # ================================================================
    log.info("=== 2. Cargando features ===")
    feat_sources = {
        # SAR
        "mean_sigma0_vv": REPO/"data/features/sar/mean_sigma0_vv.tif",
        "std_sigma0_vv": REPO/"data/features/sar/std_sigma0_vv.tif",
        "min_sigma0_vv": REPO/"data/features/sar/min_sigma0_vv.tif",
        "cv_sigma0_vv": REPO/"data/features/sar/cv_sigma0_vv.tif",
        "mean_vv_vh_ratio": REPO/"data/features/sar/mean_vv_vh_ratio.tif",
        "water_count": REPO/"data/features/sar/water_count.tif",
        # DEM
        "elevation": REPO/"data/dem/elevation.tif",
        "slope": REPO/"data/dem/slope.tif",
        "distance_to_stream": REPO/"data/dem/distance_to_stream.tif",
        "flow_accumulation": REPO/"data/dem/flow_accumulation.tif",
        # NDVI
        "ndvi_mean": ndvi_path,
        # DEM advanced
        "distance_to_coast": REPO/"data/dem/distance_to_coast.tif",
        "twi": REPO/"data/dem/twi.tif",
        "hand": REPO/"data/dem/hand.tif",
        # New
        "urban_mask": adv_dir/"urban_mask.tif",
        "local_std_5x5": adv_dir/"local_std_5x5.tif",
        "local_range_5x5": adv_dir/"local_range_5x5.tif",
        "summer_mean_sigma0_vv": adv_dir/"summer_mean_sigma0_vv.tif",
        "winter_mean_sigma0_vv": adv_dir/"winter_mean_sigma0_vv.tif",
        "summer_min_sigma0_vv": adv_dir/"summer_min_sigma0_vv.tif",
        "winter_min_sigma0_vv": adv_dir/"winter_min_sigma0_vv.tif",
        "summer_std_sigma0_vv": adv_dir/"summer_std_sigma0_vv.tif",
        "winter_std_sigma0_vv": adv_dir/"winter_std_sigma0_vv.tif",
        "winter_minus_summer_vv": adv_dir/"winter_minus_summer_vv.tif",
    }

    # Verificar que todos existen
    missing = [n for n, p in feat_sources.items() if not p.exists()]
    if missing:
        log.error("Features faltantes: %s", missing)
        return 1

    # Reproyectar al grid canonico y stack
    stack = np.empty((len(FEATURES_V3), rows, cols), dtype="float32")
    for i, name in enumerate(FEATURES_V3):
        p = feat_sources[name]
        with rasterio.open(p) as src:
            arr = src.read(1).astype("float32")
        if src.crs != canon_crs or (src.height, src.width) != canon_shape:
            arr_r = np.full(canon_shape, np.nan, dtype="float32")
            rio_reproject(source=arr, destination=arr_r,
                           src_transform=src.transform, src_crs=src.crs,
                           dst_transform=canon_t, dst_crs=canon_crs,
                           resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan)
            arr = arr_r
        # Convert nodata to NaN
        nd = src.nodata
        if nd is not None and not np.isnan(nd):
            arr[arr == nd] = np.nan
        stack[i] = arr
    log.info("  %d features cargadas, shape=%s", len(FEATURES_V3), stack.shape)

    # ================================================================
    # 3. Label
    # ================================================================
    label_path = REPO / "data" / "labels" / "flood_mask_emsr773_clipped.tif"
    with rasterio.open(label_path) as src:
        lbl = src.read(1).astype("uint8")
    if src.crs != canon_crs or (src.height, src.width) != canon_shape:
        lbl_r = np.full(canon_shape, 255, dtype="uint8")
        rio_reproject(source=lbl, destination=lbl_r,
                       src_transform=src.transform, src_crs=src.crs,
                       dst_transform=canon_t, dst_crs=canon_crs,
                       resampling=Resampling.nearest, src_nodata=255, dst_nodata=255)
        lbl = lbl_r

    # ================================================================
    # 4. Construir DataFrame
    # ================================================================
    log.info("=== 4. Construyendo DataFrame ===")
    valid_mask = np.isfinite(stack[0]) & (lbl != 255)
    rr, cc = np.where(valid_mask)
    data = {"row": rr.astype("int32"), "col": cc.astype("int32")}
    for i, name in enumerate(FEATURES_V3):
        data[name] = stack[i][valid_mask]
    data["flood_label"] = lbl[valid_mask].astype("int8")
    df = pd.DataFrame(data)
    del stack, lbl

    # Filtrar NaN/inf
    nan_rows = df[FEATURES_V3].isna().any(axis=1)
    df = df.loc[~nan_rows].reset_index(drop=True)
    inf_rows = np.isinf(df[FEATURES_V3].to_numpy()).any(axis=1)
    df = df.loc[~inf_rows].reset_index(drop=True)

    n_pos = int(df["flood_label"].sum())
    log.info("  Dataset: %d filas  positivos=%d (%.2f%%)  features=%d",
             len(df), n_pos, 100*n_pos/len(df), len(FEATURES_V3))
    log.info("  Features: %s", FEATURES_V3)

    # ================================================================
    # 5. Preparar X, y, groups + muestreo para CV rapida
    # ================================================================
    # CV sobre 2M filas estratificado (para velocidad), pero modelo final con todo
    N_CV = min(2_000_000, len(df))
    pos_mask = df["flood_label"] == 1
    df_pos = df[pos_mask]
    df_neg = df[~pos_mask]
    n_pos_cv = min(len(df_pos), int(N_CV * 0.2))
    n_neg_cv = N_CV - n_pos_cv
    rng = np.random.default_rng(RANDOM_STATE)
    df_cv = pd.concat([
        df_pos.sample(n_pos_cv, random_state=RANDOM_STATE),
        df_neg.sample(n_neg_cv, random_state=RANDOM_STATE),
    ]).sample(frac=1, random_state=RANDOM_STATE).reset_index(drop=True)

    X_cv = df_cv[FEATURES_V3].to_numpy(dtype="float32")
    y_cv = df_cv["flood_label"].to_numpy(dtype="int8")
    groups_cv = _assign_blocks(df_cv["row"].to_numpy(), df_cv["col"].to_numpy(),
                                BLOCK_M // PIXEL_M, cols)
    log.info("  CV sample: %d filas (%d positivos, %.1f%%)  Bloques: %d",
             len(df_cv), int(y_cv.sum()), 100*y_cv.mean(), len(np.unique(groups_cv)))

    # Full data para modelo final
    X_full = df[FEATURES_V3].to_numpy(dtype="float32")
    y_full = df["flood_label"].to_numpy(dtype="int8")
    del df, df_cv
    log.info("  Full: %d filas  positivos=%d (%.1f%%)",
             len(X_full), int(y_full.sum()), 100*y_full.mean())

    # ================================================================
    # 6. Validacion cruzada 5-fold
    # ================================================================
    log.info("=== 6. CV espacial 5-fold ===")
    gkf = GroupKFold(n_splits=5)

    def train_eval(model, name, X_train, y_train, X_val, y_val):
        t = time.time()
        model.fit(X_train, y_train)
        train_t = time.time() - t
        proba = model.predict_proba(X_val)[:, 1]
        pred = (proba >= 0.5).astype("int8")
        return {
            "model": name,
            "auc_roc": float(roc_auc_score(y_val, proba)),
            "f1": float(f1_score(y_val, pred, zero_division=0)),
            "precision": float(precision_score(y_val, pred, zero_division=0)),
            "recall": float(recall_score(y_val, pred)),
            "accuracy": float(accuracy_score(y_val, pred)),
            "train_s": train_t,
        }

    cv_rf = []; cv_xgb = []
    for fold, (train_idx, val_idx) in enumerate(gkf.split(X_cv, y_cv, groups=groups_cv)):
        log.info("  Fold %d/5 train=%d val=%d", fold+1, len(train_idx), len(val_idx))
        rf = RandomForestClassifier(n_estimators=N_ESTIMATORS, max_depth=MAX_DEPTH,
                                     class_weight="balanced_subsample", n_jobs=-1,
                                     random_state=RANDOM_STATE)
        pos_ratio = float((y_cv==0).sum() / max((y_cv==1).sum(), 1))
        xgb = XGBClassifier(n_estimators=N_ESTIMATORS, max_depth=MAX_DEPTH,
                            scale_pos_weight=pos_ratio,
                            eval_metric="logloss", random_state=RANDOM_STATE, n_jobs=-1)
        cv_rf.append(train_eval(rf, "RF_v3", X_cv[train_idx], y_cv[train_idx], X_cv[val_idx], y_cv[val_idx]))
        cv_xgb.append(train_eval(xgb, "XGBoost", X_cv[train_idx], y_cv[train_idx], X_cv[val_idx], y_cv[val_idx]))

    # ================================================================
    # 7. Agregar y comparar
    # ================================================================
    def agg_metrics(folds, label):
        out = {}
        for m in ["auc_roc", "f1", "precision", "recall", "accuracy"]:
            vals = [f[m] for f in folds]
            out[f"{label}_{m}"] = f"{np.mean(vals):.4f} ± {np.std(vals):.4f}"
        return out

    log.info("=== 7. COMPARATIVA CV (5-fold) ===")
    # Cargar metricas v2 existentes
    v2_path = REPO / "results" / "model" / "metrics_v2.json"
    v2 = {}
    if v2_path.exists():
        v2 = json.load(open(v2_path))
    v2_recall = v2.get("Recall", v2.get("recall", 0))
    v2_f1 = v2.get("F1", v2.get("f1", 0))
    v2_auc = v2.get("AUC_ROC", v2.get("auc_roc", 0))
    v2_prec = v2.get("Precision", v2.get("precision", 0))

    a_rf = agg_metrics(cv_rf, "RF_v3")
    a_xgb = agg_metrics(cv_xgb, "XGBoost")

    print("\n" + "=" * 80)
    print("COMPARATIVA FINAL")
    print("=" * 80)
    print(f"  {'Metrica':<12s}  {'v2 (14 feat)':>18s}  {'RF v3 (24 feat)':>18s}  {'XGBoost (24 feat)':>18s}")
    print(f"  {'-'*12}  {'-'*18}  {'-'*18}  {'-'*18}")

    for m_key, v2_val in [("auc_roc", v2_auc), ("f1", v2_f1), ("precision", v2_prec), ("recall", v2_recall)]:
        rf_val = np.mean([f[m_key] for f in cv_rf])
        xgb_val = np.mean([f[m_key] for f in cv_xgb])
        print(f"  {m_key.upper():<12s}  {v2_val:>18.4f}  {rf_val:>18.4f}  {xgb_val:>18.4f}")
    print("=" * 80)

    # Delta
    rf_rec = np.mean([f["recall"] for f in cv_rf])
    rf_f1 = np.mean([f["f1"] for f in cv_rf])
    rf_auc = np.mean([f["auc_roc"] for f in cv_rf])
    rf_prec = np.mean([f["precision"] for f in cv_rf])
    xgb_auc = np.mean([f["auc_roc"] for f in cv_xgb])
    xgb_f1 = np.mean([f["f1"] for f in cv_xgb])
    xgb_prec = np.mean([f["precision"] for f in cv_xgb])
    xgb_rec = np.mean([f["recall"] for f in cv_xgb])

    print(f"\n  DELTA v2 -> RF v3:   AUC {rf_auc - v2_auc:+.4f}  F1 {rf_f1 - v2_f1:+.4f}  Recall {rf_rec - v2_recall:+.4f}  Precision {rf_prec - v2_prec:+.4f}")
    print(f"  DELTA v2 -> XGBoost: AUC {xgb_auc - v2_auc:+.4f}  F1 {xgb_f1 - v2_f1:+.4f}  Recall {xgb_rec - v2_recall:+.4f}  Precision {xgb_prec - v2_prec:+.4f}")

    # ================================================================
    # 8. Entrenar modelos finales y guardar
    # ================================================================
    log.info("=== 8. Entrenando modelos finales (datos completos) ===")
    models_dir = REPO / "models"
    rf_final = RandomForestClassifier(n_estimators=N_ESTIMATORS, max_depth=MAX_DEPTH,
                                       class_weight="balanced_subsample", n_jobs=-1,
                                       random_state=RANDOM_STATE)
    t_rf = time.time()
    rf_final.fit(X_full, y_full)
    joblib.dump(rf_final, models_dir / "random_forest_v3.joblib", compress=3)
    log.info("  RF v3 guardado (%.1f s, %.1f MB)", time.time()-t_rf,
             (models_dir/"random_forest_v3.joblib").stat().st_size/1e6)

    pos_ratio_full = float((y_full==0).sum() / max((y_full==1).sum(), 1))
    xgb_final = XGBClassifier(n_estimators=N_ESTIMATORS, max_depth=MAX_DEPTH,
                              scale_pos_weight=pos_ratio_full,
                              eval_metric="logloss", random_state=RANDOM_STATE, n_jobs=-1)
    t_xgb = time.time()
    xgb_final.fit(X_full, y_full)
    joblib.dump(xgb_final, models_dir / "xgboost_v3.joblib", compress=3)
    log.info("  XGBoost guardado (%.1f s, %.1f MB)", time.time()-t_xgb,
             (models_dir/"xgboost_v3.joblib").stat().st_size/1e6)

    # Feature importance RF
    log.info("=== 9. Permutation importance RF v3 ===")
    n_sample = min(100_000, len(X_full))
    idx_s = rng.choice(len(X_full), n_sample, replace=False)
    pi = permutation_importance(rf_final, X_full[idx_s], y_full[idx_s], n_repeats=5,
                                 scoring="roc_auc", random_state=RANDOM_STATE, n_jobs=-1)
    order = np.argsort(pi.importances_mean)[::-1]
    log.info("  Top 10 features:")
    for rank, i in enumerate(order[:10], 1):
        log.info("  %2d. %-30s  %.4f ± %.4f", rank, FEATURES_V3[i],
                 pi.importances_mean[i], pi.importances_std[i])

    if HAS_MPL:
        diag_dir = REPO / "results" / "diagnostics" / "model"
        diag_dir.mkdir(parents=True, exist_ok=True)
        names_s = [FEATURES_V3[i] for i in order]
        vals_s = pi.importances_mean[order]
        err_s = pi.importances_std[order]
        fig, ax = plt.subplots(figsize=(10, 8))
        ax.barh(names_s, vals_s, xerr=err_s, color="#e63946", capsize=2)
        ax.set_xlabel("Permutation importance (delta AUC)")
        ax.set_title("RF v3 — Permutation importance (24 features)")
        ax.grid(True, alpha=0.3, axis="x")
        plt.tight_layout()
        plt.savefig(diag_dir / "feature_importance_permutation_v3.png", dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: feature_importance_permutation_v3.png")

    # Guardar metricas
    results = {
        "timestamp": datetime.now().isoformat(),
        "features": FEATURES_V3,
        "n_features": len(FEATURES_V3),
        "n_samples": int(len(X_full)),
        "n_positive": int(y_full.sum()),
        "rf_v3_cv": {"auc_roc": f"{rf_auc:.4f}±{np.std([f['auc_roc'] for f in cv_rf]):.4f}",
                      "f1": f"{rf_f1:.4f}±{np.std([f['f1'] for f in cv_rf]):.4f}",
                      "precision": f"{rf_prec:.4f}±{np.std([f['precision'] for f in cv_rf]):.4f}",
                      "recall": f"{rf_rec:.4f}±{np.std([f['recall'] for f in cv_rf]):.4f}"},
        "xgboost_cv": {"auc_roc": f"{xgb_auc:.4f}±{np.std([f['auc_roc'] for f in cv_xgb]):.4f}",
                        "f1": f"{xgb_f1:.4f}±{np.std([f['f1'] for f in cv_xgb]):.4f}",
                        "precision": f"{xgb_prec:.4f}±{np.std([f['precision'] for f in cv_xgb]):.4f}",
                        "recall": f"{xgb_rec:.4f}±{np.std([f['recall'] for f in cv_xgb]):.4f}"},
        "v2_baseline": {"auc_roc": v2_auc, "f1": v2_f1, "precision": v2_prec, "recall": v2_recall},
        "top_features": {FEATURES_V3[i]: float(pi.importances_mean[i]) for i in order[:10]},
    }
    json_path = REPO / "results" / "model" / "metrics_v3.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    log.info("  Metricas: %s", json_path)

    elapsed = time.time() - t0
    log.info("=== COMPLETADO en %.1f min ===", elapsed/60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
