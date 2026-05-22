"""
TEST 1 - Leakage check de urban_mask en XGBoost v3.

Compara XGBoost A (24 features, incluyendo urban_mask) vs
B (23 features, sin urban_mask) usando la misma validacion
cruzada espacial que RF v2 (GroupKFold 5 folds, bloques 1x1 km,
dataset completo de Valencia ~7.5 M filas).

Reporta:
  - Spearman correlation urban_mask vs flood_label
  - AUC, F1, Precision, Recall (mean +- std) para A y B
  - Delta AUC = AUC(A) - AUC(B)
  - Delta F1  = F1(A) - F1(B)

Veredicto:
  Delta AUC > 0.05 -> RED FLAG (urban_mask domina)
  0.02 < Delta AUC <= 0.05 -> ZONA GRIS
  Delta AUC <= 0.02 -> OK

Outputs:
  results/diagnostics/leakage_tests/test1_urban_mask_check.png
  results/model/test1_urban_mask_report.md
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject as rio_reproject
from scipy.stats import spearmanr
from sklearn.metrics import (accuracy_score, f1_score, precision_score,
                              recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold
from xgboost import XGBClassifier

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]

# Misma config que cv_comparison_v3_fast.py para que la unica
# variable sea la presencia/ausencia de urban_mask.
N_EST    = 200
MAX_DEPTH = 10
RND      = 42
BLOCK_PX = 100   # 100 px @ 10 m = 1000 m blocks (igual que RF v2)

FEATURES_V3_24 = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
    "urban_mask",
    "local_std_5x5", "local_range_5x5",
    "summer_mean_sigma0_vv", "winter_mean_sigma0_vv",
    "summer_min_sigma0_vv", "winter_min_sigma0_vv",
    "summer_std_sigma0_vv", "winter_std_sigma0_vv",
    "winter_minus_summer_vv",
]
FEATURES_V3_23 = [f for f in FEATURES_V3_24 if f != "urban_mask"]

FEAT_SRC = {
    "mean_sigma0_vv": "data/features/sar/mean_sigma0_vv.tif",
    "std_sigma0_vv":  "data/features/sar/std_sigma0_vv.tif",
    "min_sigma0_vv":  "data/features/sar/min_sigma0_vv.tif",
    "cv_sigma0_vv":   "data/features/sar/cv_sigma0_vv.tif",
    "mean_vv_vh_ratio": "data/features/sar/mean_vv_vh_ratio.tif",
    "water_count":    "data/features/sar/water_count.tif",
    "elevation":      "data/dem/elevation.tif",
    "slope":          "data/dem/slope.tif",
    "distance_to_stream": "data/dem/distance_to_stream.tif",
    "flow_accumulation":  "data/dem/flow_accumulation.tif",
    "ndvi_mean":      "data/features/optical/ndvi_mean.tif",
    "distance_to_coast": "data/dem/distance_to_coast.tif",
    "twi":            "data/dem/twi.tif",
    "hand":           "data/dem/hand.tif",
    "urban_mask":     "data/features/advanced/urban_mask.tif",
    "local_std_5x5":  "data/features/advanced/local_std_5x5.tif",
    "local_range_5x5":"data/features/advanced/local_range_5x5.tif",
    "summer_mean_sigma0_vv": "data/features/advanced/summer_mean_sigma0_vv.tif",
    "winter_mean_sigma0_vv": "data/features/advanced/winter_mean_sigma0_vv.tif",
    "summer_min_sigma0_vv":  "data/features/advanced/summer_min_sigma0_vv.tif",
    "winter_min_sigma0_vv":  "data/features/advanced/winter_min_sigma0_vv.tif",
    "summer_std_sigma0_vv":  "data/features/advanced/summer_std_sigma0_vv.tif",
    "winter_std_sigma0_vv":  "data/features/advanced/winter_std_sigma0_vv.tif",
    "winter_minus_summer_vv":"data/features/advanced/winter_minus_summer_vv.tif",
}


def _load_canonical_stack():
    wf = REPO / "data/sentinel1/water_masks/water_frequency.tif"
    with rasterio.open(wf) as ref:
        canon_t = ref.transform; canon_crs = ref.crs
        rows, cols = ref.height, ref.width
    log.info("Grid canonico Valencia: (%d, %d) px=%.0f m",
             rows, cols, canon_t.a)

    stack = np.empty((len(FEATURES_V3_24), rows, cols), dtype="float32")
    for i, name in enumerate(FEATURES_V3_24):
        p = REPO / FEAT_SRC[name]
        if not p.exists():
            raise FileNotFoundError(p)
        with rasterio.open(p) as src:
            arr = src.read(1).astype("float32")
            shape_match = (src.height, src.width) == (rows, cols)
            crs_match = src.crs == canon_crs
        if not (shape_match and crs_match):
            arr_r = np.full((rows, cols), np.nan, dtype="float32")
            with rasterio.open(p) as src:
                rio_reproject(
                    source=arr, destination=arr_r,
                    src_transform=src.transform, src_crs=src.crs,
                    dst_transform=canon_t, dst_crs=canon_crs,
                    resampling=Resampling.bilinear,
                    src_nodata=src.nodata, dst_nodata=np.nan,
                )
            arr = arr_r
        nd = src.nodata
        if nd is not None and not np.isnan(nd):
            arr[arr == nd] = np.nan
        stack[i] = arr

    # Label
    with rasterio.open(REPO / "data/labels/flood_mask_emsr773_clipped.tif") as src:
        lbl = src.read(1).astype("uint8")
        if (src.height, src.width) != (rows, cols) or src.crs != canon_crs:
            lbl_r = np.full((rows, cols), 255, dtype="uint8")
            rio_reproject(
                source=lbl, destination=lbl_r,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=canon_t, dst_crs=canon_crs,
                resampling=Resampling.nearest, src_nodata=255, dst_nodata=255,
            )
            lbl = lbl_r
    return stack, lbl, canon_t, canon_crs, rows, cols


def main():
    t0 = time.time()
    log.info("=" * 75)
    log.info("TEST 1 - Leakage check urban_mask")
    log.info("=" * 75)

    stack, lbl, canon_t, canon_crs, rows, cols = _load_canonical_stack()

    # Construir DataFrame con 24 features (full dataset)
    valid = np.isfinite(stack[0]) & (lbl != 255)
    rr, cc = np.where(valid)
    data = {"row": rr.astype("int32"), "col": cc.astype("int32")}
    for i, name in enumerate(FEATURES_V3_24):
        data[name] = stack[i][valid]
    data["flood_label"] = lbl[valid].astype("int8")
    df = pd.DataFrame(data)
    del stack, lbl

    # Filtrar NaN/inf
    df = df.loc[~df[FEATURES_V3_24].isna().any(axis=1)].reset_index(drop=True)
    inf_mask = np.isinf(df[FEATURES_V3_24].to_numpy()).any(axis=1)
    df = df.loc[~inf_mask].reset_index(drop=True)
    log.info("Dataset Valencia FULL: %d filas  positivos=%d (%.2f%%)",
             len(df), int(df["flood_label"].sum()),
             100 * df["flood_label"].mean())

    # Spearman correlation urban_mask vs flood_label
    log.info("Calculando Spearman urban_mask vs flood_label...")
    n_corr = min(500_000, len(df))
    df_c = df.sample(n_corr, random_state=RND)
    rho, pval = spearmanr(df_c["urban_mask"], df_c["flood_label"])
    log.info("  Spearman urban_mask <-> flood_label: rho=%.4f  p=%.2e", rho, pval)

    # Bloques espaciales
    ncb = int(np.ceil(cols / BLOCK_PX))
    groups = (df["row"].to_numpy() // BLOCK_PX * ncb +
              df["col"].to_numpy() // BLOCK_PX).astype("int32")
    n_blocks = len(np.unique(groups))
    log.info("Bloques espaciales 1x1 km: %d", n_blocks)

    pos_w = float((df["flood_label"] == 0).sum() /
                  max((df["flood_label"] == 1).sum(), 1))
    log.info("scale_pos_weight (XGBoost): %.2f", pos_w)

    y = df["flood_label"].to_numpy("int8")

    def cv_run(features_list, label):
        log.info("--- CV %s (%d features) ---", label, len(features_list))
        X = df[features_list].to_numpy("float32")
        gkf = GroupKFold(n_splits=5)
        results = []
        for fold, (tr, vl) in enumerate(gkf.split(X, y, groups=groups)):
            t = time.time()
            model = XGBClassifier(
                n_estimators=N_EST, max_depth=MAX_DEPTH,
                scale_pos_weight=pos_w, eval_metric="logloss",
                verbosity=0, random_state=RND, n_jobs=-1,
                tree_method="hist",
            )
            model.fit(X[tr], y[tr])
            proba = model.predict_proba(X[vl])[:, 1]
            pred  = (proba >= 0.5).astype("int8")
            r = {
                "fold": fold + 1,
                "auc":      float(roc_auc_score(y[vl], proba)),
                "f1":       float(f1_score(y[vl], pred, zero_division=0)),
                "precision":float(precision_score(y[vl], pred, zero_division=0)),
                "recall":   float(recall_score(y[vl], pred)),
                "accuracy": float(accuracy_score(y[vl], pred)),
                "train_s":  time.time() - t,
            }
            results.append(r)
            log.info("  fold %d/5  AUC=%.4f  F1=%.4f  P=%.4f  R=%.4f  (%.0fs)",
                     fold + 1, r["auc"], r["f1"], r["precision"], r["recall"],
                     r["train_s"])
        return results

    res_A = cv_run(FEATURES_V3_24, "A_24feat_with_urban")
    res_B = cv_run(FEATURES_V3_23, "B_23feat_no_urban")

    def agg(folds, key):
        v = np.array([f[key] for f in folds])
        return float(v.mean()), float(v.std())

    a_auc_m, a_auc_s = agg(res_A, "auc")
    a_f1_m,  a_f1_s  = agg(res_A, "f1")
    a_p_m,   a_p_s   = agg(res_A, "precision")
    a_r_m,   a_r_s   = agg(res_A, "recall")
    b_auc_m, b_auc_s = agg(res_B, "auc")
    b_f1_m,  b_f1_s  = agg(res_B, "f1")
    b_p_m,   b_p_s   = agg(res_B, "precision")
    b_r_m,   b_r_s   = agg(res_B, "recall")

    delta_auc = a_auc_m - b_auc_m
    delta_f1  = a_f1_m  - b_f1_m
    delta_p   = a_p_m   - b_p_m
    delta_r   = a_r_m   - b_r_m

    if delta_auc > 0.05:
        verdict_auc = "RED_FLAG"
    elif delta_auc > 0.02:
        verdict_auc = "ZONA_GRIS"
    else:
        verdict_auc = "OK"

    log.info("=" * 75)
    log.info("RESULTADOS TEST 1")
    log.info("=" * 75)
    log.info("Spearman urban_mask <-> flood_label: rho=%.4f", rho)
    log.info("")
    log.info("                          A (24 feat con urban_mask)   B (23 feat sin urban_mask)   Delta")
    log.info("  AUC      :  %.4f +- %.4f         %.4f +- %.4f         %+.4f",
             a_auc_m, a_auc_s, b_auc_m, b_auc_s, delta_auc)
    log.info("  F1       :  %.4f +- %.4f         %.4f +- %.4f         %+.4f",
             a_f1_m, a_f1_s, b_f1_m, b_f1_s, delta_f1)
    log.info("  Precision:  %.4f +- %.4f         %.4f +- %.4f         %+.4f",
             a_p_m, a_p_s, b_p_m, b_p_s, delta_p)
    log.info("  Recall   :  %.4f +- %.4f         %.4f +- %.4f         %+.4f",
             a_r_m, a_r_s, b_r_m, b_r_s, delta_r)
    log.info("")
    log.info("VEREDICTO  : %s   (Delta AUC = %+.4f)", verdict_auc, delta_auc)

    # Guardar JSON
    out = {
        "test": "1_urban_mask_leakage",
        "spearman_rho": rho, "spearman_p": pval,
        "config": {"n_estimators": N_EST, "max_depth": MAX_DEPTH,
                   "block_px": BLOCK_PX, "scale_pos_weight": pos_w,
                   "n_samples": len(df), "n_blocks": n_blocks},
        "A_24_with_urban": {
            "auc_mean": a_auc_m, "auc_std": a_auc_s,
            "f1_mean":  a_f1_m,  "f1_std":  a_f1_s,
            "precision_mean": a_p_m, "precision_std": a_p_s,
            "recall_mean": a_r_m, "recall_std": a_r_s,
            "folds": res_A,
        },
        "B_23_no_urban": {
            "auc_mean": b_auc_m, "auc_std": b_auc_s,
            "f1_mean":  b_f1_m,  "f1_std":  b_f1_s,
            "precision_mean": b_p_m, "precision_std": b_p_s,
            "recall_mean": b_r_m, "recall_std": b_r_s,
            "folds": res_B,
        },
        "delta_AUC": delta_auc, "delta_F1": delta_f1,
        "delta_Precision": delta_p, "delta_Recall": delta_r,
        "verdict": verdict_auc,
    }
    out_dir = REPO / "results" / "model"
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "test1_urban_mask_results.json", "w") as fh:
        json.dump(out, fh, indent=2)
    log.info("JSON: %s", out_dir / "test1_urban_mask_results.json")

    # PNG comparativa
    if HAS_MPL:
        diag = REPO / "results" / "diagnostics" / "leakage_tests"
        diag.mkdir(parents=True, exist_ok=True)
        labels = ["AUC", "F1", "Precision", "Recall"]
        a_vals = [a_auc_m, a_f1_m, a_p_m, a_r_m]
        a_err  = [a_auc_s, a_f1_s, a_p_s, a_r_s]
        b_vals = [b_auc_m, b_f1_m, b_p_m, b_r_m]
        b_err  = [b_auc_s, b_f1_s, b_p_s, b_r_s]
        x = np.arange(len(labels)); w = 0.35
        fig, ax = plt.subplots(figsize=(11, 6))
        ax.bar(x - w / 2, a_vals, w, yerr=a_err, capsize=4,
               color="#e63946", label="A: 24 feat (con urban_mask)")
        ax.bar(x + w / 2, b_vals, w, yerr=b_err, capsize=4,
               color="#457b9d", label="B: 23 feat (sin urban_mask)")
        for xi, va, vb in zip(x, a_vals, b_vals):
            ax.text(xi - w / 2, va + 0.01, f"{va:.3f}",
                    ha="center", fontsize=9)
            ax.text(xi + w / 2, vb + 0.01, f"{vb:.3f}",
                    ha="center", fontsize=9)
        ax.set_xticks(x); ax.set_xticklabels(labels)
        ax.set_ylim(0, 1.05); ax.set_ylabel("Score (mean +- std, 5-fold GroupKFold)")
        ax.set_title(f"Test 1 - urban_mask leakage check  -  Delta AUC = "
                     f"{delta_auc:+.4f}  -  Veredicto: {verdict_auc}")
        ax.legend(loc="lower right")
        ax.grid(True, alpha=0.3, axis="y")
        plt.tight_layout()
        plt.savefig(diag / "test1_urban_mask_check.png",
                    dpi=150, bbox_inches="tight")
        plt.close()
        log.info("PNG: %s", diag / "test1_urban_mask_check.png")

    # Reporte markdown
    md = out_dir / "test1_urban_mask_report.md"
    with open(md, "w", encoding="utf-8") as fh:
        fh.write(f"""# Test 1 - urban_mask leakage check

**Modelo:** XGBoost v3 (n_estimators={N_EST}, max_depth={MAX_DEPTH},
scale_pos_weight={pos_w:.2f})
**Validacion:** GroupKFold 5 folds, bloques 1x1 km, dataset Valencia FULL ({len(df):,} filas, {n_blocks} bloques)
**Misma configuracion que RF v2** (full dataset, no class re-balancing)

## Spearman correlation urban_mask <-> flood_label

| metrica | valor |
|---|---:|
| rho | {rho:+.4f} |
| p-value | {pval:.2e} |

Interpretacion:
- |rho| > 0.5: ALERTA, urban_mask correlaciona muy fuerte con el target
- 0.3 < |rho| < 0.5: PRECAUCION
- |rho| < 0.3: OK

## Comparativa A vs B

| Metrica | A (24 feat con urban_mask) | B (23 feat sin urban_mask) | Delta |
|---|---:|---:|---:|
| AUC       | {a_auc_m:.4f} +- {a_auc_s:.4f} | {b_auc_m:.4f} +- {b_auc_s:.4f} | {delta_auc:+.4f} |
| F1        | {a_f1_m:.4f} +- {a_f1_s:.4f} | {b_f1_m:.4f} +- {b_f1_s:.4f} | {delta_f1:+.4f} |
| Precision | {a_p_m:.4f} +- {a_p_s:.4f} | {b_p_m:.4f} +- {b_p_s:.4f} | {delta_p:+.4f} |
| Recall    | {a_r_m:.4f} +- {a_r_s:.4f} | {b_r_m:.4f} +- {b_r_s:.4f} | {delta_r:+.4f} |

## Veredicto

**{verdict_auc}**  (Delta AUC = {delta_auc:+.4f})

- Delta AUC > 0.05: **RED FLAG** - urban_mask aporta >5pp de AUC, posible leakage indirecto
- 0.02 < Delta AUC <= 0.05: **ZONA GRIS** - aporte significativo, documentar
- Delta AUC <= 0.02: **OK** - urban_mask aporta marginalmente

## Notas

El ground truth usa clipping a 14 municipios urbanos (DANA RDL 6/2024). Si urban_mask
correlaciona fuerte con el target (rho), es un proxy de la geografia del clipping.
""")
    log.info("Reporte: %s", md)
    log.info("Tiempo total Test 1: %.1f min", (time.time() - t0) / 60)
    return verdict_auc, delta_auc


if __name__ == "__main__":
    sys.exit(0 if main()[0] != "RED_FLAG" else 1)
