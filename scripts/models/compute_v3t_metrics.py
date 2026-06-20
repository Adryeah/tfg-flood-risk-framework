#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
compute_v3t_metrics.py
----------------------
Computa la suite completa de metricas del modelo-nucleo v3-T (lozo9,
calibrado, umbral 0,310) para alimentar precomputed_metrics.json del
backend, con cifras REALES (nada inventado).

Produce las mismas secciones que el JSON v2:
  valencia / algemesi:
    model_metrics (auc, auc_pr, f1, precision, recall, accuracy, brier, ece)
    buffer_metrics [0,30,50,100 m]  ·  confusion_matrix  ·  threshold_operational
    feature_importance (9)  ·  n_pixels / n_positive
  algemesi.extrapolation_comparison (8 metricas valencia vs algemesi)
  transferability: feature_drift (9) + permutation_importance_comparison (9)
  leakage_audit: SE PRESERVA tal cual (auditoria historica XGBoost v3)

Valencia in-domain via GroupKFold espacial (bloques 1 km) sobre muestra;
Algemesi via aplicacion del modelo final a TODO el dataset.

Salida: framework_web/backend/data_processed/precomputed_metrics_v3t.json
  (NO sobrescribe el v2; el swap se hace aparte tras revisar)

Uso: .venv/Scripts/python.exe scripts/models/compute_v3t_metrics.py
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import rasterio
from scipy.ndimage import binary_dilation
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, average_precision_score,
                             brier_score_loss, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RS = 42
MAX_DEPTH = 12
N_EST_CV = 150
BLOCK_PX = 100
N_CV = 2_000_000
CHUNK = 2_000_000
BUFFERS_M = [0, 30, 50, 100]
PIXEL_M = 10

VAL_PARQUET = REPO / "data/dataset/training_dataset_v2.parquet"
ALG_PARQUET = REPO / "data/dataset/training_dataset_algemesi.parquet"
BINARY = {
    "valencia": (REPO / "results/maps/04_risk_prediction/risk_binary_v3t.tif",
                 REPO / "data/labels/flood_mask_emsr773_clipped.tif"),
    "algemesi": (REPO / "results/maps/05_extrapolation/risk_binary_algemesi_v3t.tif",
                 REPO / "data/labels/algemesi/flood_mask_algemesi_clipped.tif"),
}


def _ece(y, p, nb=15):
    b = np.linspace(0, 1, nb + 1); idx = np.clip(np.digitize(p, b) - 1, 0, nb - 1); e = 0.0
    for k in range(nb):
        m = idx == k
        if m.any():
            e += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(e)


def _assign_blocks(rows, cols, bpx, ncols):
    ncb = int(np.ceil(ncols / bpx))
    return ((rows // bpx) * ncb + (cols // bpx)).astype("int32")


def _metrics_block(y, proba_cal, thr):
    pred = (proba_cal >= thr).astype("int8")
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "auc_mean": float(roc_auc_score(y, proba_cal)),
        "auc_pr": float(average_precision_score(y, proba_cal)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "accuracy": float(accuracy_score(y, pred)),
        "brier": float(brier_score_loss(y, proba_cal)),
        "ece": _ece(y, proba_cal),
    }, {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}


def _buffer_metrics(zone):
    """Buffered recall: fraccion de pixeles inundados (GT) con un pixel
    predicho positivo a <= b metros. Dilata la prediccion binaria."""
    bin_path, gt_path = BINARY[zone]
    if not bin_path.exists() or not gt_path.exists():
        log.warning("  buffer_metrics %s: falta raster, omitido", zone)
        return []
    with rasterio.open(bin_path) as ds:
        pred = ds.read(1); pred_pos = (pred == 1)
    with rasterio.open(gt_path) as ds:
        gt = ds.read(1)
        if gt.shape != pred_pos.shape:
            log.warning("  buffer %s: shapes distintos pred%s gt%s — omitido",
                        zone, pred_pos.shape, gt.shape)
            return []
    gt_pos = (gt == 1)
    total = int(gt_pos.sum())
    out = []
    for b in BUFFERS_M:
        if b == 0:
            dil = pred_pos
        else:
            r = max(1, round(b / PIXEL_M))
            dil = binary_dilation(pred_pos, iterations=r)
        tp = int((gt_pos & dil).sum())
        fn = total - tp
        fp = int((dil & ~gt_pos).sum())
        # Claves en minuscula — el frontend (model-validation.jsx) lee
        # b.recall / b.precision / b.f1 / b.tp ... en minuscula.
        out.append({"buffer_m": b, "tp": tp, "fp": fp, "fn": fn,
                    "precision": float(tp / max(tp + fp, 1)),
                    "recall": float(tp / max(total, 1)),
                    "f1": float(2 * tp / max(2 * tp + fp + fn, 1))})
    return out


def main() -> int:
    t0 = time.time()
    rng = np.random.default_rng(RS)
    model = joblib.load(REPO / "models/random_forest_v3t.joblib")
    cal = joblib.load(REPO / "models/v3t_calibrator.joblib")
    iso, FEATS, THR = cal["isotonic"], cal["features"], cal["threshold"]
    log.info("v3-T: %d feats, thr=%.3f", len(FEATS), THR)

    out = {}

    # ---------- VALENCIA (in-domain, CV espacial) ----------
    log.info("== VALENCIA ==")
    val = pd.read_parquet(VAL_PARQUET, columns=["row", "col", "flood_label", *FEATS])
    val = val.loc[np.isfinite(val[FEATS].to_numpy()).all(1)].reset_index(drop=True)
    n_pix_v, n_pos_v = len(val), int(val["flood_label"].sum())
    ncols_v = int(val["col"].max() + 1)
    # muestra CV estratificada
    pos = val.index[val.flood_label == 1].to_numpy(); neg = val.index[val.flood_label == 0].to_numpy()
    npos = min(len(pos), int(N_CV * 0.2))
    idx = np.concatenate([rng.choice(pos, npos, False), rng.choice(neg, min(len(neg), N_CV - npos), False)])
    sub = val.loc[idx].reset_index(drop=True)
    Xs = sub[FEATS].to_numpy("float32"); ys = sub["flood_label"].to_numpy("int8")
    grp = _assign_blocks(sub["row"].to_numpy(), sub["col"].to_numpy(), BLOCK_PX, ncols_v)
    oof = np.full(len(ys), np.nan, "float32")
    for k, (tr, va) in enumerate(GroupKFold(5).split(Xs, ys, grp), 1):
        clf = RandomForestClassifier(n_estimators=N_EST_CV, max_depth=MAX_DEPTH,
                                     class_weight="balanced_subsample", n_jobs=-1, random_state=RS)
        clf.fit(Xs[tr], ys[tr]); oof[va] = clf.predict_proba(Xs[va])[:, 1].astype("float32")
        log.info("  CV fold %d/5", k)
    oof_cal = iso.predict(oof).astype("float32")
    auc_folds = []
    for _, va in GroupKFold(5).split(Xs, ys, grp):
        auc_folds.append(roc_auc_score(ys[va], oof[va]))
    mm, cm = _metrics_block(ys, oof_cal, THR)
    mm["auc_std"] = float(np.std(auc_folds))
    imp = dict(sorted(zip(FEATS, model.feature_importances_.astype(float)),
                      key=lambda kv: kv[1], reverse=True))
    out["valencia"] = {
        "model_metrics": mm, "confusion_matrix": cm,
        "feature_importance": [{"feature": k, "importance": v} for k, v in imp.items()],
        "buffer_metrics": _buffer_metrics("valencia"),
        "threshold_operational": THR, "n_pixels": n_pix_v, "n_positive": n_pos_v,
    }
    log.info("  Valencia AUC=%.4f recall=%.4f prec=%.4f F1=%.4f ECE=%.3f",
             mm["auc_mean"], mm["recall"], mm["precision"], mm["f1"], mm["ece"])
    val_drift = val[FEATS].median().to_dict(); val_std = val[FEATS].std().to_dict()
    val_sample = sub.sample(min(80_000, len(sub)), random_state=RS)
    del val, sub, Xs

    # ---------- ALGEMESI (extrapolacion, aplicacion directa) ----------
    log.info("== ALGEMESI ==")
    alg = pd.read_parquet(ALG_PARQUET, columns=["flood_label", *FEATS])
    alg = alg.loc[np.isfinite(alg[FEATS].to_numpy()).all(1)].reset_index(drop=True)
    Xa = alg[FEATS].to_numpy("float32"); ya = alg["flood_label"].to_numpy("int8")
    proba = np.empty(len(Xa), "float32")
    for s in range(0, len(Xa), CHUNK):
        e = min(s + CHUNK, len(Xa)); proba[s:e] = model.predict_proba(Xa[s:e])[:, 1].astype("float32")
    proba_cal = iso.predict(proba).astype("float32")
    mm_a, cm_a = _metrics_block(ya, proba_cal, THR)
    out["algemesi"] = {
        "model_metrics": mm_a, "confusion_matrix": cm_a,
        "buffer_metrics": _buffer_metrics("algemesi"),
        "threshold_operational": THR, "n_pixels": int(len(ya)), "n_positive": int(ya.sum()),
    }
    out["algemesi"]["extrapolation_comparison"] = [
        {"metric": m, "valencia": mm[m], "algemesi": mm_a[m], "delta": mm_a[m] - mm[m]}
        for m in ["auc_mean", "auc_pr", "f1", "precision", "recall", "accuracy", "brier", "ece"]
    ]
    log.info("  Algemesi AUC=%.4f recall=%.4f prec=%.4f F1=%.4f ECE=%.3f",
             mm_a["auc_mean"], mm_a["recall"], mm_a["precision"], mm_a["f1"], mm_a["ece"])

    # ---------- TRANSFERIBILIDAD ----------
    alg_drift = alg[FEATS].median().to_dict()
    # permutation importance v3-T en cada zona (sample)
    pv = permutation_importance(model, val_sample[FEATS].to_numpy("float32"),
                                val_sample["flood_label"].to_numpy("int8"),
                                scoring="roc_auc", n_repeats=3, random_state=RS, n_jobs=-1)
    alg_s = alg.sample(min(80_000, len(alg)), random_state=RS)
    pa = permutation_importance(model, alg_s[FEATS].to_numpy("float32"),
                                alg_s["flood_label"].to_numpy("int8"),
                                scoring="roc_auc", n_repeats=3, random_state=RS, n_jobs=-1)
    # feature_drift incluye la importancia por zona — el Overview lee
    # feature_drift[].importance_valencia para su gráfica de features.
    drift = [{"feature": f, "valencia_median": float(val_drift[f]),
              "algemesi_median": float(alg_drift[f]),
              "delta_normalized_std": float((alg_drift[f] - val_drift[f]) / (val_std[f] or 1e-9)),
              "importance_valencia": float(pv.importances_mean[i]),
              "importance_algemesi": float(pa.importances_mean[i])}
             for i, f in enumerate(FEATS)]
    out["transferability"] = {
        "auc_valencia": mm["auc_mean"], "auc_algemesi": mm_a["auc_mean"],
        "recall_valencia": mm["recall"], "recall_algemesi": mm_a["recall"],
        "feature_drift": drift,
        "permutation_importance_comparison": [
            {"feature": f, "importance_valencia": float(pv.importances_mean[i]),
             "importance_algemesi": float(pa.importances_mean[i])} for i, f in enumerate(FEATS)],
    }

    # ---------- PRESERVAR leakage_audit ----------
    old = json.loads((REPO / "framework_web/backend/data_processed/precomputed_metrics.json").read_text(encoding="utf-8"))
    out["leakage_audit"] = old.get("leakage_audit", {})
    out["_model"] = {"name": "Random Forest v3-T (transferible)", "n_features": len(FEATS),
                     "features": FEATS, "threshold": THR}

    dst = REPO / "framework_web/backend/data_processed/precomputed_metrics_v3t.json"
    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Escrito: %s", dst.relative_to(REPO))
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
