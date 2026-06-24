"""Tests del singleton ModelService (modelo v3-T, 10 features, calibrado).

Blinda la migracion v2 (14 feat) -> v3-T (10 feat): el set activo, el umbral
calibrado (0,16) y que los proxies espaciales descartados por la ablacion
(distance_to_coast, elevation, slope) NO vuelvan al modelo servido.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
import pytest

from backend.config import settings
from backend.services.model_service import (
    FEATURE_NAMES_V3T, ModelService, get_model_service,
)

# Vector de 10 features en el ORDEN de FEATURE_NAMES_V3T, valores plausibles:
# mean_vv, min_vv, cv_vv, water_count, dist_stream, flow_acc, ndvi, twi, hand, dist_river
X10 = np.array([-11.0, -14.0, 0.13, 5.0, 200.0, 50.0, 0.3, 8.5, 1.2, 120.0],
               dtype="float32")


@pytest.fixture(scope="module", autouse=True)
def _loaded():
    """Estado limpio: recarga el singleton con modelo + calibrador (la ruta
    real de produccion). La idempotencia de load_model es por model_path, asi
    que reseteamos para garantizar que el calibrador queda cargado."""
    ModelService._instance = None
    svc = get_model_service()
    svc.load_model(settings.MODEL_PATH, settings.CALIBRATOR_PATH)
    yield svc
    ModelService._instance = None


def test_active_feature_set_is_v3t_10():
    svc = get_model_service()
    names = svc.get_feature_names()
    assert len(names) == 10
    assert names == FEATURE_NAMES_V3T          # mismo orden de entrenamiento
    assert "distance_to_river" in names        # el A/B ganador
    assert "twi" in names and "hand" in names
    # Proxies espaciales descartados por la ablacion LOZO/A-B: no deben volver.
    for dropped in ("distance_to_coast", "elevation", "slope", "std_sigma0_vv"):
        assert dropped not in names


def test_model_expects_10_features():
    svc = get_model_service()
    assert getattr(svc._model, "n_features_in_", None) == 10


def test_threshold_is_calibrated_016():
    svc = get_model_service()
    # Fuente de verdad = calibrador; el default de config debe coincidir.
    assert svc.get_threshold() == pytest.approx(0.16, abs=1e-6)
    assert svc.get_threshold() == pytest.approx(settings.THRESHOLD_OPERATIONAL, abs=1e-6)


def test_predict_with_valid_features():
    svc = get_model_service()
    p = svc.predict(X10)
    assert isinstance(p, float)
    assert 0.0 <= p <= 1.0


def test_predict_batch():
    svc = get_model_service()
    rng = np.random.default_rng(42)
    X = rng.standard_normal((10, 10)).astype("float32")
    probs = svc.predict_batch(X)
    assert probs.shape == (10,)
    assert probs.min() >= 0.0
    assert probs.max() <= 1.0


def test_predict_batch_rejects_wrong_width():
    svc = get_model_service()
    with pytest.raises(ValueError):
        svc.predict_batch(np.zeros((3, 14), dtype="float32"))   # ancho v2 viejo


def test_singleton_idempotent():
    assert get_model_service() is get_model_service()
