#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
aoa_analysis.py
---------------
Area of Applicability (AOA) y Dissimilarity Index (DI) de Meyer & Pebesma
(2021) para el modelo Random Forest v2 entrenado en Valencia / L'Horta Sud
y extrapolado a Algemesi (Ribera Alta/Baixa).

QUE RESPONDE
    El AUC se mantiene al extrapolar (0.92 -> 0.82) pero el recall se
    desploma (0.78 -> 0.18). La pregunta es DONDE es competente el modelo.
    La AOA delimita, pixel a pixel, en que parte de Algemesi el modelo
    predice dentro del dominio de features visto en entrenamiento (AOA) y
    donde extrapola a ciegas (fuera de AOA). Las metricas se recalculan por
    separado dentro vs fuera de AOA para demostrar que la degradacion se
    concentra en la zona de extrapolacion.

METODO (Meyer & Pebesma 2021, Methods Ecol. Evol. 12(9), DOI 10.1111/2041-210X.13650)
    1. Estandarizar features con media/sd del TRAIN (Valencia).
    2. Ponderar cada feature por su permutation importance (las features
       irrelevantes no deben dominar la distancia).
    3. d_bar = distancia media entre puntos de entrenamiento en ese espacio
       ponderado.
    4. DI(p) = distancia del punto p al vecino de entrenamiento mas cercano
       / d_bar.
    5. Umbral AOA = Q75(DI_train) + 1.5*IQR(DI_train) (regla del outlier
       sobre la DI leave-one-out del propio train). DI <= umbral => dentro.

    Nota: se usa la version LOO-NN de la DI del train (sin re-derivar el
    umbral por folds de CV como en el metodo completo de CAST). Es la
    simplificacion estandar de trainDI cuando no se pasan los folds y es
    suficiente para delimitar el dominio; se documenta como tal.

Inputs (verificados en disco):
    data/dataset/training_dataset_v2.parquet          (Valencia, 14 feats v2)
    data/dataset/training_dataset_algemesi.parquet    (Algemesi, mismas feats)
    models/random_forest_v2.joblib
    results/model/permutation_importance_v2.json       (pesos)
    data/extrapolation/features/sar/water_frequency_algemesi.tif  (rejilla DI)

Salidas:
    results/model/aoa_analysis.json
    results/diagnostics/extrapolation/aoa_di_distributions.png
    results/maps/05_extrapolation/aoa_di_algemesi.tif        (mapa DI)
    results/maps/05_extrapolation/aoa_inside_algemesi.tif     (mascara 1=dentro)

Uso:
    .venv/Scripts/python.exe scripts/models/aoa_analysis.py
        [--n-ref 200000] [--threshold 0.614] [--chunk 2000000]
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import rasterio
from scipy.spatial import cKDTree
from scipy.spatial.distance import pdist
from sklearn.metrics import (f1_score, precision_score, recall_score,
                             roc_auc_score)

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except ImportError:
    HAS_MPL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
RANDOM_STATE = 42

# Features v2 — mismo orden con el que se entreno random_forest_v2.joblib.
FEATURES_V2 = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count", "elevation", "slope",
    "distance_to_stream", "flow_accumulation", "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]

# Subsample para estimar d_bar (media de distancias por pares). 3000 puntos
# = ~4.5M pares: estimacion estable e instantanea de la distancia media.
N_DBAR = 3000


def _load_weights() -> np.ndarray:
    """Pesos = permutation importance v2, normalizados a suma 1, en orden
    de FEATURES_V2. Importancias negativas o nulas se clampean a 0."""
    path = REPO / "results" / "model" / "permutation_importance_v2.json"
    imp = json.loads(path.read_text(encoding="utf-8"))
    w = np.array([max(imp.get(f, 0.0), 0.0) for f in FEATURES_V2], dtype="float64")
    total = w.sum()
    if total <= 0:
        log.warning("Importancias degeneradas; usando pesos uniformes.")
        return np.ones(len(FEATURES_V2)) / len(FEATURES_V2)
    return w / total


def _weighted_space(X: np.ndarray, mu: np.ndarray, sd: np.ndarray,
                    w: np.ndarray) -> np.ndarray:
    """Estandariza con (mu, sd) del train y pondera por w. La distancia
    euclidea en este espacio es la del DI de CAST."""
    return ((X - mu) / sd) * w


def _metrics(y: np.ndarray, proba: np.ndarray, thr: float) -> dict:
    """AUC + F1/precision/recall al umbral operacional. Robusto a subsets
    sin positivos (AUC indefinido -> None)."""
    pred = (proba >= thr).astype("int8")
    out = {
        "n": int(len(y)),
        "n_pos": int(y.sum()),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
    }
    try:
        out["auc_roc"] = float(roc_auc_score(y, proba)) if y.min() != y.max() else None
    except ValueError:
        out["auc_roc"] = None
    return out


def _write_raster(values: np.ndarray, rows: np.ndarray, cols: np.ndarray,
                  ref_path: Path, out_path: Path, dtype: str, nodata) -> None:
    """Rasteriza un vector indexado por (row, col) sobre la rejilla de ref."""
    with rasterio.open(ref_path) as ref:
        H, W = ref.height, ref.width
        prof = ref.profile
    grid = np.full((H, W), nodata, dtype=dtype)
    grid[rows, cols] = values.astype(dtype)
    # El profile de la rejilla de referencia puede traer blockxsize sin
    # tiled=yes (GDAL se queja). Se descartan esas claves de tiling.
    for k in ("blockxsize", "blockysize", "tiled"):
        prof.pop(k, None)
    prof.update(driver="GTiff", dtype=dtype, count=1, nodata=nodata, compress="lzw")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **prof) as dst:
        dst.write(grid, 1)
    log.info("  raster: %s", out_path.relative_to(REPO))


def main() -> int:
    t0 = time.time()
    ap = argparse.ArgumentParser(description="AOA / DI Valencia -> Algemesi")
    ap.add_argument("--n-ref", type=int, default=200_000,
                    help="Puntos de Valencia para la nube de referencia (KDTree).")
    ap.add_argument("--threshold", type=float, default=0.614,
                    help="Umbral operacional del modelo (criterio recall>=0.75).")
    ap.add_argument("--chunk", type=int, default=2_000_000,
                    help="Filas por chunk al procesar Algemesi.")
    args = ap.parse_args()

    rng = np.random.default_rng(RANDOM_STATE)

    # ---- 1. Train reference + estadisticos ----
    log.info("=== 1. Cargando Valencia (train) y pesos ===")
    df_tr = pd.read_parquet(REPO / "data/dataset/training_dataset_v2.parquet",
                            columns=FEATURES_V2)
    X_tr = df_tr.to_numpy(dtype="float64")
    del df_tr
    finite = np.isfinite(X_tr).all(axis=1)
    X_tr = X_tr[finite]
    mu = X_tr.mean(axis=0)
    sd = X_tr.std(axis=0)
    sd[sd < 1e-9] = 1e-9  # guarda: feature constante no debe dividir por 0
    w = _load_weights()
    log.info("  train=%d filas (finitas)  features=%d", len(X_tr), len(FEATURES_V2))
    log.info("  pesos top: %s", ", ".join(
        f"{FEATURES_V2[i]}={w[i]:.3f}" for i in np.argsort(w)[::-1][:4]))

    # Nube de referencia (sample) en espacio ponderado.
    n_ref = min(args.n_ref, len(X_tr))
    ref_idx = rng.choice(len(X_tr), n_ref, replace=False)
    Xw_ref = _weighted_space(X_tr[ref_idx], mu, sd, w).astype("float32")
    del X_tr
    log.info("  referencia KDTree: %d puntos", n_ref)

    # ---- 2. d_bar (distancia media entre puntos de train) ----
    sub = Xw_ref[rng.choice(n_ref, min(N_DBAR, n_ref), replace=False)]
    d_bar = float(pdist(sub.astype("float64")).mean())
    log.info("  d_bar (dist media train) = %.5f", d_bar)

    # ---- 3. DI del train (LOO-NN) + umbral AOA ----
    log.info("=== 2. DI del train + umbral AOA ===")
    tree = cKDTree(Xw_ref)
    nn_tr, _ = tree.query(Xw_ref, k=2, workers=-1)  # col 0 = uno mismo
    di_train = nn_tr[:, 1] / d_bar
    q75, q25 = np.percentile(di_train, [75, 25])
    iqr = q75 - q25
    aoa_thr = float(q75 + 1.5 * iqr)
    log.info("  DI_train: mediana=%.3f  Q75=%.3f  IQR=%.3f", np.median(di_train), q75, iqr)
    log.info("  UMBRAL AOA = %.4f (DI<=umbral => dentro)", aoa_thr)

    # ---- 4. Algemesi: DI + proba por chunks ----
    log.info("=== 3. Algemesi: DI + predict_proba (chunked) ===")
    model = joblib.load(REPO / "models/random_forest_v2.joblib")
    pq_path = REPO / "data/dataset/training_dataset_algemesi.parquet"
    cols_needed = ["row", "col", "flood_label", *FEATURES_V2]
    df_alg = pd.read_parquet(pq_path, columns=cols_needed)
    n_total = len(df_alg)
    log.info("  Algemesi=%d filas", n_total)

    di_all = np.empty(n_total, dtype="float32")
    proba_all = np.empty(n_total, dtype="float32")
    for start in range(0, n_total, args.chunk):
        end = min(start + args.chunk, n_total)
        Xc = df_alg.iloc[start:end][FEATURES_V2].to_numpy(dtype="float64")
        Xwc = _weighted_space(Xc, mu, sd, w).astype("float32")
        nn_c, _ = tree.query(Xwc, k=1, workers=-1)
        di_all[start:end] = (nn_c / d_bar).astype("float32")
        proba_all[start:end] = model.predict_proba(Xc)[:, 1].astype("float32")
        log.info("  chunk %d-%d ok", start, end)

    y = df_alg["flood_label"].to_numpy(dtype="int8")
    rows = df_alg["row"].to_numpy(dtype="int32")
    cols = df_alg["col"].to_numpy(dtype="int32")
    del df_alg

    # ---- 5. Metricas dentro vs fuera de AOA ----
    inside = di_all <= aoa_thr
    pct_inside = 100.0 * inside.mean()
    log.info("=== 4. Metricas (umbral op. %.3f) ===", args.threshold)
    log.info("  Algemesi dentro de AOA: %.1f%%  (fuera: %.1f%%)",
             pct_inside, 100 - pct_inside)

    m_all = _metrics(y, proba_all, args.threshold)
    m_in = _metrics(y[inside], proba_all[inside], args.threshold)
    m_out = _metrics(y[~inside], proba_all[~inside], args.threshold)

    def _log_m(tag, m):
        auc = f"{m['auc_roc']:.4f}" if m["auc_roc"] is not None else "n/a"
        log.info("  %-12s n=%8d pos=%6d  AUC=%s  P=%.4f  R=%.4f  F1=%.4f",
                 tag, m["n"], m["n_pos"], auc, m["precision"], m["recall"], m["f1"])
    _log_m("TODO", m_all)
    _log_m("DENTRO AOA", m_in)
    _log_m("FUERA AOA", m_out)

    # ---- 6. Salidas ----
    out_json = REPO / "results/model/aoa_analysis.json"
    out_json.write_text(json.dumps({
        "method": "Meyer & Pebesma 2021 (LOO-NN DI, umbral Q75+1.5*IQR)",
        "n_ref": n_ref,
        "d_bar": d_bar,
        "aoa_threshold": aoa_thr,
        "di_train_stats": {
            "median": float(np.median(di_train)),
            "q75": float(q75), "iqr": float(iqr),
            "max": float(di_train.max()),
        },
        "operational_threshold": args.threshold,
        "algemesi": {
            "n_total": n_total,
            "pct_inside_aoa": pct_inside,
            "di_median": float(np.median(di_all)),
            "di_p90": float(np.percentile(di_all, 90)),
        },
        "metrics": {"all": m_all, "inside_aoa": m_in, "outside_aoa": m_out},
        "weights": {f: float(w[i]) for i, f in enumerate(FEATURES_V2)},
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("  JSON: %s", out_json.relative_to(REPO))

    # Mapa DI + mascara AOA (rasterizados a la rejilla de Algemesi)
    ref_grid = REPO / "data/extrapolation/features/sar/water_frequency_algemesi.tif"
    if ref_grid.exists():
        _write_raster(di_all, rows, cols, ref_grid,
                      REPO / "results/maps/05_extrapolation/aoa_di_algemesi.tif",
                      dtype="float32", nodata=-1.0)
        _write_raster(inside.astype("uint8"), rows, cols, ref_grid,
                      REPO / "results/maps/05_extrapolation/aoa_inside_algemesi.tif",
                      dtype="uint8", nodata=255)
    else:
        log.warning("  Sin rejilla de referencia (%s); se omite el mapa DI.", ref_grid.name)

    # Histograma DI_train vs DI_algemesi + umbral
    if HAS_MPL:
        diag = REPO / "results/diagnostics/extrapolation"
        diag.mkdir(parents=True, exist_ok=True)
        fig, ax = plt.subplots(figsize=(10, 6))
        clip = np.percentile(di_all, 99.5)
        bins = np.linspace(0, max(clip, aoa_thr * 2), 80)
        ax.hist(di_train, bins=bins, density=True, alpha=0.55,
                color="#2c7fb8", label="DI train (Valencia)")
        ax.hist(np.clip(di_all, 0, bins[-1]), bins=bins, density=True, alpha=0.55,
                color="#f46d43", label="DI Algemesi")
        ax.axvline(aoa_thr, color="#d73027", ls="--", lw=1.6,
                   label=f"Umbral AOA = {aoa_thr:.2f}")
        ax.set_xlabel("Dissimilarity Index (DI)")
        ax.set_ylabel("Densidad")
        ax.set_title(f"AOA Valencia -> Algemesi  ·  {pct_inside:.1f}% dentro de AOA")
        ax.legend()
        ax.grid(True, alpha=0.3)
        plt.tight_layout()
        png = diag / "aoa_di_distributions.png"
        plt.savefig(png, dpi=150, bbox_inches="tight")
        plt.close()
        log.info("  PNG: %s", png.relative_to(REPO))

    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
