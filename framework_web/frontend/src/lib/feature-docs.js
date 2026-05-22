/**
 * Single source of truth for the 14 model features.
 *
 * Each entry documents what the feature measures, its physical unit,
 * which source dataset / pipeline step produced it, and (when relevant)
 * the academic reference behind the index. Used by:
 *   - Model & Validation → Feature Importance chart tooltip + glossary
 *   - Transferability    → Feature Drift chart tooltip + glossary
 *
 * Keep entries terse. The tribunal reads them on hover; they're not a
 * literature review — one sentence of "what it measures" + a "why we
 * include it" half-sentence is enough.
 *
 * `category` drives the colour chip in the glossary table:
 *   - sar      → Sentinel-1 backscatter aggregates (baseline 2022-2024)
 *   - optical  → Sentinel-2 NDVI
 *   - dem      → SRTM 30 m derived (static)
 *   - hydro    → DEM-derived hydrology (TWI, HAND, drainage)
 *   - distance → Euclidean distance metrics
 */

export const FEATURE_DOCS = {
  // ── SAR backscatter (Sentinel-1 GRD baseline 2022-09 → 2024-09) ──
  mean_sigma0_vv: {
    label: 'mean_sigma0_vv',
    category: 'sar',
    unit: 'dB',
    short: 'Mean VV backscatter over the baseline period',
    description:
      'Average Sentinel-1 σ⁰ VV across the pre-DANA baseline (≈ 50 dates). Captures the pixel\'s "default" radar response — permanent water has very low dB, urban/built environments very high.',
    source: 'Sentinel-1 GRD IW · pipeline 03_sar_temporal_features',
  },
  std_sigma0_vv: {
    label: 'std_sigma0_vv',
    category: 'sar',
    unit: 'dB',
    short: 'Temporal standard deviation of VV backscatter',
    description:
      'How much the pixel\'s backscatter fluctuates across the baseline. High std = pixel that oscillates (irrigated cropland, river fringe); low std = stable urban or bare rock.',
    source: 'Sentinel-1 GRD IW · pipeline 03_sar_temporal_features',
  },
  min_sigma0_vv: {
    label: 'min_sigma0_vv',
    category: 'sar',
    unit: 'dB',
    short: 'Minimum VV backscatter observed in baseline',
    description:
      'The wettest moment a pixel reached historically (water is a specular reflector → very negative dB). Strong proxy for "has been flooded at least once".',
    source: 'Sentinel-1 GRD IW · pipeline 03_sar_temporal_features',
  },
  cv_sigma0_vv: {
    label: 'cv_sigma0_vv',
    category: 'sar',
    unit: '—',
    short: 'Coefficient of variation (std / mean) of VV',
    description:
      'Scale-free variability. Useful because mean σ⁰ varies a lot across land cover; the ratio normalises it and isolates the "wobble".',
    source: 'Derived from mean_sigma0_vv + std_sigma0_vv',
  },
  mean_vv_vh_ratio: {
    label: 'mean_vv_vh_ratio',
    category: 'sar',
    unit: '—',
    short: 'Mean of σ⁰_VV / σ⁰_VH ratio',
    description:
      'Distinguishes open water (high VV/VH, specular surface) from vegetation (low ratio, volume scattering). Standard polarisation feature in SAR water mapping.',
    source: 'Sentinel-1 GRD IW · dual-pol VV+VH',
  },
  water_count: {
    label: 'water_count',
    category: 'sar',
    unit: 'dates',
    short: 'Number of baseline dates the pixel was Otsu-classified as water',
    description:
      'Direct flood-frequency proxy: for each date, apply Otsu threshold to σ⁰ VV; count dates the pixel falls below. A pixel with water_count = 12 has been wet on 12 of the 50 baseline dates.',
    source: 'Otsu threshold per scene · pipeline 03_water_detection',
  },

  // ── Topography & hydrology (DEM-derived, static) ──
  elevation: {
    label: 'elevation',
    category: 'dem',
    unit: 'm',
    short: 'Pixel elevation above sea level',
    description:
      'SRTM 30 m DEM. Strongest single predictor in coastal floodplains — pixels below 5–10 m a.s.l. dominate the DANA-affected zones.',
    source: 'NASA SRTM v3 · 30 m posting',
  },
  slope: {
    label: 'slope',
    category: 'dem',
    unit: '°',
    short: 'Terrain slope (gradient magnitude of DEM)',
    description:
      'Steep slopes drain quickly; flat ground accumulates. Computed as the magnitude of the local DEM gradient in degrees.',
    source: 'SRTM-derived · numpy.gradient',
  },
  distance_to_stream: {
    label: 'distance_to_stream',
    category: 'distance',
    unit: 'm',
    short: 'Euclidean distance to nearest river / drainage line',
    description:
      'Drainage network extracted via flow-accumulation thresholding; Euclidean distance from each pixel to the nearest stream cell. Low value = high fluvial flooding risk.',
    source: 'DEM-derived drainage · pipeline 04_topographic_features',
  },
  flow_accumulation: {
    label: 'flow_accumulation',
    category: 'hydro',
    unit: 'cells',
    short: 'Number of upstream cells draining into the pixel',
    description:
      'Standard D8 flow-accumulation grid. High value = pixel sits downstream of a large basin and concentrates runoff.',
    source: 'D8 algorithm on SRTM · richdem / pysheds',
  },

  // ── Optical (Sentinel-2 L2A) ──
  ndvi_mean: {
    label: 'ndvi_mean',
    category: 'optical',
    unit: '— [-1, 1]',
    short: 'Mean NDVI from Sentinel-2 over the baseline',
    description:
      'Normalised Difference Vegetation Index = (NIR − RED) / (NIR + RED). Healthy vegetation ≈ +0.6, bare soil ≈ +0.1, water ≈ negative. Distinguishes huerta from urban from water.',
    source: 'Sentinel-2 L2A · band B8 / B4',
  },

  // ── Distance-based ──
  distance_to_coast: {
    label: 'distance_to_coast',
    category: 'distance',
    unit: 'm',
    short: 'Euclidean distance to the Mediterranean coastline',
    description:
      'Most important feature in Valencia (coastal storm-surge / lagoon flooding). Drift sign-flips in Algemesí because that basin is fluvial (Júcar river) — see Transferability view.',
    source: 'Natural Earth coastline polyline',
  },
  twi: {
    label: 'twi',
    category: 'hydro',
    unit: '— (ln units)',
    short: 'Topographic Wetness Index = ln(α / tan β)',
    description:
      'Classic Beven & Kirkby (1979) wetness index. α = upslope contributing area per unit contour length; β = local slope. High TWI = saturated valley bottoms.',
    source: 'DEM-derived · pipeline 04_topographic_features',
    cite: 'Beven & Kirkby 1979',
  },
  hand: {
    label: 'hand',
    category: 'hydro',
    unit: 'm',
    short: 'Height Above Nearest Drainage',
    description:
      'Vertical distance from the pixel down to the nearest stream pixel along the flow path. Captures local relative relief better than absolute elevation. Nobre et al. (2011) flood-mapping standard.',
    source: 'DEM-derived · pipeline 04_topographic_features',
    cite: 'Nobre et al. 2011',
  },
};

/** Category metadata for legend chips in the glossary table. */
export const CATEGORY_META = {
  sar: { label: 'SAR temporal', color: '#1D4ED8', bg: '#EFF4FB' },
  optical: { label: 'Optical', color: '#15803D', bg: '#F0FDF4' },
  dem: { label: 'DEM', color: '#7C3AED', bg: '#F3EEFE' },
  hydro: { label: 'Hydrology', color: '#0E9F8E', bg: '#ECFEFA' },
  distance: { label: 'Distance', color: '#D97706', bg: '#FFFBEB' },
};
