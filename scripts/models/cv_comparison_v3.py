"""Fast CV comparison v2 vs v3 vs XGBoost."""
import json, numpy as np, time
from pathlib import Path
import pandas as pd, rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, f1_score, precision_score, recall_score

REPO = Path(".").resolve()
RND = 42; N_EST = 300; MAX_D = 12

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

# Cargar features
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

print("Cargando features...")
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

# DataFrame
valid = np.isfinite(stack[0]) & (lbl != 255)
rr, cc = np.where(valid)
data = {"row": rr.astype("int32"), "col": cc.astype("int32")}
for i, name in enumerate(FEATURES_V3): data[name] = stack[i][valid]
data["flood_label"] = lbl[valid].astype("int8")
df = pd.DataFrame(data)
del stack, lbl
df = df.loc[~df[FEATURES_V3].isna().any(axis=1)].reset_index(drop=True)
print(f"Dataset: {len(df):,} filas  pos={df.flood_label.sum():,} ({100*df.flood_label.mean():.1f}%)")

# 2M CV sample
N_CV = min(2_000_000, len(df))
pos_mask = df["flood_label"] == 1
df_pos = df[pos_mask]; df_neg = df[~pos_mask]
n_p = min(len(df_pos), int(N_CV*0.2)); n_n = N_CV - n_p
df_cv = pd.concat([df_pos.sample(n_p, random_state=RND), df_neg.sample(n_n, random_state=RND)]).sample(frac=1, random_state=RND)
X_cv = df_cv[FEATURES_V3].to_numpy("float32"); y_cv = df_cv["flood_label"].to_numpy("int8")
ncb = int(np.ceil(cols / 100))
groups_cv = (df_cv["row"].to_numpy()//100 * ncb + df_cv["col"].to_numpy()//100).astype("int32")
print(f"CV sample: {len(df_cv):,} pos={y_cv.sum():,} ({100*y_cv.mean():.1f}%)")

# CV 5-fold
gkf = GroupKFold(n_splits=5)
cv_rf = []; cv_xgb = []
for fold, (tr, vl) in enumerate(gkf.split(X_cv, y_cv, groups_cv)):
    t0 = time.time()
    rf = RandomForestClassifier(n_estimators=N_EST, max_depth=MAX_D,
                                class_weight="balanced_subsample", n_jobs=-1, random_state=RND)
    xgb = XGBClassifier(n_estimators=N_EST, max_depth=MAX_D,
                        scale_pos_weight=(y_cv==0).sum()/max((y_cv==1).sum(),1),
                        eval_metric="logloss", random_state=RND, n_jobs=-1)
    rf.fit(X_cv[tr], y_cv[tr]); xgb.fit(X_cv[tr], y_cv[tr])
    p_rf = rf.predict_proba(X_cv[vl])[:,1]; p_xgb = xgb.predict_proba(X_cv[vl])[:,1]
    cv_rf.append({"auc":float(roc_auc_score(y_cv[vl],p_rf)),
                  "f1":float(f1_score(y_cv[vl],p_rf>=0.5)),
                  "p":float(precision_score(y_cv[vl],p_rf>=0.5,zero_division=0)),
                  "r":float(recall_score(y_cv[vl],p_rf>=0.5))})
    cv_xgb.append({"auc":float(roc_auc_score(y_cv[vl],p_xgb)),
                   "f1":float(f1_score(y_cv[vl],p_xgb>=0.5)),
                   "p":float(precision_score(y_cv[vl],p_xgb>=0.5,zero_division=0)),
                   "r":float(recall_score(y_cv[vl],p_xgb>=0.5))})
    dt = time.time()-t0
    print(f"  Fold {fold+1}/5  RF: AUC={cv_rf[-1]['auc']:.3f} F1={cv_rf[-1]['f1']:.3f}  XGB: AUC={cv_xgb[-1]['auc']:.3f} F1={cv_xgb[-1]['f1']:.3f}  ({dt:.0f}s)")

# Comparativa
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
print("COMPARATIVA FINAL v2 vs RF v3 vs XGBoost")
print("=" * 80)
print(f"  {'Metrica':<12s}  {'v2 (14 feat)':>18s}  {'RF v3 (24 feat)':>18s}  {'XGBoost (24 feat)':>18s}")
print(f"  {'-'*12}  {'-'*18}  {'-'*18}  {'-'*18}")
print(f"  {'AUC-ROC':12s}  {v2_auc:>18.4f}  {rf_auc:>18.4f}  {xgb_auc:>18.4f}")
print(f"  {'F1':12s}  {v2_f1:>18.4f}  {rf_f1:>18.4f}  {xgb_f1:>18.4f}")
print(f"  {'Precision':12s}  {v2_prec:>18.4f}  {rf_prec:>18.4f}  {xgb_prec:>18.4f}")
print(f"  {'Recall':12s}  {v2_rec:>18.4f}  {rf_rec:>18.4f}  {xgb_rec:>18.4f}")
print("=" * 80)
print(f"  DELTA v2 -> RF v3:   AUC {rf_auc-v2_auc:+.4f}  F1 {rf_f1-v2_f1:+.4f}  Recall {rf_rec-v2_rec:+.4f}  Precision {rf_prec-v2_prec:+.4f}")
print(f"  DELTA v2 -> XGBoost: AUC {xgb_auc-v2_auc:+.4f}  F1 {xgb_f1-v2_f1:+.4f}  Recall {xgb_rec-v2_rec:+.4f}  Precision {xgb_prec-v2_prec:+.4f}")
