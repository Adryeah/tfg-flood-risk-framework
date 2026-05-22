# Framework de Evaluación Predictiva de Riesgo Catastrófico

## DANA Valencia 2024 — Sentinel-1 SAR + Sentinel-2

**Trabajo de Fin de Grado | Ingeniería de Telecomunicaciones — UAB**

| | |
|---|---|
| **Autor** | Adrián Vargas Aceituno |
| **Tutor académico** | Prof. José A. López-Salcedo (DTES/SPCOMNAV, UAB) |
| **Tutor empresa** | Ricard (CIO, Zurich Insurance Spain) |
| **Curso** | 2024–2025 |

---

## Descripción

Framework predictivo de riesgo de inundación catastrófica basado en teledetección satelital. Utiliza datos SAR de Sentinel-1 y ópticos de Sentinel-2 (ESA Copernicus) para entrenar un modelo de Random Forest que predice la probabilidad de inundación por píxel.

**Caso de estudio:** DANA Valencia, octubre 2024 (una de las peores catástrofes naturales de España en décadas).

**Tres fases temporales:**

1. **Pre-DANA** (2022-01-01 → 2024-09-30): periodo base, entrenamiento del modelo
2. **Durante DANA** (2024-10-29 → 2024-11-05): cartografía de la inundación
3. **Post-DANA** (2024-11-06 → 2025-03-31): análisis de recuperación

**Extrapolación:** el modelo entrenado en Valencia L'Horta Sud se aplica a la Vega Baja del Segura para validar su generalización geográfica.

---

## Datos Utilizados

| Sensor / Fuente | Tipo | Resolución | Uso |
|---|---|---|---|
| Sentinel-1 GRD IW | SAR (VV+VH) | 10–20 m | Features temporales, detección agua |
| Sentinel-2 L2A | Óptico multiespectral | 10–20 m | NDVI, NDWI, máscara nubes (SCL) |
| SRTM 30m (NASA) | DEM | 30 m | Slope, flow accumulation, dist. ríos |
| Copernicus EMS EMSR768 | Polígonos vectoriales | — | Ground truth validación DANA |

Todos los datos son públicos y gratuitos (ESA Copernicus, NASA Earthdata).

---

## Estructura del Repositorio

```
tfg-earth-intelligence/
│
├── config/
│   ├── params.yaml              # Parámetros del modelo y estudio
│   └── paths.yaml               # Rutas a datos y resultados
│
├── scripts/                     # Pipeline Python (código de producción)
│   ├── download/                # Descarga desde Copernicus API
│   ├── preprocessing/
│   │   ├── sar/                 # Pipeline SNAP: calibración, speckle, TC
│   │   ├── optical/             # Máscaras nube S2, NDVI, NDWI
│   │   └── dem/                 # Slope, flow accumulation, distancia ríos
│   ├── features/                # Construcción del dataset de entrenamiento
│   ├── models/                  # Entrenamiento Random Forest
│   ├── validation/              # Comparación vs EMS ground truth
│   ├── extrapolation/           # Aplicación del modelo a nueva zona
│   ├── visualization/           # Mapas estáticos y demo Folium
│   └── utils/                   # config.py (carga YAML), helpers
│
├── notebooks/
│   ├── exploration/             # EDA, análisis exploratorio
│   ├── analysis/                # Resultados, validación
│   └── figures/                 # Figuras generadas para la memoria
│
├── data/                        # Datos satelitales (NO en git)
│   ├── sentinel1/               # raw/, processed/, water_masks/
│   ├── sentinel2/               # raw/, processed/, indices/
│   ├── dem/                     # DEM SRTM
│   ├── ems/                     # Polígonos Copernicus EMS
│   ├── auxiliary/               # Hidrografía, catastro
│   ├── extrapolation/           # Datos zona Vega Baja del Segura
│   └── catalogo_escenas.csv     # Registro de escenas descargadas
│
├── models/
│   ├── trained/                 # random_forest.joblib, scaler.joblib
│   └── evaluation/              # Métricas de evaluación del modelo
│
├── results/
│   ├── maps/                    # GeoTIFFs y PNGs por fase temporal
│   │   ├── 01_pre_dana/
│   │   ├── 02_during_dana/
│   │   ├── 03_post_dana/
│   │   ├── 04_risk_prediction/
│   │   └── 05_extrapolation/
│   ├── metrics/                 # CSV con AUC, F1, precision, recall
│   ├── figures/                 # Figuras para la memoria
│   └── tables/                  # Tablas exportadas
│
├── docs/
│   ├── memoria_latex/           # Memoria TFG en LaTeX (Overleaf sync)
│   ├── presentacion/            # Slides defensa
│   ├── propuesta/               # Propuesta inicial TFG
│   ├── reuniones/               # Actas y tracking semanal
│   └── literatura/              # Papers y referencias
│
├── demo/                        # mapa_interactivo.html (Folium)
├── capturas/                    # Screenshots semanales del progreso
│
├── requirements.txt
├── .gitignore
├── CLAUDE.md
└── README.md
```

---

## Instalación y Uso

```bash
# Clonar repositorio
git clone <url>
cd tfg-earth-intelligence

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows

# Instalar dependencias
pip install -r requirements.txt

# Configurar credenciales Copernicus (NO versionar)
cp config/copernicus_credentials.yaml.example config/copernicus_credentials.yaml
# Editar con tus credenciales

# Ejecutar pipeline
python scripts/preprocessing/sar/pipeline_sar.py --input data/sentinel1/raw/SCENE.zip
python scripts/features/build_dataset.py
python scripts/models/train_model.py
python scripts/validation/validate_vs_ems.py
```

> **Nota:** ESA SNAP 10 y el módulo `snappy` requieren instalación manual desde [step.esa.int](https://step.esa.int).
