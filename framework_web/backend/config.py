"""Configuracion centralizada del backend FastAPI."""
from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    CORS_ORIGINS: List[str] = Field(default_factory=lambda: [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ])

    # Accept CORS_ORIGINS as a comma-separated env var so Render's UI
    # (single-line input) works without JSON escaping:
    #   CORS_ORIGINS=https://tfg.vercel.app,https://*.vercel.app
    # JSON arrays still work too (pydantic-settings v2 default).
    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors_origins(cls, v):
        if isinstance(v, str):
            stripped = v.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return v  # let pydantic parse as JSON
            return [s.strip() for s in stripped.split(",") if s.strip()]
        return v

    THRESHOLD_OPERATIONAL: float = 0.614
    THRESHOLD_OPERATIONAL_ALGEMESI: float = 0.389


settings = Settings()
