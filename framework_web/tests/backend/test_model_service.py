"""Tests del singleton ModelService."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
import pytest

from backend.config import settings
from backend.services.model_service import (
    FEATURE_NAMES_V2, ModelService, get_model_service,
)


def test_get_feature_names_returns_14():
    names = ModelService.get_feature_names()
    assert len(names) == 14
    assert "mean_sigma0_vv" in names
    assert "distance_to_coast" in names
    assert "twi" in names
    assert "hand" in names


def test_model_loads_correctly():
    svc = get_model_service()
    if not svc.is_loaded():
        svc.load_model(settings.MODEL_PATH)
    assert svc.is_loaded()


def test_predict_with_valid_features():
    svc = get_model_service()
    if not svc.is_loaded():
        svc.load_model(settings.MODEL_PATH)
    # Vector arbitrario en rangos plausibles
    x = np.array([
        -11.0, 1.5, -14.0, 0.13,        # SAR sigma0_vv stats
         7.0, 5.0,                      # mean_vv_vh_ratio, water_count
         15.0, 1.0, 200.0, 50.0,        # elevation, slope, dist_stream, flow_acc
         0.3,                           # ndvi_mean
         5000.0, 8.5, 1.2,              # distance_to_coast, twi, hand
    ], dtype="float32")
    p = svc.predict(x)
    assert isinstance(p, float)
    assert 0.0 <= p <= 1.0


def test_predict_batch():
    svc = get_model_service()
    if not svc.is_loaded():
        svc.load_model(settings.MODEL_PATH)
    rng = np.random.default_rng(42)
    X = rng.standard_normal((10, 14)).astype("float32")
    probs = svc.predict_batch(X)
    assert probs.shape == (10,)
    assert probs.min() >= 0.0
    assert probs.max() <= 1.0


def test_singleton_idempotent():
    a = get_model_service()
    b = get_model_service()
    assert a is b
