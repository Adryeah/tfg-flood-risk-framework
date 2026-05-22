"""FastAPI app del framework predictivo de riesgo de inundacion DANA.

Levantar con:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

Estructura:
  - 4 routers: risk, portfolio, metrics, methodology
  - 8 endpoints (ver routers)
  - 4 services con singleton: model, features, geojson, portfolios
"""
from __future__ import annotations

import logging
import time
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import geo as geo_router
from .routers import metrics as metrics_router
from .routers import methodology as methodology_router
from .routers import portfolio as portfolio_router
from .routers import risk as risk_router
from .services.feature_extractor import get_feature_extractor
from .services.geojson_service import get_geojson_service
from .services.model_service import get_model_service
from .services.portfolio_generator import get_portfolio_store

warnings.filterwarnings("ignore", category=UserWarning)
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("flood-risk-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Carga de modelo + lookups + GeoJSON + portfolios al iniciar."""
    t0 = time.time()
    log.info("=" * 60)
    log.info("Iniciando %s v%s", settings.API_TITLE, settings.API_VERSION)
    log.info("DATA_PROCESSED_DIR: %s", settings.DATA_PROCESSED_DIR)
    log.info("MODEL_PATH:         %s", settings.MODEL_PATH)
    log.info("=" * 60)

    # 1. Modelo
    t = time.time()
    try:
        get_model_service().load_model(settings.MODEL_PATH)
        log.info("Modelo cargado en %.2f s", time.time() - t)
    except Exception as exc:
        log.exception("Fallo cargando modelo: %s", exc)

    # 2. Feature lookups
    t = time.time()
    try:
        get_feature_extractor().load_lookups(settings.DATA_PROCESSED_DIR)
        log.info("Feature lookups cargados en %.2f s", time.time() - t)
    except Exception as exc:
        log.exception("Fallo cargando lookups: %s", exc)

    # 3. GeoJSON
    t = time.time()
    try:
        get_geojson_service().load_all(settings.DATA_PROCESSED_DIR)
        log.info("GeoJSONs cargados en %.2f s", time.time() - t)
    except Exception as exc:
        log.exception("Fallo cargando GeoJSONs: %s", exc)

    # 4. Predefined portfolios
    t = time.time()
    try:
        get_portfolio_store().load_predefined(settings.DATA_PROCESSED_DIR)
        log.info("Predefined portfolios cargados en %.2f s",
                 time.time() - t)
    except Exception as exc:
        log.exception("Fallo cargando portfolios: %s", exc)

    log.info("Startup total: %.2f s", time.time() - t0)
    log.info("=" * 60)
    yield
    log.info("Shutdown del backend.")


app = FastAPI(
    title=settings.API_TITLE,
    description=settings.API_DESCRIPTION,
    version=settings.API_VERSION,
    lifespan=lifespan,
)

# CORS
allow_origins = settings.CORS_ORIGINS
if settings.DEBUG:
    allow_origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(risk_router.router)
app.include_router(geo_router.router)
app.include_router(portfolio_router.router)
app.include_router(metrics_router.router)
app.include_router(methodology_router.router)


@app.get("/", tags=["root"])
def root():
    """Info basica del API."""
    return {
        "name": settings.API_TITLE,
        "version": settings.API_VERSION,
        "docs": "/docs",
        "health": "/api/health",
        "endpoints": [
            "GET  /api/risk/{zone}.geojson",
            "GET  /api/risk/predict?lat=&lon=",
            "GET  /api/portfolios/predefined",
            "GET  /api/portfolios/{portfolio_id}",
            "POST /api/portfolios/custom",
            "GET  /api/portfolios/{portfolio_id}/exposure",
            "GET  /api/metrics/{section}",
            "GET  /api/methodology/leakage_audit",
        ],
    }


@app.get("/api/health", tags=["root"])
def health():
    """Health check con estado de servicios."""
    return {
        "status": "ok",
        "model_loaded": get_model_service().is_loaded(),
        "lookup_zones": get_feature_extractor().loaded_zones(),
        "geojson_keys": get_geojson_service().loaded_keys(),
        "predefined_portfolios": len(
            get_portfolio_store().list_predefined()
        ),
    }
