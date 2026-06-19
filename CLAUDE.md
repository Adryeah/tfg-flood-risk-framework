
# CLAUDE.md — Earth Intelligence TFG
## Última actualización Abril 2026

## PROYECTO
**Título:** Predictive Flood Risk Assessment Framework based on Sentinel-1 SAR Signal Processing: DANA Valencia 2024 Case Study
**Autor:** Adrián Vargas Aceituno
**Grado:** Ingeniería de Sistemas de Telecomunicación, UAB
**Tutor académico:** Prof. José A. López-Salcedo (SPCOMNAV, DTES, UAB)
**Tutor empresa:** Ricard, CIO Zurich Insurance Spain
**Coordinador TFG:** Gary Junkin

## QUÉ HACE EL PROYECTO
Framework de 5 pasos que transforma datos satelitales públicos (Copernicus) en mapas de riesgo predictivo de inundación. Se entrena con datos ANTERIORES a la DANA de Valencia (oct 2024) y se valida contra el evento real (Copernicus EMS EMSR773). Tres fases temporales: pre-DANA (predicción), durante-DANA (change detection), post-DANA (recuperación NDVI). Extrapolación a segunda zona geográfica (Vega Baja del Segura).

## ESTADO ACTUAL (Semana 2)
### Completado
- 2 escenas S1 GRD descargadas (19 oct pre, 31 oct post)
- Pipeline SAR 5 pasos ejecutado manualmente en SNAP 13 (ambas escenas)
- Productos exportados como GeoTIFF en data/sentinel1/processed/
- Change detection calculado (post-pre)
- Ground truth descargado: Copernicus EMS EMSR773 delineation 31 oct en data/ems/
- Capturas S2 pre/post (True Color + False Color) en capturas/semana1/
- Memoria LaTeX: Cap 1 completo, Cap 5.1-5.2 completos, Cap 2 ya existía

### En curso (Semana 2)
- Automatizar pipeline SAR con Python
- Descargar ~30-50 escenas históricas (2022-sept 2024)
- Procesar en batch
- Pipeline óptico (NDVI)
- Preparar DEM

## STACK TECNOLÓGICO
- **Datos:** Copernicus Data Space (S1 GRD IW, S2 L2A), NASA SRTM 30m, Copernicus EMS EMSR773
- **SAR processing:** ESA SNAP 13 + esa_snappy (Python bridge)
- **Geoespacial:** rasterio, GDAL, geopandas, shapely, pyproj
- **ML:** scikit-learn (RandomForestClassifier, NO deep learning)
- **Visualización:** matplotlib, seaborn, folium
- **Config:** PyYAML (params.yaml, paths.yaml)
- **Memoria:** LaTeX (VS Code + MiKTeX, natbib)

## PARÁMETROS CLAVE (config/params.yaml)
yaml
study_area:
  name: "Valencia - L'Horta Sud"
  bbox: [-0.55, 39.30, -0.25, 39.55]
  crs: "EPSG:32630"

extrapolation_area:
  name: "Vega Baja del Segura"
  bbox: [-1.10, 38.00, -0.60, 38.25]

dates:
  baseline_start: "2022-01-01"
  baseline_end: "2024-09-30"
  event_start: "2024-10-29"
  event_end: "2024-11-05"
  recovery_end: "2025-03-31"

sentinel1:
  product_type: "GRD"
  sensor_mode: "IW"
  polarization: ["VV", "VH"]
  orbit_direction: "ASCENDING"

model:
  type: "RandomForest"
  n_estimators: 500
  max_depth: 15
  class_weight: "balanced"
  cv_folds: 5

water_detection:
  method: "otsu"
  band: "Sigma0_VV"

## ESTRUCTURA DE CARPETAS
tfg-earth-intelligence/
├── CLAUDE.md
├── config/
│   ├── params.yaml
│   └── paths.yaml
├── data/
│   ├── sentinel1/
│   │   ├── raw/                 ← .SAFE (2 escenas listas)
│   │   ├── processed/           ← GeoTIFFs calibrados (2 listos)
│   │   └── water_masks/
│   ├── sentinel2/raw/
│   ├── dem/
│   └── ems/                     ← EMSR773 shapefiles
├── scripts/
│   ├── download/
│   ├── preprocessing/sar/
│   ├── preprocessing/optical/
│   ├── features/
│   ├── models/
│   ├── validation/
│   └── visualization/
├── results/maps/
│   ├── 01_pre_dana/
│   ├── 02_during_dana/          ← change_detection listo
│   ├── 03_post_dana/
│   ├── 04_risk_prediction/
│   └── 05_extrapolation/
├── docs/memoria_latex/
└── capturas/semana1/

## PIPELINE SAR (5 pasos, orden estricto)
1. Apply Orbit File          → efemérides precisas POD
2. Thermal Noise Removal     → sustrae LUT ruido receptor
3. Calibrate (σ0)            → DN a retrodispersión (dB)
4. Speckle Filter (Lee 7×7)  → ruido multiplicativo
5. Range-Doppler TC (SRTM)   → coordenadas geográficas
**CRÍTICO:** Calibración (3) SIEMPRE antes de speckle (4). Invertir altera σ0.

## FEATURES DEL MODELO (por píxel)
### SAR temporales
- media_sigma0_vv, std_sigma0_vv, min_sigma0_vv
- water_count, cv_sigma0_vv, mean_vv_vh_ratio

### Topográficas (DEM SRTM)- elevation, slope, distance_to_stream, flow_accumulation

### Ópticas (S2)
- ndvi_mean

## REGLAS DE CÓDIGO
1. Rutas con pathlib.Path desde config/paths.yaml
2. Parámetros desde config/params.yaml — NUNCA hardcodear
3. GeoTIFF, CRS EPSG:32630
4. Scripts ejecutables independientemente
5. NO deep learning
6. Docstrings en español
7. logging, no print()
8. Type hints

## ⚠️ ADVERTENCIAS TÉCNICAS CRÍTICAS

### esa_snappy y memoria RAM
Fugas de memoria conocidas en batch. `.dispose()` NO libera RAM.
**Obligatorio:** cada escena en subprocess independiente.
python
### CORRECTO
import subprocess
for scene in scenes:
    subprocess.run(["python", "process_single_scene.py", scene], check=True)

### INCORRECTO — memoria nunca se libera
for scene in scenes:
    product = ProductIO.readProduct(scene)

### Autocorrelación espacial en ML
Píxeles cercanos están correlacionados. Train/test aleatorio → métricas infladas.
**Obligatorio:** GroupKFold con bloques geográficos.
**```python**
from sklearn.model_selection import GroupKFold
groups = assign_spatial_blocks(X, block_size_m=1000)
cv = GroupKFold(n_splits=5)
scores = cross_val_score(model, X, y, cv=cv, groups=groups)

### Polarización VV vs VH
VV superior para agua (especular, ~28% más sensibilidad). VH complementa:
ratio VV/VH distingue agua abierta de vegetación inundada. Usar ambas como features.

## VALIDACIÓN
- Ground truth: Copernicus EMS EMSR773, delineation 31 oct 2024
- Ubicación: data/ems/
- Métricas: AUC > 0.80, F1 > 0.70, Recall > 0.75

## NO HACER
- NO deep learning
- NO hardcodear coordenadas/fechas
- NO datos en Git (.gitignore)
- NO esa_snappy en bucle directo — subprocess
- NO train_test_split aleatorio — GroupKFold
- NO invertir calibración y speckle
- NO datos internos de Zurich Insurance

## DESIGN SYSTEM · DESIGN.md
La fuente única de verdad del lenguaje visual está en `framework_web/frontend/DESIGN.md` (formato AI-readable estilo refero.design). **Cualquier agente que genere componentes UI debe leerlo antes.** Consolida: paleta navy-authority + bright-blue interactive, pairing Inter/JetBrains Mono/IBM Plex Serif, sistema de registros editoriales por widget, jerarquía TIER de KPIs, recipe del eyebrow+rail, y los anti-patterns que delatan "AI-generated". Validado como sistema "Column-class" (light fintech + mono accent); NO importar un DESIGN.md externo wholesale porque los registros, tiers, RP selectors y HUD son domain-specific (flood underwriting).

## UNDERWRITER CONSOLE · /tour
Consola de inteligencia de cartera (`/tour` → `UnderwriterConsole` en `src/views/policy-tour-3d.jsx`). Fly-through de las pólizas de una cartera, edificio a edificio, sobre mapa MapLibre con extrusión 3D de la planta asegurada.

> **Nota de arquitectura (jun 2026):** existió un prototipo previo de "tactical HUD" con deck.gl + Tile3DLayer + modos visuales F1-F5 (`components/tour/`, `lib/tour/`, `tour-map.jsx`). Fue **retirado** (código muerto sin importadores) y sustituido por la implementación MapLibre descrita aquí. No reintroducir deck.gl/Cesium para el tour.

### Stack
- **MapLibre** vía `src/components/Map.tsx` (wrapper imperativo: `useMap`, `MapMarker`, `MarkerContent`). Sin deck.gl ni Cesium.
- Basemap **OpenFreeMap Liberty** (`tiles.openfreemap.org/styles/liberty`): trae footprints de edificios OSM (`source-layer 'building'`), necesarios para extruir la planta. CARTO dark-matter no trae edificios.
- Estado local en el componente (`useState`/`useMemo`), no Context global.

### Flujo
1. Carga el índice de carteras predefinidas (`/api/portfolios/predefined`) y la cartera seleccionada (`/api/portfolios/{id}`).
2. Filtra por producto (`particulares`/`pymes`/`autos`), ordena por riesgo desc y recorta a Top 20 / Top 100.
3. Renderiza un marcador por póliza, coloreado por `risk_category` (paleta `RISK_COLORS`: low→very_high).
4. La póliza activa monta `<PolicyTour3D>`: vuela al edificio (`flyTo` zoom 18, pitch 55, bearing −20), extruye la banda de la planta asegurada (`fill-extrusion`) en color de riesgo, flota un `PulsingMarker` a la altura de la planta y abre `PolicyRiskPanel`.
5. Auto-play avanza a la siguiente póliza cada `5000/speed` ms.

### Arquitectura (archivos vivos)

```
src/
├── views/policy-tour-3d.jsx          # UnderwriterConsole (ruta /tour) + top strip
├── components/
│   ├── Map.tsx                       # wrapper MapLibre (useMap, MapMarker, MarkerContent)
│   ├── tour-dock.jsx                 # dock inferior: lista pólizas + prev/next + play/pause/speed
│   └── PolicyTour3D/
│       ├── index.jsx                 # overlay: flyTo edificio + extrusión planta + cleanup
│       ├── PolicyRiskPanel.jsx       # panel vertical de riesgo de la póliza
│       ├── FloorRiskIndicator.jsx    # indicador de riesgo por planta
│       └── PulsingMarker.jsx         # marcador pulsante a la altura de la planta
├── hooks/useFloorRisk.js             # riesgo por planta → color + altitud
├── utils/floodGeometry.js            # squareFootprint, getFloorMin/MaxHeight
└── types/policyTour.types.js         # adaptClientToPolicy(client) → policy 3D
```

### Teclas
- ← → : Navegar pólizas
- Space : Play/Pause

### Accesibilidad / responsive
- `< md` (768 px) muestra banner "Consola pensada para desktop"; el mapa sigue renderizando (degradación graceful, no bloqueo).
- `prefers-reduced-motion` (hook `usePrefersReducedMotion` en `src/lib/animations.js`) se respeta en KPIs/reveal de las vistas de dashboard; el fly-through del tour usa `flyTo` de MapLibre.
- Focus visible global (2 px outline accent-info) heredado de `main.css :focus-visible`.

### Return Period · escalado AEP global (Fase 7)
Estado global persistido en `localStorage['frfw.return_period']` con valores T10, T50, T100 (default), T250, T500. Implementado en `src/lib/return-period.js` con hook `useReturnPeriod()` que cualquier consumer puede leer.

Escalado de pérdidas vía Annual Exceedance Probability:

```
loss(T) = loss(T_ref) * (T / T_ref)^α    con α = 0.35
```

α publicado en Dottori et al. (2018) *Nat. Clim. Change* 8(9) DOI:10.1038/s41558-018-0257-z (rango 0.28–0.45 para flood losses). T_ref = 100 porque la DANA Valencia 2024 corresponde a T75-100 según el reanalysis AEMET de precipitación 8h en cabecera del Poyo.

Multiplicadores resultantes:

| RP | Multiplicador |
|----|---------------|
| T10  | ×0.46 |
| T50  | ×0.80 |
| T100 | ×1.00 (baseline) |
| T250 | ×1.36 |
| T500 | ×1.75 |

P(flood) por píxel NO escala — representa la baseline climatológica actual, no la intensidad del escenario. La separación es intencional.

**Backbone metodológico (Fase 8)**: la plataforma soporta dos backbones intercambiables para los mapas de zonas inundables. El switching es opt-in por usuario, persistido global en `localStorage['frfw.backbone_source']`.

| Backbone | Default | Estado | Método |
|----------|---------|--------|--------|
| `rf_v2`  | ✓ | Operativo | Random Forest v2 + escalado AEP (Dottori 2018) — todo client-side, sin dependencias externas |
| `snczi`  | — | Pendiente | Rasters oficiales SNCZI/MITECO T10/T100/T500 — requiere descarga manual + tiles propios o WMS INSPIRE proxy |

Endpoint backend `/api/return-periods/sources` lista las fuentes disponibles para que el frontend sepa si puede ofrecer el toggle SNCZI. Manifest stub en `/api/return-periods/snczi/{zone}/{rp}/manifest` devuelve 503 mientras SNCZI no esté configurado, con mensaje claro para que la UI muestre el banner correspondiente.

**Pasos para activar SNCZI** (documentados en `framework_web/backend/routers/return_periods.py`):

1. Descargar manualmente rasters T10/T100/T500 desde MITECO (requiere aceptar términos web, no automatizable):
   <https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/cartografia-zi-lamina.html>
2. Recortar al bbox de cada zona con `gdalwarp`.
3. Generar tile pyramids z=10-15 con `gdal2tiles.py`.
4. Servir desde Render como capa raster `/api/return-periods/snczi/{zone}/{rp}/{z}/{x}/{y}.png`.
5. Alternativa WMS: proxy del WMS INSPIRE de MITECO desde el backend para evitar CORS.

**Visual feedback por RP** (Fase 8.A): el risk surface aplica un filtro CSS según el RP activo — saturación/brillo modulados para reflejar la intensidad del escenario sin falsificar datos. T100 baseline = filtro vacío. T10 desatura/aclara (escenario menos extremo), T500 satura/oscurece (escenario más extremo). Implementado en `getRPVisualFilter(rp)` en `src/lib/return-period.js`, aplicado al wrapper de `GeographicMap` en `/exposure`.

Componentes:
- `ReturnPeriodSelector` — `src/components/return-period-selector.jsx`. Integrado en `/exposure` como scenario bar (variant dashboard) para recalcular la pérdida estimada según el RP activo.
