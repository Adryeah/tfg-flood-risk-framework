export const API_BASE = '/api';

// Bordes de banda de categoría, alineados con el backend
// (categorize_probability) en la escala CALIBRADA de v3-T (10 feat): >=0.16
// moderate (= umbral operacional), >=0.30 high, >=0.50 very_high.
export const RISK_THRESHOLDS = {
  moderate: 0.16,
  high: 0.3,
  very_high: 0.5,
};

// Paleta canónica de categoría de riesgo (esquema de 4 bins del modelo) para
// superficies sobre fondo CLARO (dashboards, mapas Positron). El tour 3D usa
// una paleta distinta sobre mapa oscuro: TOUR_RISK_COLORS en policy-tour-3d.jsx.
// `medium` es un alias defensivo por si algo pasa la key del esquema viejo.
export const RISK_COLORS = {
  low: '#16A34A',
  moderate: '#D97706',
  medium: '#D97706',
  high: '#DC2626',
  very_high: '#991B1B',
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
    threshold: 0.16,
    // bbox = extensión REAL del ráster de riesgo v3-T (no el study-bbox,
    // que era ligeramente menor y recortaba los bordes de la zona).
    bbox: [-0.559, 39.293, -0.24, 39.557],
    leafletBounds: [
      [39.293, -0.559],
      [39.557, -0.24],
    ],
    color: '#1D4ED8', // brand-700 — training area
  },
  algemesi: {
    id: 'algemesi',
    name: 'Algemesí',
    description: 'Ribera Alta del Júcar (extrapolation)',
    center: [39.19, -0.43],
    zoom: 11,
    threshold: 0.16,
    // bbox = extensión REAL del ráster de riesgo v3-T de Algemesí.
    bbox: [-0.71, 38.995, -0.152, 39.377],
    leafletBounds: [
      [38.995, -0.71],
      [39.377, -0.152],
    ],
    color: '#7E22CE', // purple-700 — extrapolation area
  },
};
