#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ab_distance_river.py
--------------------
A/B rapido: ¿anadir `distance_to_river` (distancia euclidea a la red de
drenaje principal) al nucleo v3-T (9 feats -> 10) mejora el modelo SIN romper
la transferibilidad? Ejecuta el trabajo futuro #1 de la memoria.

distance_to_river se computa por zona DESDE la columna flow_accumulation del
propio parquet (reconstruyendo el grid 2D por row/col -> alineacion perfecta,
sin reproyeccion): red = flow_acc > p99.5, dilatada; dist = EDT(~red) * 10 m.

Compara in-domain (AUC CV-holdout Valencia) y transferencia (Algemesi: AUC +
recall al umbral recall>=0.75 fijado en Valencia) para 9 vs 10 features.
NO toca el modelo desplegado; solo decide si merece la pena adoptarlo.
"""
from __future__ import annotations
import logging, time
from pathlib import Path
import numpy as np, pandas as pd
from scipy.ndimage import distance_transform_edt, binary_dilation
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score, recall_score, precision_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
RS = 42

V3T = ["mean_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv", "water_count",
       "distance_to_stream", "flow_accumulation", "ndvi_mean", "twi", "hand"]
PARQUET = {"valencia": "data/dataset/training_dataset_v2.parquet",
           "algemesi": "data/dataset/training_dataset_algemesi.parquet"}


def add_distance_to_river(df: pd.DataFrame) -> pd.DataFrame:
    """Anade columna distance_to_river desde flow_accumulation via grid 2D."""
    r = df["row"].to_numpy("int32"); c = df["col"].to_numpy("int32")
    H, W = int(r.max()) + 1, int(c.max()) + 1
    grid = np.full((H, W), np.nan, "float32")
    grid[r, c] = df["flow_accumulation"].to_numpy("float32")
    pos = grid[np.isfinite(grid) & (grid > 0)]
    thr = np.percentile(pos, 99.5) if pos.size else np.inf
    river = np.isfinite(grid) & (grid > thr)
    river = binary_dilation(river, iterations=3)
    dist = distance_transform_edt(~river).astype("float32") * 10.0  # 10 m/px
    df = df.copy()
    df["distance_to_river"] = dist[r, c]
    return df


def _strat(df, n, rng, pos_frac):
    pos = df.index[df.flood_label == 1].to_numpy(); neg = df.index[df.flood_label == 0].to_numpy()
    npos = min(len(pos), int(n * pos_frac))
    idx = np.concatenate([rng.choice(pos, npos, False), rng.choice(neg, min(len(neg), n - npos), False)])
    rng.shuffle(idx); return idx


def _thr_recall(y, p, target=0.75):
    best = 0.02
    for t in np.linspace(0.02, 0.98, 97):
        if recall_score(y, p >= t, zero_division=0) >= target:
            best = t
    return best


def main():
    t0 = time.time(); rng = np.random.default_rng(RS)
    log.info("Cargando Valencia + computando distance_to_river...")
    val = pd.read_parquet(REPO / PARQUET["valencia"], columns=["row", "col", "flood_label", *V3T])
    val = val.loc[np.isfinite(val[V3T].to_numpy()).all(1)].reset_index(drop=True)
    val = add_distance_to_river(val)
    log.info("  distance_to_river Valencia: mediana=%.0fm", val["distance_to_river"].median())

    log.info("Cargando Algemesi + distance_to_river...")
    alg = pd.read_parquet(REPO / PARQUET["algemesi"], columns=["row", "col", "flood_label", *V3T])
    alg = alg.loc[np.isfinite(alg[V3T].to_numpy()).all(1)].reset_index(drop=True)
    alg = add_distance_to_river(alg)
    log.info("  distance_to_river Algemesi: mediana=%.0fm", alg["distance_to_river"].median())

    # splits Valencia: train 1.5M@20%, holdout natural 500k (in-domain + umbral)
    tr_idx = _strat(val, 1_500_000, rng, 0.20)
    pool = val.drop(index=tr_idx)
    ho_idx = _strat(pool, 500_000, rng, float(val.flood_label.mean()))
    tr, ho = val.loc[tr_idx], pool.loc[ho_idx]
    yT, yH = tr.flood_label.to_numpy("int8"), ho.flood_label.to_numpy("int8")
    yA = alg.flood_label.to_numpy("int8")

    for tag, feats in [("9-feat (actual)", V3T), ("10-feat (+river)", V3T + ["distance_to_river"])]:
        m = RandomForestClassifier(n_estimators=100, max_depth=12, class_weight="balanced_subsample",
                                   n_jobs=-1, random_state=RS)
        m.fit(tr[feats].to_numpy("float32"), yT)
        pH = m.predict_proba(ho[feats].to_numpy("float32"))[:, 1]
        pA = m.predict_proba(alg[feats].to_numpy("float32"))[:, 1]
        auc_in = roc_auc_score(yH, pH); auc_tr = roc_auc_score(yA, pA)
        thr = _thr_recall(yH, pH)
        rec_in = recall_score(yH, pH >= thr, zero_division=0)
        rec_tr = recall_score(yA, pA >= thr, zero_division=0)
        prec_tr = precision_score(yA, pA >= thr, zero_division=0)
        log.info("%-18s | in-domain AUC=%.4f recall=%.3f | TRANSFER AUC=%.4f recall=%.3f prec=%.4f (thr=%.3f)",
                 tag, auc_in, rec_in, auc_tr, rec_tr, prec_tr, thr)

    log.info("=== A/B en %.1f min ===", (time.time() - t0) / 60)


if __name__ == "__main__":
    raise SystemExit(main())
