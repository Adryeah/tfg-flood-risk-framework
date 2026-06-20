#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
susceptibility_zones.py
-----------------------
Reencuadra la salida del modelo como MAPA DE SUSCEPTIBILIDAD POR ZONA
(no detector binario por pixel) y lo mide con las metricas correctas para
ese objetivo: ranking (gain/lift por zona) y calibracion (ECE).

Motivacion: a nivel pixel y evento raro (prevalencia 0,30% en Algemesi),
la precision binaria es estructuralmente baja y ENGANOSA para un producto
de susceptibilidad. Lo que importa a un suscriptor es: "el top-N% del
territorio mas susceptible, ¿cuanta inundacion real captura?" (gain) y
"¿el score 0,7 significa de verdad 70%?" (calibracion).

Usa el modelo TRANSFERIBLE `random_forest_v2_nocoast.joblib` aplicado a
Algemesi (extrapolacion, jamas visto en entrenamiento).

Pasos:
  1. predict_proba nocoast sobre Algemesi (chunked).
  2. Calibracion isotonica AJUSTADA en Valencia (complemento del set de
     entrenamiento -> sin fuga), medida sobre Algemesi: ECE antes/despues.
  3. Agregacion a zonas de 1 km (bloques row//100, col//100):
     susceptibilidad = media de P(flood) de la zona.
  4. Metricas de susceptibilidad: AUC a nivel zona + curva GAIN
     (top-N% area mas susceptible vs % inundaciones reales capturadas).

Salidas:
  results/model/susceptibility_zones.json
  results/diagnostics/extrapolation/susceptibility_gain_calibration.png

Uso:
  .venv/Scripts/python.exe scripts/models/susceptibility_zones.py
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score

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
RANDOM_STATE = 42
BLOCK_PX = 100              # 100 px * 10 m = zonas de 1 km
CHUNK = 2_000_000
N_TRAIN_SAMPLE = 1_500_000  # mismo que ab_drop_coast.py (para reconstruir split)
N_CALIB = 1_000_000

FEATURES_FULL = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]
FEATURES_NOCOAST = [f for f in FEATURES_FULL if f != "distance_to_coast"]


def _ece(y, p, n_bins=15):
    """Expected Calibration Error con binning uniforme."""
    bins = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, bins) - 1, 0, n_bins - 1)
    ece = 0.0
    for b in range(n_bins):
        m = idx == b
        if not m.any():
            continue
        ece += (m.mean()) * abs(y[m].mean() - p[m].mean())
    return float(ece)


def _reliability(y, p, n_bins=12):
    bins = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, bins) - 1, 0, n_bins - 1)
    conf, acc = [], []
    for b in range(n_bins):
        m = idx == b
        if m.sum() < 50:
            continue
        conf.append(float(p[m].mean()))
        acc.append(float(y[m].mean()))
    return conf, acc


def _predict_chunked(model, X):
    out = np.empty(len(X), dtype="float32")
    for s in range(0, len(X), CHUNK):
        e = min(s + CHUNK, len(X))
        out[s:e] = model.predict_proba(X[s:e])[:, 1].astype("float32")
    return out


def main() -> int:
    t0 = time.time()
    model = joblib.load(REPO / "models/random_forest_v2_nocoast.joblib")
    log.info("Modelo nocoast cargado (%d features)", model.n_features_in_)

    # ---- 1. Algemesi: predict ----
    log.info("Cargando Algemesi...")
    dfa = pd.read_parquet(REPO / "data/dataset/training_dataset_algemesi.parquet",
                          columns=["row", "col", "flood_label", *FEATURES_NOCOAST])
    fin = np.isfinite(dfa[FEATURES_NOCOAST].to_numpy()).all(axis=1)
    dfa = dfa.loc[fin].reset_index(drop=True)
    Xa = dfa[FEATURES_NOCOAST].to_numpy("float32")
    ya = dfa["flood_label"].to_numpy("int8")
    log.info("Algemesi: %d px  pos=%d (%.3f%%)", len(ya), ya.sum(), 100*ya.mean())
    pa = _predict_chunked(model, Xa)
    pix_auc = float(roc_auc_score(ya, pa))
    ece_raw = _ece(ya, pa)
    log.info("Pixel AUC=%.4f  ECE(sin calibrar)=%.4f", pix_auc, ece_raw)

    # ---- 2. Calibracion isotonica en Valencia (complemento del train) ----
    log.info("Reconstruyendo split de Valencia para calibrar sin fuga...")
    dfv = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet")
    finv = np.isfinite(dfv[FEATURES_FULL].to_numpy()).all(axis=1)
    dfv = dfv.loc[finv].reset_index(drop=True)
    train_idx = dfv.sample(N_TRAIN_SAMPLE, random_state=RANDOM_STATE).index
    calib = dfv.drop(index=train_idx)
    calib = calib.sample(min(N_CALIB, len(calib)), random_state=RANDOM_STATE)
    Xc = calib[FEATURES_NOCOAST].to_numpy("float32")
    yc = calib["flood_label"].to_numpy("int8")
    del dfv, calib
    log.info("Calibracion sobre %d px de Valencia (disjuntos del train)", len(yc))
    pc = _predict_chunked(model, Xc)
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(pc, yc)
    pa_cal = iso.predict(pa).astype("float32")
    ece_cal = _ece(ya, pa_cal)
    log.info("ECE(calibrado)=%.4f  (delta %.4f)", ece_cal, ece_cal - ece_raw)

    # ---- 3. Agregacion a zonas de 1 km ----
    log.info("Agregando a zonas de 1 km...")
    zone = (dfa["row"].to_numpy() // BLOCK_PX).astype("int64") * 100000 \
         + (dfa["col"].to_numpy() // BLOCK_PX).astype("int64")
    zdf = pd.DataFrame({"zone": zone, "p": pa_cal, "flood": ya})
    g = zdf.groupby("zone").agg(susc=("p", "mean"),
                                n_pix=("p", "size"),
                                n_flood=("flood", "sum")).reset_index()
    g["flooded"] = (g["n_flood"] > 0).astype("int8")
    log.info("Zonas: %d  inundadas=%d (%.1f%%)", len(g), g["flooded"].sum(),
             100*g["flooded"].mean())
    zone_auc = float(roc_auc_score(g["flooded"], g["susc"])) if g["flooded"].nunique() > 1 else None

    # ---- 4. Curva GAIN (ranking por susceptibilidad) ----
    gs = g.sort_values("susc", ascending=False).reset_index(drop=True)
    cum_area = np.cumsum(gs["n_pix"].to_numpy()) / gs["n_pix"].sum()
    cum_flood = np.cumsum(gs["n_flood"].to_numpy()) / gs["n_flood"].sum()
    # captura a top-N% de AREA
    def capture_at(frac):
        k = np.searchsorted(cum_area, frac)
        k = min(k, len(cum_flood) - 1)
        return float(cum_flood[k])
    capt = {f"top_{int(f*100)}pct_area": capture_at(f) for f in (0.05, 0.10, 0.20, 0.30, 0.50)}
    # lift = captura / fraccion (vs aleatorio)
    lift10 = capt["top_10pct_area"] / 0.10
    log.info("Zone AUC=%s  captura@10%%area=%.3f (lift x%.2f)  @20%%=%.3f  @30%%=%.3f",
             f"{zone_auc:.4f}" if zone_auc else "n/a",
             capt["top_10pct_area"], lift10, capt["top_20pct_area"], capt["top_30pct_area"])

    # ---- Salidas ----
    out = {
        "model": "random_forest_v2_nocoast (13 feat)",
        "zone_km": BLOCK_PX * 10 / 1000,
        "pixel_auc": pix_auc,
        "zone_auc": zone_auc,
        "n_zones": int(len(g)),
        "n_zones_flooded": int(g["flooded"].sum()),
        "gain_capture_by_area": capt,
        "lift_top10pct": lift10,
        "calibration": {"ece_raw": ece_raw, "ece_calibrated": ece_cal,
                        "improvement": ece_raw - ece_cal},
    }
    jp = REPO / "results/model/susceptibility_zones.json"
    jp.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("JSON: %s", jp.relative_to(REPO))

    if HAS_MPL:
        diag = REPO / "results/diagnostics/extrapolation"
        diag.mkdir(parents=True, exist_ok=True)
        fig, ax = plt.subplots(1, 2, figsize=(14, 6))
        # GAIN
        ax[0].plot(np.concatenate([[0], cum_area]), np.concatenate([[0], cum_flood]),
                   color="#2c7fb8", lw=2, label="Modelo (susceptibilidad)")
        ax[0].plot([0, 1], [0, 1], "--", color="#888", label="Aleatorio")
        for f in (0.10, 0.20, 0.30):
            ax[0].axvline(f, color="#d73027", ls=":", lw=0.8)
        ax[0].set_xlabel("Fracción del territorio (más susceptible primero)")
        ax[0].set_ylabel("Fracción de inundaciones reales capturadas")
        ax[0].set_title(f"Curva GAIN por zona 1 km  ·  captura@10%%={capt['top_10pct_area']:.0%} (lift x{lift10:.1f})")
        ax[0].legend(); ax[0].grid(True, alpha=0.3)
        # CALIBRACION
        c0, a0 = _reliability(ya, pa)
        c1, a1 = _reliability(ya, pa_cal)
        ax[1].plot([0, 1], [0, 1], "--", color="#888", label="Perfecta")
        ax[1].plot(c0, a0, "o-", color="#f46d43", label=f"Sin calibrar (ECE={ece_raw:.3f})")
        ax[1].plot(c1, a1, "s-", color="#2c7fb8", label=f"Calibrado (ECE={ece_cal:.3f})")
        ax[1].set_xlabel("Probabilidad predicha"); ax[1].set_ylabel("Frecuencia real")
        ax[1].set_title("Fiabilidad (calibración) — Algemesí")
        ax[1].legend(); ax[1].grid(True, alpha=0.3)
        plt.tight_layout()
        png = diag / "susceptibility_gain_calibration.png"
        plt.savefig(png, dpi=150, bbox_inches="tight")
        plt.close()
        log.info("PNG: %s", png.relative_to(REPO))

    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
