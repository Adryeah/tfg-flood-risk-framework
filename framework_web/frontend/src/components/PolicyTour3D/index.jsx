import React, { useEffect } from 'react';

import { useMap, MapMarker, MarkerContent } from '@/components/Map';
import { useFloorRisk } from '../../hooks/useFloorRisk.js';
import {
  getFloorMinHeight,
  getFloorMaxHeight,
  squareFootprint,
  inflatePolygon,
  pointInPolygon,
} from '../../utils/floodGeometry.js';
import { PulsingMarker } from './PulsingMarker.jsx';
import { PolicyRiskPanel } from './PolicyRiskPanel.jsx';
import './policyTour.css';

const FLY = { zoom: 18, pitch: 55, bearing: -20, duration: 1800 };

// Caja (px) alrededor del punto de la póliza para queryRenderedFeatures.
const BUILDING_QUERY_PX = 12;
// Color de la lámina T500 (accent-sar) y opacidad translúcida.
const WATER_COLOR = '#1d6fa8';

/** flyTo cinematográfico al edificio de la póliza (zoom 18, pitch 55). */
function flyToPolicy(map, policy) {
  map.flyTo({ center: [policy.lon, policy.lat], ...FLY, essential: true });
}

/**
 * Footprint real del edificio OSM bajo la coordenada de la póliza, o null.
 * Tras el flyTo + carga de tiles (map idle), queryRenderedFeatures sobre la
 * source-layer 'building' de OpenFreeMap. Prefiere el polígono que CONTIENE
 * el punto; si la coord cae en calle, snap al edificio más cercano de la caja.
 * Devuelve null si no hay edificio → el caller mantiene el footprint esquemático.
 */
function buildingFootprintAt(map, lon, lat) {
  let pt;
  try {
    pt = map.project([lon, lat]);
  } catch {
    return null;
  }
  const box = [
    [pt.x - BUILDING_QUERY_PX, pt.y - BUILDING_QUERY_PX],
    [pt.x + BUILDING_QUERY_PX, pt.y + BUILDING_QUERY_PX],
  ];
  let feats = [];
  try {
    feats = map.queryRenderedFeatures(box) || [];
  } catch {
    return null;
  }
  const buildings = feats.filter(
    (f) =>
      f.sourceLayer === 'building' &&
      f.geometry &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
  if (!buildings.length) return null;
  const hit =
    buildings.find((b) => pointInPolygon(lon, lat, b.geometry)) || buildings[0];
  return hit.geometry || null;
}

/** Extruye la banda de la planta asegurada en color de riesgo. */
function placeFloor(map, sourceId, layerId, policy, color, footprint) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);
  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'Feature', geometry: footprint, properties: {} },
  });
  map.addLayer({
    id: layerId,
    type: 'fill-extrusion',
    source: sourceId,
    paint: {
      'fill-extrusion-color': color,
      'fill-extrusion-base': getFloorMinHeight(policy.floorIndex),
      'fill-extrusion-height': getFloorMaxHeight(policy.floorIndex),
      'fill-extrusion-opacity': 0.9,
    },
  });
}

/**
 * Lámina de agua T500 como volumen translúcido alrededor del edificio, de la
 * cota del suelo hasta la profundidad del agua sobre el suelo. Si el agua no
 * sube del suelo (planta sobre la lámina), no se dibuja. Hace visible "hasta
 * qué altura sube el agua" — el edificio se ve sumergido a través del azul.
 */
function placeWater(map, sourceId, layerId, policy) {
  const depth = Math.max(
    0,
    (policy.floodDepthT500M || 0) - (policy.terrainElevationM || 0)
  );
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);
  if (depth <= 0.05) return; // seco: sin lámina
  map.addSource(sourceId, {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: squareFootprint(policy.lon, policy.lat, 90, 90),
      properties: {},
    },
  });
  map.addLayer({
    id: layerId,
    type: 'fill-extrusion',
    source: sourceId,
    paint: {
      'fill-extrusion-color': WATER_COLOR,
      'fill-extrusion-base': 0,
      'fill-extrusion-height': depth,
      'fill-extrusion-opacity': 0.34,
    },
  });
}

function shortFloorLabel(i) {
  if (i === 0) return 'PB';
  if (i === -1) return 'PARKING';
  if (i < -1) return `S${-i}`;
  return `P${i}`;
}

/**
 * PolicyTour3D — overlay del tour a nivel de edificio. Montado como hijo de
 * <Map> (Map.tsx). Al recibir una póliza: vuela al edificio, extruye la planta
 * asegurada en color de riesgo (footprint OSM real si lo encuentra, esquemático
 * si no), levanta la lámina T500 a su cota, flota un marcador pulsante y abre
 * el panel de riesgo vertical.
 *
 * @param {{ policy: import('../../types/policyTour.types.js').PolicyTour3DPolicy,
 *           onClose: () => void }} props
 */
export function PolicyTour3D({ policy, onClose }) {
  const { map } = useMap();

  const risk = useFloorRisk({
    floorIndex: policy.floorIndex,
    assetType: policy.assetType,
    pFlood: policy.pFlood,
    tiv: policy.tiv,
    eal: policy.eal,
    pml: policy.pml,
    terrainElevationM: policy.terrainElevationM,
    floodDepthT500M: policy.floodDepthT500M,
  });

  useEffect(() => {
    if (!map) return undefined;

    let cancelled = false;
    const floorSrc = `ptour-src-${policy.id}`;
    const floorLayer = `ptour-floor-${policy.id}`;
    const waterSrc = `ptour-water-src-${policy.id}`;
    const waterLayer = `ptour-water-${policy.id}`;

    // Tras flyTo + carga de tiles, intenta el footprint OSM real. 'idle' es el
    // único evento que garantiza cámara quieta + tiles cargados (el intento
    // previo querreaba demasiado pronto y por eso volvía vacío).
    const onIdle = () => {
      if (cancelled) return;
      const real = buildingFootprintAt(map, policy.lon, policy.lat);
      if (real) {
        placeFloor(map, floorSrc, floorLayer, policy, risk.riskColor, inflatePolygon(real, 1.04));
      }
    };

    const run = () => {
      if (cancelled) return;
      flyToPolicy(map, policy);
      // Footprint esquemático inmediato (no depende de tiles) — fallback estable.
      placeFloor(map, floorSrc, floorLayer, policy, risk.riskColor, squareFootprint(policy.lon, policy.lat));
      placeWater(map, waterSrc, waterLayer, policy);
      map.once('idle', onIdle);
    };

    // addSource/addLayer y flyTo exigen el estilo cargado. En el mount el mapa
    // se acaba de crear (estilo cargando) y se difiere con 'styledata'; en
    // navegación el estilo ya está → corre de inmediato.
    const onStyle = () => {
      if (map.isStyleLoaded()) {
        map.off('styledata', onStyle);
        run();
      }
    };
    if (map.isStyleLoaded()) run();
    else map.on('styledata', onStyle);

    return () => {
      cancelled = true;
      map.off('styledata', onStyle);
      map.off('idle', onIdle);
      for (const layer of [floorLayer, waterLayer]) {
        if (map.getLayer(layer)) map.removeLayer(layer);
      }
      for (const src of [floorSrc, waterSrc]) {
        if (map.getSource(src)) map.removeSource(src);
      }
    };
  }, [map, policy, risk.riskColor]);

  return (
    <>
      <MapMarker longitude={policy.lon} latitude={policy.lat}>
        <MarkerContent>
          <PulsingMarker
            riskColor={risk.riskColor}
            floorAltitudeM={risk.floorAltitudeM}
            label={shortFloorLabel(policy.floorIndex)}
          />
        </MarkerContent>
      </MapMarker>

      <PolicyRiskPanel policy={policy} onClose={onClose} />
    </>
  );
}
