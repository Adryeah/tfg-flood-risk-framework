#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
add_river_to_lookups.py
-----------------------
Anade la columna `distance_to_river` a los lookups del backend
(valencia/algemesi_features_lookup.parquet) muestreando el MISMO raster
distance_to_river.tif que usan entrenamiento e inferencia. Asi el endpoint de
scoring en vivo (routers/risk.py, portfolio_generator.py) puede servir el
modelo de 10 features sin romperse.

Los lookups estan en lat/lon (WGS84); se reproyecta a la CRS del raster y se
muestrea por vecino mas cercano (ds.sample). Backup timestampeado antes de
sobrescribir.

Uso: .venv/Scripts/python.exe scripts/features/add_river_to_lookups.py
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)
REPO = Path(__file__).resolve().parents[2]

LOOKUPS = {
    "valencia": (REPO / "framework_web/backend/data_processed/valencia_features_lookup.parquet",
                 REPO / "data/dem/distance_to_river.tif"),
    "algemesi": (REPO / "framework_web/backend/data_processed/algemesi_features_lookup.parquet",
                 REPO / "data/extrapolation/dem/distance_to_river.tif"),
}


def _sample(lon, lat, tif: Path) -> np.ndarray:
    with rasterio.open(tif) as ds:
        tr = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
        x, y = tr.transform(lon, lat)
        vals = np.array([v[0] for v in ds.sample(np.column_stack([x, y]))], "float32")
        nd = ds.nodata
    if nd is not None and not np.isnan(nd):
        vals[vals == nd] = np.nan
    return vals


def main() -> int:
    t0 = time.time()
    for zone, (lk, tif) in LOOKUPS.items():
        if not lk.exists() or not tif.exists():
            log.warning("[%s] falta lookup o raster, omitido", zone)
            continue
        df = pd.read_parquet(lk)
        vals = _sample(df["lon"].to_numpy("float64"), df["lat"].to_numpy("float64"), tif)
        n_nan = int(np.isnan(vals).sum())
        df["distance_to_river"] = vals
        log.info("[%s] n=%d  river mediana=%.0fm  NaN=%d",
                 zone, len(df), float(np.nanmedian(vals)), n_nan)
        bak = lk.with_suffix(f".parquet.bak_{time.strftime('%Y%m%d_%H%M%S')}")
        lk.replace(bak)
        df.to_parquet(lk, index=False)
        log.info("[%s] -> %s (backup %s)", zone, lk.name, bak.name)
    log.info("=== COMPLETADO en %.1f min ===", (time.time() - t0) / 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
