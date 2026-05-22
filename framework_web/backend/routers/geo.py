"""Endpoints for the static GeoJSON layers that aren't risk-specific
(municipalities, ground-truth masks). Sirve los .gz pre-comprimidos por
defecto (Content-Encoding: gzip) y se cae al .geojson plano si falta
el .gz. Streamed from disk vía FileResponse — el worker sólo mantiene un
file handle, manteniendo el contenedor Render de 512 MB bajo presupuesto."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException

from ..services.geojson_service import get_geojson_service, stream_geojson

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/municipalities.geojson",
             summary="14 Valencia DANA municipalities + Algemesí + Alzira")
def get_municipalities():
    svc = get_geojson_service()
    path = svc.get_municipalities_geojson_path()
    if path is None:
        raise HTTPException(503, "municipalities GeoJSON not loaded")
    return stream_geojson(path)


@router.get("/ground_truth/{zone}.geojson",
             summary="EMSR773 clipped flood mask for the requested zone")
def get_ground_truth(zone: Literal["valencia", "algemesi"]):
    svc = get_geojson_service()
    path = svc.get_ground_truth_geojson_path(zone)
    if path is None:
        raise HTTPException(404,
                             f"ground truth GeoJSON not available for '{zone}'.")
    return stream_geojson(path)
