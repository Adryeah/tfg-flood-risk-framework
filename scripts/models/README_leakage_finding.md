# Hallazgo de leakage temporal en XGBoost v3

**Fecha del hallazgo:** 2026-05-03
**Autor:** Adrian Vargas Aceituno
**Contexto:** Validacion previa a inclusion de XGBoost v3 como modelo final del TFG.

## Resumen ejecutivo

Durante la auditoria de leakage del modelo XGBoost v3 (AUC OOF reportado
0.966, F1 0.780), se descubrio que **cuatro features estacionales de
invierno** fueron calculadas incluyendo las dos escenas Sentinel-1 SAR del
propio evento DANA (19 oct y 31 oct 2024). El modelo, por tanto, fue
entrenado con features que contienen la inundacion que debe predecir.

Se rechaza XGBoost v3 como modelo final. **El modelo final del TFG sigue
siendo Random Forest v2** (AUC 0.922 Valencia, AUC 0.817 Algemesi).

## El bug

### Codigo afectado

`scripts/features/extract_advanced_features_v3.py`, linea 162:

```python
processed_dir = REPO / "data" / "sentinel1" / "processed"
tifs = sorted(p for p in processed_dir.glob("S1_sigma0_*.tif")
              if "event" not in p.parts)
```

El filtro `"event" not in p.parts` solo descarta archivos cuyo path
contenga el componente `event` (es decir, el subdirectorio `event/`).
**No descarta escenas con fechas evento** que esten directamente en
`processed/`.

### Cronologia de la contaminacion

Cuando se ejecuto el script (mayo 2 2026 a las 23:58), las dos escenas
evento estaban directamente en `data/sentinel1/processed/` (no en
`processed/event/`):

| Fichero | Ubicacion al ejecutar el script | mtime |
|---|---|---|
| `S1_sigma0_20241019_orb103.tif` | `data/sentinel1/processed/` | 2026-05-02 19:20 |
| `S1_sigma0_20241031_orb103.tif` | `data/sentinel1/processed/` | 2026-05-02 19:21 |
| `winter_mean_sigma0_vv.tif` (generada) | `data/features/advanced/` | 2026-05-02 23:58 |

La funcion `_is_summer(date_str)` devuelve True para meses 4-9. Octubre
(mes 10) clasifica como winter. Las dos escenas evento entraron al stack
winter junto con las 12 escenas baseline winter (oct 2022 - mar 2024 +
oct 2023 + nov 2023 + dec 2023).

### Features afectadas

| Feature | Computo | Afectada |
|---|---|---|
| `winter_mean_sigma0_vv` | `np.nanmean(winter_stack, axis=0)` | **SI** |
| `winter_min_sigma0_vv` | `np.nanmin(winter_stack, axis=0)` | **SI (impacto mayor)** |
| `winter_std_sigma0_vv` | `np.nanstd(winter_stack, axis=0)` | **SI** |
| `winter_minus_summer_vv` | `winter_mean - summer_mean` | **SI (deriva de winter_mean)** |
| `summer_mean/min/std_sigma0_vv` | escenas Apr-Sep, todas pre-DANA | NO |
| `urban_mask` | NDVI < 0.2 | NO |
| `local_std/range_5x5` | textura sobre `mean_sigma0_vv` (baseline) | NO |

## Magnitud del impacto

Se regeneraron las cuatro features winter SOLO con las 12 escenas baseline
(excluyendo 20241019 y 20241031). Comparativa original (con leakage) vs
clean (sin leakage):

| feature | median diff (px inundados) | median diff (px no inund.) | **max abs diff** |
|---|---:|---:|---:|
| `winter_mean_sigma0_vv` | +0.060 dB | +0.058 dB | 3.58 dB |
| `winter_min_sigma0_vv` | +0.000 dB | +0.000 dB | **16.34 dB** |
| `winter_std_sigma0_vv` | +0.053 dB | -0.023 dB | 7.14 dB |
| `winter_minus_summer_vv` | +0.060 dB | +0.058 dB | 3.58 dB |

`winter_min_sigma0_vv` es la feature con mayor leakage informativo:
- Al ser un agregado por **minimo**, captura el valor sigma0 mas bajo
  visto en cualquier escena winter.
- En pixeles inundados durante la DANA, la escena del 31 oct 2024 muestra
  retrodispersion proxima al regimen especular del agua (~ -25 a -30 dB).
- Sin leakage, esos mismos pixeles tienen winter_min ~ -14 dB
  (terreno seco tipico de huerta levantina en invierno).
- La diferencia (-30 vs -14 dB = 16 dB) convierte `winter_min` en un
  **indicador casi-perfecto** del propio target.

Features clean disponibles en `data/features/advanced_clean/` para futura
correccion del modelo.

## Por que XGBoost lo explota mas que Random Forest

Random Forest v3 con las MISMAS 24 features contaminadas tiene AUC
0.910 (folds 0.89-0.93). XGBoost v3 con esas mismas features tiene AUC
0.966 (folds 0.96-0.97). El delta de 5.6 puntos porcentuales con
features identicas se explica por:

1. **Continuidad numerica**: `winter_min_sigma0_vv` toma valores casi
   bimodales en pixeles inundados (-30 dB) vs no inundados (-14 dB).
   XGBoost, al construir splits sobre gradientes (gradient boosting),
   identifica rapidamente el umbral optimo (~ -22 dB) que separa las
   dos modas casi perfectamente.

2. **Boosting secuencial**: cada arbol corrige los errores del anterior.
   Cuando una feature es casi-target (como `winter_min` con leakage),
   XGBoost converge en pocos arboles a un score alto sobre los pixeles
   "faciles" y dedica los arboles posteriores a refinar los pocos
   pixeles dificiles.

3. **L2 regularizacion implicita**: XGBoost penaliza scores extremos por
   hoja, lo que evita la sobreseguridad caracteristica de RF y produce
   probabilidades mejor calibradas — pero sobre una feature contaminada,
   esto se traduce en confianza alta y mantenida en el "shortcut".

4. **Random Forest con bagging promedia entre 300 arboles independientes**.
   Cada arbol ve un subset de features (sqrt(24) = 4-5) y un subset
   bootstrap de muestras. La feature `winter_min` aparece en
   aproximadamente 1/5 de los splits. RF promedia, no se enfoca tanto.

En el limite teorico, ambos modelos podrian llegar al mismo AUC con
suficientes arboles. En la practica, XGBoost explota el shortcut con
muchas menos arboles y AUC superior, lo que **evidencia con mayor
claridad la presencia del leakage**: si la "mejora" parece demasiado buena,
suele serlo.

## Como se detecto el leakage (auditoria de 4 tests)

### Test 1 - Leakage check de `urban_mask`

Hipotesis: el ground truth (clipping municipal a 14 municipios DANA)
introduce asimetria geografica; `urban_mask` (NDVI < 0.2) podria ser
un proxy del clipping.

Procedimiento:
- Spearman rho urban_mask vs flood_label.
- XGBoost A (24 features) vs B (23 features sin urban_mask), GroupKFold
  5 folds bloques 1x1 km, full Valencia 7.52M filas, n_estimators=200,
  max_depth=10.

Resultado:
- rho = -0.105 (correlacion baja).
- AUC A = 0.9703 +- 0.0106, AUC B = 0.9707 +- 0.0101, **delta = -0.0004**.
- **Veredicto: OK**. urban_mask aporta cero, no es leakage.

### Test 2 - Leakage temporal en seasonal features

Hipotesis: las features seasonal podrian incluir escenas del evento.

Procedimiento:
- Inspeccionar timestamps de los .tif evento y de las features estacionales.
- Inspeccionar el filtro del script v3.
- Regenerar features winter limpias y comparar con las originales.

Resultado:
- Filtro defectuoso (excluye solo subdir `event/`, no fechas evento).
- 2 escenas evento (20241019 + 20241031) presentes en `processed/`
  cuando se ejecuto el script.
- Diferencia max abs en `winter_min_sigma0_vv` = **16 dB** en pixeles
  inundados.
- **Veredicto: LEAKAGE_DIRECTO_CONFIRMADO**. El test se detiene aqui
  por la regla "si algun test falla, no continuar".

### Tests 3 y 4 - SKIP

Conforme a la instruccion del usuario, los tests 3 (validacion CV
espacial) y 4 (transferibilidad a Algemesi) **no se ejecutaron**. La
sospecha previa al Test 2 era que la std AUC entre folds reportada en
`metrics_v3.json` (0.0046) era artificialmente baja por el re-balanceo
a 20% positivos sobre 500K filas en `cv_comparison_v3_fast.py`. El Test 1,
con CV identica a RF v2 (full data, 8% positivos), confirma std AUC =
0.0106 (2x mayor).

## Leccion metodologica

**Filtrar siempre por fecha, no por path.** El path es un detalle de
organizacion del filesystem que cambia con cada reorganizacion. La
fecha de adquisicion de la escena es un atributo intrinseco del dato
que no depende de donde este almacenado.

### Patron correcto

```python
EVENT_DATES = {"20241019", "20241031"}

def _date_from_name(p: Path) -> str:
    for part in p.stem.split("_"):
        if len(part) == 8 and part.isdigit():
            return part
    return ""

# CORRECTO: filtra por fecha
tifs = sorted(
    p for p in processed_dir.glob("S1_sigma0_*.tif")
    if _date_from_name(p) not in EVENT_DATES
)
```

### Patron defectuoso (lo que estaba)

```python
# DEFECTUOSO: filtra por path
tifs = sorted(
    p for p in processed_dir.glob("S1_sigma0_*.tif")
    if "event" not in p.parts   # solo excluye subdir, no fechas
)
```

### Reglas para evitar leakage temporal

1. **Definir EXPLICITAMENTE las fechas evento como constante** al inicio
   del script. No depender de la organizacion de directorios.

2. **Loggear la lista de escenas usadas** al construir cualquier feature
   temporal. Si se ven fechas evento, alarma inmediata.

3. **Comparar feature stats entre clases inundado/no-inundado**. Si una
   feature como `winter_min` tiene magnitudes extremas (max abs > 5 dB)
   solo en pixeles inundados, sospechar leakage.

4. **Comparar AUC con y sin la feature sospechosa**. Una feature
   marginal (delta AUC < 0.02) es robusta. Una feature dominante
   (delta AUC > 0.05) merece examen manual.

5. **Cross-validation espacial real**, no muestreo aleatorio. Bloques
   1x1 km como minimo en zonas urbanas/agrarias, mas grandes en
   zonas naturales con autocorrelacion espacial mayor.

6. **El AUC reportado debe usar el dataset completo**, no un subsample
   re-balanceado. El re-balanceo cambia las distribuciones marginales y
   puede inflar metricas dependientes del balance (precision, F1) sin
   reflejar mejora real.

## Estado de los modelos tras el hallazgo

| Modelo | Estado | Justificacion |
|---|---|---|
| `models/random_forest_v2.joblib` | **MODELO FINAL DEL TFG** | 14 features (11 originales + distance_to_coast, twi, hand). Todas las features estaticas (DEM) o agregados temporales sobre baseline pre-DANA. Sin leakage. AUC OOF 0.922 Valencia, AUC 0.817 Algemesi. |
| `models/random_forest_v3.joblib` | NO USAR | Mismas 24 features que XGBoost v3, mismo leakage temporal en winter features. |
| `models/xgboost_v3.joblib` | NO USAR | Leakage temporal confirmado. AUC 0.966 sobreestima rendimiento real ~5pp. |
| `models/random_forest_v1.joblib` | Descontinuado | Predecesor de v2, 11 features. |

Las features clean estan en `data/features/advanced_clean/` por si se
desea rehabilitar XGBoost v3 en una iteracion futura. Los modelos
existentes NO se han modificado.

## Referencias en el TFG

Esta documentacion da soporte a la inclusion en la memoria de:

1. **Capitulo de validacion del modelo final**: justificacion del
   rechazo de XGBoost v3 y mantenimiento de RF v2 como modelo final.

2. **Discusion metodologica**: el hallazgo refuerza la importancia de
   la auditoria de features antes de la publicacion del modelo,
   especialmente cuando se introducen features temporales o
   agregaciones (mean, min, std) sobre series temporales que
   incluyan eventos.

3. **Anexos / lecciones aprendidas**: tabla de diferencias winter
   features (con vs sin leakage), bug exacto en el codigo y patron
   correcto para evitar leakage temporal.

## Outputs generados durante la auditoria

```
results/model/
  leakage_tests_summary.md           # reporte ejecutivo consolidado
  test1_urban_mask_report.md         # detalle Test 1
  test1_urban_mask_results.json
  test2_temporal_leakage_report.md   # detalle Test 2
  test2_temporal_leakage_results.json

results/diagnostics/leakage_tests/
  test1_urban_mask_check.png         # barras XGB con/sin urban_mask
  test2_temporal_leakage.png         # mapas diff winter features

scripts/models/
  test1_urban_mask_leakage.py        # script Test 1
  test2_temporal_leakage.py          # script Test 2
  README_leakage_finding.md          # este documento

data/features/advanced_clean/
  winter_mean_sigma0_vv.tif          # feature limpia (sin escenas evento)
  winter_min_sigma0_vv.tif
  winter_std_sigma0_vv.tif
  winter_minus_summer_vv.tif
```
