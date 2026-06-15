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

/** Centroide aproximado (media del anillo exterior) de un footprint. */
function footprintCentroid(geometry) {
  const ring =
    geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring?.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/** De una lista de features-polígono, el más cercano al punto [lon,lat]. */
function nearestBuilding(polys, lon, lat) {
  let best = null;
  let bestD = Infinity;
  for (const f of polys) {
    const c = footprintCentroid(f.geometry);
    if (!c) continue;
    const d = (c[0] - lon) ** 2 + (c[1] - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
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

    // TEMP DIAG — quitar tras verificar el flyTo.
    if (typeof window !== 'undefined') {
      window.__ptourMap = map;
      window.__ptourLog = window.__ptourLog || [];
      window.__ptourLog.push(
        `effect run · policy=${policy.id} lon=${policy.lon} lat=${policy.lat} ` +
          `zoomBefore=${map.getZoom?.().toFixed?.(2)} loaded=${map.loaded?.()}`
      );
    }

    let cancelled = false;
    const sourceId = `ptour-src-${policy.id}`;
    const layerId = `ptour-floor-${policy.id}`;

    // Coordenadas de póliza SINTÉTICAS (cartera simulada) → rara vez caen
    // justo sobre un footprint OSM. Se consulta un bbox amplio (±150 px) de
    // las capas de edificios y se elige el footprint REAL más cercano al
    // punto (snap), en vez de exigir que el punto esté dentro del edificio.
    // No se inventa geometría: se extruye un edificio OSM real próximo.
    const placeFloor = () => {
      if (cancelled || !map.getStyle()) return false;
      const layers = getBuildingLayerIds(map);
      const p = map.project([policy.lon, policy.lat]);
      const R = 150;
      let features = [];
      try {
        features = map.queryRenderedFeatures(
          [
            [p.x - R, p.y - R],
            [p.x + R, p.y + R],
          ],
          layers.length ? { layers } : undefined
        );
      } catch {
        features = [];
      }
      const polys = features.filter(
        (f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      );
      const building = nearestBuilding(polys, policy.lon, policy.lat);
      if (typeof window !== 'undefined') {
        window.__ptourLog.push(
          `placeFloor · zoom=${map.getZoom().toFixed(1)} feats=${features.length} ` +
            `polys=${polys.length} picked=${!!building}`
        );
      }
      if (!building) return false; // sin edificio cercano → solo panel (fallback spec)
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

    // El flyTo se descarta si se llama antes de que el estilo cargue (mapa
    // recién creado en el mount inicial). Se difiere con 'styledata' hasta
    // isStyleLoaded(): fiable en el mount (estilo aún cargando → espera) y
    // en navegación (estilo ya cargado → vuela ya). NO se usa 'load'
    // (dispara una vez) ni map.loaded() (false mientras hay tiles en vuelo).
    const fly = () => {
      if (cancelled) return;
      flyToPolicy(map, policy);
      map.on('moveend', onMoveEnd);
      if (typeof window !== 'undefined') {
        window.__ptourLog.push(`flyTo called · zoomBefore=${map.getZoom().toFixed(2)}`);
      }
    };
    const onStyle = () => {
      if (map.isStyleLoaded()) {
        map.off('styledata', onStyle);
        fly();
      }
    };
    if (map.isStyleLoaded()) fly();
    else map.on('styledata', onStyle);

    // Cleanup: SIEMPRE elimina layer + source + listeners para que no se
    // acumulen al navegar entre pólizas (spec §LIMPIEZA).
    return () => {
      cancelled = true;
      map.off('styledata', onStyle);
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
