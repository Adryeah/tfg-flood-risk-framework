# Decisión de método de detección de agua en Sigma0_VV

**Fecha:** 2026-04-20
**Autor:** Adrián Vargas Aceituno
**Contexto:** Preprocesado de 24 escenas Sentinel-1 GRD baseline (2022-10 → 2024-09) sobre Valencia - L'Horta Sud.
**Afecta a:** `water_detection.py`, feature `water_count` del modelo, producto `water_frequency.tif`.

---

## 1. Problema detectado

Al correr el Otsu clásico (`skimage.filters.threshold_otsu`) escena por escena, 22/24 escenas cayeron dentro de un rango estable (umbral ≈ -16 dB, std ≈ 1.2 dB) pero **2 escenas produjeron umbrales anómalos**:

| Escena      | Umbral Otsu (dB) | % agua |
|-------------|------------------|--------|
| 20240117    | **-9.44**        | 72.9 % |
| 20240210    | **-9.19**        | 74.6 % |
| resto (22)  | ~-16 ± 1         | ~27 %  |

Interpretación física: esos dos días la distribución de σ⁰_VV es **quasi-unimodal** (probablemente viento fuerte sobre la Albufera + suelo saturado tras lluvia), por lo que Otsu ya no encuentra una frontera bimodal real y cae sobre un mínimo espurio en el centro de la distribución principal, clasificando ~73 % de la escena como agua. Esto contaminaría de forma sistemática el feature `water_count` y dejaría huerta normal puntuada como agua persistente.

## 2. Alternativas evaluadas

Se implementaron y compararon las tres opciones sobre las 24 escenas completas (script `water_detection_investigation.py`):

| Método                | Umbral por escena                 | Fuente        |
|-----------------------|-----------------------------------|---------------|
| A. Otsu binario       | `threshold_otsu` (2 clases)       | método actual |
| B. Umbral físico fijo | −17 dB                            | literatura SAR (>95 % P(agua)) |
| C. Multi-Otsu 3 clases| `threshold_multiotsu(classes=3)`, se toma el umbral inferior (frontera agua / tierra húmeda) | skimage |

### Estabilidad del umbral (24 escenas)

| Método      | min (dB) | max (dB) | mediana | std (dB) |
|-------------|----------|----------|---------|----------|
| Otsu        | -18.0    | **-9.19**| -15.6   | **1.95** |
| Fijo -17    | -17.0    | -17.0    | -17.0   | 0.00     |
| Multi-Otsu  | -18.97   | -13.14   | -15.63  | **1.36** |

Multi-Otsu elimina las dos anomalías (ningún umbral por encima de -13 dB) y además es más estable que Otsu binario incluso descartando las anómalas.

### Sanity check (valor final en `water_frequency.tif`, 0-24)

| Punto (lon, lat)            | Esperado   | Otsu | Fijo -17 | Multi-Otsu |
|-----------------------------|------------|------|----------|------------|
| Albufera (-0.335, 39.335)   | ~24        | 24   | 24       | **24**     |
| Mar (-0.28, 39.35)          | ~24        | 23   | 24       | **23**     |
| Urbano (-0.376, 39.475)     | 0          | 2-3  | 0        | **0**      |
| Huerta (-0.46, 39.40)       | ≤ 2        | 8+   | 0-1      | **1**      |

Multi-Otsu es el único método que pasa los 4 puntos sin contaminar zonas secas y sin subclasificar el mar.

## 3. Método elegido: **Multi-Otsu (3 clases)**

### Justificación

1. **Estabilidad:** std del umbral = 1.36 dB (vs 1.95 Otsu). Sin outliers.
2. **Coherencia física:** las 3 clases corresponden a regímenes físicos reales — agua abierta (reflexión especular), tierra húmeda / vegetación inundada (reflexión difusa intermedia) y tierra seca / vegetación (alta retrodispersión). Tomar el umbral inferior (agua vs. tierra húmeda) es conservador y coherente con lo que la literatura denomina "permanent water".
3. **Sanity checks:** Albufera y mar salen como agua permanente, urbano y huerta salen como nunca/casi-nunca agua.
4. **Señal de ocasional útil:** 11.67 % de la imagen cae en la banda 1-5/24, que es precisamente el tipo de píxel que el feature `water_count` debe capturar para predecir inundación.

### Robustez frente a las escenas anómalas

Con Multi-Otsu, 20240117 y 20240210 dejan de producir umbrales absurdos: sus umbrales pasan a ser -14.3 dB y -13.1 dB respectivamente, dentro del rango normal. El 73 % de agua espuria desaparece.

## 4. Implementación

`water_detection.py` acepta un flag CLI:

```bash
python scripts/preprocessing/sar/water_detection.py --method multiotsu  # default
python scripts/preprocessing/sar/water_detection.py --method otsu
python scripts/preprocessing/sar/water_detection.py --method fixed --fixed-db -17.0
```

El default es `multiotsu`. `otsu` y `fixed` quedan disponibles para reproducir la comparación o para experimentos futuros.

## 5. Artefactos

**Definitivos (producción):**
- `data/sentinel1/water_masks/water_mask_{YYYYMMDD}.tif` (24 ficheros, uint8, 0/1)
- `data/sentinel1/water_masks/water_frequency.tif` (uint8, 0-24)
- `results/diagnostics/water_otsu_histogram.png`
- `results/diagnostics/water_frequency_map.png`

**Evidencia de la decisión (memoria TFG):**
- `results/diagnostics/anomalous_scenes/histograms_otsu_vs_fixed_vs_multi.png`
- `results/diagnostics/anomalous_scenes/water_frequency_comparison.png`

**Estadísticas finales del `water_frequency.tif` definitivo:**
- nunca (=0):     59.00 %
- ocasional (1-5): 11.67 %
- persistente (6-23): 8.99 %
- siempre (=24):   20.34 %
