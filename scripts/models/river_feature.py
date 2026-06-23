#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
river_feature.py
----------------
Helper compartido: muestrea `distance_to_river.tif` en un DataFrame de
entrenamiento por (row, col). El mismo raster lo lee la inferencia
(`predict_risk_map_v3t.py`), de modo que el feature es identico en train e
inferencia (fuente unica: scripts/features/make_distance_to_river.py).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

RIVER_TIF = {
    "valencia": "data/dem/distance_to_river.tif",
    "algemesi": "data/extrapolation/dem/distance_to_river.tif",
}


def add_distance_to_river(df: pd.DataFrame, zone: str, repo: Path) -> pd.DataFrame:
    """Anade columna distance_to_river muestreando el raster en (row, col)."""
    path = repo / RIVER_TIF[zone]
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        nd = ds.nodata
    if nd is not None and not np.isnan(nd):
        arr[arr == nd] = np.nan
    r = df["row"].to_numpy("int64")
    c = df["col"].to_numpy("int64")
    out = df.copy()
    out["distance_to_river"] = arr[r, c]
    return out
