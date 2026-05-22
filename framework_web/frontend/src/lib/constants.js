export const API_BASE = '/api';

export const RISK_THRESHOLDS = {
  low: 0.3,
  medium: 0.614,
  high: 0.85,
};

export const RISK_COLORS = {
  low: '#16A34A',
  medium: '#EAB308',
  high: '#DC2626',
};

// bbox tuples are [lon_min, lat_min, lon_max, lat_max] in WGS84, matching the
// backend's config/params.yaml. Leaflet expects [[lat_min, lon_min], [lat_max, lon_max]]
// so we expose both forms.
export const ZONES = {
  valencia: {
    id: 'valencia',
    name: 'Valencia',
    description: "l'Horta Sud (training zone)",
    center: [39.43, -0.4],
    zoom: 11,
    threshold: 0.614,
    bbox: [-0.55, 39.3, -0.25, 39.55],
    leafletBounds: [
      [39.3, -0.55],
      [39.55, -0.25],
    ],
    color: '#1D4ED8', // brand-700 — training area
  },
  algemesi: {
    id: 'algemesi',
    name: 'Algemesí',
    description: 'Ribera Alta del Júcar (extrapolation)',
    center: [39.19, -0.43],
    zoom: 11,
    threshold: 0.389,
    bbox: [-0.698, 39.007, -0.166, 39.365],
    leafletBounds: [
      [39.007, -0.698],
      [39.365, -0.166],
    ],
    color: '#7E22CE', // purple-700 — extrapolation area
  },
};
