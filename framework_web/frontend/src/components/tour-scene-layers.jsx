import React, { useEffect, useRef } from 'react';

import { useMap } from '@/components/Map';
import { api } from '@/lib/api';
import { pointInPolygon, inflatePolygon } from '../utils/floodGeometry.js';

// AWS Open Data Terrarium — mismo DEM que el modo 3D de RiskZoneMap; el stack
// terreno + hillshade + cielo es, en esencia, lo que usa shademap.app.
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Zonas con tiles de riesgo del RF v3-T (superficie de suelo, opcional).
const RISK_ZONES = ['valencia', 'algemesi'];
// Caja (px) alrededor del punto de la póliza para snap al footprint OSM.
const SNAP_PX = 14;

// Paleta de la web (tokens.css, tema dark) para recolorear el basemap Liberty
// claro y que la consola vaya del color de la página, no del gris OSM.
const THEME = {
  bg: '#08090a', // surface-canvas
  water: '#10222e', // SAR oscurecido → lee como agua sin iluminar
  land: '#0e1012',
  park: '#0f1410',
  building: '#161718', // surface-card
  buildingRoof: '#1e2022', // surface-elevated
  road: '#2a2d31',
  roadMinor: '#1b1e21',
  text: '#8a8f98', // text-secondary
};

/**
 * Recolorea el estilo Liberty (claro) a la paleta dark de la web, capa a
 * capa por tipo + source-layer (robusto al naming exacto). NO toca nuestras
 * capas (prefijos tour-/insured-/terrain), para no pisar el tintado de riesgo
 * si el efecto se re-ejecuta. Deja pasar en silencio las capas sin la prop.
 */
function recolorToTheme(map) {
  const layers = map.getStyle()?.layers || [];
  for (const l of layers) {
    if (/^(tour-|insured-|terrain)/.test(l.id)) continue;
    const sl = l['source-layer'] || '';
    try {
      if (l.type === 'background') {
        map.setPaintProperty(l.id, 'background-color', THEME.bg);
      } else if (l.type === 'fill-extrusion') {
        map.setPaintProperty(l.id, 'fill-extrusion-color', THEME.buildingRoof);
      } else if (l.type === 'fill') {
        const c =
          sl === 'water'
            ? THEME.water
            : sl === 'building'
              ? THEME.building
              : /park|wood|forest|grass|landcover|landuse/.test(sl)
                ? THEME.park
                : THEME.land;
        map.setPaintProperty(l.id, 'fill-color', c);
      } else if (l.type === 'line') {
        const c =
          sl === 'water' || sl === 'waterway'
            ? THEME.water
            : sl === 'transportation'
              ? THEME.road
              : THEME.roadMinor;
        map.setPaintProperty(l.id, 'line-color', c);
      } else if (l.type === 'symbol') {
        if (sl === 'poi' || sl === 'housenumber') {
          map.setLayoutProperty(l.id, 'visibility', 'none');
        } else {
          map.setPaintProperty(l.id, 'text-color', THEME.text);
          map.setPaintProperty(l.id, 'text-halo-color', THEME.bg);
        }
      }
    } catch {
      // capa sin esa propiedad — ignorar.
    }
  }
}

/** id de la primera capa de edificios del basemap, para insertar la
 *  superficie de riesgo POR DEBAJO (los edificios quedan encima, limpios). */
function firstBuildingLayerId(map) {
  const layers = map.getStyle()?.layers || [];
  return layers.find((l) => l.id && l.id.toLowerCase().includes('building'))?.id;
}

/**
 * Footprint OSM real del edificio bajo [lon,lat] + su altura de render.
 * Devuelve null si no hay edificio renderizado ahí (coord en calle, o tiles
 * de edificio aún sin cargar). Honesto: no fingimos un edificio que no está.
 */
function buildingAt(map, lon, lat) {
  let pt;
  try {
    pt = map.project([lon, lat]);
  } catch {
    return null;
  }
  const box = [
    [pt.x - SNAP_PX, pt.y - SNAP_PX],
    [pt.x + SNAP_PX, pt.y + SNAP_PX],
  ];
  let feats = [];
  try {
    feats = map.queryRenderedFeatures(box) || [];
  } catch {
    return null;
  }
  const builds = feats.filter(
    (f) =>
      f.sourceLayer === 'building' &&
      f.geometry &&
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
  if (!builds.length) return null;
  const hit = builds.find((b) => pointInPolygon(lon, lat, b.geometry)) || builds[0];
  const raw = Number(hit.properties?.render_height ?? hit.properties?.height ?? 0) || 12;
  return { geometry: hit.geometry, height: Math.min(Math.max(raw, 6), 120) };
}

/** FeatureCollection de los edificios asegurados visibles, tintados por
 *  riesgo. Solo pólizas de inmueble (los coches van como marcador de calle).
 *  Solo las que están en viewport y tienen edificio OSM bajo el punto. */
function snapInsured(map, policies, activeId) {
  let bounds;
  try {
    bounds = map.getBounds();
  } catch {
    return null;
  }
  const features = [];
  for (const p of policies) {
    if (p.product === 'autos') continue;
    const lon = Number(p.lon);
    const lat = Number(p.lat);
    if (!bounds.contains([lon, lat])) continue;
    const b = buildingAt(map, lon, lat);
    if (!b) continue;
    features.push({
      type: 'Feature',
      // +0.5 m y footprint inflado 4 % → la cara tintada envuelve la del
      // edificio gris del basemap sin z-fighting.
      properties: {
        id: p.id,
        color: p._color || '#F87171',
        active: p.id === activeId,
        h: b.height + 0.5,
      },
      geometry: inflatePolygon(b.geometry, 1.04),
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Capas de escena del tour: terreno 3D + cielo (stack shademap), superficie
 * de riesgo de suelo (opcional, botón), y los EDIFICIOS asegurados tintados
 * por riesgo sobre su footprint OSM real. Cada edificio tintado es una póliza
 * clicable. Montado como hijo de <Map>.
 *
 * @param {{ policies: any[], activeId: string|null, floodOn: boolean,
 *           onSelectPolicy: (id: string) => void }} props
 */
export function TourSceneLayers({ policies, activeId, floodOn, onSelectPolicy }) {
  const { map, isLoaded } = useMap();
  // Refs para que los handlers (click/moveend) lean siempre lo último sin
  // re-suscribirse en cada cambio de cartera.
  const ref = useRef({ policies, activeId, onSelectPolicy, needsSnap: true });
  ref.current.policies = policies;
  ref.current.activeId = activeId;
  ref.current.onSelectPolicy = onSelectPolicy;

  // ── 1) Escena estática + handlers (una vez por mapa) ────────────────────
  useEffect(() => {
    if (!map || !isLoaded) return undefined;

    const reSnap = () => {
      const data = snapInsured(map, ref.current.policies, ref.current.activeId);
      const src = map.getSource('insured-buildings');
      if (src && data) src.setData(data);
    };

    try {
      // Basemap a la paleta dark de la web ANTES de añadir nuestras capas
      // (así el recolor no las alcanza).
      recolorToTheme(map);

      const beforeBuildings = firstBuildingLayerId(map);

      // Superficie de riesgo de suelo (RF v3-T). Visible por defecto → las
      // pólizas quedan dentro del mapa de riesgo; el botón la puede ocultar.
      for (const z of RISK_ZONES) {
        const id = `tour-risk-${z}`;
        if (map.getSource(id)) continue;
        map.addSource(id, {
          type: 'raster',
          tiles: [api.risk.tilesUrl(z)],
          tileSize: 256,
          minzoom: 10,
          maxzoom: 15,
          attribution: 'Random Forest v3-T · TFG Vargas (UAB)',
        });
        map.addLayer(
          {
            id,
            type: 'raster',
            source: id,
            layout: { visibility: floodOn ? 'visible' : 'none' },
            paint: {
              'raster-opacity': 0.6,
              'raster-opacity-transition': { duration: 260, delay: 0 },
              'raster-resampling': 'linear',
            },
          },
          beforeBuildings
        );
      }

      // Terreno Terrarium + hillshade + cielo (idéntico a RiskZoneMap 3D).
      if (!map.getSource('terrain-dem')) {
        map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: [TERRARIUM],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 14,
          attribution: 'Terrain · AWS Open Data Registry (SRTM/ALOS)',
        });
      }
      if (!map.getTerrain || !map.getTerrain()) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.3 });
      }
      if (!map.getLayer('tour-hillshade')) {
        map.addLayer(
          {
            id: 'tour-hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
              'hillshade-exaggeration': 0.4,
              'hillshade-shadow-color': '#0F172A',
              'hillshade-highlight-color': '#F8FAFC',
              'hillshade-accent-color': '#1E293B',
            },
          },
          map.getLayer(`tour-risk-${RISK_ZONES[0]}`)
            ? `tour-risk-${RISK_ZONES[0]}`
            : beforeBuildings
        );
      }
      if (map.setSky) {
        map.setSky({
          'sky-color': '#88B5DA',
          'horizon-color': '#E8EEF5',
          'fog-color': '#B8C9D8',
          'fog-ground-blend': 0.05,
          'horizon-fog-blend': 0.5,
          'sky-horizon-blend': 0.6,
          'atmosphere-blend': 0.85,
        });
      }

      // Edificios asegurados: footprint OSM real tintado por riesgo, ENCIMA
      // de los edificios grises del basemap. El activo va más opaco.
      if (!map.getSource('insured-buildings')) {
        map.addSource('insured-buildings', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: 'insured-buildings',
          type: 'fill-extrusion',
          source: 'insured-buildings',
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-base': 0,
            'fill-extrusion-height': ['get', 'h'],
            'fill-extrusion-opacity': ['case', ['boolean', ['get', 'active'], false], 0.94, 0.62],
            'fill-extrusion-vertical-gradient': true,
          },
        });
      }
    } catch (err) {
      // Estilo aún no listo del todo — guarda que falla en abierto.
      console.warn('TourSceneLayers: escena no lista todavía', err?.message);
    }

    // Click sobre un edificio asegurado → selecciona la póliza.
    const onBuildingClick = (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.id;
      if (id != null) ref.current.onSelectPolicy?.(String(id));
    };
    const setPointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = '';
    };
    // Re-snap solo cuando la cámara se detiene Y los tiles están cargados:
    // moveend marca pendiente, el siguiente idle (tiles listos) ejecuta. Así
    // los edificios que entran en vista se tintan sin bucle de setData→idle.
    const onMoveEnd = () => {
      ref.current.needsSnap = true;
    };
    const onIdle = () => {
      if (!ref.current.needsSnap) return;
      ref.current.needsSnap = false;
      reSnap();
    };

    map.on('click', 'insured-buildings', onBuildingClick);
    map.on('mouseenter', 'insured-buildings', setPointer);
    map.on('mouseleave', 'insured-buildings', clearPointer);
    map.on('moveend', onMoveEnd);
    map.on('idle', onIdle);
    reSnap(); // primer intento inmediato

    return () => {
      map.off('click', 'insured-buildings', onBuildingClick);
      map.off('mouseenter', 'insured-buildings', setPointer);
      map.off('mouseleave', 'insured-buildings', clearPointer);
      map.off('moveend', onMoveEnd);
      map.off('idle', onIdle);
    };
  }, [map, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2) Re-tinta al cambiar cartera o póliza activa ──────────────────────
  useEffect(() => {
    if (!map || !isLoaded) return;
    const data = snapInsured(map, policies, activeId);
    const src = map.getSource('insured-buildings');
    if (src && data) src.setData(data);
  }, [map, isLoaded, policies, activeId]);

  // ── 3) Botón → muestra/oculta la superficie de riesgo de suelo ──────────
  useEffect(() => {
    if (!map || !isLoaded) return;
    for (const z of RISK_ZONES) {
      if (map.getLayer(`tour-risk-${z}`)) {
        map.setLayoutProperty(`tour-risk-${z}`, 'visibility', floodOn ? 'visible' : 'none');
      }
    }
  }, [map, isLoaded, floodOn]);

  return null;
}
