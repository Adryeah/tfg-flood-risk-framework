/**
 * floodGeometry — funciones puras de geometría de inundación vertical.
 *
 * Sin dependencias externas, sin estado, sin JSX. Toda la matemática del
 * riesgo por planta vive aquí para poder testearse en aislamiento (ver
 * floodGeometry.test.mjs). El resto del módulo PolicyTour3D (hook,
 * componentes, capa de mapa) consume estas funciones sin recomputarlas.
 *
 * Convención de plantas (floorIndex):
 *   -1 = parking / sótano   ·  0 = planta baja (PB)  ·  1 = primera, etc.
 * Cada planta ocupa una banda de 3 m de alto desde el suelo del edificio.
 */

const FLOOR_HEIGHT_M = 3;

/**
 * Altura en metros desde el suelo del edificio hasta la BASE de la planta.
 * @param {number} floorIndex -1 parking, 0 PB, 1 P1…
 * @returns {number} metros (negativo para sótanos)
 */
export function getFloorMinHeight(floorIndex) {
  // PB(0) → 0 m · P1(1) → 3 m · parking(-1) → -3 m
  return floorIndex * FLOOR_HEIGHT_M;
}

/**
 * Altura en metros hasta el TECHO de la planta (base + 3 m).
 * @param {number} floorIndex
 * @returns {number} metros
 */
export function getFloorMaxHeight(floorIndex) {
  return getFloorMinHeight(floorIndex) + FLOOR_HEIGHT_M;
}

/**
 * ¿Alcanza la lámina de agua T500 a esta planta?
 *
 * Trabaja en cotas absolutas (m.s.n.m): la base de la planta está a
 * `terrainElevation + getFloorMinHeight(floorIndex)`; si la cota de la
 * lámina T500 la supera, el agua entra.
 *
 * @param {number} floorIndex
 * @param {number} terrainElevation cota del suelo en m.s.n.m (DEM/SRTM)
 * @param {number} floodDepthAbsolute cota absoluta de la lámina T500 en m.s.n.m
 * @returns {{ reaches: boolean, marginMeters: number }}
 *   marginMeters > 0 → metros de agua POR ENCIMA de la base de la planta;
 *   marginMeters < 0 → metros de margen seco hasta que el agua la alcance.
 */
export function floodReachesFloor(floorIndex, terrainElevation, floodDepthAbsolute) {
  const floorAbsoluteElevation = terrainElevation + getFloorMinHeight(floorIndex);
  const marginMeters = floodDepthAbsolute - floorAbsoluteElevation;
  return {
    reaches: marginMeters > 0,
    marginMeters: Math.round(marginMeters * 10) / 10,
  };
}

/**
 * Factor de exposición por tipo de activo y planta.
 *
 * Un local en PB es 1.0x; un parking subterráneo 1.4x (inunda antes y
 * concentra valor en vehículos); un ático ~0.05x (prácticamente inmune).
 * El factor escala EAL/PML base para reflejar la vulnerabilidad vertical.
 *
 * @param {string} assetType local_comercial | nave_industrial | parking |
 *   vivienda | oficina | atico | (cualquier otro → default)
 * @param {number} floorIndex
 * @returns {number} multiplicador de exposición
 */
export function getExposureFactor(assetType, floorIndex) {
  const factors = {
    local_comercial: floorIndex === 0 ? 1.0 : floorIndex < 0 ? 1.4 : 0.2,
    nave_industrial: floorIndex === 0 ? 1.1 : 0.15,
    parking: floorIndex <= -1 ? 1.4 : 0.3,
    vivienda: floorIndex === 0 ? 0.8 : floorIndex < 0 ? 1.2 : 0.1,
    oficina: floorIndex === 0 ? 0.7 : floorIndex < 0 ? 1.1 : 0.05,
    atico: 0.05,
    default: floorIndex <= 0 ? 1.0 : 0.15,
  };
  return factors[assetType] ?? factors.default;
}

/**
 * Infla un polígono GeoJSON (Polygon | MultiPolygon) escalándolo desde su
 * centroide por `factor`. Uso: la banda de extrusión de la planta activa
 * se infla ~3-4 % sobre el footprint del edificio para que envuelva la
 * pared del `building-3d` del basemap y el color de riesgo gane el test de
 * profundidad sin z-fighting.
 *
 * No es un buffer geodésico exacto — un escalado desde centroide basta a
 * escala de edificio (decenas de metros) y mantiene la función pura.
 *
 * @param {{type:string, coordinates:any}} geometry geometría GeoJSON
 * @param {number} factor 1.0 = sin cambio; 1.04 = +4 %
 * @returns {{type:string, coordinates:any}} nueva geometría (inmutable)
 */
/**
 * Footprint rectangular esquemático centrado en [lon,lat]. La cartera es
 * sintética (coords no geocodificadas a edificios reales), así que se
 * extruye un bloque neutro en el punto en vez de fingir que un edificio
 * OSM concreto está asegurado.
 * ponytail: esquemático; cambiar a snap de queryRenderedFeatures(building)
 * si llegan coords geocodificadas reales.
 * @returns {{type:'Polygon', coordinates:number[][][]}}
 */
export function squareFootprint(lon, lat, wMeters = 16, hMeters = 20) {
  const dLat = hMeters / 2 / 111320;
  const dLon = wMeters / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - dLon, lat - dLat],
      [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat],
      [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ]],
  };
}

export function inflatePolygon(geometry, factor = 1.04) {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return geometry;
  }

  const scaleRing = (ring, cx, cy) =>
    ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);

  // Centroide simple = media de todos los vértices del anillo exterior.
  const centroidOf = (rings) => {
    const outer = rings[0] || [];
    let sx = 0;
    let sy = 0;
    for (const [x, y] of outer) {
      sx += x;
      sy += y;
    }
    const n = outer.length || 1;
    return [sx / n, sy / n];
  };

  if (geometry.type === 'Polygon') {
    const [cx, cy] = centroidOf(geometry.coordinates);
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => scaleRing(ring, cx, cy)),
    };
  }

  // MultiPolygon: escala cada polígono respecto a su propio centroide.
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((poly) => {
      const [cx, cy] = centroidOf(poly);
      return poly.map((ring) => scaleRing(ring, cx, cy));
    }),
  };
}
