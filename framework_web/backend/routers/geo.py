"""Endpoints for the static GeoJSON layers that aren't risk-specific
(municipalities, ground-truth masks). Streamed from disk via FileResponse
(no in-memory dict cache) — the worker only holds a file handle, keeping
the 512 MB Render container under its RAM budget."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..services.geojson_service import get_geojson_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/geo", tags=["geo"])


_GEOJSON_HEADERS = {
    "Cache-Control": "public, max-age=86400, immutable",
}


@router.get("/municipalities.geojson",
             summary="14 Valencia DANA municipalities + Algemesí + Alzira")
def get_municipalities():
    svc = get_geojson_service()
    path = svc.get_municipalities_geojson_path()
    if path is None:
        raise HTTPException(503, "municipalities GeoJSON not loaded")
    return FileResponse(
        path,
        media_type="application/geo+json",
        headers=_GEOJSON_HEADERS,
    )


@router.get("/ground_truth/{zone}.geojson",
             summary="EMSR773 clipped flood mask for the requested zone")
def get_ground_truth(zone: Literal["valencia", "algemesi"]):
    svc = get_geojson_service()
    path = svc.get_ground_truth_geojson_path(zone)
    if path is None:
        raise HTTPException(404,
                             f"ground truth GeoJSON not available for '{zone}'.")
    return FileResponse(
        path,
        media_type="application/geo+json",
        headers=_GEOJSON_HEADERS,
    )
