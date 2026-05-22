"""CV rapida: 500K sample, 5-fold, RF v3 + XGBoost. Resultados en 25 min."""
import json, numpy as np, time
from pathlib import Path
import pandas as pd, rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, f1_score, precision_score, recall_score
from concurrent.futures import ThreadPoolExecutor

REPO = Path(".").resolve()
RND = 42; N_EST = 200; MAX_D = 10

FEATURES_V3 = [
    'mean_sigma0_vv','std_sigma0_vv','min_sigma0_vv','cv_sigma0_vv',
    'mean_vv_vh_ratio','water_count','elevation','slope',
    'distance_to_stream','flow_accumulation','ndvi_mean',
    'distance_to_coast','twi','hand','urban_mask',
    'local_std_5x5','local_range_5x5',
    'summer_mean_sigma0_vv','winter_mean_sigma0_vv',
    'summer_min_sigma0_vv','winter_min_sigma0_vv',
    'summer_std_sigma0_vv','winter_std_sigma0_vv','winter_minus_summer_vv',
]

print("Cargando features (esto toma ~1 min)...")
wf_path = REPO / "data/sentinel1/water_masks/water_frequency.tif"
with rasterio.open(wf_path) as ref:
    canon_t = ref.transform; canon_crs = ref.crs; canon_shape = (ref.height, ref.width)
rows, cols = canon_shape

feat_src = {
    'mean_sigma0_vv':'data/features/sar/mean_sigma0_vv.tif',
    'std_sigma0_vv':'data/features/sar/std_sigma0_vv.tif',
    'min_sigma0_vv':'data/features/sar/min_sigma0_vv.tif',
    'cv_sigma0_vv':'data/features/sar/cv_sigma0_vv.tif',
    'mean_vv_vh_ratio':'data/features/sar/mean_vv_vh_ratio.tif',
    'water_count':'data/features/sar/water_count.tif',
    'elevation':'data/dem/elevation.tif',
    'slope':'data/dem/slope.tif',
    'distance_to_stream':'data/dem/distance_to_stream.tif',
    'flow_accumulation':'data/dem/flow_accumulation.tif',
    'ndvi_mean':'data/features/optical/ndvi_mean.tif',
    'distance_to_coast':'data/dem/distance_to_coast.tif',
    'twi':'data/dem/twi.tif',
    'hand':'data/dem/hand.tif',
    'urban_mask':'data/features/advanced/urban_mask.tif',
    'local_std_5x5':'data/features/advanced/local_std_5x5.tif',
    'local_range_5x5':'data/features/advanced/local_range_5x5.tif',
    'summer_mean_sigma0_vv':'data/features/advanced/summer_mean_sigma0_vv.tif',
    'winter_mean_sigma0_vv':'data/features/advanced/winter_mean_sigma0_vv.tif',
    'summer_min_sigma0_vv':'data/features/advanced/summer_min_sigma0_vv.tif',
    'winter_min_sigma0_vv':'data/features/advanced/winter_min_sigma0_vv.tif',
    'summer_std_sigma0_vv':'data/features/advanced/summer_std_sigma0_vv.tif',
    'winter_std_sigma0_vv':'data/features/advanced/winter_std_sigma0_vv.tif',
    'winter_minus_summer_vv':'data/features/advanced/winter_minus_summer_vv.tif',
}

stack = np.empty((24, rows, cols), dtype="float32")
for i, name in enumerate(FEATURES_V3):
    with rasterio.open(REPO / feat_src[name]) as src:
        arr = src.read(1).astype("float32")
    if src.crs != canon_crs or (src.height,src.width) != canon_shape:
        arr_r = np.full(canon_shape, np.nan, dtype="float32")
        reproject(source=arr, destination=arr_r, src_transform=src.transform,
                  src_crs=src.crs, dst_transform=canon_t, dst_crs=canon_crs,
                  resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan)
        arr = arr_r
    nd = src.nodata
    if nd is not None and not np.isnan(nd): arr[arr==nd] = np.nan
    stack[i] = arr
print(f"  {len(FEATURES_V3)} features, shape={stack.shape}")

# Label
with rasterio.open(REPO / "data/labels/flood_mask_emsr773_clipped.tif") as src:
    lbl = src.read(1).astype("uint8")
if src.crs != canon_crs or (src.height,src.width) != canon_shape:
    lbl_r = np.full(canon_shape, 255, dtype="uint8")
    reproject(source=lbl, destination=lbl_r, src_transform=src.transform,
              src_crs=src.crs, dst_transform=canon_t, dst_crs=canon_crs,
              resampling=Resampling.nearest, src_nodata=255, dst_nodata=255)
    lbl = lbl_r

valid = np.isfinite(stack[0]) & (lbl != 255)
rr, cc = np.where(valid)
data = {"row": rr.astype("int32"), "col": cc.astype("int32")}
for i, name in enumerate(FEATURES_V3): data[name] = stack[i][valid]
data["flood_label"] = lbl[valid].astype("int8")
df = pd.DataFrame(data)
del stack, lbl
df = df.loc[~df[FEATURES_V3].isna().any(axis=1)].reset_index(drop=True)
print(f"Dataset: {len(df):,} filas  pos={int(df.flood_label.sum()):,} ({100*df.flood_label.mean():.1f}%)")

# 500K CV sample (estratificado)
N_CV = 500_000
pos_mask = df["flood_label"] == 1
df_pos = df[pos_mask]; df_neg = df[~pos_mask]
n_p = min(len(df_pos), 100_000); n_n = N_CV - n_p
df_cv = pd.concat([df_pos.sample(n_p, random_state=RND), df_neg.sample(n_n, random_state=RND)]).sample(frac=1, random_state=RND)
X_cv = df_cv[FEATURES_V3].to_numpy("float32"); y_cv = df_cv["flood_label"].to_numpy("int8")
ncb = int(np.ceil(cols / 100))
groups_cv = (df_cv["row"].to_numpy()//100 * ncb + df_cv["col"].to_numpy()//100).astype("int32")
print(f"CV sample: {len(df_cv):,} pos={int(y_cv.sum()):,} ({100*y_cv.mean():.1f}%)")

# CV 5-fold
print("\nEjecutando CV 5-fold (RF v3 + XGBoost)...")
gkf = GroupKFold(n_splits=5)
cv_rf = []; cv_xgb = []
tstart = time.time()
for fold, (tr, vl) in enumerate(gkf.split(X_cv, y_cv, groups_cv)):
    t0 = time.time()
    rf = RandomForestClassifier(n_estimators=N_EST, max_depth=MAX_D,
                                class_weight="balanced_subsample", n_jobs=-1, random_state=RND)
    xgb = XGBClassifier(n_estimators=N_EST, max_depth=MAX_D,
                        scale_pos_weight=(y_cv==0).sum()/max((y_cv==1).sum(),1),
                        eval_metric="logloss", verbosity=0, random_state=RND, n_jobs=-1)
    rf.fit(X_cv[tr], y_cv[tr])
    xgb.fit(X_cv[tr], y_cv[tr])
    p_rf = rf.predict_proba(X_cv[vl])[:,1]; p_xgb = xgb.predict_proba(X_cv[vl])[:,1]
    cv_rf.append({"auc":float(roc_auc_score(y_cv[vl],p_rf)),
                  "f1":float(f1_score(y_cv[vl],p_rf>=0.5)),
                  "p":float(precision_score(y_cv[vl],p_rf>=0.5,zero_division=0)),
                  "r":float(recall_score(y_cv[vl],p_rf>=0.5))})
    cv_xgb.append({"auc":float(roc_auc_score(y_cv[vl],p_xgb)),
                   "f1":float(f1_score(y_cv[vl],p_xgb>=0.5)),
                   "p":float(precision_score(y_cv[vl],p_xgb>=0.5,zero_division=0)),
                   "r":float(recall_score(y_cv[vl],p_xgb>=0.5))})
    print(f"  Fold {fold+1}/5  RF: AUC={cv_rf[-1]['auc']:.4f} F1={cv_rf[-1]['f1']:.4f}  XGB: AUC={cv_xgb[-1]['auc']:.4f} F1={cv_xgb[-1]['f1']:.4f}  ({time.time()-t0:.0f}s)")

# Comparativa con v2
v2_path = REPO / "results/model/metrics_v2.json"
v2_auc=v2_f1=v2_prec=v2_rec=0
if v2_path.exists():
    v2 = json.load(open(v2_path))
    v2_auc = v2.get("AUC_ROC", v2.get("auc_roc", 0))
    v2_f1 = v2.get("F1", v2.get("f1", 0))
    v2_prec = v2.get("Precision", v2.get("precision", 0))
    v2_rec = v2.get("Recall", v2.get("recall", 0))

rf_auc = np.mean([f["auc"] for f in cv_rf])
rf_f1 = np.mean([f["f1"] for f in cv_rf])
rf_prec = np.mean([f["p"] for f in cv_rf])
rf_rec = np.mean([f["r"] for f in cv_rf])
xgb_auc = np.mean([f["auc"] for f in cv_xgb])
xgb_f1 = np.mean([f["f1"] for f in cv_xgb])
xgb_prec = np.mean([f["p"] for f in cv_xgb])
xgb_rec = np.mean([f["r"] for f in cv_xgb])

print()
print("=" * 80)
print("COMPARATIVA FINAL")
print("=" * 80)
print(f"  {'Metrica':<12s}  {'v2 (14 feat)':>16s}  {'RF v3 (24 feat)':>16s}  {'XGBoost (24 feat)':>18s}  {'Delta RF':>10s}  {'Delta XGB':>10s}")
print(f"  {'-'*12}  {'-'*16}  {'-'*16}  {'-'*18}  {'-'*10}  {'-'*10}")
for label, v2val, rfval, xgbval in [
    ("AUC-ROC", v2_auc, rf_auc, xgb_auc),
    ("F1", v2_f1, rf_f1, xgb_f1),
    ("Precision", v2_prec, rf_prec, xgb_prec),
    ("Recall", v2_rec, rf_rec, xgb_rec),
]:
    dr = f"{(rfval-v2val):+.4f}"; dx = f"{(xgbval-v2val):+.4f}"
    print(f"  {label:<12s}  {v2val:>16.4f}  {rfval:>16.4f}  {xgbval:>18.4f}  {dr:>10s}  {dx:>10s}")
print("=" * 80)
print(f"  Total: {time.time()-tstart:.0f}s  ({N_EST} trees, {MAX_D} max_depth, {N_CV//1000}k samples)")
print()

# Guardar metricas
results = {
    "features": FEATURES_V3, "n_features": len(FEATURES_V3),
    "cv_samples": N_CV, "n_estimators": N_EST, "max_depth": MAX_D,
    "rf_v3": {"auc_mean": float(rf_auc), "f1_mean": float(rf_f1), "precision_mean": float(rf_prec), "recall_mean": float(rf_rec),
              "folds": [{"auc": f["auc"], "f1": f["f1"], "precision": f["p"], "recall": f["r"]} for f in cv_rf]},
    "xgb": {"auc_mean": float(xgb_auc), "f1_mean": float(xgb_f1), "precision_mean": float(xgb_prec), "recall_mean": float(xgb_rec),
            "folds": [{"auc": f["auc"], "f1": f["f1"], "precision": f["p"], "recall": f["r"]} for f in cv_xgb]},
    "v2_baseline": {"auc_roc": v2_auc, "f1": v2_f1, "precision": v2_prec, "recall": v2_rec},
}
with open(REPO / "results/model/metrics_v3.json", "w") as fh:
    json.dump(results, fh, indent=2)
print("Metricas guardadas en results/model/metrics_v3.json")
