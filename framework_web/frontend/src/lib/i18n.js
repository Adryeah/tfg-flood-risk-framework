/**
 * Lightweight DOM-level i18n. No framework, no virtual DOM diff — we walk
 * the rendered tree and substitute literal strings from an EN→ES dictionary
 * after each view mounts. Dynamic values (numbers, dates, IDs) bypass the
 * dictionary cleanly because they aren't keys.
 *
 * Usage:
 *   import { setLang, getLang, applyTranslations, onLangChange } from './i18n';
 *   setLang('es');           // persists in localStorage
 *   applyTranslations();     // walks #app and translates
 *
 * The router calls applyTranslations() after each view render so navigated-
 * to views inherit the current language.
 */

const STORAGE_KEY = 'frfw.lang';

// EN → ES. Keys must match the EXACT English text rendered in the DOM.
// Long strings (info-tooltip "what" / "source") are translated too so the
// switch covers what the user reads, not just the chrome.
const EN_ES = {
  // Sidebar — sections
  ANALYSIS: 'ANÁLISIS',
  PORTFOLIO: 'CARTERA',
  METHODOLOGY: 'METODOLOGÍA',
  // Sidebar — items
  Overview: 'Resumen',
  'Valencia Map': 'Mapa Valencia',
  'Algemesí Map': 'Mapa Algemesí',
  Comparison: 'Comparativa',
  'Portfolio Explorer': 'Explorador de Cartera',
  'Exposure Dashboard': 'Panel de Exposición',
  'Model & Validation': 'Modelo y Validación',
  Transferability: 'Transferibilidad',
  'Leakage Audit': 'Auditoría de Fugas',
  // Sidebar — status
  'Checking backend…': 'Comprobando backend…',
  'Backend online · model loaded': 'Backend en línea · modelo cargado',
  'Backend degraded': 'Backend degradado',
  'Backend offline': 'Backend desconectado',
  Docs: 'Documentación',
  // Topbar
  Framework: 'Framework',
  'Daily Briefing': 'Resumen Diario',
  Help: 'Ayuda',
  Settings: 'Ajustes',
  Activity: 'Actividad',
  'Search portfolios, municipalities, features…':
    'Buscar carteras, municipios, features…',
  // Daily Briefing — header
  'Real-time exposure summary for the Valencia metropolitan portfolio. Model output validated against Copernicus EMS activation EMSR773 (DANA, 29 Oct 2024).':
    'Resumen en tiempo real de la exposición de la cartera metropolitana de Valencia. Salida del modelo validada contra la activación de Copernicus EMS EMSR773 (DANA, 29 oct 2024).',
  LIVE: 'EN VIVO',
  Export: 'Exportar',
  // Operational status strip
  'Model AUC': 'AUC del Modelo',
  'Recall @ 100m': 'Recall @ 100 m',
  'Pixels analyzed': 'Píxeles analizados',
  Features: 'Features',
  'Portfolio TIV': 'TIV de Cartera',
  'Exposed TIV': 'TIV Expuesto',
  'TIV at risk': 'TIV en Riesgo',
  'EAL · annual': 'EAL · anual',
  'PML · DANA scenario': 'PML · escenario DANA',
  'PML estimate': 'Estimación PML',
  'High risk share': 'Cuota Riesgo Alto',
  // Scenario chip strip (Previsico / ICEYE pattern)
  'Pre-event': 'Pre-evento',
  Recovery: 'Recuperación',
  'DANA · 29 Oct 2024': 'DANA · 29 oct 2024',
  // Map side rail
  'Top at-risk assets': 'Activos en mayor riesgo',
  'No portfolio data.': 'Sin datos de cartera.',
  // Basemaps
  Oscuro: 'Oscuro',
  // KPI sub-info
  'Block-level on EMSR773': 'A nivel de bloque sobre EMSR773',
  '10m × 10m · 750 km²': '10 m × 10 m · 750 km²',
  'SAR · DEM · NDVI / NDWI': 'SAR · DEM · NDVI / NDWI',
  'Probable Maximum Loss · event basis':
    'Pérdida Máxima Probable · base por evento',
  // KPI value notes
  'active policies': 'pólizas activas',
  'above threshold 0.5': 'por encima del umbral 0.5',
  'policies · P > 0.7': 'pólizas · P > 0.7',
  // Chart card titles
  'Exposed TIV by municipality': 'TIV Expuesto por municipio',
  'Feature importance · Δ AUC': 'Importancia de features · Δ AUC',
  'SAR backscatter · Paiporta AOI': 'Retrodispersión SAR · AOI Paiporta',
  // Map section
  'Risk surface · study areas': 'Superficie de riesgo · zonas de estudio',
  'Risk · Valencia': 'Riesgo · Valencia',
  'Risk · Algemesí': 'Riesgo · Algemesí',
  'DANA municipalities': 'Municipios DANA',
  'Study zones': 'Zonas de estudio',
  'Low-prob tail · Valencia': 'Cola baja prob. · Valencia',
  'Low-prob tail · Algemesí': 'Cola baja prob. · Algemesí',
  Basemap: 'Mapa base',
  Overlays: 'Capas',
  // Legend
  'Flood probability': 'Probabilidad de inundación',
  '< 0.25 transparent': '< 0.25 transparente',
  // Info tooltips chrome
  What: 'Qué',
  Source: 'Fuente',
  // Valencia / Algemesí map views — nuevo header editorial
  //   (legacy "Valencia Risk Map" / "Algemesí Risk Map" se mantienen
  //   por si alguna ruta antigua los referencia, pero el nuevo h1
  //   se compone con "Risk map" + place name en italic)
  'Valencia Risk Map': 'Mapa de riesgo · Valencia',
  'Algemesí Risk Map': 'Mapa de riesgo · Algemesí',
  'Risk map': 'Mapa de riesgo',
  'Operations · Zone 01 · Training': 'Operaciones · Zona 01 · Entrenamiento',
  'Operations · Zone 02 · Extrapolation': 'Operaciones · Zona 02 · Extrapolación',
  "l'Horta Sud · 14 DANA-affected municipalities · Flood probability surface from Random Forest v2.":
    "l'Horta Sud · 14 municipios afectados por la DANA · Superficie de probabilidad de inundación del modelo Random Forest v2.",
  'Ribera Alta del Júcar · Algemesí + Alzira · Same model, transferred without retraining as a geographic generalisation test.':
    'Ribera Alta del Júcar · Algemesí + Alzira · Mismo modelo, transferido sin re-entrenamiento como test de generalización geográfica.',
  'Training zone': 'Zona de entrenamiento',
  'Extrapolation zone': 'Zona de extrapolación',
  Statistics: 'Estadísticas',
  Threshold: 'Umbral',
  'Pixel inspection': 'Inspección de píxel',
  Actions: 'Acciones',
  'AUC ROC': 'AUC ROC',
  'AUC PR': 'AUC PR',
  'F1 score': 'F1',
  Precision: 'Precisión',
  Recall: 'Recall',
  'Recall (100 m)': 'Recall (100 m)',
  Accuracy: 'Exactitud',
  'Brier score': 'Brier score',
  'GroupKFold 5 × 1 km · out-of-fold': 'GroupKFold 5 × 1 km · out-of-fold',
  'Extrapolation · full surface': 'Extrapolación · superficie completa',
  'Decision threshold': 'Umbral de decisión',
  'Click any point on the map to inspect.':
    'Haz click en cualquier punto del mapa para inspeccionar.',
  Coordinates: 'Coordenadas',
  Probability: 'Probabilidad',
  'Risk category': 'Categoría de riesgo',
  'Distance to cell': 'Distancia a la celda',
  'Feature values at this point': 'Valores de features en este punto',
  'Point outside coverage': 'Punto fuera de cobertura',
  'This location is not covered by the model.':
    'Esta localización no está cubierta por el modelo.',
  'Center on Paiporta': 'Centrar en Paiporta',
  'Center on Algemesí': 'Centrar en Algemesí',
  'Reset view': 'Restablecer vista',
  operational: 'operacional',
  recalibrated: 'recalibrado',
  custom: 'personalizado',
  low: 'bajo',
  medium: 'medio',
  high: 'alto',
  // Comparison view
  'Valencia vs Algemesí': 'Valencia vs Algemesí',
  'Same model': 'Mismo modelo',
  'Different zone': 'Distinta zona',
  'Methodology · Transferability test': 'Metodología · Test de transferibilidad',
  'Geographic generalisation test: the same Random Forest v2 trained in l\'Horta Sud, applied to Algemesí without retraining or recalibration.':
    'Test de generalización geográfica: el mismo Random Forest v2 entrenado en l\'Horta Sud, aplicado a Algemesí sin re-entrenamiento ni recalibración.',
  'Geographic transferability test — Random Forest v2 applied without retraining':
    'Test de transferibilidad geográfica — Random Forest v2 aplicado sin re-entrenamiento',
  'Metrics comparison': 'Comparativa de métricas',
  'Performance comparison': 'Comparativa de rendimiento',
  Metric: 'Métrica',
  'Positive prevalence': 'Prevalencia positiva',
  'Transferability insight': 'Conclusión de transferibilidad',
  // ── Asset markers / property popup (ICEYE / True Flood Risk) ─
  TIV: 'TIV',
  EAL: 'EAL',
  Probability: 'Probabilidad',
  'DANA loss': 'Pérdida DANA',
  'ground floor': 'planta baja',
  POLICY: 'PÓLIZA',
  Asset: 'Activo',
  moderate: 'moderado',
  'very high': 'muy alto',
  very_high: 'muy alto',
  Oscuro: 'Oscuro',
  // Common UI states
  'Loading…': 'Cargando…',
  'Loading metrics…': 'Cargando métricas…',
  'Inspecting pixel…': 'Inspeccionando píxel…',
  'Map unavailable': 'Mapa no disponible',
  'Failed to load briefing data': 'No se pudieron cargar los datos del resumen',
  'Failed to load map data': 'No se pudieron cargar los datos del mapa',
  'Failed to load comparison data': 'No se pudieron cargar los datos de la comparativa',
  'Try again': 'Reintentar',
  '← Back to Overview': '← Volver al resumen',
  'Coming in Session C': 'Próximamente en la Sesión C',
  'This view will be developed in the next session. The Analysis section (Overview, Valencia Map, Algemesí Map, Comparison) is fully wired up.':
    'Esta vista se desarrollará en la próxima sesión. La sección de Análisis (Resumen, Mapa Valencia, Mapa Algemesí, Comparativa) está completamente conectada.',

  // ── InfoTooltip chrome ──────────────────────────────────────
  What: 'Qué',
  Source: 'Fuente',
  'About this metric': 'Sobre esta métrica',

  // ── Overview KPI tooltips · model ───────────────────────────
  'Area under the ROC curve for the Random Forest v2 model on the Valencia OOF set, averaged across 5 spatial GroupKFold folds (1×1 km blocks).':
    'Área bajo la curva ROC del modelo Random Forest v2 sobre el conjunto OOF de Valencia, promediada sobre 5 folds espaciales GroupKFold (bloques de 1×1 km).',
  'GET /api/metrics/valencia → model_metrics.auc_mean / .auc_std':
    'GET /api/metrics/valencia → model_metrics.auc_mean / .auc_std',
  'Fraction of EMSR773 flooded pixels found within 100 m of any predicted high-risk pixel — neighbourhood-scale operational metric.':
    'Fracción de píxeles inundados de EMSR773 que aparecen a menos de 100 m de algún píxel predicho de alto riesgo — métrica operativa a escala de barrio.',
  'GET /api/metrics/valencia → buffer_metrics[buffer_m=100].recall':
    'GET /api/metrics/valencia → buffer_metrics[buffer_m=100].recall',
  'Total Sentinel-1 / Sentinel-2 grid cells scored by the model across the Valencia bbox at 10 m × 10 m resolution.':
    'Total de celdas Sentinel-1 / Sentinel-2 puntuadas por el modelo en el bbox de Valencia a 10 m × 10 m de resolución.',
  'GET /api/metrics/valencia → n_pixels': 'GET /api/metrics/valencia → n_pixels',
  '6 SAR temporal (σ⁰ VV mean/std/min/cv, VV/VH ratio, water count) + 4 DEM (elevation, slope, distance_to_stream, flow_accumulation) + 1 NDVI + 3 hydro-geomorphological (distance_to_coast, TWI, HAND).':
    '6 SAR temporales (σ⁰ VV media/desv/mín/cv, ratio VV/VH, cuenta de agua) + 4 DEM (elevación, pendiente, distancia al cauce, acumulación de flujo) + 1 NDVI + 3 hidro-geomorfológicas (distancia a la costa, TWI, HAND).',
  'config/params.yaml + scripts/features/build_dataset_v2.py':
    'config/params.yaml + scripts/features/build_dataset_v2.py',

  // ── Overview KPI tooltips · portfolio ───────────────────────
  "Total insured value across all policies in the active portfolio — sum of every contract's sum-insured at simulation start.":
    'Valor total asegurado en todas las pólizas de la cartera activa — suma del capital asegurado de cada contrato al inicio de la simulación.',
  'GET /api/portfolios/wide_distribution/exposure → total_insured_value':
    'GET /api/portfolios/wide_distribution/exposure → total_insured_value',
  'Sum of insured values for policies whose pixel-level flood probability exceeds the operational threshold.':
    'Suma del capital asegurado de las pólizas cuya probabilidad de inundación a nivel de píxel supera el umbral operativo.',
  'GET /api/portfolios/wide_distribution/exposure → value_at_risk':
    'GET /api/portfolios/wide_distribution/exposure → value_at_risk',
  'Expected Annual Loss — long-run yearly loss expectation under the current portfolio and modelled hazard frequency.':
    'Pérdida Anual Esperada (EAL) — expectativa de pérdida anual a largo plazo bajo la cartera actual y la frecuencia modelada del peligro.',
  'GET /api/portfolios/wide_distribution/exposure → expected_total_loss':
    'GET /api/portfolios/wide_distribution/exposure → expected_total_loss',
  'Probable Maximum Loss estimated by simulating the DANA event on the current portfolio (per-pixel probability × insured value × vulnerability function).':
    'Pérdida Máxima Probable (PML) estimada simulando el evento DANA sobre la cartera actual (probabilidad por píxel × capital asegurado × función de vulnerabilidad).',
  'GET /api/portfolios/wide_distribution/exposure → estimated_total_loss_dana':
    'GET /api/portfolios/wide_distribution/exposure → estimated_total_loss_dana',

  // ── Chart card tooltips ─────────────────────────────────────
  'Total insured value of policies whose pixel-level flood probability exceeds 0.5, aggregated by host municipality.':
    'Valor total asegurado de las pólizas cuya probabilidad de inundación a nivel de píxel supera 0.5, agregado por municipio.',
  'Computed client-side from /api/portfolios/wide_distribution clients filtered by risk_probability > 0.5 and bucketed by nearest municipality from /api/geo/municipalities.geojson.':
    'Calculado en cliente a partir de /api/portfolios/wide_distribution filtrando por risk_probability > 0.5 y agrupando por municipio más cercano desde /api/geo/municipalities.geojson.',
  'Permutation importance of each model feature — the drop in AUC when its column is randomly shuffled on the Valencia OOF set.':
    'Importancia por permutación de cada feature del modelo — la caída de AUC cuando su columna se baraja aleatoriamente en el conjunto OOF de Valencia.',
  'Permutation importance of each model feature, measured as the drop in AUC when its column is randomly shuffled on the Valencia OOF set.':
    'Importancia por permutación de cada feature del modelo, medida como la caída de AUC al barajar su columna aleatoriamente sobre el conjunto OOF de Valencia.',
  'GET /api/metrics/transferability → feature_drift[].importance_valencia':
    'GET /api/metrics/transferability → feature_drift[].importance_valencia',
  'Mean σ⁰ VV time series for a 500 m AOI centred on Paiporta. Pre-DANA reference is the 60-day median; the dip on 29 Oct 2024 marks the flood peak.':
    'Serie temporal de σ⁰ VV medio para un AOI de 500 m centrado en Paiporta. La referencia pre-DANA es la mediana de 60 días; la caída del 29 oct 2024 marca el pico de la inundación.',
  'Mean σ⁰ VV time series for a 500 m AOI centred on Paiporta. The pre-DANA reference is the 60-day median; the dip on 29 Oct 2024 marks the flood peak.':
    'Serie temporal de σ⁰ VV medio para un AOI de 500 m centrado en Paiporta. La referencia pre-DANA es la mediana de 60 días; la caída del 29 oct 2024 marca el pico de la inundación.',
  'Illustrative curve — historical S1 GRD time-series ingestion pending. Reference Δ from data/sentinel1/processed/.':
    'Curva ilustrativa — la ingesta histórica de series S1 GRD está pendiente. Δ de referencia tomado de data/sentinel1/processed/.',
  'Illustrative curve — historical S1 GRD time-series ingestion is pending. Reference value −12.4 dB is the measured Δ from data/sentinel1/processed/.':
    'Curva ilustrativa — la ingesta histórica de series S1 GRD está pendiente. El valor de referencia −12.4 dB es el Δ medido en data/sentinel1/processed/.',

  // ── Map header tooltip + overlays panel ─────────────────────
  'Pre-baked flood probability surface for Valencia and Algemesí, overlaid on DANA-affected municipality outlines. Dashed rectangles delimit the training (Valencia) and extrapolation (Algemesí) bboxes.':
    'Superficie de probabilidad de inundación pre-calculada para Valencia y Algemesí, sobre los contornos de los municipios afectados por la DANA. Los rectángulos discontinuos delimitan los bbox de entrenamiento (Valencia) y de extrapolación (Algemesí).',
  'Pre-baked flood probability surface for Valencia and Algemesí, overlaid on DANA-affected municipality outlines. Dashed rectangles delimit the training (Valencia) and extrapolation (Algemesí) bboxes from config/params.yaml.':
    'Superficie de probabilidad de inundación pre-calculada para Valencia y Algemesí, sobre los contornos de los municipios afectados por la DANA. Los rectángulos discontinuos delimitan los bbox de entrenamiento y extrapolación definidos en config/params.yaml.',
  'GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson':
    'GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson',
  'Toggle layers on/off. The low-probability tail (p<0.25) is heavy and only fetched the first time you enable it. Click anywhere on the map to inspect that pixel\'s prediction.':
    'Activa/desactiva capas. La cola de baja probabilidad (p<0.25) es pesada y solo se descarga la primera vez que la activas. Haz click en cualquier punto del mapa para inspeccionar la predicción de ese píxel.',
  'GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson · GET /api/risk/predict?lat=&lon=':
    'GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson · GET /api/risk/predict?lat=&lon=',

  // ── Map controls + zone toggle labels ───────────────────────
  Overlays: 'Capas',
  Basemap: 'Mapa base',
  'Risk · Valencia': 'Riesgo · Valencia',
  'Risk · Algemesí': 'Riesgo · Algemesí',
  'DANA municipalities': 'Municipios DANA',
  'Study zones': 'Zonas de estudio',
  'Tail · Valencia (p<0.25)': 'Cola · Valencia (p<0.25)',
  'Tail · Algemesí (p<0.25)': 'Cola · Algemesí (p<0.25)',

  // ── Risk surface card chrome ────────────────────────────────
  'Risk surface · study areas': 'Superficie de riesgo · zonas de estudio',
  'Risk surface · Valencia training zone': 'Superficie de riesgo · zona de entrenamiento Valencia',
  'Risk surface · Algemesí extrapolation zone':
    'Superficie de riesgo · zona de extrapolación Algemesí',

  // ── Sidebar nav (new entries + relabel) ─────────────────────
  'Policy Map': 'Mapa de Pólizas',

  // ── Portfolio Explorer ──────────────────────────────────────
  'Portfolio Explorer': 'Explorador de Cartera',
  'Underwriting demo': 'Demo de suscripción',
  'Simulated client portfolio overlaid on flood risk surface · Synthetic data with realistic distributions':
    'Cartera de clientes simulada sobre la superficie de riesgo de inundación · Datos sintéticos con distribuciones realistas',
  'Export CSV': 'Exportar CSV',
  Portfolio: 'Cartera',
  'Predefined portfolios': 'Carteras predefinidas',
  'Create custom': 'Crear personalizada',
  'Define parameters': 'Definir parámetros',
  Filters: 'Filtros',
  Showing: 'Mostrando',
  Product: 'Producto',
  Particulares: 'Particulares',
  Pymes: 'Pymes',
  Autos: 'Autos',
  'Risk category': 'Categoría de riesgo',
  Low: 'Bajo',
  'Medium (moderate)': 'Medio (moderado)',
  'High + very high': 'Alto + muy alto',
  'Insured value': 'Valor asegurado',
  'Reset filters': 'Restablecer filtros',
  'Portfolio TIV': 'TIV de cartera',
  'High-risk exposure': 'Exposición de alto riesgo',
  'Value at risk': 'Valor en riesgo',
  'PML · DANA scenario': 'PML · escenario DANA',
  'Risk distribution': 'Distribución de riesgo',
  Moderate: 'Moderado',
  High: 'Alto',
  'Very high': 'Muy alto',
  Clients: 'Clientes',
  'Sortable · paginated · CSV-exportable':
    'Ordenable · paginado · exportable a CSV',
  'Policy ID': 'ID póliza',
  Type: 'Tipo',
  Subtype: 'Subtipo',
  'P(flood)': 'P(inundación)',
  Risk: 'Riesgo',
  'Est. loss DANA': 'Pérdida est. DANA',
  'Est. loss Flood': 'Pérdida est. inundación',
  'Est. loss · flood': 'Pérdida est. · inundación',
  Premium: 'Prima',
  'Est. loss flood': 'Pérdida est. inundación',

  // ── Exposure Dashboard ──────────────────────────────────────
  'Exposure Dashboard': 'Panel de Exposición',
  'Aggregate risk metrics and loss projections for the selected portfolio':
    'Métricas de riesgo agregadas y proyecciones de pérdidas para la cartera seleccionada',
  'Select portfolio': 'Seleccionar cartera',
  'Total exposure': 'Exposición total',
  'Total insured value': 'Valor total asegurado',
  'Value at risk · weighted': 'Valor en riesgo · ponderado',
  'EAL · annual': 'EAL · anual',
  'Avg P(flood)': 'P(inundación) media',
  'Exposure by product': 'Exposición por producto',
  '€ insured value': '€ valor asegurado',
  'Geographic concentration': 'Concentración geográfica',
  clustered: 'agrupado',
  'Loss breakdown': 'Desglose de pérdidas',
  'DANA scenario': 'Escenario DANA',
  'Top 10 highest risk': 'Top 10 mayor riesgo',
  'sorted by est. loss': 'ordenado por pérdida est.',
  'DANA loss': 'Pérdida DANA',
  'Policy': 'Póliza',
  'Est. loss': 'Pérdida est.',
  '1-event basis': 'base 1 evento',

  // ── Policy Map ──────────────────────────────────────────────
  'Single-policy inspector': 'Inspector de póliza individual',
  'Browse every policy on the map, see its impact relative to the rest of the portfolio. Click any point or use Prev / Next to navigate.':
    'Navega cada póliza en el mapa y consulta su impacto frente al resto de la cartera. Haz click en cualquier punto o usa Anterior / Siguiente.',
  All: 'Todas',
  'Riesgo · mayor primero': 'Riesgo · mayor primero',
  'Pérdida · mayor primero': 'Pérdida · mayor primero',
  'Valor · mayor primero': 'Valor · mayor primero',
  'Position in portfolio': 'Posición en la cartera',
  'Risk rank': 'Ranking de riesgo',
  'Percentile (worse than)': 'Percentil (peor que)',
  'Contribution to PML': 'Contribución al PML',
  'Share of TIV': 'Cuota del TIV',
  'Nearest high-risk policy': 'Póliza alto riesgo más cercana',
  'P(flood) distribution': 'Distribución de P(inundación)',
  'Annual premium': 'Prima anual',
  'Loading portfolio…': 'Cargando cartera…',
  'No policies match the filters.': 'Ninguna póliza coincide con los filtros.',

  // ── Risk categories (per-cell text in tables / badges) ──────
  low: 'bajo',
  moderate: 'moderado',
  high: 'alto',
  'very high': 'muy alto',

  // ── Subtypes (popup + table cells) ──────────────────────────
  piso_alto: 'piso alto',
  piso_bajo: 'piso bajo',
  'piso alto': 'piso alto',
  'piso bajo': 'piso bajo',
  casa: 'casa',
  chalet: 'chalet',
  comercio: 'comercio',
  oficina: 'oficina',
  nave: 'nave',
  coche: 'coche',
  moto: 'moto',
  furgoneta: 'furgoneta',

  // ════════════════════════════════════════════════════════════
  // METHODOLOGY SECTION — Model & Validation, Transferability,
  // Leakage Audit. Long-form paragraphs are rendered as a single
  // text node in the views (refactored to template strings) so
  // the walker matches them as one key. Citations (Brier 1950,
  // sklearn.metrics.*) are intentionally NOT translated — they
  // are proper-noun bibliographic references.
  // ════════════════════════════════════════════════════════════

  // ── Model & Validation — chrome ──────────────────────────────
  '14 features': '14 features',
  'Cross-validated performance metrics with spatial GroupKFold methodology':
    'Métricas de rendimiento validadas cruzadamente con metodología GroupKFold espacial',
  'F1 Score': 'F1',
  '5-fold spatial CV': 'CV espacial de 5 folds',
  threshold: 'umbral',
  'at 100 m buffer': 'a 100 m de buffer',
  'lower is better': 'menor es mejor',
  'ROC Curves (5 folds)': 'Curvas ROC (5 folds)',
  'Spatial cross-validation with 1 × 1 km blocks':
    'Validación cruzada espacial con bloques de 1 × 1 km',
  'Confusion Matrix': 'Matriz de confusión',
  'Valencia OOF · threshold 0.614': 'Valencia OOF · umbral 0.614',
  'Feature Importance': 'Importancia de features',
  'Permutation importance · top features by ΔAUC contribution':
    'Importancia por permutación · features principales por contribución ΔAUC',
  'Buffer Metrics': 'Métricas con buffer',
  'Performance at increasing spatial tolerance · operational scale':
    'Rendimiento al aumentar la tolerancia espacial · escala operativa',
  'Why spatial cross-validation?': '¿Por qué validación cruzada espacial?',
  'Pixels in flood risk mapping are spatially autocorrelated. Random k-fold splits inflate metrics artificially because validation pixels share local context with training pixels. We use GroupKFold with 1 × 1 km blocks: each block goes entirely to train or test, ensuring no spatial leakage. This produces honest metrics suitable for assessing real-world generalisation.':
    'Los píxeles en el mapeo de riesgo de inundación están espacialmente autocorrelacionados. Las divisiones k-fold aleatorias inflan las métricas artificialmente porque los píxeles de validación comparten contexto local con los de entrenamiento. Usamos GroupKFold con bloques de 1 × 1 km: cada bloque va entero a entrenamiento o a test, garantizando que no haya fuga espacial. Esto produce métricas honestas adecuadas para evaluar la generalización en el mundo real.',
  Folds: 'Folds',
  'Block size': 'Tamaño de bloque',
  'Total pixels': 'Píxeles totales',
  // Confusion matrix axis labels (split by <br/>)
  'Pred. Negative': 'Pred. negativo',
  'Pred. Positive': 'Pred. positivo',
  Actual: 'Real',
  Negative: 'negativo',
  Positive: 'positivo',
  'Total samples': 'Muestras totales',
  'Brier Score': 'Brier score',

  // ── Model & Validation — InfoHint contents (one key per hint) ──
  'Area under the Receiver Operating Characteristic curve. Measures how well the model ranks a random positive (flooded pixel) above a random negative. 1.0 = perfect ranking, 0.5 = random chance. The "± value" is the standard deviation across the 5 spatial folds.':
    'Área bajo la curva ROC (Receiver Operating Characteristic). Mide cómo de bien el modelo ordena un positivo aleatorio (píxel inundado) por encima de un negativo aleatorio. 1.0 = ordenación perfecta, 0.5 = azar. El "± valor" es la desviación típica entre los 5 folds espaciales.',
  'Harmonic mean of precision and recall at the operational decision threshold (0.614). Picked by maximising F1 on the validation folds — balances false alarms vs missed floods.':
    'Media armónica de precisión y recall en el umbral de decisión operativo (0.614). Elegido maximizando F1 en los folds de validación — equilibra falsas alarmas frente a inundaciones perdidas.',
  'Fraction of actual flooded pixels the model correctly flags (TP / (TP + FN)). Critical for risk products — a missed flood is worse than a false alarm. The "100 m buffer" value is recall when a prediction within 100 m of a true positive counts as a hit, following the Tellman et al. (2021) operational convention.':
    'Fracción de píxeles realmente inundados que el modelo marca correctamente (TP / (TP + FN)). Crítico en productos de riesgo — una inundación no detectada es peor que una falsa alarma. El valor "buffer 100 m" es el recall cuando una predicción a menos de 100 m de un verdadero positivo cuenta como acierto, siguiendo la convención operativa de Tellman et al. (2021).',
  'Mean squared error of the predicted probabilities vs the true binary outcome. Measures calibration — a model that says "0.8" for a pixel should be right 80 % of the time. Range [0, 1]; lower is better. Random Forest baseline is typically around 0.1.':
    'Error cuadrático medio entre las probabilidades predichas y el resultado binario real. Mide la calibración — un modelo que dice "0.8" para un píxel debería acertar el 80 % de las veces. Rango [0, 1]; menor es mejor. La línea base de Random Forest suele rondar 0.1.',
  "Each curve plots True Positive Rate vs False Positive Rate as the decision threshold sweeps from 0 to 1. The area under each curve is the fold's AUC. The dashed diagonal is random guessing (AUC 0.5). Curves shown are reconstructed from per-fold AUC mean ± std — when per-fold ROC points are exported they will replace this approximation.":
    'Cada curva representa True Positive Rate vs False Positive Rate mientras el umbral de decisión barre de 0 a 1. El área bajo cada curva es el AUC del fold. La diagonal discontinua es azar (AUC 0.5). Las curvas mostradas se reconstruyen a partir del AUC medio ± desv. típica por fold — cuando se exporten los puntos ROC por fold sustituirán esta aproximación.',
  '2 × 2 contingency table of predictions at the operational threshold (0.614). TP = correctly flagged flood; FN = missed flood (worst case); FP = false alarm; TN = correctly clear pixel. Out-of-fold predictions only — no train-set leakage.':
    'Tabla de contingencia 2 × 2 de predicciones en el umbral operativo (0.614). TP = inundación marcada correctamente; FN = inundación no detectada (peor caso); FP = falsa alarma; TN = píxel seco correctamente clasificado. Solo predicciones out-of-fold — sin fuga del conjunto de entrenamiento.',
  'Permutation importance: for each feature, randomly shuffle its column on the validation set and measure how much the AUC drops. A large drop means the model relied heavily on that feature; a drop near zero means the feature is redundant or noisy. Top 5 are highlighted in deep blue. The exact unit is ΔAUC averaged over the 5 spatial folds.':
    'Importancia por permutación: para cada feature, baraja aleatoriamente su columna en el conjunto de validación y mide cuánto cae el AUC. Una caída grande significa que el modelo dependía mucho de esa feature; cerca de cero indica feature redundante o ruidosa. Las 5 principales aparecen en azul oscuro. La unidad exacta es ΔAUC promediado sobre los 5 folds espaciales.',
  'A prediction within X metres of a true positive counts as a hit when the buffer = X m. The 0 m bar is strict pixel-perfect matching; 100 m is the standard "operational tolerance" in flood remote sensing (the buffer accounts for SAR pixel size, geocoding error, and the fact that a building 50 m from a flood is operationally affected). Recall climbs with buffer size; precision falls.':
    'Una predicción a menos de X metros de un verdadero positivo cuenta como acierto cuando el buffer = X m. La barra de 0 m es coincidencia píxel a píxel estricta; 100 m es la "tolerancia operativa" estándar en teledetección de inundaciones (el buffer absorbe el tamaño de píxel SAR, errores de geocodificación y el hecho de que un edificio a 50 m de la inundación está operativamente afectado). El recall sube con el buffer; la precisión baja.',

  // ── ECharts axis names + legend ──
  'False Positive Rate': 'Tasa de falsos positivos',
  'True Positive Rate': 'Tasa de verdaderos positivos',
  'Random (AUC 0.5)': 'Azar (AUC 0.5)',
  'ΔAUC contribution': 'Contribución ΔAUC',

  // ── ECharts feature tooltip chrome (HTML formatter inner text
  // nodes that the DOM walker hits after the strong tags) ──
  '· unit': '· unidad',
  unit: 'unidad',

  // ── InfoHint chrome ──
  'More info': 'Más información',

  // ── Methodology Sources footer ──
  'Sources & methodology references':
    'Fuentes y referencias metodológicas',
  'Brier score — mean squared error of probabilistic forecasts.':
    'Brier score — error cuadrático medio de pronósticos probabilísticos.',
  'Model architecture (RandomForestClassifier) and permutation importance.':
    'Arquitectura del modelo (RandomForestClassifier) e importancia por permutación.',
  'Spatial GroupKFold (1×1 km blocks) instead of random k-fold.':
    'GroupKFold espacial (bloques de 1×1 km) en lugar de k-fold aleatorio.',
  'AUC ROC / F1 / Precision / Recall / Confusion Matrix implementations.':
    'Implementaciones de AUC ROC / F1 / Precisión / Recall / Matriz de confusión.',
  'Buffer-metric convention for evaluating flood maps at operational tolerance (0/30/50/100 m).':
    'Convención de métricas con buffer para evaluar mapas de inundación a tolerancia operativa (0/30/50/100 m).',
  'Expected Calibration Error (ECE) reported in model_metrics.':
    'Expected Calibration Error (ECE) reportado en model_metrics.',

  // ── Feature Glossary (chrome + headers) ──
  'Feature glossary · 14 model inputs':
    'Glosario de features · 14 entradas del modelo',
  Feature: 'Feature',
  Description: 'Descripción',
  Unit: 'Unidad',
  'Hover any bar in the chart above for the full definition, source pipeline, and academic citation per feature.':
    'Pasa el ratón por cualquier barra del gráfico para ver la definición completa, el paso del pipeline y la cita académica de cada feature.',
  // Category chip labels
  'SAR temporal': 'SAR temporal',
  Optical: 'Óptico',
  DEM: 'DEM',
  Hydrology: 'Hidrología',
  Distance: 'Distancia',

  // ── 14 features — short descriptions (glossary "Description" column) ──
  'Mean VV backscatter over the baseline period':
    'Retrodispersión VV media en el periodo de referencia',
  'Temporal standard deviation of VV backscatter':
    'Desviación típica temporal de la retrodispersión VV',
  'Minimum VV backscatter observed in baseline':
    'Retrodispersión VV mínima observada en el baseline',
  'Coefficient of variation (std / mean) of VV':
    'Coeficiente de variación (desv/media) de VV',
  'Mean of σ⁰_VV / σ⁰_VH ratio':
    'Ratio medio σ⁰_VV / σ⁰_VH',
  'Number of baseline dates the pixel was Otsu-classified as water':
    'Número de fechas del baseline en que el píxel se clasificó como agua por Otsu',
  'Pixel elevation above sea level':
    'Elevación del píxel sobre el nivel del mar',
  'Terrain slope (gradient magnitude of DEM)':
    'Pendiente del terreno (magnitud del gradiente del DEM)',
  'Euclidean distance to nearest river / drainage line':
    'Distancia euclidiana al cauce / línea de drenaje más cercano',
  'Number of upstream cells draining into the pixel':
    'Número de celdas aguas arriba que drenan al píxel',
  'Mean NDVI from Sentinel-2 over the baseline':
    'NDVI medio de Sentinel-2 en el baseline',
  'Euclidean distance to the Mediterranean coastline':
    'Distancia euclidiana a la costa mediterránea',
  'Topographic Wetness Index = ln(α / tan β)':
    'Índice topográfico de humedad = ln(α / tan β)',
  'Height Above Nearest Drainage':
    'Altura sobre el drenaje más cercano (HAND)',

  // ── 14 features — full descriptions (ECharts tooltip body) ──
  'Average Sentinel-1 σ⁰ VV across the pre-DANA baseline (≈ 50 dates). Captures the pixel\'s "default" radar response — permanent water has very low dB, urban/built environments very high.':
    'σ⁰ VV medio de Sentinel-1 sobre el baseline pre-DANA (≈ 50 fechas). Captura la respuesta radar "por defecto" del píxel — el agua permanente tiene dB muy bajos, los entornos urbanos/construidos muy altos.',
  "How much the pixel's backscatter fluctuates across the baseline. High std = pixel that oscillates (irrigated cropland, river fringe); low std = stable urban or bare rock.":
    'Cuánto fluctúa la retrodispersión del píxel a lo largo del baseline. Desviación alta = píxel que oscila (cultivo regado, ribera fluvial); baja = urbano estable o roca desnuda.',
  'The wettest moment a pixel reached historically (water is a specular reflector → very negative dB). Strong proxy for "has been flooded at least once".':
    'El momento más húmedo que alcanzó históricamente un píxel (el agua es un reflector especular → dB muy negativo). Buen proxy de "ha estado inundado al menos una vez".',
  'Scale-free variability. Useful because mean σ⁰ varies a lot across land cover; the ratio normalises it and isolates the "wobble".':
    'Variabilidad sin escala. Útil porque el σ⁰ medio varía mucho según la cobertura del suelo; el ratio lo normaliza y aísla la "oscilación".',
  'Distinguishes open water (high VV/VH, specular surface) from vegetation (low ratio, volume scattering). Standard polarisation feature in SAR water mapping.':
    'Distingue agua abierta (VV/VH alto, superficie especular) de vegetación (ratio bajo, scattering volumétrico). Feature de polarización estándar en mapeo SAR de agua.',
  'Direct flood-frequency proxy: for each date, apply Otsu threshold to σ⁰ VV; count dates the pixel falls below. A pixel with water_count = 12 has been wet on 12 of the 50 baseline dates.':
    'Proxy directo de frecuencia de inundación: para cada fecha, aplica umbral de Otsu a σ⁰ VV y cuenta las fechas en que el píxel cae por debajo. Un píxel con water_count = 12 ha estado mojado en 12 de las 50 fechas del baseline.',
  'SRTM 30 m DEM. Strongest single predictor in coastal floodplains — pixels below 5–10 m a.s.l. dominate the DANA-affected zones.':
    'DEM SRTM de 30 m. Predictor individual más fuerte en llanuras costeras de inundación — los píxeles bajo 5–10 m s.n.m. dominan las zonas afectadas por la DANA.',
  'Steep slopes drain quickly; flat ground accumulates. Computed as the magnitude of the local DEM gradient in degrees.':
    'Las pendientes pronunciadas drenan rápido; el terreno llano acumula. Calculado como la magnitud del gradiente local del DEM en grados.',
  'Drainage network extracted via flow-accumulation thresholding; Euclidean distance from each pixel to the nearest stream cell. Low value = high fluvial flooding risk.':
    'Red de drenaje extraída por umbralización de acumulación de flujo; distancia euclidiana de cada píxel a la celda de cauce más cercana. Valor bajo = alto riesgo de inundación fluvial.',
  'Standard D8 flow-accumulation grid. High value = pixel sits downstream of a large basin and concentrates runoff.':
    'Rejilla estándar de acumulación de flujo D8. Valor alto = el píxel está aguas abajo de una cuenca grande y concentra escorrentía.',
  'Normalised Difference Vegetation Index = (NIR − RED) / (NIR + RED). Healthy vegetation ≈ +0.6, bare soil ≈ +0.1, water ≈ negative. Distinguishes huerta from urban from water.':
    'Índice de Vegetación de Diferencia Normalizada = (NIR − RED) / (NIR + RED). Vegetación sana ≈ +0.6, suelo desnudo ≈ +0.1, agua ≈ negativo. Distingue huerta, urbano y agua.',
  'Most important feature in Valencia (coastal storm-surge / lagoon flooding). Drift sign-flips in Algemesí because that basin is fluvial (Júcar river) — see Transferability view.':
    'Feature más importante en Valencia (storm-surge costero / inundación de albufera). El signo del drift se invierte en Algemesí porque esa cuenca es fluvial (río Júcar) — ver vista Transferibilidad.',
  'Classic Beven & Kirkby (1979) wetness index. α = upslope contributing area per unit contour length; β = local slope. High TWI = saturated valley bottoms.':
    'Índice de humedad clásico de Beven & Kirkby (1979). α = área contribuyente aguas arriba por unidad de longitud de contorno; β = pendiente local. TWI alto = fondos de valle saturados.',
  'Vertical distance from the pixel down to the nearest stream pixel along the flow path. Captures local relative relief better than absolute elevation. Nobre et al. (2011) flood-mapping standard.':
    'Distancia vertical desde el píxel al píxel de cauce más cercano siguiendo la trayectoria de flujo. Captura mejor el relieve relativo local que la elevación absoluta. Estándar de Nobre et al. (2011) en mapeo de inundación.',

  // ── Transferability ─────────────────────────────────────────
  'Transferability Analysis': 'Análisis de transferibilidad',
  Methodology: 'Metodología',
  'How the Valencia-trained model performs when applied to Algemesí without retraining':
    'Cómo se comporta el modelo entrenado en Valencia al aplicarse a Algemesí sin reentrenamiento',
  'Critical feature drift detected': 'Drift crítico de feature detectado',
  'The feature distance_to_coast is the most important predictor in Valencia (+0.162 ΔAUC) but flips sign and becomes negatively important in Algemesí (−0.021). Algemesí is a fluvial basin (Júcar river) rather than a coastal system. For production, the model would require regionalisation by hydrographic basin type.':
    'La feature distance_to_coast es el predictor más importante en Valencia (+0.162 ΔAUC) pero invierte el signo y pasa a ser negativamente importante en Algemesí (−0.021). Algemesí es una cuenca fluvial (río Júcar), no un sistema costero. Para producción, el modelo necesitaría regionalización por tipo de cuenca hidrográfica.',
  'AUC Valencia': 'AUC Valencia',
  'AUC Algemesí': 'AUC Algemesí',
  'AUC drop': 'Caída de AUC',
  'Feature Drift Valencia → Algemesí':
    'Drift de features Valencia → Algemesí',
  'Normalised z-score difference per feature. Positive = larger values in Algemesí.':
    'Diferencia z-score normalizada por feature. Positivo = valores mayores en Algemesí.',
  'Permutation Importance Comparison':
    'Comparativa de importancia por permutación',
  'ΔAUC contribution per feature in each zone. The dramatic shift in distance_to_coast is the smoking gun.':
    'Contribución ΔAUC por feature en cada zona. El cambio drástico en distance_to_coast es la prueba decisiva.',
  'Methodological conclusion': 'Conclusión metodológica',
  'The transferability experiment demonstrates that model generalisation has identifiable and quantifiable limits. AUC 0.817 confirms the model retains ranking capability, but precision collapse (35% → 0.9%) shows binary classification fails. The root cause is identifiable: feature drift on geographically-defined features (distance_to_coast). For production deployment, the model would require regionalisation by hydrographic basin type — coastal, fluvial, mountainous. This finding, although it may read as model failure, is exactly the type of rigorous validation a thesis should include.':
    'El experimento de transferibilidad demuestra que la generalización del modelo tiene límites identificables y cuantificables. AUC 0.817 confirma que el modelo conserva capacidad de ordenación, pero el colapso de precisión (35% → 0.9%) muestra que la clasificación binaria falla. La causa raíz es identificable: drift en features geográficamente definidas (distance_to_coast). Para despliegue en producción, el modelo necesitaría regionalización por tipo de cuenca hidrográfica — costera, fluvial, montañosa. Este hallazgo, aunque pueda parecer un fallo del modelo, es exactamente el tipo de validación rigurosa que un TFG debe incluir.',
  'Δ (Algemesí − Valencia) / σ_Valencia':
    'Δ (Algemesí − Valencia) / σ_Valencia',
  'Valencia (trained)': 'Valencia (entrenado)',
  'Algemesí (transferred)': 'Algemesí (transferido)',

  // ── Leakage Audit ───────────────────────────────────────────
  'Leakage Audit': 'Auditoría de fugas',
  'Case study': 'Caso de estudio',
  'Temporal leakage detection in XGBoost v3 exploratory iteration · Methodological contribution':
    'Detección de fuga temporal en la iteración exploratoria XGBoost v3 · Contribución metodológica',
  'Too good to be true?': '¿Demasiado bueno para ser cierto?',
  "An exploratory XGBoost iteration reported AUC 0.966 vs Random Forest v2's 0.922. Before accepting it as the final model, we ran a formal 4-test audit. Test 2 failed and the model was discarded. This audit is documented as a methodological case study.":
    'Una iteración exploratoria con XGBoost reportó AUC 0.966 frente al 0.922 de Random Forest v2. Antes de aceptarlo como modelo final, ejecutamos una auditoría formal de 4 tests. El Test 2 falló y se descartó el modelo. Esta auditoría queda documentada como caso de estudio metodológico.',
  'Suspected (XGBoost v3)': 'Sospechoso (XGBoost v3)',
  'Verified (Random Forest v2)': 'Verificado (Random Forest v2)',
  discarded: 'descartado',
  'final model': 'modelo final',
  'contaminated by event scenes': 'contaminado por escenas del evento',
  'no leakage by construction': 'sin fuga por construcción',
  'Audit Timeline': 'Cronología de la auditoría',
  'Four-phase systematic methodology with stop-on-fail rule':
    'Metodología sistemática en 4 fases con regla de parada al fallar',
  'Phase 1': 'Fase 1',
  'Phase 2': 'Fase 2',
  'Phase 3': 'Fase 3',
  'Phase 4': 'Fase 4',
  'The suspicious result': 'El resultado sospechoso',
  'Audit design — 4 tests, stop-on-fail':
    'Diseño de la auditoría — 4 tests, parada al fallar',
  'Test 1 PASS · Test 2 FAIL': 'Test 1 PASS · Test 2 FAIL',
  'Decision — XGBoost v3 rejected':
    'Decisión — XGBoost v3 rechazado',
  'XGBoost v3 with 24 features reported AUC 0.966 ± 0.011, a jump of +0.044 over Random Forest v2. In a remote sensing problem with correctly validated spatial cross-validation, such improvements are rare unless explained by (a) fundamentally different architecture, (b) qualitatively new features, or (c) leakage.':
    'XGBoost v3 con 24 features reportó AUC 0.966 ± 0.011, un salto de +0.044 sobre Random Forest v2. En un problema de teledetección con validación cruzada espacial correctamente aplicada, mejoras así son raras a menos que se expliquen por (a) arquitectura fundamentalmente distinta, (b) features cualitativamente nuevas, o (c) fuga (leakage).',
  'Four sequential tests with a stopping rule: if any test fails, halt and reject the model. Test 1: urban_mask as leakage proxy. Test 2: temporal leakage in seasonal features. Test 3: validation of spatial CV identical to RF v2. Test 4: transferability to Algemesí.':
    'Cuatro tests secuenciales con regla de parada: si cualquiera falla, detener y rechazar el modelo. Test 1: urban_mask como proxy de fuga. Test 2: fuga temporal en features estacionales. Test 3: validación del CV espacial idéntica a RF v2. Test 4: transferibilidad a Algemesí.',
  'Test 1: AUC with vs without urban_mask identical (ΔAUC = -0.0004). Not leakage. Test 2: bug located in scripts/features/extract_advanced_features_v3.py:162. The path-based filter "if "event" not in p.parts" failed to exclude October 2024 event scenes from winter feature aggregation. winter_min_sigma0_vv max abs diff vs the clean version: 16.34 dB.':
    'Test 1: AUC con vs sin urban_mask idéntico (ΔAUC = -0.0004). No es fuga. Test 2: bug localizado en scripts/features/extract_advanced_features_v3.py:162. El filtro por ruta "if "event" not in p.parts" no excluía las escenas de octubre 2024 al agregar features de invierno. winter_min_sigma0_vv diferencia máxima absoluta vs la versión limpia: 16.34 dB.',
  'Per the stopping rule, XGBoost v3 was discarded. models/xgboost_v3_DEPRECATED.joblib preserved for traceability but excluded from the pipeline. Final model: Random Forest v2 — 14 features, no temporal leakage possible by construction. Documented in scripts/models/README_leakage_finding.md.':
    'Por la regla de parada, XGBoost v3 fue descartado. models/xgboost_v3_DEPRECATED.joblib se conserva por trazabilidad pero excluido del pipeline. Modelo final: Random Forest v2 — 14 features, sin fuga temporal posible por construcción. Documentado en scripts/models/README_leakage_finding.md.',
  'The bug': 'El bug',
  'Path-based filter failed to exclude event date scenes':
    'El filtro por ruta no excluía las escenas de fechas del evento',
  'October 2024 event scenes (S1_sigma0_20241019.tif and S1_sigma0_20241031.tif) were located directly in data/sentinel1/processed/, not in processed/event/. The path filter missed them. Since October counts as a winter month in the seasonal logic, both scenes leaked into the winter feature stack alongside the 12 baseline winter scenes.':
    'Las escenas del evento de octubre 2024 (S1_sigma0_20241019.tif y S1_sigma0_20241031.tif) estaban directamente en data/sentinel1/processed/, no en processed/event/. El filtro por ruta no las detectó. Como octubre cuenta como mes de invierno en la lógica estacional, ambas escenas se filtraron al stack de features de invierno junto a las 12 escenas baseline.',
  'Winter Features Diff': 'Diff de features de invierno',
  'Magnitude of leakage measured by regenerating clean features':
    'Magnitud de la fuga medida regenerando features limpias',
  'Median diff · flooded': 'Diff mediana · inundado',
  'Median diff · not-flooded': 'Diff mediana · no inundado',
  'Max abs diff': 'Diff máx. abs.',
  critical: 'crítica',
  'Lesson learned': 'Lección aprendida',
  'Always filter time series by date, not by path. Path-based filters depend on directory organisation, which is fragile. Date-based filters are explicit about temporal intent. This audit demonstrates that rigorous validation is not optional — significant metric improvements without an underlying methodological change deserve scrutiny. The final TFG model (Random Forest v2) is robust by construction: features are static DEM, baseline-period SAR aggregates, and baseline NDVI. No temporal leakage is possible.':
    'Filtra siempre las series temporales por fecha, no por ruta. Los filtros por ruta dependen de la organización de directorios, lo cual es frágil. Los filtros por fecha son explícitos sobre la intención temporal. Esta auditoría demuestra que la validación rigurosa no es opcional — mejoras significativas en métricas sin un cambio metodológico subyacente merecen escrutinio. El modelo final del TFG (Random Forest v2) es robusto por construcción: features de DEM estático, agregados SAR del periodo baseline y NDVI baseline. No es posible fuga temporal.',

  // ── Evidently AI / Data Drift / Regulatory references ──────────
  'Data Drift': 'Drift de datos',
  // Evidently AI badge (proper noun, kept) but used_for strings translate
  'Reference pattern for the KPI strip + ROC + confusion-matrix heatmap layout.':
    'Patrón de referencia para la franja de KPIs + ROC + heatmap de matriz de confusión.',
  'Reference pattern for feature-drift bar charts + per-feature drill-down.':
    'Patrón de referencia para barras de drift por feature + drill-down individual.',
  'Definition and taxonomy of data drift / concept drift in supervised ML.':
    'Definición y taxonomía de data drift / concept drift en ML supervisado.',
  'Justifies spatial extrapolation as a rigorous transferability test.':
    'Justifica la extrapolación espacial como test riguroso de transferibilidad.',
  'Permutation importance, recomputed independently per zone.':
    'Importancia por permutación, recalculada de forma independiente por zona.',
  'Open-source ML observability · "Too good to be true" audit patterns.':
    'Observabilidad de ML de código abierto · patrones de auditoría "demasiado bueno para ser cierto".',
  'Reference for the "suspect → 4-test audit → stop-on-fail" workflow shape.':
    'Referencia para el flujo "sospecha → auditoría 4 tests → parada al fallar".',
  'Open-source ML monitoring · classification performance dashboard.':
    'Monitorización ML de código abierto · panel de rendimiento de clasificación.',
  'Data Drift detection dashboards · open-source ML monitoring.':
    'Paneles de detección de Data Drift · monitorización ML de código abierto.',
  'Directive 2009/138/EC (Solvency II) — Internal Model Validation requirements.':
    'Directiva 2009/138/CE (Solvencia II) — requisitos de validación de modelos internos.',
  'Model validation + backtesting obligations for insurance risk models.':
    'Obligaciones de validación + backtesting para modelos de riesgo de seguros.',
  'Regulation (EU) 2024/1689 — Artificial Intelligence Act, Annex III §5.':
    'Reglamento (UE) 2024/1689 — Ley de IA, Anexo III §5.',
  'High-risk classification of AI used for insurance risk pricing; documentation, traceability and human oversight requirements.':
    'Clasificación de alto riesgo de la IA usada para tarificación de riesgo de seguros; requisitos de documentación, trazabilidad y supervisión humana.',

  // ── Leakage Audit · Regulatory framing card ──
  'Regulatory framing': 'Marco regulatorio',
  'Why a leakage audit is a production-grade control, not just a thesis exercise':
    'Por qué una auditoría de fugas es un control de producción, no solo un ejercicio académico',
  'Solvency II': 'Solvencia II',
  'EU AI Act': 'Ley de IA de la UE',
  'Directive 2009/138/EC': 'Directiva 2009/138/CE',
  'Regulation 2024/1689 · Annex III §5':
    'Reglamento 2024/1689 · Anexo III §5',
  'Insurers using internal models for capital adequacy must demonstrate that those models pass rigorous validation and backtesting. A model that reports a +0.044 AUC jump without methodological explanation would fail validation. This audit is the documented backtesting that justifies the Random Forest v2 choice.':
    'Las aseguradoras que usen modelos internos para adecuación de capital deben demostrar que dichos modelos pasan validación y backtesting rigurosos. Un modelo que reporta un salto de +0.044 AUC sin explicación metodológica no superaría la validación. Esta auditoría es el backtesting documentado que justifica la elección de Random Forest v2.',
  'AI systems used for insurance risk scoring are classified high-risk. Providers must keep technical documentation, an audit trail of model decisions, and evidence of human oversight. This page is the audit log: hypothesis, tests run, outcome, and why the suspect model was rejected.':
    'Los sistemas de IA usados para scoring de riesgo de seguros se clasifican como de alto riesgo. Los proveedores deben mantener documentación técnica, un registro de auditoría de las decisiones del modelo, y evidencia de supervisión humana. Esta página es el registro de auditoría: hipótesis, tests ejecutados, resultado, y razón del rechazo del modelo sospechoso.',

  // ── Leakage Audit badges ──
  'Solvency II · model validation': 'Solvencia II · validación de modelo',
  'EU AI Act · audit log': 'Ley de IA UE · registro de auditoría',

  // ── Overview / Exposure KPIs + widget chrome (faltaban) ───────
  'Affected policies': 'Pólizas afectadas',
  'Expected annual loss': 'Pérdida anual esperada',
  'If a DANA hits today': 'Si una DANA ocurriera hoy',
  'Single-event loss if a DANA hits today':
    'Pérdida single-event si una DANA ocurriera hoy',
  'Loss exceedance curve': 'Curva de excedencia de pérdida',
  'TIV share': 'Cuota TIV',
  'PML share': 'Cuota PML',

  // ── Policy Map · dock metrics (faltaban) ──────────────────────
  Insured: 'Asegurado',
  Premium: 'Prima',
  'Est. loss': 'Pérdida est.',
  Position: 'Posición',
  Distribution: 'Distribución',
  Policy: 'Póliza',
  'Nearest HR': 'Alto Riesgo más cercano',

  // ── Methodology eyebrow (compartido entre páginas) ────────────
  'Methodology': 'Metodología',
  'Audit verdict': 'Veredicto de auditoría',

  // ── Leakage Audit · forensic redesign (case-file UI) ──────
  // Strings introducidos cuando la vista se rediseñó como expediente
  // forense. Las cadenas viejas del banner "Too good to be true?" y
  // del "Lesson learned" se conservan arriba por si alguien revierte;
  // las nuevas (Verdict, Evidence A, Exhibit A/B, pull-quote, etc.)
  // viven aquí.
  'Case file': 'Expediente',
  'Solvency II · EU AI Act': 'Solvencia II · Ley de IA UE',
  Verdict: 'Veredicto',
  Rejected: 'Rechazado',
  'An exploratory XGBoost iteration reported AUC 0.966, a +0.044 jump over the Random Forest v2 baseline. The 4-test audit halted at Test 2: temporal leakage confirmed. Per the stop-on-fail rule, the model was removed from the pipeline.':
    'Una iteración exploratoria de XGBoost reportó AUC 0.966, un salto de +0.044 sobre el baseline de Random Forest v2. La auditoría de 4 tests se detuvo en el Test 2: fuga temporal confirmada. Por la regla de parada al fallar, el modelo fue retirado del pipeline.',
  'Decided by': 'Decidido por',
  'Test 2 fail': 'Test 2 fallido',
  'Stopping rule': 'Regla de parada',
  'Stop-on-fail': 'Parar al fallar',
  Artefact: 'Artefacto',

  'Evidence A': 'Prueba A',
  'Reported vs verifiable AUC': 'AUC reportado vs verificable',
  'The +0.044 jump that prompted the audit':
    'El salto de +0.044 que disparó la auditoría',
  Suspected: 'Sospechoso',
  'XGBoost v3 · 24 features': 'XGBoost v3 · 24 features',
  'Inflated by event-date scenes leaking into winter aggregates':
    'Inflado por escenas con fecha de evento filtradas en los agregados de invierno',
  Verified: 'Verificado',
  'Random Forest v2 · 14 features': 'Random Forest v2 · 14 features',
  'Static DEM + baseline-period aggregates only; no temporal leakage by construction':
    'Sólo DEM estático + agregados del periodo baseline; sin fuga temporal por construcción',
  "Auditor's note:": 'Nota del auditor:',
  'A +0.044 AUC step between two correctly cross-validated models, with no qualitatively new feature family added, is the canonical signal of leakage in remote-sensing classification. Audit was triggered on that prior alone.':
    'Un salto de +0.044 en AUC entre dos modelos correctamente validados de forma cruzada, sin añadir ninguna familia de features cualitativamente nueva, es la señal canónica de fuga en clasificación con teledetección. La auditoría se disparó sólo por ese indicio.',

  Methodology: 'Metodología',
  'Four-phase audit · stop-on-fail rule':
    'Auditoría en 4 fases · regla de parada al fallar',

  'Exhibit A': 'Prueba A',
  'The bug · path-based filter': 'El bug · filtro por ruta',
  'Exhibit B': 'Prueba B',
  'Contamination magnitude · winter feature stack':
    'Magnitud de contaminación · stack de features de invierno',
  'Differences between leaked and re-derived clean features. Values in dB unless stated otherwise.':
    'Diferencias entre las features filtradas y las re-derivadas limpias. Valores en dB salvo indicación.',

  'Regulatory anchor': 'Anclaje regulatorio',
  'Why this is a production control, not a thesis exercise':
    'Por qué esto es un control de producción, no un ejercicio académico',
  'Directive 2009/138/EC · Internal Model Validation':
    'Directiva 2009/138/CE · Validación de Modelo Interno',

  'Always filter time series by date, not by path. Path-based filters depend on directory organisation, which is fragile; date-based filters are explicit about temporal intent.':
    'Filtra siempre las series temporales por fecha, no por ruta. Los filtros por ruta dependen de la organización de directorios, lo cual es frágil; los filtros por fecha son explícitos sobre la intención temporal.',
  'Significant metric improvements without an underlying methodological change deserve scrutiny. The final TFG model (Random Forest v2) is robust by construction: features are static DEM, baseline-period SAR aggregates, and baseline NDVI. No temporal leakage is possible.':
    'Las mejoras significativas en métricas sin un cambio metodológico subyacente merecen escrutinio. El modelo final del TFG (Random Forest v2) es robusto por construcción: features de DEM estático, agregados SAR del periodo baseline y NDVI baseline. No es posible fuga temporal.',
  'Methodological appendix · TFG memoria, Ch. 7':
    'Apéndice metodológico · Memoria TFG, Cap. 7',

  // Winter diff table chrome
  Feature: 'Feature',
  'smoking gun': 'prueba decisiva',
  'No diff data available.': 'Sin datos de diff disponibles.',

  // Timeline phase titles — versión nueva con · en vez de em-dash
  'Audit design · 4 tests, stop-on-fail':
    'Diseño de la auditoría · 4 tests, parada al fallar',
  'Decision · XGBoost v3 rejected': 'Decisión · XGBoost v3 rechazado',

  // ── Continuous / Binary view toggle on the risk maps ──
  Continuo: 'Continuo',
  Binario: 'Binario',
  'Binary view: pixels with': 'Vista binaria: los píxeles con',
  'are coloured red (flood-positive); the rest are muted grey. Drag the slider to see the classification update live.':
    'se colorean en rojo (positivos de inundación); el resto se atenúan en gris. Arrastra el slider para ver la clasificación actualizarse en vivo.',
  'Continuous view: 8-bin colour palette from the geojson. Operational threshold':
    'Vista continua: paleta de 8 bins del geojson. Umbral operativo',
  'selected by recall ≥ 0.75 criterion on spatial cross-validation. Switch to Binary to apply the slider live to the map.':
    'elegido por el criterio recall ≥ 0.75 en validación cruzada espacial. Cambia a Binario para aplicar el slider en vivo al mapa.',
  'Continuous view: 8-bin colour palette from the geojson. Recalibrated threshold':
    'Vista continua: paleta de 8 bins del geojson. Umbral recalibrado',
  '(original 0.614 was recalibrated because positive prevalence differs by ~27× — 0.29 % vs 7.98 %). Switch to Binary to apply the slider live to the map.':
    '(el original 0.614 se recalibró porque la prevalencia positiva difiere ~27× — 0.29 % vs 7.98 %). Cambia a Binario para aplicar el slider en vivo al mapa.',

  // ── Algemesí map subtitle (was missing from translations) ──
  'Ribera Alta del Júcar · Model applied without retraining · Transferability test':
    'Ribera Alta del Júcar · Modelo aplicado sin reentrenamiento · Test de transferibilidad',
  // (Statistics / Extrapolation zone / F1 / Brier score already covered
  //  above — keeping only the new strings here.)
  'Extrapolation · full surface': 'Extrapolación · superficie completa',
  Exactitud: 'Exactitud',

  // ── Custom portfolio dialog ───────────────────────
  // Body strings are already Spanish in the dialog source. These
  // entries cover the few English remnants + the chrome.
  'Crear cartera personalizada': 'Crear cartera personalizada',
  'Generates a new synthetic portfolio with your parameters. Policies are sampled on the modelled risk surface (Valencia, Algemesí or both).':
    'Genera una cartera sintética nueva con tus parámetros. Las pólizas se sortean sobre la superficie de riesgo modelada (Valencia, Algemesí o ambas).',

  // ── Predefined portfolio blurbs (sidebar cards) ──
  'High-value residential · Valencia city':
    'Residencial premium · Valencia ciudad',
  'Mix 50/30/20 particulares · autos · pymes':
    'Mix 50/30/20 particulares · autos · pymes',
  'Industrial parks · Sedaví, Manises, Quart':
    'Polígonos industriales · Sedaví, Manises, Quart',

  // ── Predefined portfolio names (rendered in selector) ──
  'Premium Residential Valencia': 'Residencial Premium Valencia',
  'Wide Distribution Mix': 'Mix de Distribución Amplia',
  'Industrial Focus': 'Foco Industrial',

  // ── Policy Map dock — additional chrome strings ──
  'Posición en la cartera': 'Posición en la cartera',
  'Risk rank': 'Ranking de riesgo',
  'Risk position': 'Posición en el rango',
  'Copiar ficha': 'Copiar ficha',
  'Ficha copiada': 'Ficha copiada',
};

const ES_EN = Object.fromEntries(
  Object.entries(EN_ES).map(([k, v]) => [v, k])
);

const listeners = new Set();

export function getLang() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  } catch {
    return 'en';
  }
}

export function setLang(lang) {
  if (lang !== 'en' && lang !== 'es') return;
  const prev = getLang();
  if (prev === lang) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore — private mode */
  }
  applyTranslations();
  listeners.forEach((fn) => {
    try {
      fn(lang);
    } catch (err) {
      console.warn('i18n listener failed', err);
    }
  });
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Walk the rendered DOM and translate textNodes + attributes (title,
 * placeholder, aria-label) that match the current direction's dictionary.
 *
 * Idempotent: running it twice in the same language is a no-op because
 * the matcher only triggers on direct EN/ES keys. If the user is in ES
 * and we re-run with `lang=es`, every node already says ES so EN_ES lookup
 * misses and nothing changes.
 */
export function applyTranslations(root = document.getElementById('app')) {
  if (!root) return;
  const lang = getLang();
  const dict = lang === 'es' ? EN_ES : ES_EN;

  // Text nodes — direct text content only (not concatenated dynamic strings).
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const raw = node.nodeValue;
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (Object.prototype.hasOwnProperty.call(dict, trimmed)) {
      targets.push([node, raw.replace(trimmed, dict[trimmed])]);
    }
  }
  targets.forEach(([n, v]) => {
    n.nodeValue = v;
  });

  // Attributes that carry user-facing text.
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  ATTRS.forEach((attr) => {
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr);
      if (v && Object.prototype.hasOwnProperty.call(dict, v.trim())) {
        el.setAttribute(attr, dict[v.trim()]);
      }
    });
  });

  document.documentElement.setAttribute('lang', lang);
}

/**
 * Watch #app for new content (async-loaded KPIs, chart text, map popups)
 * and re-translate the subtree as it appears. Debounced so a burst of
 * mutations during a view's data-fetch fan-out triggers a single pass.
 */
let observer = null;
let pendingPass = null;
export function startI18nObserver(root) {
  const target = root || document.getElementById('app');
  if (!target || observer) return;
  observer = new MutationObserver(() => {
    if (pendingPass) return;
    pendingPass = requestAnimationFrame(() => {
      pendingPass = null;
      applyTranslations(target);
    });
  });
  observer.observe(target, { childList: true, subtree: true });
}

