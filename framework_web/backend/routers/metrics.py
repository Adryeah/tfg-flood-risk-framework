"""Endpoints /api/metrics/*"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException

from ..config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metrics", tags=["metrics"])


_METRICS_CACHE: dict | None = None


def _load_metrics() -> dict:
    global _METRICS_CACHE
    if _METRICS_CACHE is not None:
        return _METRICS_CACHE
    path = settings.DATA_PROCESSED_DIR / "precomputed_metrics.json"
    if not path.exists():
        raise FileNotFoundError(f"precomputed_metrics.json no existe en {path}")
    with open(path, encoding="utf-8") as fh:
        _METRICS_CACHE = json.load(fh)
    return _METRICS_CACHE


@router.get("/{section}", summary="Metricas pre-calculadas por seccion")
def get_metrics(section: Literal[
        "valencia", "algemesi", "transferability", "leakage",
        "operating_points", "zone_level", "aoa"]):
    """Devuelve la seccion correspondiente del JSON pre-computado.

    - **valencia**: metricas RF v3-T in-domain (GroupKFold espacial).
    - **algemesi**: metricas tras aplicacion sin reentrenamiento + recalibracion.
    - **transferability**: drift de features y permutation importance.
    - **leakage**: resultados de la auditoria Tests 1-2 sobre XGBoost v3.
    - **operating_points**: curva precision-recall + puntos de operacion nombrados.
    - **zone_level**: precision/recall/F1 a escala municipio y celda 1 km.
    - **aoa**: Area de Aplicabilidad (Meyer & Pebesma 2021) — % de Algemesi dentro del dominio.
    """
    try:
        data = _load_metrics()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))
    if section == "leakage":
        return data.get("leakage_audit", {})
    return data.get(section, {})
