/**
 * Tipos locales del módulo PolicyTour3D (JSDoc — el proyecto es JS puro).
 *
 * No se modifica ningún tipo global: el cliente del backend (`PolicyRecord`)
 * no trae `floorIndex` ni cotas de elevación, así que aquí se define la
 * forma que consume el tour y un adaptador que la deriva de los campos
 * reales, marcando explícitamente los fallbacks.
 *
 * @typedef {Object} PolicyTour3DPolicy
 * @property {string} id
 * @property {number} lat
 * @property {number} lon
 * @property {number} floorIndex        -1 parking · 0 PB · 1 P1…
 * @property {string} assetType         clave de getExposureFactor
 * @property {number} pFlood            P(inundación) [0,1]
 * @property {number} tiv               Total Insured Value (€)
 * @property {number} eal               Expected Annual Loss base (€)
 * @property {number} pml               Probable Maximum Loss base (€)
 * @property {number} terrainElevationM cota del terreno (m.s.n.m)
 * @property {number} floodDepthT500M   cota absoluta lámina T500 (m.s.n.m)
 * @property {number} floorCount        nº de plantas del edificio (para el indicador)
 * @property {string} riskCategory      low | moderate | high | very_high
 * @property {boolean} _estimatedElevation true si terrain/T500 son fallback
 */

// Fallbacks documentados (spec §FALLBACKS).
const DEFAULT_TERRAIN_M = 10.0; // Valencia costa, suelo bajo
const FLOOR_HEIGHT_M = 3;

/** subtype del backend → floorIndex representativo de la planta asegurada. */
const SUBTYPE_FLOOR = {
  parking: -1,
  sotano: -1,
  piso_bajo: 0,
  bajo: 0,
  local: 0,
  nave: 0,
  casa: 0,
  chalet: 0,
  oficina: 1,
  piso_alto: 3,
  atico: 4,
};

/** (type|product|subtype) → clave de exposición de getExposureFactor. */
function deriveAssetType(client) {
  const t = String(client.type || '').toLowerCase();
  const known = ['local_comercial', 'nave_industrial', 'parking', 'vivienda', 'oficina', 'atico'];
  if (known.includes(t)) return t;

  const sub = String(client.subtype || '').toLowerCase();
  if (sub.includes('nave')) return 'nave_industrial';
  if (sub.includes('oficina')) return 'oficina';
  if (sub.includes('local')) return 'local_comercial';
  if (sub.includes('atico')) return 'atico';
  if (sub.includes('parking') || sub.includes('garaje')) return 'parking';

  const product = String(client.product || '').toLowerCase();
  if (product === 'autos') return 'parking'; // vehículos: vulnerabilidad nivel calle/sótano
  if (product === 'particulares') return 'vivienda';
  return 'default';
}

/** Deriva el floorIndex de la planta asegurada desde los campos reales. */
function deriveFloorIndex(client) {
  if (typeof client.floor === 'number' && client.floor >= -3 && client.floor <= 12) {
    return client.floor;
  }
  const sub = String(client.subtype || '').toLowerCase();
  if (sub in SUBTYPE_FLOOR) return SUBTYPE_FLOOR[sub];
  if (client.ground_floor === true) return 0;
  return 0; // PB por defecto
}

/**
 * Adapta un cliente del backend a PolicyTour3DPolicy. Deriva lo que falta
 * de campos reales (subtype, type, estimated_loss_dana) y aplica los
 * fallbacks del spec para elevación y lámina T500, que el dataset actual
 * no incluye por póliza.
 *
 * @param {Object} client registro de cliente/póliza del backend
 * @returns {PolicyTour3DPolicy}
 */
export function adaptClientToPolicy(client) {
  const pFlood = Number(client.risk_probability ?? 0);
  const tiv = Number(client.insured_value ?? 0);
  // estimated_loss_dana = pérdida si la DANA golpea HOY → proxy de PML
  // single-event. EAL ≈ PML × P(flood) (esperanza anualizada). Ambos
  // derivados de campos reales, no inventados.
  const pml = Number(client.estimated_loss_dana ?? tiv * pFlood);
  const eal = Math.round(pml * pFlood);

  const terrainElevationM =
    typeof client.terrain_elevation_m === 'number' ? client.terrain_elevation_m : DEFAULT_TERRAIN_M;
  const hasRealElevation = typeof client.terrain_elevation_m === 'number';
  // Lámina T500 ausente por póliza → estimación spec: suelo + P(flood)×3 m.
  const floodDepthT500M =
    typeof client.flood_depth_t500_m === 'number'
      ? client.flood_depth_t500_m
      : terrainElevationM + pFlood * FLOOR_HEIGHT_M;

  return {
    id: client.id,
    lat: Number(client.lat),
    lon: Number(client.lon),
    floorIndex: deriveFloorIndex(client),
    assetType: deriveAssetType(client),
    pFlood,
    tiv,
    eal,
    pml,
    terrainElevationM,
    floodDepthT500M,
    floorCount: Number(client.floor_count) > 0 ? Number(client.floor_count) : 4,
    riskCategory: client.risk_category || 'moderate',
    _estimatedElevation: !hasRealElevation,
  };
}
