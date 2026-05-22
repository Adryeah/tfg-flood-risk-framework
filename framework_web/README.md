# Framework Web — Predictive Flood Risk Assessment

Backend FastAPI + tools de export para servir el framework predictivo
de riesgo de inundación del TFG (DANA Valencia 2024). Modelo final:
**Random Forest v2** (14 features, AUC 0.922 Valencia, AUC 0.817 Algemesí).

## Estructura

```
framework_web/
├── backend/                        FastAPI app
│   ├── main.py                     # entrypoint, lifespan, routers
│   ├── config.py                   # Pydantic Settings
│   ├── routers/                    # 4 routers, 8 endpoints
│   ├── services/                   # model, features, geojson, portfolios
│   ├── schemas/                    # Pydantic models
│   ├── data_processed/             # outputs de tools/ (no commit)
│   └── requirements.txt
├── tools/                          # scripts pre-deploy
│   ├── 01_export_risk_to_geojson.py
│   ├── 02_build_features_lookup.py
│   ├── 03_export_metrics.py
│   ├── 04_validate_data.py
│   └── 05_generate_predefined_portfolios.py
├── tests/backend/                  # pytest
├── docker-compose.yml
├── .env.example
└── README.md
```

## Setup local (sin Docker)

Desde la raíz del repo `tfg-earth-intelligence/`:

```bash
# 1. Generar datos pre-procesados (una sola vez, ~5 min)
python framework_web/tools/01_export_risk_to_geojson.py
python framework_web/tools/02_build_features_lookup.py
python framework_web/tools/03_export_metrics.py
python framework_web/tools/05_generate_predefined_portfolios.py
python framework_web/tools/04_validate_data.py

# 2. Instalar deps backend en el venv ya existente
.venv/Scripts/python.exe -m pip install -r framework_web/backend/requirements.txt

# 3. Levantar uvicorn
cd framework_web
../.venv/Scripts/python.exe -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

API disponible en http://localhost:8000  •  Swagger en http://localhost:8000/docs

## Setup con Docker

```bash
cd framework_web
cp .env.example .env
docker compose up
```

## Los 8 endpoints

```bash
# 1. GeoJSON de riesgo Valencia
curl http://localhost:8000/api/risk/valencia.geojson

# 2. GeoJSON de riesgo Algemesí
curl http://localhost:8000/api/risk/algemesi.geojson

# 3. Predicción puntual (Paiporta)
curl "http://localhost:8000/api/risk/predict?lat=39.4276&lon=-0.4153"

# 4. Listado de carteras predefinidas
curl http://localhost:8000/api/portfolios/predefined

# 5. Cartera completa con clientes
curl http://localhost:8000/api/portfolios/premium_residential

# 6. Cartera custom
curl -X POST http://localhost:8000/api/portfolios/custom \
  -H "Content-Type: application/json" \
  -d '{"n_clients": 50, "value_range": [100000, 500000],
       "type_distribution": {"residential": 0.7, "commercial": 0.3},
       "geographic_focus": "valencia", "seed": 42}'

# 7. Exposure agregada de la cartera
curl http://localhost:8000/api/portfolios/premium_residential/exposure

# 8. Métricas (valencia | algemesi | transferability | leakage)
curl http://localhost:8000/api/metrics/valencia
curl http://localhost:8000/api/metrics/leakage

# Bonus: caso completo de auditoría de leakage
curl http://localhost:8000/api/methodology/leakage_audit
```

## Tests

```bash
cd framework_web
../.venv/Scripts/python.exe -m pytest tests/ -v
```

## Regenerar `data_processed/`

Si se actualizan los modelos o features del pipeline TFG, ejecutar
los scripts de `tools/` en orden numérico (01 → 02 → 03 → 05 → 04).

## Modelo

`models/random_forest_v2.joblib` — entrenado con scikit-learn 1.3.2.
14 features ordenadas (ver `services/model_service.py:FEATURE_NAMES_V2`).

| Métrica | Valencia (OOF) | Algemesí (extrapolación) |
|---|---:|---:|
| AUC-ROC | 0.922 ± 0.019 | 0.817 |
| F1 | 0.485 (t=0.614) | 0.018 (t=0.389) |
| Recall | 0.777 | 0.919 |
| Precision | 0.353 | 0.0091 |
