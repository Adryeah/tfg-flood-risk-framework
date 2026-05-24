const DEFAULT_TIMEOUT = 30000;

// Backend base URL. In dev this stays empty so the Vite proxy
// (configured in vite.config.js) forwards /api/* to localhost:8000.
// In production (Vercel) we set VITE_API_BASE_URL at build time to
// the public Render URL, e.g. "https://tfg-flood-risk.onrender.com".
// Trailing slash stripped so we don't end up with double // in URLs.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function withBase(path) {
  // Pass-through for any caller that already uses an absolute URL.
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  constructor(message, status, response) {
    super(message);
    this.status = status;
    this.response = response;
  }
}

// FastAPI returns `detail` as a string for HTTPException but as an array of
// {loc, msg, type} for 422 validation errors. Normalise to a single string so
// the message never renders as "[object Object]" in the UI.
function formatDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) =>
        d && typeof d === 'object' && d.msg ? d.msg : JSON.stringify(d)
      )
      .join('; ');
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
}

async function request(endpoint, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);

  try {
    const response = await fetch(withBase(endpoint), {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        formatDetail(error.detail) || `HTTP ${response.status}`,
        response.status,
        error
      );
    }

    // Cubre application/json y application/geo+json (lo que devuelve
    // el backend para los .geojson) — `includes('json')` matchea ambos
    // sin engancharse a tipos non-JSON que tengan "json" en otro sitio
    // (no hay riesgo realista en este API).
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('json')) {
      return await response.json();
    }
    return await response.text();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiError('Request timeout', 0);
    }
    throw err;
  }
}

export const api = {
  health: () => request('/api/health'),

  risk: {
    getGeoJSON: (zone) => request(`/api/risk/${zone}.geojson`),
    // Low-probability shoulder (p ∈ [0, 0.25)). Opt-in overlay; may 404
    // if the export script hasn't been re-run with the tail step.
    getTailGeoJSON: (zone) => request(`/api/risk/${zone}/tail.geojson`),
    predict: (lat, lon) => request(`/api/risk/predict?lat=${lat}&lon=${lon}`),
    // Plantilla XYZ para MapLibre raster source — `{z}/{x}/{y}` quedan
    // como literales para que MapLibre los sustituya por tile. Devuelve
    // la URL ABSOLUTA al backend (no relativa) para evitar que el
    // navegador resuelva contra el dominio del frontend en producción.
    tilesUrl: (zone) => `${API_BASE}/api/tiles/${zone}/{z}/{x}/{y}.png`,
  },

  geo: {
    // Direct fetch — these GeoJSON files are served statically from
    // backend/data_processed/ via the same proxy as the API.
    municipalities: () => request('/api/geo/municipalities.geojson'),
  },

  portfolio: {
    getPredefined: () => request('/api/portfolios/predefined'),
    getById: (id) => request(`/api/portfolios/${id}`),
    createCustom: (params) =>
      request('/api/portfolios/custom', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    getExposure: (id) => request(`/api/portfolios/${id}/exposure`),
  },

  metrics: {
    getSection: (section) => request(`/api/metrics/${section}`),
  },

  methodology: {
    getLeakageAudit: () => request('/api/methodology/leakage_audit'),
  },
};
