"""Endpoints for the static GeoJSON layers that aren't risk-specific
(municipalities, ground-truth masks). Already loaded in-memory by
GeoJSONService at startup, so these handlers are just dict lookups."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException

from ..services.geojson_service import get_geojson_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/municipalities.geojson",
             summary="14 Valencia DANA municipalities + Algemesí + Alzira")
def get_municipalities():
    svc = get_geojson_service()
    data = svc.get_municipalities_geojson()
    if data is None:
        raise HTTPException(503, "municipalities GeoJSON not loaded")
    return data


@router.get("/ground_truth/{zone}.geojson",
             summary="EMSR773 clipped flood mask for the requested zone")
def get_ground_truth(zone: Literal["valencia", "algemesi"]):
    svc = get_geojson_service()
    data = svc.get_ground_truth_geojson(zone)
    if data is None:
        raise HTTPException(404,
                             f"ground truth GeoJSON not available for '{zone}'.")
    return data
