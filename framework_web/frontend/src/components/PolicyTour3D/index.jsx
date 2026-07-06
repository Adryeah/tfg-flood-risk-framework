import React, { useEffect } from 'react';

import { useMap } from '@/components/Map';
import { PolicyRiskPanel } from './PolicyRiskPanel.jsx';
import './policyTour.css';

const FLY = { zoom: 18, pitch: 55, bearing: -20, duration: 1800 };

/**
 * PolicyTour3D — overlay de la póliza seleccionada. Ya NO dibuja geometría
 * vertical de riesgo (banda por planta, lámina, marcador flotante): el
 * edificio asegurado se tinta por riesgo en `TourSceneLayers` sobre su
 * footprint OSM real. Aquí solo: vuela al edificio y abre el panel de riesgo.
 *
 * @param {{ policy: import('../../types/policyTour.types.js').PolicyTour3DPolicy,
 *           onClose: () => void }} props
 */
export function PolicyTour3D({ policy, onClose }) {
  const { map } = useMap();

  useEffect(() => {
    if (!map) return undefined;
    const run = () => {
      map.flyTo({ center: [policy.lon, policy.lat], ...FLY, essential: true });
    };
    // flyTo exige el estilo cargado; en el mount se difiere con 'styledata'.
    if (map.isStyleLoaded()) {
      run();
      return undefined;
    }
    const onStyle = () => {
      if (map.isStyleLoaded()) {
        map.off('styledata', onStyle);
        run();
      }
    };
    map.on('styledata', onStyle);
    return () => map.off('styledata', onStyle);
  }, [map, policy.id, policy.lon, policy.lat]);

  return <PolicyRiskPanel policy={policy} onClose={onClose} />;
}
