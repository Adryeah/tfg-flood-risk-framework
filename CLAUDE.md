
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

## UNDERWRITER CONSOLE · /tour
Consola de inteligencia de cartera en `framework_web/frontend/src/` inspirada en el lenguaje visual de Palantir/Bloomberg adaptada a insurance underwriting.

### Vocabulario
Términos militares en inglés usados como jerga técnica con tooltips que traducen a términos underwriter. Ejemplo: "TARGET" = póliza monitorizada, "ASSET" = póliza, "MONITORED" = bajo supervisión activa.

### Stack
- deck.gl 9.3.2 + Tile3DLayer (Google Photorealistic 3D Tiles o OpenFreeMap como fallback)
- MapLibre para basemap (sin Google key = OpenFreeMap Liberty)
- CSS filter postprocessing para modos visuales (thermal/night/archive)
- React Context para estado centralizado (mode, hud, activeIndex, speed, incidentTime)

### Modos visuales
| Modo | Filtro CSS | Uso |
|------|-----------|-----|
| photo | none | Fly-through normal |
| thermal | saturate(2.2) sepia(0.8) hue-rotate(-10deg) | Mapa de calor de riesgo |
| night | saturate(0) brightness(0.85) | NVG monocromo verde |
| archive | contrast(1.15) brightness(0.92) | Dossier / evidence |

### Arquitectura

```
src/
├── components/tour/
│   ├── hud-overlay.jsx      # Orquestador de paneles HUD
│   ├── target-registry.jsx # Panel izquierdo: ID·€TIV·P(flood)
│   ├── mode-bank.jsx       # F1-F5 shortcuts + useKeyboardModeSwitcher
│   ├── tactical-minimap.jsx # Minimap con grid WGS84 + N arrow
│   ├── status-strip.jsx    # Bottom bar: assets/monitored/mode/speed
│   ├── incident-timeline.jsx # Scrubber 19 oct → 31 oct con play/pause
│   ├── center-reticle.jsx  # Retícula SVG que cambia por modo
│   └── help-overlay.jsx    # Keyboard shortcuts (?) help
└── lib/tour/
    ├── tour-state.jsx      # Context provider + reducer (mode, hud, etc)
    ├── deck-effects.js    # getShaderCssFilter(mode)
    ├── shader-thermal.js  # GLSL pseudocolor JET (no usado aún)
    ├── shader-night.js     # GLSL green boost (no usado aún)
    ├── shader-archive.js  # GLSL scanlines + viñeta (no usado aún)
    ├── incident-replay.js # DANA_TIMELINE, MODEL_METRICS, polygon helpers
    └── trace-layer.js     # PathLayer factory para trace geodésico
```

### Teclas
- ← → : Navegar pólizas
- Space : Play/Pause
- F1-F5 : Cambiar modo visual
- ? / h : Toggle help overlay
- Esc : Cerrar help overlay

### Accesibilidad (Fase 6)
- `prefers-reduced-motion` respetado vía `usePrefersReducedMotion` hook en `src/lib/animations.js`:
  - Fly-throughs entre pólizas → jump instantáneo (`transitionDuration: 0`)
  - CSS filter crossfade entre modos → switch instantáneo (`transition: none`)
- Mobile (< md breakpoint, 768 px) muestra banner "Consola pensada para desktop" pero el mapa sigue renderizando — degradación graceful, no bloqueo total.
- Focus visible global (2 px outline accent-info) heredado de `main.css :focus-visible`.

### Defaults HUD
`HUD_DEFAULTS` en `tour-state.jsx`:
- callsigns: true (TargetRegistry visible)
- reticle: true (CenterReticle por modo)
- grid: true (TacticalMiniMap esquina superior derecha)
- trace: false (opt-in; sweep mode lo activa)
- scanlines: false (opt-in; archive mode lo activa)

### Mode bank tintes semánticos
| Modo | Pill activa tint | Fondo glifo | Lectura |
|------|------------------|-------------|---------|
| F1 PHOTO   | #22D3EE cyan   | dark navy | analítica neutra |
| F2 THERMAL | #E74C3C red    | white | heat-map register |
| F3 NIGHT   | #22C55E green  | dark green | NVG low-light |
| F4 ARCHIVE | #F39C12 amber  | dark | evidence dossier |
| F5 SWEEP   | #FBBF24 gold   | dark | god-mode panoptic |

Sin estos tintes el modo activo se confunde con el resto cuando el ojo no está mirando la pill directamente — el chrome del HUD lleva paleta navy uniforme así que la pill activa es la única señal cromática.
