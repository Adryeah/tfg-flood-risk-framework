"""Servicio que carga y sirve los GeoJSON pre-calculados desde disk."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)


class GeoJSONService:
    _instance: Optional["GeoJSONService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._cache: Dict[str, dict] = {}
        self._data_dir: Optional[Path] = None

    @classmethod
    def get_instance(cls) -> "GeoJSONService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = GeoJSONService()
        return cls._instance

    def load_all(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        files = {
            "valencia_risk":         "valencia_risk.geojson",
            "algemesi_risk":         "algemesi_risk.geojson",
            # Low-probability tail (opt-in overlay) — present only if the
            # export script was re-run with the TAIL_BINS step. Missing
            # files are skipped silently in `load_all`.
            "valencia_risk_tail":    "valencia_risk_tail.geojson",
            "algemesi_risk_tail":    "algemesi_risk_tail.geojson",
            "ground_truth_valencia": "ground_truth_valencia.geojson",
            "ground_truth_algemesi": "ground_truth_algemesi.geojson",
            "municipalities":        "municipalities.geojson",
        }
        for key, fname in files.items():
            path = data_dir / fname
            if not path.exists():
                log.warning("GeoJSON %s no existe: %s", key, path)
                continue
            with open(path, encoding="utf-8") as fh:
                self._cache[key] = json.load(fh)
            log.info("GeoJSON %s cargado: %d features (%.1f KB)",
                     key, len(self._cache[key].get("features", [])),
                     path.stat().st_size / 1024)

    def get_risk_geojson(self, zone: str) -> Optional[dict]:
        key = f"{zone}_risk"
        return self._cache.get(key)

    def get_risk_tail_geojson(self, zone: str) -> Optional[dict]:
        """Low-probability shoulder (p ∈ [0, 0.25)). May be None if the
        tail layer hasn't been exported yet."""
        key = f"{zone}_risk_tail"
        return self._cache.get(key)

    def get_ground_truth_geojson(self, zone: str) -> Optional[dict]:
        key = f"ground_truth_{zone}"
        return self._cache.get(key)

    def get_municipalities_geojson(self) -> Optional[dict]:
        return self._cache.get("municipalities")

    def loaded_keys(self) -> list[str]:
        return list(self._cache.keys())


def get_geojson_service() -> GeoJSONService:
    return GeoJSONService.get_instance()
