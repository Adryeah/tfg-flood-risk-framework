import React, { useEffect } from 'react';

import { useMap, MapMarker, MarkerContent } from '@/components/Map';
import { useFloorRisk } from '../../hooks/useFloorRisk.js';
import {
  getFloorMinHeight,
  getFloorMaxHeight,
  squareFootprint,
} from '../../utils/floodGeometry.js';
import { PulsingMarker } from './PulsingMarker.jsx';
import { PolicyRiskPanel } from './PolicyRiskPanel.jsx';
import './policyTour.css';

const FLY = { zoom: 18, pitch: 55, bearing: -20, duration: 1800 };

/** flyTo cinematográfico al edificio de la póliza (zoom 18, pitch 55). */
function flyToPolicy(map, policy) {
  map.flyTo({ center: [policy.lon, policy.lat], ...FLY, essential: true });
}

/** Extruye la banda de la planta activa (footprint esquemático) en color de riesgo. */
function addFloorExtrusion(map, sourceId, layerId, policy, color) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);

  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'Feature', geometry: squareFootprint(policy.lon, policy.lat), properties: {} },
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

    // addSource/addLayer y flyTo exigen el estilo cargado. En el mount el
    // mapa se acaba de crear (estilo aún cargando) y la llamada se descarta;
    // se difiere con 'styledata' hasta isStyleLoaded(). En navegación el
    // estilo ya está → corre de inmediato. No se usa 'load' (dispara una
    // vez) ni map.loaded() (false mientras hay tiles en vuelo).
    const run = () => {
      if (cancelled) return;
      flyToPolicy(map, policy);
      addFloorExtrusion(map, sourceId, layerId, policy, risk.riskColor);
    };
    const onStyle = () => {
      if (map.isStyleLoaded()) {
        map.off('styledata', onStyle);
        run();
      }
    };
    if (map.isStyleLoaded()) run();
    else map.on('styledata', onStyle);

    // Cleanup: elimina layer + source + listener al navegar entre pólizas.
    return () => {
      cancelled = true;
      map.off('styledata', onStyle);
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
