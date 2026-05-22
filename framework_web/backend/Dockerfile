# ─── Backend image · FastAPI + Random Forest v2 ───────────────────
# Builds the production-ready backend container for Render (or any
# Docker host). The image bundles:
#   - Python 3.12-slim
#   - System libs needed by geopandas / rasterio / shapely (GDAL/PROJ/GEOS)
#   - All Python deps from requirements.txt
#   - The backend source (framework_web/backend/)
#   - The pre-trained Random Forest v2 model + the processed data
#     (parquets, geojsons, municipalities)
#
# Size budget: ~600 MB compressed (Python + GDAL deps + 72 MB of app
# data). Fits comfortably in Render's free + Starter tier.
#
# Run locally:
#   docker build -t flood-risk-backend -f framework_web/backend/Dockerfile .
#   docker run --rm -p 8000:8000 flood-risk-backend
# ───────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# System dependencies — geospatial Python wheels (geopandas, rasterio,
# shapely, pyproj) need GDAL / GEOS / PROJ at the C level. Slim image
# doesn't ship them, so we install via apt before pip.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    libspatialindex-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so the layer is cached across rebuilds
# when only app code changes.
COPY framework_web/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy app code. The relative layout mirrors the dev repo so
# `framework_web.backend.main:app` keeps working unchanged.
COPY framework_web/backend/ ./framework_web/backend/
COPY framework_web/__init__.py ./framework_web/__init__.py
COPY models/random_forest_v2.joblib ./models/random_forest_v2.joblib

# Strip the dev logs that may have been committed by accident.
RUN rm -f ./framework_web/backend/backend.log \
          ./framework_web/backend/backend.err.log

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
# DEBUG off in production → CORS uses CORS_ORIGINS env, not wildcard
ENV DEBUG=false
# Render injects $PORT (default 10000). We honour it but default to 8000
# so the same image runs locally with -p 8000:8000.
ENV PORT=8000

EXPOSE 8000

# Healthcheck — matches Render's free + Starter convention. Probes
# /api/health every 30 s.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

# Use sh -c so $PORT is interpolated at container start (Render).
CMD ["sh", "-c", "uvicorn framework_web.backend.main:app --host 0.0.0.0 --port ${PORT}"]
