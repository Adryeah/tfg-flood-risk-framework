import React, { useEffect } from 'react';

import { useMap, MapMarker, MarkerContent } from '@/components/Map';
import { useFloorRisk } from '../../hooks/useFloorRisk.js';
import {
  getFloorMinHeight,
  getFloorMaxHeight,
  inflatePolygon,
} from '../../utils/floodGeometry.js';
import { PulsingMarker } from './PulsingMarker.jsx';
import { PolicyRiskPanel } from './PolicyRiskPanel.jsx';
import './policyTour.css';

const FLY = { zoom: 18, pitch: 55, bearing: -20, duration: 1800 };

/** Capas de edificios del estilo actual (OpenMapTiles: source-layer 'building'). */
function getBuildingLayerIds(map) {
  const style = map.getStyle?.();
  if (!style?.layers) return [];
  return style.layers
    .filter(
      (l) =>
        (l['source-layer'] === 'building' || /building/i.test(l.id)) &&
        (l.type === 'fill' || l.type === 'fill-extrusion')
    )
    .map((l) => l.id);
}

/** flyTo cinematográfico al edificio de la póliza (zoom 18, pitch 55). */
function flyToPolicy(map, policy) {
  map.flyTo({
    center: [policy.lon, policy.lat],
    ...FLY,
    essential: true,
  });
}

/**
 * Extruye SOLO la banda de la planta activa sobre el footprint OSM, en el
 * color de riesgo. El polígono se infla ~4 % para envolver la pared del
 * building-3d del basemap y ganar el depth test (sin z-fighting).
 */
function addFloorExtrusion(map, sourceId, layerId, geometry, policy, color) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'Feature', geometry: inflatePolygon(geometry, 1.04), properties: {} },
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

function shortFloorLabel(i) {
  if (i === 0) return 'PB';
  if (i === -1) return 'PARKING';
  if (i < -1) return `S${-i}`;
  return `P${i}`;
}

/**
 * PolicyTour3D — overlay del tour a nivel de edificio. Montado como hijo de
 * <Map> (Map.tsx). Al recibir una póliza: vuela al edificio, extruye la
 * planta asegurada en color de riesgo, flota un marcador pulsante a su
 * altura y abre el panel de riesgo vertical.
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
    const sourceId = `ptour-src-${policy.id}`;
    const layerId = `ptour-floor-${policy.id}`;

    // Busca el edificio bajo la póliza (bbox ±28 px) y extruye su planta.
    const placeFloor = () => {
      if (cancelled || !map.getStyle()) return false;
      const layers = getBuildingLayerIds(map);
      const p = map.project([policy.lon, policy.lat]);
      let features = [];
      try {
        features = map.queryRenderedFeatures(
          [
            [p.x - 28, p.y - 28],
            [p.x + 28, p.y + 28],
          ],
          layers.length ? { layers } : undefined
        );
      } catch {
        features = [];
      }
      const building = features.find(
        (f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      );
      if (!building) return false; // edificio no encontrado → solo panel (fallback spec)
      addFloorExtrusion(map, sourceId, layerId, building.geometry, policy, risk.riskColor);
      return true;
    };

    const onMoveEnd = () => {
      map.off('moveend', onMoveEnd);
      if (!placeFloor()) {
        // tiles del z18 aún sin asentar → reintento único al quedar idle.
        map.once('idle', placeFloor);
      }
    };

    // Arranca el vuelo + el placement. Gateamos en la propia disponibilidad
    // del mapa (map.loaded()), NO en el isLoaded del contexto: ese combina
    // isStyleLoaded y puede quedar colgado en false, bloqueando el flyTo.
    const begin = () => {
      if (cancelled) return;
      flyToPolicy(map, policy);
      // Espera al final del vuelo (spec: NO setTimeout fijo → moveend).
      map.on('moveend', onMoveEnd);
    };

    if (map.loaded()) begin();
    else map.once('load', begin);

    // Cleanup: SIEMPRE elimina layer + source + listeners para que no se
    // acumulen al navegar entre pólizas (spec §LIMPIEZA).
    return () => {
      cancelled = true;
      map.off('load', begin);
      map.off('moveend', onMoveEnd);
      map.off('idle', placeFloor);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
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
