"""Servicio que cachea las rutas de los GeoJSON pre-calculados.

Cambio v2 (post-deploy Render): antes cargaba los 7 GeoJSON enteros como
dicts Python en memoria (~150 MB inflados desde los 32 MB en disco).
Para servir el risk geojson de Algemesí (16 MB) FastAPI tenía que
re-serializar el dict a JSON → pico de RAM que tumbaba el contenedor
free-tier de 512 MB con OOM (502 Bad Gateway).

Ahora solo cacheamos la ruta. El router los sirve con `FileResponse`,
que hace stream desde disco — cero pico de RAM, además FastAPI puede
añadir cabeceras de caché por archivo. Si el client necesita parsear,
ya lo hace en el navegador (que tiene RAM de sobra).
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)


class GeoJSONService:
    _instance: Optional["GeoJSONService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._paths: Dict[str, Path] = {}
        self._data_dir: Optional[Path] = None

    @classmethod
    def get_instance(cls) -> "GeoJSONService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = GeoJSONService()
        return cls._instance

    def load_all(self, data_dir: Path) -> None:
        """Registra las rutas de los GeoJSON disponibles. No los abre."""
        self._data_dir = data_dir
        files = {
            "valencia_risk":         "valencia_risk.geojson",
            "algemesi_risk":         "algemesi_risk.geojson",
            # Low-probability tail (opt-in overlay) — present only if the
            # export script was re-run with the TAIL_BINS step. Missing
            # files are skipped silently.
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
            self._paths[key] = path
            log.info("GeoJSON %s registrado: %.1f KB",
                     key, path.stat().st_size / 1024)

    # ─── Path accessors — used by the routers to FileResponse-stream ──
    def get_risk_geojson_path(self, zone: str) -> Optional[Path]:
        return self._paths.get(f"{zone}_risk")

    def get_risk_tail_geojson_path(self, zone: str) -> Optional[Path]:
        """Low-probability shoulder (p ∈ [0, 0.25)). May be None if the
        tail layer hasn't been exported yet."""
        return self._paths.get(f"{zone}_risk_tail")

    def get_ground_truth_geojson_path(self, zone: str) -> Optional[Path]:
        return self._paths.get(f"ground_truth_{zone}")

    def get_municipalities_geojson_path(self) -> Optional[Path]:
        return self._paths.get("municipalities")

    def loaded_keys(self) -> list[str]:
        return list(self._paths.keys())


def get_geojson_service() -> GeoJSONService:
    return GeoJSONService.get_instance()
