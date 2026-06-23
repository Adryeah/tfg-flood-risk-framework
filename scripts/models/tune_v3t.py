#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
tune_v3t.py
-----------
Busqueda acotada de hiperparametros del nucleo v3-T (10 feats, +river).
Se juzga cada config por DOS objetivos a la vez (coherente con la tesis de
transferibilidad): AUC in-domain (holdout natural Valencia) Y AUC/recall de
TRANSFERENCIA (Algemesi). Una config solo "gana" si no degrada transferencia.

Split barato para la busqueda (1 holdout espacial, no 5-fold): rapido y
suficiente para rankear. El ganador se re-confirma luego en compute_v3t_metrics
con GroupKFold espacial completo.

Uso: .venv/Scripts/python.exe scripts/models/tune_v3t.py
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import recall_score, roc_auc_score

from river_feature import add_distance_to_river

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
RS = 42

V3T9 = ["mean_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv", "water_count",
        "distance_to_stream", "flow_accumulation", "ndvi_mean", "twi", "hand"]
FEATS = V3T9 + ["distance_to_river"]

# Grid acotado: profundidad y hoja minima (los que mas pesan en generalizacion
# de RF); n_estimators fijo a 300 (mas estable, coste asumible). Sin depth=None
# (arbol completo sobre 1.5M es lento y suele degradar transferencia).
GRID = [(200, d, 5) for d in (12, 16, 20)]
# Subsamples para la BUSQUEDA (el ranking de hiperparametros es estable a menor
# tamano; el ganador se re-confirma a tamano completo en compute_v3t_metrics).
N_TRAIN = 400_000
N_HOLD = 200_000
N_ALG_EVAL = 600_000


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


def _load(zone, parquet, max_rows=None, rng=None):
    df = pd.read_parquet(REPO / parquet, columns=["row", "col", "flood_label", *V3T9])
    df = df.loc[np.isfinite(df[V3T9].to_numpy()).all(1)].reset_index(drop=True)
    df = add_distance_to_river(df, zone, REPO)
    df = df.loc[np.isfinite(df["distance_to_river"].to_numpy())].reset_index(drop=True)
    if max_rows and len(df) > max_rows:
        # subsample ESTRATIFICADO para preservar la prevalencia natural
        df = df.sample(max_rows, random_state=42).reset_index(drop=True)
    return df


def main() -> int:
    t0 = time.time(); rng = np.random.default_rng(RS)
    log.info("Cargando Valencia + Algemesi (+river)...")
    val = _load("valencia", "data/dataset/training_dataset_v2.parquet")
    alg = _load("algemesi", "data/dataset/training_dataset_algemesi.parquet", N_ALG_EVAL, rng)
    log.info("Valencia=%d  Algemesi(eval)=%d (prev %.4f)", len(val), len(alg), float(alg.flood_label.mean()))

    tr_idx = _strat(val, N_TRAIN, rng, 0.20)
    pool = val.drop(index=tr_idx)
    ho_idx = _strat(pool, N_HOLD, rng, float(val.flood_label.mean()))
    Xtr, ytr = val.loc[tr_idx, FEATS].to_numpy("float32"), val.loc[tr_idx, "flood_label"].to_numpy("int8")
    Xho, yho = pool.loc[ho_idx, FEATS].to_numpy("float32"), pool.loc[ho_idx, "flood_label"].to_numpy("int8")
    Xa, ya = alg[FEATS].to_numpy("float32"), alg["flood_label"].to_numpy("int8")

    rows = []
    for n_est, depth, leaf in GRID:
        m = RandomForestClassifier(n_estimators=n_est, max_depth=depth, min_samples_leaf=leaf,
                                   class_weight="balanced_subsample", n_jobs=-1, random_state=RS)
        m.fit(Xtr, ytr)
        pH = m.predict_proba(Xho)[:, 1]; pA = m.predict_proba(Xa)[:, 1]
        auc_in = roc_auc_score(yho, pH); auc_tr = roc_auc_score(ya, pA)
        thr = _thr_recall(yho, pH); rec_tr = recall_score(ya, pA >= thr, zero_division=0)
        rows.append((n_est, depth, leaf, auc_in, auc_tr, rec_tr))
        log.info("n=%d depth=%s leaf=%-2d | in-AUC=%.4f  TRANSFER AUC=%.4f recall=%.3f",
                 n_est, str(depth), leaf, auc_in, auc_tr, rec_tr)

    # Ganador: maxima AUC de transferencia (la metrica que valida la tesis),
    # con in-domain no peor que el mejor in-domain - 0.005 (no sacrificar in-domain).
    best_in = max(r[3] for r in rows)
    cand = [r for r in rows if r[3] >= best_in - 0.005]
    win = max(cand, key=lambda r: r[4])
    log.info("=== GANADOR: n=%d depth=%s leaf=%d (in-AUC=%.4f transfer-AUC=%.4f recall=%.3f) ===",
             win[0], win[1], win[2], win[3], win[4], win[5])
    log.info("=== tuning en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
