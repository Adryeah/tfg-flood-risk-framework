# tools — generadores de datos pre-procesados

Scripts que transforman los outputs del pipeline del TFG (en `data/`,
`models/` y `results/`) en archivos servibles desde el backend FastAPI
(en `framework_web/backend/data_processed/`).

## Orden de ejecución

```bash
python tools/01_export_risk_to_geojson.py
python tools/02_build_features_lookup.py
python tools/03_export_metrics.py
python tools/05_generate_predefined_portfolios.py
python tools/04_validate_data.py     # al final, comprueba todo
```

## Outputs (backend/data_processed/)

| Archivo | Generador | Descripción |
|---|---|---|
| `valencia_risk.geojson` | 01 | Probabilidad RF v2 vectorizada por bins |
| `algemesi_risk.geojson` | 01 | Idem zona extrapolación |
| `ground_truth_valencia.geojson` | 01 | Máscara EMSR773 AOI01 clipped |
| `ground_truth_algemesi.geojson` | 01 | Máscara EMSR773 AOI04 clipped |
| `municipalities.geojson` | 01 | 14 municipios DANA |
| `valencia_features_lookup.parquet` | 02 | (lat, lon, 14 feats, predicted_p) |
| `algemesi_features_lookup.parquet` | 02 | Idem zona extrapolación |
| `precomputed_metrics.json` | 03 | Métricas consolidadas todas las secciones |
| `predefined_portfolios.json` | 05 | 3 carteras sintéticas con clientes |

## Notas

- Los scripts asumen que se ejecutan desde la raíz del repo
  (`c:/Users/Usuario/tfg-earth-intelligence/`).
- Tiempos esperados:
  - 01: ~2-4 min (vectorización)
  - 02: ~30 s
  - 03: ~5 s
  - 05: ~30 s
  - 04: ~10 s
- Tamaño total esperado de `data_processed/`: < 30 MB.
