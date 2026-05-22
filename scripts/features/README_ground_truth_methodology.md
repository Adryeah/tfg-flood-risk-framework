# Construcción del ground truth para el modelo predictivo de riesgo

**Fecha:** 2026-04-26
**Autor:** Adrián Vargas Aceituno
**Afecta a:** `data/labels/flood_mask_emsr773_clipped.tif`, `data/dataset/training_dataset.parquet`, feature `flood_label` del modelo Random Forest.
**Scripts implicados:** `scripts/features/build_dataset.py`, `scripts/labels/clip_flood_mask_to_municipalities.py`.

---

## 1. Problema detectado

La máscara generada en una primera iteración rasterizando directamente `EMSR773_AOI01_DEL_PRODUCT_observedEventA_v1.shp` sobre el grid canónico marcaba como inundadas zonas que claramente no se inundaron durante la DANA del 29 de octubre de 2024. La inspección visual reveló contaminación en al menos tres áreas dentro del bbox de estudio:

- **Cuenca natural Sueca–Cullera (Ribera Baixa)** al sur del bbox: incluida por un único polígono de tipo *Flood trace* de 251,75 km² que cubre el 47,4 % del área total del shapefile. Es el contorno grueso de la cuenca por la que fluyó el agua hacia el sur, no el área efectivamente inundada en zonas habitadas.
- **Marismas y arrozales perimetrales de la Albufera**: incluidas por un polígono de tipo *Flooded area* de 88 km² que abarca la laguna y los arrozales adyacentes, áreas hidrológicamente activas de forma natural durante todo el ciclo agrícola.
- **Banda contigua a La Devesa / El Saler**: aparece tocada por el borde norte del polígono *Flood trace* de 251 km² aunque las localizaciones específicas (mar, restinga, parque natural) no se inundaron.

El efecto neto: 15,80 % de píxeles del bbox marcados como inundados, frente al 5–10 % esperado para un evento de inundación localizado. El desbalance contaminado introducía falsos positivos en zonas hidrológicamente activas naturalmente —rasgo que el modelo aprendería a reconocer como "inundación" induciendo una circularidad lógica al predecir.

## 2. Investigación realizada

### 2.1 Atributos del shapefile `observedEventA`

Inspección directa de la tabla de atributos (1488 polígonos):

| Campo | Valores únicos | Reparto |
|---|---|---|
| `event_type` | 1 | `'5-Flood'` (todos) |
| `obj_desc` | 1 | `'Flash flood'` (todos) |
| `det_method` | 1 | `'Semi-automatic extraction'` (todos) |
| `notation` | **2** | **`'Flooded area'` (1117) / `'Flood trace'` (371)** |
| `dmg_src_id` | 3 | `2` (371) / `3` (1001) / `4` (116) |

El campo `notation` distingue dos tipos físicamente distintos:

- **`Flooded area`**: agua visible en imagen post-evento. Donde se pudo medir profundidad (idéntico geográficamente a `floodDepthA`).
- **`Flood trace`**: trazas de inundación detectadas en ortofoto pero ya drenadas en el momento de la imagen. Incluye contornos basinales gruesos.

### 2.2 Comparativa cuantitativa de capas EMSR773 (rasterizadas al bbox)

| Capa | Píxeles = 1 | % del bbox |
|---|---|---|
| `observedEventA` completo (Flood + Trace) | 1 199 510 | 15,80 % |
| `observedEventA` solo `Flooded area` | 539 624 | 7,11 % |
| `observedEventA` solo `Flood trace` | 659 886 | 8,69 % |
| `floodDepthA` (3216 polígonos con profundidad) | 539 625 | 7,11 % |

**Hallazgo numérico:** `floodDepthA` ≡ `observedEventA[notation=='Flooded area']`. Diferencia de 1 píxel por borde de rasterización. Son los mismos polígonos.

### 2.3 Hallazgo crítico — test punto a punto

| Punto | observedEvent (all) | Solo `Flooded area` | Solo `Flood trace` | `floodDepthA` |
|---|:-:|:-:|:-:|:-:|
| Centro Albufera (lago) | – | – | – | – |
| La Devesa | – | – | – | – |
| Mar frente Devesa | – | – | – | – |
| **Paiporta** | ✓ | – | **✓** | – |
| **Sedaví** | ✓ | – | **✓** | – |

Las zonas urbanas catastróficamente afectadas (Paiporta, Sedaví, Alfafar, Catarroja) **solo aparecen en `Flood trace`**, no en `Flooded area`. Razón física: el agua pasó por las calles, dañó propiedades y se drenó hacia barrancos antes de que el satélite adquiriera la imagen post-evento. EMSR las marca como traza visible (escombros, depósitos, daños), no como agua estanca.

Esto invalida la solución intuitiva de filtrar a `notation=='Flooded area'` o usar `floodDepthA`: ambas opciones eliminan precisamente el ground truth más relevante.

## 3. Alternativas evaluadas

| Opción | Descripción | Problema |
|---|---|---|
| **(a)** | Usar `observedEventA` completo, sin filtro | Contamina con `Flood trace` basinal lejano (Ribera Baixa, marismas) |
| **(b)** | Solo `Flooded area` o solo `floodDepthA` | Pierde Paiporta, Sedaví, Catarroja, Alfafar (zonas drenadas) |
| **(c)** | Filtrar polígonos por área > umbral (p. ej. > 50 km²) | Umbral arbitrario, no defendible académicamente, no resuelve el problema de raíz |
| **(d)** | **Clipping municipal con la declaración oficial de zona catastrófica** | Adoptada |

## 4. Solución adoptada — opción (d): clipping municipal

### Definición

`flood_label_corrected = (observedEventA completo) AND (máscara de municipios DANA)`

donde la máscara municipal contiene los términos municipales (boundaries OSM) de la lista oficial de municipios declarados zona catastrófica por el Real Decreto-ley 6/2024.

### Justificación académica

1. **Criterio objetivo** — la lista de municipios proviene de un instrumento legal (BOE), no de una decisión del autor.
2. **Conexión con la realidad operativa del sector asegurador** — el Consorcio de Compensación de Seguros opera y mapea siniestros por municipio. La unidad de declaración de daño de la administración española es el término municipal.
3. **Resuelve el problema de raíz** — excluye geográficamente las zonas que el shapefile EMS marca por contigüidad hidrológica pero que están fuera del impacto humano del evento.
4. **Conserva la señal urbana de `Flood trace`** — Paiporta, Sedaví, Alfafar, etc. siguen marcados como inundados gracias a que están dentro de sus respectivos municipios afectados.

### Fuentes y herramientas

| Recurso | Fuente |
|---|---|
| Lista oficial de municipios | Real Decreto-ley 6/2024, de 5 de noviembre, por el que se adoptan medidas urgentes de respuesta ante los daños causados por la DANA en diversos municipios |
| Límites municipales | OpenStreetMap vía `osmnx 2.1.0` (`geocode_to_gdf`) |
| Cache local | `data/auxiliary/municipios/dana_affected_municipalities.geojson` |
| Lista usada (16 municipios) | Paiporta, Catarroja, Sedaví, Alfafar, Benetússer, Massanassa, Albal, Beniparrell, Picanya, Picassent, Aldaia, Torrent, Quart de Poblet, Manises, Algemesí, Alzira |
| Municipios efectivos en el bbox | 14 (Algemesí y Alzira quedan al sur del bbox y se descartan automáticamente por intersección geométrica) |

## 5. Resultado cuantitativo

| Métrica | Antes (EMSR773 crudo) | Después (clipping municipal) |
|---|---:|---:|
| Píxeles clase 1 (inundado) | 1 199 510 | **606 165** |
| % del bbox como inundado | 15,80 % | **7,98 %** |
| % del bbox como no inundado | 84,18 % | **92,02 %** |
| Ratio negativos : positivos | 5,3 : 1 | **11,5 : 1** |
| Reducción de píxeles clase 1 | — | **−49,5 %** |
| Filas válidas en `training_dataset.parquet` | 7 539 690 | 7 539 690 (sin cambios) |

El 7,98 % está dentro del rango 5–10 % esperado para un evento de inundación localizado. El ratio 11,5 : 1 es directamente compatible con `class_weight='balanced'` en scikit-learn sin necesidad de SMOTE ni undersampling.

## 6. Validación visual

Diagnósticos en [results/diagnostics/dataset/](../../results/diagnostics/dataset/):

- `flood_mask_before_after.png` — comparación lado a lado de la máscara antes y después del clipping.
- `flood_mask_visualization.png` — máscara final superpuesta (rojo) sobre `mean_sigma0_vv`.
- `municipalities_visualization.png` — bordes municipales en cyan con nombre, sobre `mean_sigma0_vv`.

**Validaciones puntuales** (todas correctas en la máscara final):

| Punto | Esperado | Resultado |
|---|---|---|
| Centro Albufera (lago) | no inundado | 0 ✓ |
| La Devesa (centro/norte) | no inundado | 0 ✓ |
| El Saler pueblo | no inundado | 0 ✓ |
| Mar frente Devesa | no inundado | 0 ✓ |
| Paiporta centro | inundado | 1 ✓ |
| Sedaví centro | inundado | 1 ✓ |
| Alfafar centro | inundado | 1 ✓ |
| Massanassa centro | inundado | 1 ✓ |
| Albal centro | inundado | 1 ✓ |
| Picanya centro | inundado | 1 ✓ |

## 7. Artefactos finales

| Fichero | Función |
|---|---|
| `data/auxiliary/municipios/dana_affected_municipalities.geojson` | Cache de límites municipales OSM |
| `data/labels/affected_municipalities_mask.tif` | Máscara binaria municipal (uint8) |
| `data/labels/flood_mask_emsr773.tif` | Máscara EMSR773 cruda (referencia) |
| `data/labels/flood_mask_emsr773_clipped.tif` | **Máscara definitiva tras clipping** |
| `data/dataset/training_dataset.parquet` | Dataset tabular con `flood_label` corregida |

Reproducible con: `python scripts/labels/clip_flood_mask_to_municipalities.py [--force]`.
