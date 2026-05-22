"""Servicio singleton para cargar y servir el modelo Random Forest v2."""
from __future__ import annotations

import logging
import threading
import warnings
from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np

log = logging.getLogger(__name__)


FEATURE_NAMES_V2: List[str] = [
    "mean_sigma0_vv", "std_sigma0_vv", "min_sigma0_vv", "cv_sigma0_vv",
    "mean_vv_vh_ratio", "water_count",
    "elevation", "slope", "distance_to_stream", "flow_accumulation",
    "ndvi_mean",
    "distance_to_coast", "twi", "hand",
]


class ModelService:
    """Singleton que carga random_forest_v2.joblib una vez al iniciar."""

    _instance: Optional["ModelService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._model = None
        self._model_path: Optional[Path] = None

    @classmethod
    def get_instance(cls) -> "ModelService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = ModelService()
        return cls._instance

    def load_model(self, model_path: Path) -> None:
        """Carga el modelo desde disk. Idempotente."""
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
        n_feats = getattr(self._model, "n_features_in_", -1)
        if n_feats != len(FEATURE_NAMES_V2):
            log.warning(
                "Modelo espera %d features pero FEATURE_NAMES_V2 declara %d",
                n_feats, len(FEATURE_NAMES_V2),
            )
        log.info(
            "Modelo cargado: %s  n_estimators=%s  max_depth=%s  n_features=%d",
            type(self._model).__name__,
            getattr(self._model, "n_estimators", "?"),
            getattr(self._model, "max_depth", "?"),
            n_feats,
        )

    def is_loaded(self) -> bool:
        return self._model is not None

    def predict(self, features: np.ndarray) -> float:
        """Devuelve la probabilidad de clase 1 (inundado).

        features: shape (14,) o (1, 14).
        """
        if self._model is None:
            raise RuntimeError("Modelo no cargado. Llama a load_model() primero.")
        x = np.asarray(features, dtype="float32")
        if x.ndim == 1:
            x = x.reshape(1, -1)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            proba = self._model.predict_proba(x)[:, 1]
        return float(proba[0])

    def predict_batch(self, features: np.ndarray) -> np.ndarray:
        """Devuelve probabilidades para una matriz (N, 14)."""
        if self._model is None:
            raise RuntimeError("Modelo no cargado.")
        x = np.asarray(features, dtype="float32")
        if x.ndim != 2 or x.shape[1] != len(FEATURE_NAMES_V2):
            raise ValueError(
                f"Esperado shape (N, {len(FEATURE_NAMES_V2)}), recibido {x.shape}"
            )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self._model.predict_proba(x)[:, 1]

    @staticmethod
    def get_feature_names() -> List[str]:
        return list(FEATURE_NAMES_V2)


def get_model_service() -> ModelService:
    """Helper para inyeccion en endpoints FastAPI."""
    return ModelService.get_instance()
