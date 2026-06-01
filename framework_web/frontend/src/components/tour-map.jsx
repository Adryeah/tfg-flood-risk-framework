import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map, useMap } from './Map.tsx';
import { formatMoney, formatPercent } from '@/lib/format.js';

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

// Índice de planta de la PÓLIZA dentro del edificio.
//   ground_floor=true       → 0 (planta baja)
//   ground_floor=false      → floor_count   (asumimos planta alta = la
//                              última del edificio)
//   product=autos           → 0 (parking)
function policyFloorIdx(policy) {
  if (policy.product === 'autos') return 0;
  if (policy.ground_floor) return 0;
  return Math.max(1, Math.min(policy.floor_count || 1, 12));
}

// Total de plantas del edificio (para dibujar el stack completo de
// discos uno por planta).
function buildingFloors(policy) {
  if (policy.product === 'autos') return 1;
  return Math.max(policyFloorIdx(policy) + 1, policy.floor_count || 1, 1);
}

// Altura en metros (relativa al terreno) de la planta de la póliza.
// 3 m por planta, planta baja = 1 m para que el halo sea visible
// (un disco a altura 0 quedaría enterrado por la calle).
function policyAltitude(policy) {
  if (policy.product === 'autos') return 0.5;
  const f = policyFloorIdx(policy);
  return f === 0 ? 1.2 : f * 3;
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
        zoom={14}
        minZoom={9}
        maxZoom={19}
        pitch={48}
        bearing={-20}
        maxPitch={75}
        className="h-full w-full"
      >
        <TourLayers policies={policies} activeIndex={activeIndex} />
      </Map>

      {/* Panel cinematográfico flotante sobre el mapa con los datos de
       *  la póliza activa. Replica el contenido del strip del dock
       *  pero con tipografía editorial y posicionado bottom-left al
       *  estilo "subtítulo de película". El strip del dock se sigue
       *  viendo en mobile (donde el panel se oculta para no tapar
       *  el mapa pequeño). */}
      <CinematicPanel policy={policies[activeIndex]} index={activeIndex} total={policies.length} />

      {/* Mini-mapa contextual "you are here" — SVG (no MapLibre extra
       *  para no duplicar overhead). Da la sensación de tour orquestado
       *  dentro de la cartera, no de salto aleatorio. Esquina superior
       *  derecha, oculto en mobile. */}
      <MiniMap policies={policies} activeIndex={activeIndex} />
    </div>
  );
}

// ─── Mini-mapa SVG · all policies + active highlighted ───────────
function MiniMap({ policies, activeIndex }) {
  if (!policies || policies.length === 0) return null;
  const W = 168;
  const H = 168;
  const PAD = 14;

  // Bbox de las pólizas
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const p of policies) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  // Si todas las pólizas están en el mismo punto evita división /0
  const lonSpan = Math.max(maxLon - minLon, 0.001);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const project = (lon, lat) => {
    const x = PAD + ((lon - minLon) / lonSpan) * (W - 2 * PAD);
    const y = PAD + ((maxLat - lat) / latSpan) * (H - 2 * PAD);
    return [x, y];
  };

  const active = policies[activeIndex];
  const [ax, ay] = active ? project(active.lon, active.lat) : [W / 2, H / 2];

  return (
    <div
      className="hidden md:block absolute top-3 right-3 z-[600] rounded-md backdrop-blur-md overflow-hidden"
      style={{
        background: 'rgba(15,23,42,0.78)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.32)',
      }}
    >
      <div className="px-2.5 pt-1.5 pb-1 text-9 font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(248,250,252,0.55)' }}>
        Tour map · {activeIndex + 1}/{policies.length}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        {/* Background subtle grid lines */}
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="rgba(255,255,255,0.04)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.04)" />

        {/* Inactive dots */}
        {policies.map((p, i) => {
          if (i === activeIndex) return null;
          const [x, y] = project(p.lon, p.lat);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill={p._color || '#94A3B8'}
              fillOpacity="0.85"
            />
          );
        })}

        {/* Active dot with pulsing ring */}
        {active && (
          <g>
            <circle cx={ax} cy={ay} r="11" fill="none" stroke={active._color || '#FFFFFF'} strokeWidth="1.5" opacity="0.6">
              <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={ax} cy={ay} r="5" fill={active._color || '#FFFFFF'} stroke="#FFFFFF" strokeWidth="2" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── Panel flotante con datos de la póliza activa ────────────────
function CinematicPanel({ policy, index, total }) {
  if (!policy) return null;
  const PRODUCT_LABEL = {
    particulares: 'Particulares',
    pymes: 'Pymes',
    autos: 'Autos',
  };
  const RISK_LABEL = {
    low: 'Bajo',
    moderate: 'Moderado',
    high: 'Alto',
    very_high: 'Muy alto',
  };
  const RISK_TINT = {
    low: '#FBBF24',
    moderate: '#F87171',
    high: '#DC2626',
    very_high: '#7F1D1D',
  };
  const tint = RISK_TINT[policy.risk_category] || '#94A3B8';
  const planta =
    policy.product === 'autos'
      ? 'Parking · planta 0'
      : policy.ground_floor
        ? 'Planta baja'
        : `Planta ${policy.floor_count || 1}.ª de ${(policy.floor_count || 1) + 1}`;
  return (
    <div
      key={index} /* re-mount triggers fade-in animation cleanly */
      className="hidden md:block absolute bottom-5 left-5 z-[600] w-[340px] rounded-md p-4 pt-3.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{
        background: 'rgba(15,23,42,0.78)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset',
        color: '#F8FAFC',
      }}
    >
      {/* Header: nº de póliza dentro del tour + categoría tinte */}
      <div className="flex items-center justify-between mb-2 text-10 font-mono uppercase tracking-[0.16em]" style={{ color: 'rgba(248,250,252,0.55)' }}>
        <span>Póliza {index + 1} de {total}</span>
        <span style={{ color: tint }}>Riesgo {RISK_LABEL[policy.risk_category] || policy.risk_category}</span>
      </div>

      {/* Policy ID grande en mono */}
      <div className="font-mono text-14 mb-0.5 tracking-tight" style={{ color: '#F8FAFC' }}>
        {policy.id}
      </div>
      {/* Producto + subtype + planta en serif italic, "subtítulo de cine" */}
      <div className="font-serif italic text-13 mb-3 leading-snug" style={{ color: 'rgba(248,250,252,0.78)' }}>
        {PRODUCT_LABEL[policy.product] || policy.product}
        {policy.subtype ? ` · ${policy.subtype}` : ''} · {planta}
      </div>

      {/* Grid de 4 metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <PanelMetric label="P(flood)" value={formatPercent(policy.risk_probability, 1)} tint={tint} />
        <PanelMetric label="Asegurado" value={formatMoney(policy.insured_value)} />
        <PanelMetric label="Pérdida est." value={formatMoney(policy.estimated_loss_dana)} tint={tint} />
        <PanelMetric label="Prima anual" value={formatMoney(policy.annual_premium)} />
      </div>
    </div>
  );
}

function PanelMetric({ label, value, tint }) {
  return (
    <div className="min-w-0">
      <div className="text-9 font-mono uppercase tracking-wider mb-0.5" style={{ color: 'rgba(248,250,252,0.5)' }}>
        {label}
      </div>
      <div className="font-mono text-13 truncate" style={{ color: tint || '#F8FAFC', fontWeight: 600 }}>
        {value}
      </div>
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
            // Bajamos opacidad para que el rojo no se trague los
            // edificios ni el contexto del basemap. La saturación
            // boosted se quita por la misma razón: el color del modelo
            // tiene que ser "tinte de calle", no plasta de pintura.
            'raster-opacity': 0.35,
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

    // ─── FLOOR-STACK · 1 disco por cada planta del edificio ────
    //   Visualiza "el edificio en transparencia": una pila de discos
    //   de 0.4 m de grosor a alturas 3, 6, 9, 12 m... La planta de la
    //   póliza se renderiza ABAJO (en policy-halos) con un disco más
    //   grande y brillante. El stack es contexto: "está en el 4º de
    //   un edificio de 8", no solo "está en el 4º".
    if (!map.getSource('policy-floors')) {
      map.addSource('policy-floors', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('policy-floors')) {
      map.addLayer({
        id: 'policy-floors',
        type: 'fill-extrusion',
        source: 'policy-floors',
        paint: {
          'fill-extrusion-color': '#F8FAFC',
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.28,
        },
      });
    }

    // ─── HALO en la planta — fill-extrusion de un círculo mayor,
    // coloreado por categoría de riesgo. base/height vienen del
    // feature, pero se les SUMA una feature-state `liftOffset` que
    // sirve para animar el halo activo desde el suelo hasta su
    // planta cuando aterriza la cámara (efecto "ascensor").
    //   - Halo no activo  → liftOffset = 0 → base/height estáticos
    //   - Halo activo     → liftOffset animado de -altitudPiso → 0
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
          'fill-extrusion-base': [
            '+',
            ['get', 'base'],
            ['coalesce', ['feature-state', 'liftOffset'], 0],
          ],
          'fill-extrusion-height': [
            '+',
            ['get', 'top'],
            ['coalesce', ['feature-state', 'liftOffset'], 0],
          ],
          'fill-extrusion-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            0.88,
            0.32,
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
    const floors = [];     // Stack: 1 disco por cada planta del edificio
    policies.forEach((p, i) => {
      const alt = policyAltitude(p);
      const totalFloors = buildingFloors(p);
      const props = {
        idx: i,
        color: p._color || '#94A3B8',
        category: p.risk_category || 'low',
        product: p.product || 'particulares',
      };

      // Beam vertical desde el suelo hasta la planta de la póliza
      beams.push(
        circleFeature(
          p.lon,
          p.lat,
          0.9,
          { ...props, top: Math.max(alt + 0.4, 2.5) },
          i
        )
      );

      // Halo grande coloreado en la planta exacta de la póliza
      halos.push(
        circleFeature(
          p.lon,
          p.lat,
          4.5,
          {
            ...props,
            base: Math.max(alt - 0.6, 0.2),
            top: alt + 1.0,
          },
          i
        )
      );

      // Anillo en el suelo
      rings.push({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: props,
      });

      // Stack de plantas — uno por cada planta del edificio. Discos
      // finos (0.3 m) blancos semi-transparentes, contexto visual de
      // "cuántas plantas tiene el edificio". El que coincide con la
      // planta de la póliza queda CUBIERTO por el halo coloreado.
      for (let f = 1; f <= totalFloors; f++) {
        const z = f * 3;
        floors.push(
          circleFeature(
            p.lon,
            p.lat,
            3.2,
            { ...props, base: z - 0.15, top: z + 0.15 },
            `${i}-f${f}`
          )
        );
      }
    });
    const update = (sid, features) => {
      const src = map.getSource(sid);
      if (src) src.setData({ type: 'FeatureCollection', features });
    };
    update('policy-beams', beams);
    update('policy-halos', halos);
    update('policy-rings', rings);
    update('policy-floors', floors);
  }, [map, isLoaded, policies]);

  // ─── Active feature-state + flyTo cuando cambia activeIndex ────
  const prevActiveRef = useRef(-1);
  const liftAnimRef = useRef(null);
  useEffect(() => {
    if (!map || !isLoaded || !policies?.length) return;
    const p = policies[activeIndex];
    if (!p) return;

    // Cancelar animación previa de lift si está en curso
    if (liftAnimRef.current != null) {
      cancelAnimationFrame(liftAnimRef.current);
      liftAnimRef.current = null;
    }

    // Limpiar el active anterior, marcar el nuevo
    const SOURCES = ['policy-beams', 'policy-halos', 'policy-rings'];
    if (prevActiveRef.current >= 0 && prevActiveRef.current !== activeIndex) {
      SOURCES.forEach((src) => {
        try {
          map.setFeatureState(
            { source: src, id: prevActiveRef.current },
            { active: false, liftOffset: 0 }
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

    // ─── Animación de "ascenso" del halo activo ────────────────
    // El halo arranca al nivel del suelo y sube hasta su planta
    // exacta en 900 ms. Visualmente lee como "esta póliza está en
    // la planta N" — verlo subir explica mejor la altura que
    // simplemente verlo aparecido arriba.
    const targetAlt = policyAltitude(p);
    const startTime = performance.now();
    const DURATION = 900;
    const startOffset = -targetAlt; // halo comienza en el suelo
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      // ease-out-quart (más dramático que cubic al aterrizar)
      const eased = 1 - Math.pow(1 - t, 4);
      const value = startOffset * (1 - eased);
      try {
        map.setFeatureState(
          { source: 'policy-halos', id: activeIndex },
          { liftOffset: value, active: true }
        );
      } catch {
        /* silent */
      }
      if (t < 1) {
        liftAnimRef.current = requestAnimationFrame(tick);
      } else {
        liftAnimRef.current = null;
      }
    };
    liftAnimRef.current = requestAnimationFrame(tick);

    // Bearing rotado ligeramente por póliza para que no todas las
    // tomas se vean iguales — añade variedad cinematográfica.
    const bearing = -15 + ((activeIndex * 23) % 70) - 35;

    // Pitch + zoom ajustados para que los edificios se vean a escala
    // humana: pitch 58° (no tan tumbado como 65, que aplastaba los
    // edificios visualmente) + zoom 17.2 (ligeramente más lejos para
    // que se vea más contexto urbano alrededor de la póliza).
    map.easeTo({
      center: [p.lon, p.lat],
      zoom: 17.2,
      pitch: 58,
      bearing,
      duration: 1500,
      // ease-out-cubic — empieza rápido, frena suave al aterrizar
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
  }, [map, isLoaded, activeIndex, policies]);

  return null;
}
