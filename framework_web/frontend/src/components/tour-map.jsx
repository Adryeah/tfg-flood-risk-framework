import React, { useEffect, useMemo, useRef } from 'react';
import { Map, useMap } from './Map.tsx';

const TERRAIN_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// ─── Geometría auxiliar ──────────────────────────────────────────
// Aproxima un círculo métrico (radiusM) alrededor de (lon, lat) como
// un polígono de N lados. Lo usamos como footprint de las columnas
// fill-extrusion del beam, halo y disco.
function circleFeature(lon, lat, radiusM, props, id) {
  const N = 18;
  const ring = [];
  const dLat = radiusM / 111111;
  const dLon = radiusM / (111111 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: props,
  };
}

// Altura "razonable" para representar la planta de una póliza, en
// metros sobre el terreno. Aproximación didáctica (las pólizas son
// sintéticas; ver cap. 4 de la memoria). Cada planta vale 3 m, planta
// baja = 0 m, autos en parking ≈ 0.5 m.
function policyAltitude(policy) {
  if (policy.product === 'autos') return 0.5;
  if (policy.ground_floor) return 1; // 1 m de altura para que el halo sea visible
  const f = Math.max(1, Math.min(policy.floor_count || 1, 12));
  return f * 3;
}

export function TourMap({ policies, activeIndex }) {
  // Centro inicial = póliza activa, para que la cámara aterrice ya en
  // sitio sin necesidad de un fitBounds inicial.
  const initialCenter = useMemo(() => {
    const p = policies?.[activeIndex];
    return p ? [p.lon, p.lat] : [-0.4, 39.42];
  }, [policies, activeIndex]);

  return (
    <div className="absolute inset-0">
      <Map
        center={initialCenter}
        zoom={16.5}
        minZoom={9}
        maxZoom={19}
        pitch={55}
        bearing={-25}
        maxPitch={75}
        className="h-full w-full"
      >
        <TourLayers policies={policies} activeIndex={activeIndex} />
      </Map>
    </div>
  );
}

function TourLayers({ policies, activeIndex }) {
  const { map, isLoaded } = useMap();

  // ─── Setup escena 3D: terreno + sky + risk-as-street + edificios ────
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Terrain DEM (AWS Terrarium, igual que en Overview 3D)
    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 14,
      });
    }
    if (!map.getTerrain || !map.getTerrain()) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 });
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

    // Risk-as-street: raster tiles del modelo tendidos sobre el terreno
    // como si fuera el color del asfalto. Saturación boosted para que
    // se distinga sobre el basemap CARTO oscuro.
    for (const zone of ['valencia', 'algemesi']) {
      const sid = `risk-street-${zone}`;
      if (!map.getSource(sid)) {
        map.addSource(sid, {
          type: 'raster',
          tiles: [`${API_BASE}/api/tiles/${zone}/{z}/{x}/{y}.png`],
          tileSize: 256,
          minzoom: 10,
          maxzoom: 15,
        });
        map.addLayer({
          id: sid,
          type: 'raster',
          source: sid,
          paint: {
            'raster-opacity': 0.6,
            'raster-saturation': 0.3,
            'raster-resampling': 'linear',
          },
        });
      }
    }

    // Edificios 3D (OpenFreeMap, render_height de OSM). Renderizamos
    // ENCIMA del risk raster para que los bloques destaquen y el
    // riesgo se vea entre/bajo ellos como "la calle coloreada".
    if (!map.getSource('openfreemap')) {
      map.addSource('openfreemap', {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      });
    }
    if (!map.getLayer('buildings-3d')) {
      map.addLayer({
        id: 'buildings-3d',
        source: 'openfreemap',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 11,
        paint: {
          'fill-extrusion-color': [
            'case',
            ['has', 'colour'],
            ['get', 'colour'],
            '#94A3B8',
          ],
          'fill-extrusion-height': [
            'coalesce',
            ['get', 'render_height'],
            ['get', 'height'],
            12,
          ],
          'fill-extrusion-base': [
            'coalesce',
            ['get', 'render_min_height'],
            ['get', 'min_height'],
            0,
          ],
          'fill-extrusion-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            0,
            12.5,
            0.7,
            15,
            0.92,
          ],
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }

    // ─── BEAM blanco (rayo láser) — desde el suelo hasta la altura
    // de la planta. Layer es fill-extrusion sobre un círculo de
    // ~1.2 m de radio. Cuando la feature está activa cambia el color.
    if (!map.getSource('policy-beams')) {
      map.addSource('policy-beams', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('policy-beams')) {
      map.addLayer({
        id: 'policy-beams',
        type: 'fill-extrusion',
        source: 'policy-beams',
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            '#FFFFFF',
            '#E2E8F0',
          ],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            0.95,
            0.45,
          ],
        },
      });
    }

    // ─── HALO en la planta — fill-extrusion de un círculo mayor,
    // entre base = altPiso - 0.75 y top = altPiso + 1.5. Color por
    // categoría de riesgo. Activa: más opaco.
    if (!map.getSource('policy-halos')) {
      map.addSource('policy-halos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('policy-halos')) {
      map.addLayer({
        id: 'policy-halos',
        type: 'fill-extrusion',
        source: 'policy-halos',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            0.85,
            0.4,
          ],
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }

    // ─── RING en el suelo — circle 2D para que la póliza siga siendo
    // visible cuando la cámara está alejada y los beams se ven finos.
    if (!map.getSource('policy-rings')) {
      map.addSource('policy-rings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('policy-rings')) {
      map.addLayer({
        id: 'policy-rings',
        type: 'circle',
        source: 'policy-rings',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            12,
            5,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            2.5,
            1.2,
          ],
          'circle-opacity': 0.92,
          'circle-pitch-alignment': 'map',
        },
      });
    }
  }, [map, isLoaded]);

  // ─── Reconstruir features cuando cambia la lista de pólizas ────
  useEffect(() => {
    if (!map || !isLoaded || !policies?.length) return;
    const beams = [];
    const halos = [];
    const rings = [];
    policies.forEach((p, i) => {
      const alt = policyAltitude(p);
      const props = {
        idx: i,
        color: p._color || '#94A3B8',
        category: p.risk_category || 'low',
        product: p.product || 'particulares',
      };
      beams.push(
        circleFeature(p.lon, p.lat, 1.0, { ...props, top: Math.max(alt, 2) }, i)
      );
      halos.push(
        circleFeature(
          p.lon,
          p.lat,
          3.5,
          { ...props, base: Math.max(alt - 0.75, 0), top: alt + 1.5 },
          i
        )
      );
      rings.push({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: props,
      });
    });
    const update = (sid, features) => {
      const src = map.getSource(sid);
      if (src) src.setData({ type: 'FeatureCollection', features });
    };
    update('policy-beams', beams);
    update('policy-halos', halos);
    update('policy-rings', rings);
  }, [map, isLoaded, policies]);

  // ─── Active feature-state + flyTo cuando cambia activeIndex ────
  const prevActiveRef = useRef(-1);
  useEffect(() => {
    if (!map || !isLoaded || !policies?.length) return;
    const p = policies[activeIndex];
    if (!p) return;

    // Limpiar el active anterior, marcar el nuevo
    const SOURCES = ['policy-beams', 'policy-halos', 'policy-rings'];
    if (prevActiveRef.current >= 0 && prevActiveRef.current !== activeIndex) {
      SOURCES.forEach((src) => {
        try {
          map.setFeatureState(
            { source: src, id: prevActiveRef.current },
            { active: false }
          );
        } catch {
          /* silent */
        }
      });
    }
    SOURCES.forEach((src) => {
      try {
        map.setFeatureState({ source: src, id: activeIndex }, { active: true });
      } catch {
        /* silent */
      }
    });
    prevActiveRef.current = activeIndex;

    // Bearing rotado ligeramente por póliza para que no todas las
    // tomas se vean iguales — añade variedad cinematográfica.
    const bearing = -15 + ((activeIndex * 23) % 70) - 35;

    map.easeTo({
      center: [p.lon, p.lat],
      zoom: 17.6,
      pitch: 65,
      bearing,
      duration: 1500,
      // ease-out-cubic — empieza rápido, frena suave al aterrizar
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
  }, [map, isLoaded, activeIndex, policies]);

  return null;
}
