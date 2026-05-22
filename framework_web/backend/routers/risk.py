"""Endpoints /api/risk/*"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..schemas.risk import RiskPredictionResponse
from ..services.feature_extractor import (
    FeatureExtractor, categorize_probability, get_feature_extractor,
)
from ..services.geojson_service import get_geojson_service
from ..services.model_service import (
    FEATURE_NAMES_V2, ModelService, get_model_service,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/risk", tags=["risk"])


@router.get("/{zone}.geojson", summary="GeoJSON de probabilidad de riesgo")
def get_risk_geojson(zone: Literal["valencia", "algemesi"]):
    """Devuelve el GeoJSON pre-calculado del modelo Random Forest v2
    vectorizado por bins de probabilidad [0-0.25, 0.25-0.5, 0.5-0.75, 0.75-1]."""
    svc = get_geojson_service()
    data = svc.get_risk_geojson(zone)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"GeoJSON de riesgo no disponible para zona '{zone}'.",
        )
    return data


@router.get(
    "/{zone}/tail.geojson",
    summary="GeoJSON del shoulder de baja probabilidad (p ∈ [0, 0.25))",
)
def get_risk_tail_geojson(zone: Literal["valencia", "algemesi"]):
    """Capa opt-in con los píxeles que en el mapa principal son transparentes
    (p < 0.25). Útil para auditoría visual del modelo cuando se quiere ver
    toda la predicción incluido el background."""
    svc = get_geojson_service()
    data = svc.get_risk_tail_geojson(zone)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Capa de tail no disponible para zona '{zone}'. "
                "Re-ejecuta tools/01_export_risk_to_geojson.py para "
                "generar valencia_risk_tail.geojson / algemesi_risk_tail.geojson."
            ),
        )
    return data


@router.get("/predict", response_model=RiskPredictionResponse,
             summary="Probabilidad de inundacion en una coordenada")
def predict_risk(
    lat: float = Query(..., ge=-90, le=90, description="Latitud WGS84"),
    lon: float = Query(..., ge=-180, le=180, description="Longitud WGS84"),
):
    """Aplica el modelo Random Forest v2 a la coordenada dada usando las
    14 features del lookup mas cercano. Si la coordenada esta fuera del
    bbox de Valencia o Algemesi, devuelve 404."""
    extractor: FeatureExtractor = get_feature_extractor()
    model: ModelService = get_model_service()

    if not extractor.is_loaded():
        raise HTTPException(503, "Feature lookup no cargado")
    if not model.is_loaded():
        raise HTTPException(503, "Modelo no cargado")

    feats = extractor.get_features_at(lat, lon)
    if feats is None:
        raise HTTPException(
            404,
            f"Coordenada ({lat}, {lon}) fuera del bbox cubierto "
            "(Valencia o Algemesi) o sin punto cercano.",
        )

    import numpy as np
    x = np.array([feats["features"][f] for f in FEATURE_NAMES_V2],
                 dtype="float32")
    proba = model.predict(x)
    category = categorize_probability(proba)

    threshold = (settings.THRESHOLD_OPERATIONAL_ALGEMESI
                 if feats["zone"] == "algemesi"
                 else settings.THRESHOLD_OPERATIONAL)

    return RiskPredictionResponse(
        lat=lat,
        lon=lon,
        zone=feats["zone"],
        probability=round(proba, 6),
        category=category,
        threshold_operational=threshold,
        is_above_threshold=bool(proba >= threshold),
        nearest_lat=feats["nearest_lat"],
        nearest_lon=feats["nearest_lon"],
        distance_to_nearest_m=round(feats["distance_to_nearest_m"], 1),
        features=feats["features"],
    )
