#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
operating_points.py
-------------------
Curva precision-recall y PUNTOS DE OPERACION nombrados del modelo final v3-T
sobre un hold-out de Valencia a prevalencia natural. El mismo modelo se puede
usar en varios regimenes segun el coste asimetrico; esto lo hace explicito sin
cambiar nada del modelo:

  - cribado          : recall >= 0.90 (maxima sensibilidad; barre exposicion)
  - operativo (0.14) : recall >= 0.75 (el umbral desplegado)
  - triaje           : maxima precision con recall >= 0.40 (prioriza inspeccion)

Salida: results/model/operating_points.json (curva + 3 puntos) para la web/memoria.
Uso: .venv/Scripts/python.exe scripts/models/operating_points.py
"""
from __future__ import annotations
import json, logging
from pathlib import Path
import joblib, numpy as np, pandas as pd
from sklearn.metrics import precision_score, recall_score, f1_score

from river_feature import add_distance_to_river

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]
RS = 42
RIVER = "distance_to_river"


def main():
    rng = np.random.default_rng(RS)
    model = joblib.load(REPO / "models/random_forest_v3t.joblib")
    cal = joblib.load(REPO / "models/v3t_calibrator.joblib")
    iso, FEATS, THR = cal["isotonic"], cal["features"], cal["threshold"]

    parquet_feats = [f for f in FEATS if f != RIVER]
    df = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                         columns=["row", "col", "flood_label", *parquet_feats])
    df = df.loc[np.isfinite(df[parquet_feats].to_numpy()).all(1)].reset_index(drop=True)
    if RIVER in FEATS:
        df = add_distance_to_river(df, "valencia", REPO)
        df = df.loc[np.isfinite(df[RIVER].to_numpy())].reset_index(drop=True)
    idx = rng.choice(df.index.to_numpy(), min(1_000_000, len(df)), replace=False)
    sub = df.loc[idx]
    y = sub["flood_label"].to_numpy("int8")
    p = iso.predict(model.predict_proba(sub[FEATS].to_numpy("float32"))[:, 1])

    ts = np.round(np.linspace(0.02, 0.95, 94), 3)
    curve = []
    for t in ts:
        pred = p >= t
        curve.append({"t": float(t),
                      "precision": float(precision_score(y, pred, zero_division=0)),
                      "recall": float(recall_score(y, pred, zero_division=0)),
                      "f1": float(f1_score(y, pred, zero_division=0))})

    def pick(cond, key, maximize=True):
        cand = [c for c in curve if cond(c)]
        if not cand:
            return None
        return (max if maximize else min)(cand, key=key)

    points = {
        "cribado": pick(lambda c: c["recall"] >= 0.90, lambda c: c["precision"]),
        "operativo": min(curve, key=lambda c: abs(c["t"] - THR)),
        "triaje": pick(lambda c: c["recall"] >= 0.40, lambda c: c["precision"]),
    }
    out = {"threshold_operational": THR, "curve": curve, "points": points,
           "note": "Mismo modelo v3-T, distintos puntos de operacion segun coste asimetrico."}
    (REPO / "results/model/operating_points.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    for name, pt in points.items():
        if pt:
            log.info("%-10s t=%.3f  P=%.3f R=%.3f F1=%.3f", name, pt["t"], pt["precision"], pt["recall"], pt["f1"])
    log.info("Escrito: results/model/operating_points.json")


if __name__ == "__main__":
    raise SystemExit(main())
