"""
02_build_features_lookup.py
---------------------------
Construye lookup tables (lat, lon, 14 features, predicted_probability_v2)
en formato parquet para responder rapido al endpoint /api/risk/predict.

Inputs:
  - data/dataset/training_dataset_v2.parquet (Valencia, 14 feats)
  - data/dataset/training_dataset_algemesi.parquet (Algemesi, 14 feats)
  - models/random_forest_v2.joblib
  - results/maps/04_risk_prediction/risk_probability_v2.tif (Valencia)
  - results/maps/05_extrapolation/risk_probability_algemesi.tif (Algemesi)

Outputs (framework_web/backend/data_processed/):
  - valencia_features_lookup.parquet
  - algemesi_features_lookup.parquet

Las coordenadas (lat, lon) se calculan a partir de (row, col) usando el
transform del raster de probabilidad de la zona correspondiente.
La probabilidad precalculada se lee directamente del raster.
Se aplica un sub-sampling cada N pixeles para mantener el tamano del
lookup razonable (~100k filas).
"""
from __future__ import annotations

import logging
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

warnings.filterwarnings("ignore", category=UserWarning)
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "framework_web" / "backend" / "data_processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FEATURE_COLS = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]
SUBSAMPLE_TARGET = 100_000


def _build(zone: str, dataset_path: Path, prob_tif: Path,
           out_path: Path) -> None:
    log.info("=" * 60)
    log.info("Zona: %s", zone)
    log.info("=" * 60)
    t0 = time.time()

    log.info("Cargando dataset %s ...", dataset_path.name)
    df = pd.read_parquet(dataset_path)
    log.info("  Filas totales: %d", len(df))

    missing = [c for c in FEATURE_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Features faltantes: {missing}")

    # Transformacion (row, col) -> (x_utm, y_utm) -> (lat, lon)
    log.info("Cargando raster de probabilidad %s ...", prob_tif.name)
    with rasterio.open(prob_tif) as ds:
        transform = ds.transform
        crs_utm = ds.crs
        prob_arr = ds.read(1)

    tr = Transformer.from_crs(crs_utm, "EPSG:4326", always_xy=True)
    rows = df["row"].to_numpy(); cols = df["col"].to_numpy()

    # Coords UTM (centro del pixel): x = transform.c + (col + 0.5) * a
    xs_utm = transform.c + (cols + 0.5) * transform.a
    ys_utm = transform.f + (rows + 0.5) * transform.e
    lons, lats = tr.transform(xs_utm, ys_utm)

    # Lookup probability precalculada del raster
    pred_prob = np.full(len(df), np.nan, dtype="float32")
    valid_idx = (rows < prob_arr.shape[0]) & (cols < prob_arr.shape[1])
    pred_prob[valid_idx] = prob_arr[rows[valid_idx], cols[valid_idx]]

    log.info("  Probabilidades validas: %d (%.1f%%)",
             int(np.isfinite(pred_prob).sum()),
             100 * np.isfinite(pred_prob).mean())

    # Construir DataFrame final
    out = pd.DataFrame({
        "lat": lats.astype("float32"),
        "lon": lons.astype("float32"),
        "predicted_probability_v2": pred_prob,
    })
    for c in FEATURE_COLS:
        out[c] = df[c].astype("float32").to_numpy()

    out = out.dropna(subset=["predicted_probability_v2"]).reset_index(drop=True)
    log.info("  Filas con probabilidad valida: %d", len(out))

    if len(out) > SUBSAMPLE_TARGET:
        step = len(out) // SUBSAMPLE_TARGET + 1
        log.info("  Subsampling cada %d (target %d) ...", step, SUBSAMPLE_TARGET)
        out = out.iloc[::step].reset_index(drop=True)
        log.info("  Filas tras subsampling: %d", len(out))

    out.to_parquet(out_path, index=False, compression="snappy")
    size_mb = out_path.stat().st_size / 1e6
    log.info("  %s  %.2f MB", out_path.name, size_mb)

    # Resolucion espacial: distancia minima entre puntos (aproximacion)
    if len(out) > 100:
        sample = out.sample(min(1000, len(out)), random_state=42)
        coords = sample[["lat", "lon"]].to_numpy()
        from scipy.spatial import cKDTree
        tree = cKDTree(coords)
        dists, _ = tree.query(coords, k=2)
        median_step = float(np.median(dists[:, 1]))
        log.info("  Resolucion espacial mediana entre puntos: %.5f deg (~%.0f m)",
                 median_step, median_step * 111000)

    log.info("  Tiempo: %.1f s", time.time() - t0)


def main() -> int:
    val_dataset = REPO / "data" / "dataset" / "training_dataset_v2.parquet"
    val_prob    = REPO / "results" / "maps" / "04_risk_prediction" / "risk_probability_v2.tif"
    alg_dataset = REPO / "data" / "dataset" / "training_dataset_algemesi.parquet"
    alg_prob    = REPO / "results" / "maps" / "05_extrapolation" / "risk_probability_algemesi.tif"

    _build("Valencia",
           val_dataset, val_prob,
           OUT_DIR / "valencia_features_lookup.parquet")
    _build("Algemesi",
           alg_dataset, alg_prob,
           OUT_DIR / "algemesi_features_lookup.parquet")

    log.info("=" * 60)
    log.info("Lookups generados:")
    for f in sorted(OUT_DIR.glob("*lookup*.parquet")):
        log.info("  %s  %.2f MB", f.name, f.stat().st_size / 1e6)
    log.info("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
