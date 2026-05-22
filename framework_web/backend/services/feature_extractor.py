"""Servicio que extrae las 14 features para una coordenada (lat, lon)
usando los lookup tables pre-calculados en data_processed/."""
from __future__ import annotations

import logging
import math
import threading
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from .model_service import FEATURE_NAMES_V2

log = logging.getLogger(__name__)

# Bbox de cada zona (lon_min, lat_min, lon_max, lat_max) WGS84
BBOX_VALENCIA  = (-0.55, 39.30, -0.25, 39.55)
BBOX_ALGEMESI  = (-0.698, 39.007, -0.166, 39.555)


class FeatureExtractor:
    """Singleton que carga lookups en memoria al iniciar."""

    _instance: Optional["FeatureExtractor"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._lookups: Dict[str, pd.DataFrame] = {}
        self._trees: Dict[str, cKDTree] = {}

    @classmethod
    def get_instance(cls) -> "FeatureExtractor":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = FeatureExtractor()
        return cls._instance

    def load_lookups(self, data_dir: Path) -> None:
        """Carga los lookups parquet de Valencia y Algemesi."""
        for zone, fname in [
            ("valencia", "valencia_features_lookup.parquet"),
            ("algemesi", "algemesi_features_lookup.parquet"),
        ]:
            path = data_dir / fname
            if not path.exists():
                log.warning("Lookup %s no existe: %s", zone, path)
                continue
            df = pd.read_parquet(path)
            self._lookups[zone] = df
            coords = df[["lat", "lon"]].to_numpy(dtype="float32")
            self._trees[zone] = cKDTree(coords)
            log.info("Lookup %s cargado: %d filas", zone, len(df))

    def is_loaded(self) -> bool:
        return len(self._lookups) > 0

    def loaded_zones(self) -> list[str]:
        return list(self._lookups.keys())

    @staticmethod
    def _zone_for_coord(lat: float, lon: float) -> str:
        """Devuelve la zona que contiene la coordenada o 'outside'."""
        if (BBOX_VALENCIA[1] <= lat <= BBOX_VALENCIA[3] and
                BBOX_VALENCIA[0] <= lon <= BBOX_VALENCIA[2]):
            return "valencia"
        if (BBOX_ALGEMESI[1] <= lat <= BBOX_ALGEMESI[3] and
                BBOX_ALGEMESI[0] <= lon <= BBOX_ALGEMESI[2]):
            return "algemesi"
        return "outside"

    def get_features_at(self, lat: float, lon: float,
                         max_distance_m: float = 200.0) -> Optional[dict]:
        """Devuelve features + prediccion precalculada para la coordenada
        mas cercana en el lookup. None si fuera de bbox o sin vecino cercano."""
        zone = self._zone_for_coord(lat, lon)
        if zone == "outside" or zone not in self._lookups:
            return None
        df = self._lookups[zone]
        tree = self._trees[zone]
        dist_deg, idx = tree.query([lat, lon], k=1)
        # 1 grado de lat ~111 km. Para lon depende de lat. Usamos
        # aproximacion isotropa para el threshold (suficiente).
        dist_m = float(dist_deg * 111000)
        if dist_m > max_distance_m:
            return None
        row = df.iloc[int(idx)]
        features = {f: float(row[f]) for f in FEATURE_NAMES_V2}
        return {
            "zone": zone,
            "nearest_lat": float(row["lat"]),
            "nearest_lon": float(row["lon"]),
            "distance_to_nearest_m": dist_m,
            "features": features,
            "predicted_probability_v2": float(row["predicted_probability_v2"]),
        }


def get_feature_extractor() -> FeatureExtractor:
    return FeatureExtractor.get_instance()


def categorize_probability(p: float) -> str:
    if p >= 0.75:
        return "very_high"
    if p >= 0.50:
        return "high"
    if p >= 0.25:
        return "moderate"
    return "low"
