"""Servicio singleton para cargar y servir el modelo Random Forest v3-T
(transferible, 10 features, con calibracion isotonica).

v3-T (jun 2026): sustituye al RF v2 de 14 features. Se eligio por seleccion
de features guiada por transferencia (ablacion LOZO bidireccional) — quita
las features no transferibles (elevation, slope, std_vv, vv_vh_ratio,
distance_to_coast) y anade distance_to_river (A/B ganador) — y se sirve
calibrado (isotonica) a prevalencia natural con umbral operacional 0,160.
Las predicciones se devuelven YA calibradas, coherentes con los mapas.
"""
from __future__ import annotations

import logging
import threading
import warnings
from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np

log = logging.getLogger(__name__)


# Set de features del v3-T (nucleo transferible lozo9r, mismo orden de
# entrenamiento). distance_to_river (A/B ganador) va el ultimo. El orden y la
# lista REAL los fija el calibrador (cal["features"]); esto es solo fallback.
FEATURE_NAMES_V3T: List[str] = [
    "mean_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv", "water_count",
    "distance_to_stream", "flow_accumulation", "ndvi_mean", "twi", "hand",
    "distance_to_river",
]

# Set v2 (14 feats) — conservado solo por compatibilidad de imports legacy.
FEATURE_NAMES_V2: List[str] = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean", "distance_to_coast", "twi", "hand",
]

# El servicio opera con el set activo del modelo en produccion = v3-T.
FEATURE_NAMES = FEATURE_NAMES_V3T


class ModelService:
    """Singleton que carga el modelo v3-T + su calibrador una vez al iniciar."""

    _instance: Optional["ModelService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._model = None
        self._model_path: Optional[Path] = None
        self._iso = None                # IsotonicRegression o None
        self._features: List[str] = FEATURE_NAMES_V3T
        self._threshold: float = 0.160

    @classmethod
    def get_instance(cls) -> "ModelService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = ModelService()
        return cls._instance

    def load_model(self, model_path: Path, calibrator_path: Optional[Path] = None) -> None:
        """Carga el modelo (y opcionalmente el calibrador). Idempotente."""
        if self._model is not None and self._model_path == model_path:
            log.info("Modelo ya cargado: %s", model_path)
            return
        log.info("Cargando modelo: %s", model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"Modelo no encontrado: {model_path}")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self._model = joblib.load(model_path)
        self._model_path = model_path

        if calibrator_path is not None and Path(calibrator_path).exists():
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                cal = joblib.load(calibrator_path)
            self._iso = cal.get("isotonic")
            self._features = cal.get("features", FEATURE_NAMES_V3T)
            self._threshold = float(cal.get("threshold", 0.160))
            log.info("Calibrador v3-T cargado: %d feats, umbral=%.3f (isotonica=%s)",
                     len(self._features), self._threshold, self._iso is not None)
        else:
            log.warning("Sin calibrador — se devolveran probabilidades crudas.")

        n_feats = getattr(self._model, "n_features_in_", -1)
        if n_feats != len(self._features):
            log.warning("Modelo espera %d features pero el set activo declara %d",
                        n_feats, len(self._features))
        log.info("Modelo cargado: %s  n_estimators=%s  max_depth=%s  n_features=%d",
                 type(self._model).__name__,
                 getattr(self._model, "n_estimators", "?"),
                 getattr(self._model, "max_depth", "?"), n_feats)

    def is_loaded(self) -> bool:
        return self._model is not None

    def _calibrate(self, proba: np.ndarray) -> np.ndarray:
        return self._iso.predict(proba) if self._iso is not None else proba

    def predict(self, features: np.ndarray) -> float:
        """Probabilidad CALIBRADA de clase 1 (inundado). features: (10,) o (1,10)."""
        if self._model is None:
            raise RuntimeError("Modelo no cargado. Llama a load_model() primero.")
        x = np.asarray(features, dtype="float32")
        if x.ndim == 1:
            x = x.reshape(1, -1)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            proba = self._model.predict_proba(x)[:, 1]
        return float(self._calibrate(proba)[0])

    def predict_batch(self, features: np.ndarray) -> np.ndarray:
        """Probabilidades calibradas para una matriz (N, n_features)."""
        if self._model is None:
            raise RuntimeError("Modelo no cargado.")
        x = np.asarray(features, dtype="float32")
        if x.ndim != 2 or x.shape[1] != len(self._features):
            raise ValueError(f"Esperado shape (N, {len(self._features)}), recibido {x.shape}")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            proba = self._model.predict_proba(x)[:, 1]
        return self._calibrate(proba)

    def get_feature_names(self) -> List[str]:
        return list(self._features)

    def get_threshold(self) -> float:
        return self._threshold


def get_model_service() -> ModelService:
    """Helper para inyeccion en endpoints FastAPI."""
    return ModelService.get_instance()
