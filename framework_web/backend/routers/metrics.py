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
        "valencia", "algemesi", "transferability", "leakage"]):
    """Devuelve la seccion correspondiente del JSON pre-computado.

    - **valencia**: metricas RF v2 sobre el dataset de entrenamiento.
    - **algemesi**: metricas tras aplicacion sin reentrenamiento + recalibracion.
    - **transferability**: drift de features y permutation importance.
    - **leakage**: resultados de la auditoria Tests 1-2 sobre XGBoost v3.
    """
    try:
        data = _load_metrics()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))
    if section == "leakage":
        return data.get("leakage_audit", {})
    return data.get(section, {})
