"""Schemas Pydantic para el endpoint /api/risk."""
from __future__ import annotations

from typing import Dict, Optional

from pydantic import BaseModel, Field


class RiskPredictionRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitud en EPSG:4326")
    lon: float = Field(..., ge=-180, le=180, description="Longitud en EPSG:4326")


class RiskPredictionResponse(BaseModel):
    lat: float
    lon: float
    zone: str = Field(..., description="valencia | algemesi | outside")
    probability: float = Field(..., ge=0.0, le=1.0)
    category: str = Field(..., description="low | moderate | high | very_high")
    threshold_operational: float
    is_above_threshold: bool
    nearest_lat: Optional[float] = None
    nearest_lon: Optional[float] = None
    distance_to_nearest_m: Optional[float] = None
    features: Dict[str, float] = Field(
        default_factory=dict,
        description="Las 14 features del modelo Random Forest v2",
    )
    model_version: str = "Random Forest v2 (14 features)"


class RiskPredictionError(BaseModel):
    error: str
    lat: float
    lon: float
    detail: Optional[str] = None
