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

from .model_service import FEATURE_NAMES_V2, FEATURE_NAMES_V3T

log = logging.getLogger(__name__)

# Bbox de cada zona (lon_min, lat_min, lon_max, lat_max) WGS84
BBOX_VALENCIA  = (-0.55, 39.30, -0.25, 39.55)
BBOX_ALGEMESI  = (-0.698, 39.007, -0.166, 39.555)


def planar_distance_m(lat1: float, lon1: float,
                      lat2: float, lon2: float) -> float:
    """Distancia metrica aproximada con correccion cos(lat) en longitud.

    El KDTree mide distancia euclidea en grados (isotropa); multiplicar el
    resultado por 111 km trata un grado de longitud como uno de latitud y
    sobreestima ~30% la componente E-W a la latitud de Valencia (39.4 ->
    cos ~ 0.77). Aqui se corrige la longitud por cos(lat) sobre el vecino
    encontrado. Exacta a nivel sub-km (el rango del threshold)."""
    dlat = lat1 - lat2
    dlon = lon1 - lon2
    lat_ref = math.radians((lat1 + lat2) / 2.0)
    return math.hypot(dlat * 111_000.0, dlon * 111_000.0 * math.cos(lat_ref))


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
        _dist_deg, idx = tree.query([lat, lon], k=1)
        row = df.iloc[int(idx)]
        # La query localiza el vecino (euclidea en grados); el threshold
        # necesita metros reales con correccion cos(lat), no 111 km isotropos.
        dist_m = planar_distance_m(lat, lon,
                                   float(row["lat"]), float(row["lon"]))
        if dist_m > max_distance_m:
            return None
        # Expone la union de v2 (14) y v3-T (incluye distance_to_river, que NO
        # esta en v2) para que el scoring en vivo del modelo de 10 features
        # encuentre todas sus columnas. Solo incluye las presentes en el lookup.
        feat_cols = list(dict.fromkeys([*FEATURE_NAMES_V2, *FEATURE_NAMES_V3T]))
        features = {f: float(row[f]) for f in feat_cols if f in row.index}
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
    # Bandas reancladas a la escala CALIBRADA de v3-T (10 feat, umbral
    # operacional 0.16 a prevalencia natural). "moderate" = a partir del umbral
    # (pixel marcado); "very_high" es raro (~1%), como debe ser.
    if p >= 0.50:
        return "very_high"
    if p >= 0.30:
        return "high"
    if p >= 0.16:
        return "moderate"
    return "low"
