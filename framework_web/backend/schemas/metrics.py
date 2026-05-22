"""Schemas Pydantic para el endpoint /api/metrics."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ConfusionMatrix(BaseModel):
    tn: int
    fp: int
    fn: int
    tp: int


class ModelMetrics(BaseModel):
    auc_mean: float
    auc_std: Optional[float] = None
    auc_pr: Optional[float] = None
    f1: float
    precision: float
    recall: float
    accuracy: float
    brier: Optional[float] = None
    ece: Optional[float] = None


class BufferMetrics(BaseModel):
    buffer_m: int
    tp: Optional[int] = None
    fp: Optional[int] = None
    fn: Optional[int] = None
    tn: Optional[int] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1: Optional[float] = None
    accuracy: Optional[float] = None


class FeatureImportance(BaseModel):
    feature: str
    importance: float


class SectionMetrics(BaseModel):
    """Estructura completa de cada seccion en /api/metrics/{section}."""
    model_metrics: Optional[ModelMetrics] = None
    buffer_metrics: Optional[List[BufferMetrics]] = None
    feature_importance: Optional[List[FeatureImportance]] = None
    confusion_matrix: Optional[ConfusionMatrix] = None
    threshold_operational: Optional[float] = None
    n_pixels: Optional[int] = None
    n_positive: Optional[int] = None
    extrapolation_comparison: Optional[List[Dict[str, Any]]] = None
    feature_drift: Optional[List[Dict[str, Any]]] = None
    permutation_importance_comparison: Optional[List[Dict[str, Any]]] = None
    test1_urban_mask: Optional[Dict[str, Any]] = None
    test2_temporal_leakage: Optional[Dict[str, Any]] = None
    final_verdict: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)
