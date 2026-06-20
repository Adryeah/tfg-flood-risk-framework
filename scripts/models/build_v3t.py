#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_v3t.py
------------
Construye el modelo-nucleo TRANSFERIBLE del TFG (RF v3-T): mejora del
RF v2 para que generalice fuera de Valencia.

Decide CON DATOS entre tres conjuntos de features y consolida el ganador
con calibracion isotonica + envoltura AOA.

Conjuntos comparados:
  - v2_full : 14 features (baseline actual del TFG).
  - lozo10  : quita {elevation, slope, std_sigma0_vv, mean_vv_vh_ratio}
              (seleccion por ablacion LOZO; mejor AUC cruzado).
  - lozo9   : lozo10 - distance_to_coast (anade la senal de recall del A/B).

Evaluacion LOZO bidireccional (sin fuga: el modelo nunca ve la zona test):
  - A->B (Valencia->Algemesi): suite completa
        AUC cruzado, ECE antes/despues de calibrar, recall/precision al
        umbral operacional (recall>=0,75 fijado en la zona de entreno),
        cobertura AOA y nº de inundaciones dentro de AOA.
  - B->A (Algemesi->Valencia): AUC cruzado (chequeo de simetria).

Calibracion: isotonica ajustada en un HOLD-OUT de la zona de entreno
(disjunto del train) y aplicada a la zona test. El umbral tambien sale de
ese hold-out. Nada se ajusta sobre la zona test.

Regla de seleccion (para ESTE caso de estudio = susceptibilidad
transferible para suscripcion): maximizar recall calibrado A->B siempre
que el AUC cruzado no caiga > 0,01 respecto al mejor.

Salida: models/random_forest_v3t.joblib, models/v3t_calibrator.joblib,
        results/model/v3t_build.json

Uso: .venv/Scripts/python.exe scripts/models/build_v3t.py
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from scipy.spatial.distance import pdist
from sklearn.ensemble import RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import precision_score, recall_score, roc_auc_score

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RS = 42
MAX_DEPTH = 12
N_EST = 150
N_TRAIN = 600_000
N_CALIB = 400_000
N_TEST = 1_500_000
N_FINAL = 2_000_000          # train del v3-T final (muestra grande de Valencia)
N_REF_AOA = 150_000
BLOCK_PX = 100

FEATURES_FULL = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]
DROP_LOZO = ["elevation", "slope", "std_sigma0_vv", "mean_vv_vh_ratio"]
LOZO10 = [f for f in FEATURES_FULL if f not in DROP_LOZO]
LOZO9 = [f for f in LOZO10 if f != "distance_to_coast"]
SETS = {"v2_full": FEATURES_FULL, "lozo10": LOZO10, "lozo9": LOZO9}


def _strat(df, n, rng):
    pos = df.index[df["flood_label"] == 1].to_numpy()
    neg = df.index[df["flood_label"] == 0].to_numpy()
    npos = min(len(pos), int(n * 0.2))
    idx = np.concatenate([rng.choice(pos, npos, replace=False),
                          rng.choice(neg, min(len(neg), n - npos), replace=False)])
    rng.shuffle(idx)
    return idx


def _ece(y, p, nb=15):
    b = np.linspace(0, 1, nb + 1)
    idx = np.clip(np.digitize(p, b) - 1, 0, nb - 1)
    e = 0.0
    for k in range(nb):
        m = idx == k
        if m.any():
            e += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(e)


def _thr_at_recall(y, p, target=0.75):
    best = 0.02
    for t in np.linspace(0.02, 0.98, 97):
        if recall_score(y, p >= t, zero_division=0) >= target:
            best = t
    return float(best)


def _fit(feats, Xdf, y):
    m = RandomForestClassifier(n_estimators=N_EST, max_depth=MAX_DEPTH,
                               class_weight="balanced_subsample", n_jobs=-1,
                               random_state=RS)
    m.fit(Xdf[feats].to_numpy("float32"), y)
    return m


def _aoa(train_df, feats, w, test_df, y_test, rng):
    Xtr = train_df[feats].to_numpy("float64")
    mu, sd = Xtr.mean(0), Xtr.std(0); sd[sd < 1e-9] = 1e-9
    nref = min(N_REF_AOA, len(Xtr))
    ref = (((Xtr[rng.choice(len(Xtr), nref, replace=False)] - mu) / sd) * w).astype("float32")
    dbar = float(pdist(ref[rng.choice(nref, min(3000, nref), replace=False)].astype("float64")).mean())
    tree = cKDTree(ref)
    di_tr = tree.query(ref, k=2, workers=-1)[0][:, 1] / dbar
    q75, q25 = np.percentile(di_tr, [75, 25])
    thr = q75 + 1.5 * (q75 - q25)
    Xte = (((test_df[feats].to_numpy("float64") - mu) / sd) * w).astype("float32")
    di_te = tree.query(Xte, k=1, workers=-1)[0] / dbar
    inside = di_te <= thr
    return {"pct_inside": float(100 * inside.mean()),
            "flood_inside": int(((y_test == 1) & inside).sum()),
            "flood_total": int((y_test == 1).sum())}


def _zone_gain(rows, cols, p, y):
    zone = (rows // BLOCK_PX).astype("int64") * 100000 + (cols // BLOCK_PX).astype("int64")
    g = pd.DataFrame({"z": zone, "p": p, "f": y}).groupby("z").agg(
        susc=("p", "mean"), npix=("p", "size"), nfl=("f", "sum")).reset_index()
    gs = g.sort_values("susc", ascending=False)
    ca = np.cumsum(gs["npix"].to_numpy()) / gs["npix"].sum()
    cf = np.cumsum(gs["nfl"].to_numpy()) / max(gs["nfl"].sum(), 1)
    zauc = float(roc_auc_score((g["nfl"] > 0).astype(int), g["susc"])) if (g["nfl"] > 0).nunique() > 1 else None
    cap = lambda fr: float(cf[min(np.searchsorted(ca, fr), len(cf) - 1)])
    return {"zone_auc": zauc, "capture_top10pct": cap(0.10), "capture_top30pct": cap(0.30)}


def main() -> int:
    t0 = time.time()
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    global N_EST, N_TRAIN, N_CALIB, N_TEST, N_FINAL, N_REF_AOA
    if args.smoke:
        N_EST, N_TRAIN, N_CALIB, N_TEST, N_FINAL, N_REF_AOA = 40, 20_000, 15_000, 50_000, 25_000, 10_000
    rng = np.random.default_rng(RS)

    log.info("Cargando zonas...")
    val = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                          columns=["row", "col", "flood_label", *FEATURES_FULL])
    val = val.loc[np.isfinite(val[FEATURES_FULL].to_numpy()).all(1)].reset_index(drop=True)
    alg = pd.read_parquet(REPO / "data/dataset/training_dataset_algemesi.parquet",
                          columns=["row", "col", "flood_label", *FEATURES_FULL])
    alg = alg.loc[np.isfinite(alg[FEATURES_FULL].to_numpy()).all(1)].reset_index(drop=True)
    log.info("Valencia=%d  Algemesi=%d", len(val), len(alg))

    # Samples Valencia: train + calib disjuntos
    tr_v_idx = _strat(val, N_TRAIN, rng)
    pool = val.drop(index=tr_v_idx)
    cal_v_idx = _strat(pool.reset_index(), N_CALIB, rng)  # indices sobre pool reset
    train_V = val.loc[tr_v_idx].reset_index(drop=True)
    calib_V = pool.reset_index(drop=True).loc[cal_v_idx].reset_index(drop=True)
    test_A = alg.sample(min(N_TEST, len(alg)), random_state=RS).reset_index(drop=True)
    # Algemesi train (para B->A) + test Valencia
    tr_a_idx = _strat(alg, N_TRAIN, rng)
    train_A = alg.loc[tr_a_idx].reset_index(drop=True)
    test_V = val.sample(min(N_TEST, len(val)), random_state=RS + 1).reset_index(drop=True)

    yVtr = train_V["flood_label"].to_numpy("int8")
    yVcal = calib_V["flood_label"].to_numpy("int8")
    yAte = test_A["flood_label"].to_numpy("int8")
    yAtr = train_A["flood_label"].to_numpy("int8")
    yVte = test_V["flood_label"].to_numpy("int8")
    log.info("train_V=%d calib_V=%d test_A=%d (pos %d)  train_A=%d test_V=%d",
             len(train_V), len(calib_V), len(test_A), yAte.sum(), len(train_A), len(test_V))

    comp = {}
    for name, feats in SETS.items():
        log.info("==== %s (%d feat) ====", name, len(feats))
        # A->B
        m = _fit(feats, train_V, yVtr)
        p_cal_raw = m.predict_proba(calib_V[feats].to_numpy("float32"))[:, 1]
        iso = IsotonicRegression(out_of_bounds="clip").fit(p_cal_raw, yVcal)
        thr = _thr_at_recall(yVcal, iso.predict(p_cal_raw))
        p_te = m.predict_proba(test_A[feats].to_numpy("float32"))[:, 1]
        p_te_cal = iso.predict(p_te)
        auc = float(roc_auc_score(yAte, p_te))
        rec = float(recall_score(yAte, p_te_cal >= thr, zero_division=0))
        prec = float(precision_score(yAte, p_te_cal >= thr, zero_division=0))
        ece_raw, ece_cal = _ece(yAte, p_te), _ece(yAte, p_te_cal)
        w = m.feature_importances_.astype("float64"); w = w / w.sum()
        aoa = _aoa(train_V, feats, w, test_A, yAte, rng)
        gain = _zone_gain(test_A["row"].to_numpy(), test_A["col"].to_numpy(), p_te_cal, yAte)
        # B->A (AUC simetria)
        m2 = _fit(feats, train_A, yAtr)
        auc_b2a = float(roc_auc_score(yVte, m2.predict_proba(test_V[feats].to_numpy("float32"))[:, 1]))
        comp[name] = {"n_feat": len(feats), "thr": thr,
                      "a2b": {"auc": auc, "recall_cal": rec, "precision_cal": prec,
                              "ece_raw": ece_raw, "ece_cal": ece_cal, **aoa, **gain},
                      "b2a_auc": auc_b2a}
        log.info("  A->B AUC=%.4f recall_cal=%.4f prec=%.4f ECE %.3f->%.3f AOA=%.1f%% fl_in=%d/%d zoneAUC=%s",
                 auc, rec, prec, ece_raw, ece_cal, aoa["pct_inside"],
                 aoa["flood_inside"], aoa["flood_total"],
                 f"{gain['zone_auc']:.3f}" if gain["zone_auc"] else "n/a")
        log.info("  B->A AUC=%.4f", auc_b2a)

    # Seleccion: max recall_cal A->B con AUC no peor que (mejor_AUC - 0,01)
    best_auc = max(c["a2b"]["auc"] for c in comp.values())
    elig = {k: c for k, c in comp.items() if c["a2b"]["auc"] >= best_auc - 0.01}
    winner = max(elig, key=lambda k: elig[k]["a2b"]["recall_cal"])
    log.info("==== GANADOR: %s ====", winner)

    # Construir v3-T final: set ganador, train grande Valencia + calibrador
    feats_w = SETS[winner]
    fin_idx = _strat(val, N_FINAL, rng)
    train_F = val.loc[fin_idx]
    cal_idx = _strat(val.drop(index=fin_idx).reset_index(), N_CALIB, rng)
    cal_F = val.drop(index=fin_idx).reset_index(drop=True).loc[cal_idx].reset_index(drop=True)
    log.info("v3-T final: train=%d calib=%d feats=%d", len(train_F), len(cal_F), len(feats_w))
    m_final = _fit(feats_w, train_F, train_F["flood_label"].to_numpy("int8"))
    iso_final = IsotonicRegression(out_of_bounds="clip").fit(
        m_final.predict_proba(cal_F[feats_w].to_numpy("float32"))[:, 1],
        cal_F["flood_label"].to_numpy("int8"))
    joblib.dump(m_final, REPO / "models/random_forest_v3t.joblib", compress=3)
    joblib.dump({"isotonic": iso_final, "features": feats_w, "threshold": comp[winner]["thr"]},
                REPO / "models/v3t_calibrator.joblib", compress=3)

    out = {"winner": winner, "features_v3t": feats_w, "comparison": comp,
           "selection_rule": "max recall_cal A->B con AUC >= best_auc - 0.01"}
    (REPO / "results/model/v3t_build.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Guardado: models/random_forest_v3t.joblib (+calibrator) | results/model/v3t_build.json")

    # Tabla
    print("\n" + "=" * 92)
    print(f"  {'modelo':<10}{'feat':>5}{'AUC A->B':>10}{'recall_cal':>12}{'prec':>8}"
          f"{'ECE_cal':>9}{'AOA%':>7}{'fl_in':>8}{'zAUC':>7}{'AUC B->A':>10}")
    print("=" * 92)
    for k, c in comp.items():
        a = c["a2b"]
        mark = "  <- v3-T" if k == winner else ""
        z = f"{a['zone_auc']:.3f}" if a["zone_auc"] else "n/a"
        print(f"  {k:<10}{c['n_feat']:>5}{a['auc']:>10.4f}{a['recall_cal']:>12.4f}"
              f"{a['precision_cal']:>8.4f}{a['ece_cal']:>9.3f}{a['pct_inside']:>7.1f}"
              f"{a['flood_inside']:>8d}{z:>7}{c['b2a_auc']:>10.4f}{mark}")
    print("=" * 92)
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
