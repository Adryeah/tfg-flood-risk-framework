"""Configuracion centralizada del backend FastAPI."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


# Repo root: 3 niveles arriba de este archivo
# (.../framework_web/backend/config.py -> .../tfg-earth-intelligence/)
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Settings cargadas desde .env (o defaults)."""
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / "framework_web" / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    API_VERSION: str = "1.0.0"
    API_TITLE: str = "Predictive Flood Risk Assessment Framework API"
    API_DESCRIPTION: str = (
        "Backend del framework predictivo de riesgo de inundacion "
        "(TFG DANA Valencia 2024). Sirve mapas de riesgo, features "
        "por coordenada, carteras sinteticas y metricas del modelo "
        "Random Forest v2 (AUC 0.922 Valencia, AUC 0.817 Algemesi)."
    )

    DEBUG: bool = True
    API_PORT: int = 8000

    DATA_PROCESSED_DIR: Path = REPO_ROOT / "framework_web" / "backend" / "data_processed"
    MODEL_PATH: Path = REPO_ROOT / "models" / "random_forest_v2.joblib"

    # Accept CORS_ORIGINS as a comma-separated env var so Render's UI
    # (single-line input) works without JSON escaping:
    #   CORS_ORIGINS=https://tfg.vercel.app,https://*.vercel.app
    # JSON arrays still work too (parsed manually below in the validator).
    #
    # `NoDecode` is required so pydantic-settings doesn't try to JSON-decode
    # the raw env string before our validator runs — that's the failure
    # mode that crashed the first Render deploy with
    #   "error parsing value for field CORS_ORIGINS from EnvSettingsSource"
    # because `https://*.vercel.app` isn't valid JSON.
    CORS_ORIGINS: Annotated[List[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
        ]
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors_origins(cls, v):
        if isinstance(v, str):
            stripped = v.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                import json
                return json.loads(stripped)
            return [s.strip() for s in stripped.split(",") if s.strip()]
        return v

    THRESHOLD_OPERATIONAL: float = 0.614
    THRESHOLD_OPERATIONAL_ALGEMESI: float = 0.389


settings = Settings()
