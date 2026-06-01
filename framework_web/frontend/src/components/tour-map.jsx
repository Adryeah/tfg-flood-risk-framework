import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { formatMoney, formatPercent } from '@/lib/format.js';

// ─── Vector tile basemap · Google Maps 3D look ───────────────────
// OpenFreeMap "Liberty" style: stack open-source (OpenMapTiles schema)
// con calles, agua, parques, puntos de interés y etiquetas. Sin clave
// API, sin satélite. Es exactamente el look "Google Maps en 3D" que
// pidió el usuario: tonos crema, calles claras, edificios estilizados.
//
// El estilo NO incluye edificios 3D por defecto; los añadimos como
// capa fill-extrusion sobre el source-layer `building` del mismo
// dataset (los polígonos de edificios traen `render_height` cuando OSM
// los tiene tageados).
const BASE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// ─── Mapeo planta / altitud (mismo que la versión Cesium) ────────
function policyFloorIdx(p) {
  if (p.product === 'autos') return 0;
  if (p.ground_floor) return 0;
  return Math.max(1, Math.min(p.floor_count || 1, 12));
}
function buildingFloors(p) {
  if (p.product === 'autos') return 1;
  return Math.max(policyFloorIdx(p) + 1, p.floor_count || 1, 1);
}
function policyAltitude(p) {
  if (p.product === 'autos') return 0.5;
  const f = policyFloorIdx(p);
  return f === 0 ? 1.2 : f * 3;
}

// Aproximación de círculo (polígono N-lados) métrico alrededor de
// (lon, lat). Usado como footprint de las columnas fill-extrusion.
function circleFeature(lon, lat, radiusM, props, id) {
  const N = 18;
  const ring = [];
  const dLat = radiusM / 111111;
  const dLon = radiusM / (111111 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: props,
  };
}

const RISK_HEX = {
  low: '#FBBF24',
  moderate: '#F87171',
  high: '#DC2626',
  very_high: '#7F1D1D',
};

// ─── TourMap principal ───────────────────────────────────────────
export function TourMap({ policies, activeIndex }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const liftRef = useRef(0);
  const liftAnimRef = useRef(null);
  const prevActiveRef = useRef(-1);
  const [ready, setReady] = useState(false);

  // ── Init MapLibre once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initCenter =
      policies && policies[activeIndex]
        ? [policies[activeIndex].lon, policies[activeIndex].lat]
        : [-0.4, 39.42];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: initCenter,
      zoom: 16.5,
      pitch: 55,
      bearing: -15,
      maxPitch: 80,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('load', () => {
      // Edificios 3D extruidos desde el source-layer `building` del
      // mismo dataset. Color crema-grisáceo para mantener el look
      // Google Maps (no edificios de cartón de juguete).
      if (!map.getLayer('buildings-3d')) {
        map.addLayer({
          id: 'buildings-3d',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
              0, '#F1F5F9',  // edificios bajos en blanco roto
              30, '#CBD5E1', // edificios medios en gris medio
              80, '#94A3B8', // rascacielos en gris más oscuro
            ],
            'fill-extrusion-height': [
              'coalesce',
              ['get', 'render_height'],
              ['get', 'height'],
              8,
            ],
            'fill-extrusion-base': [
              'coalesce',
              ['get', 'render_min_height'],
              ['get', 'min_height'],
              0,
            ],
            'fill-extrusion-opacity': [
              'interpolate', ['linear'], ['zoom'],
              14, 0, 15, 0.6, 16.5, 0.9,
            ],
            'fill-extrusion-vertical-gradient': true,
          },
        });
      }

      // Si el estilo trae una capa de edificios 2D plana, la ocultamos
      // para que no compita con la extrusión 3D.
      const flatBuildingLayers = map
        .getStyle()
        .layers.filter(
          (l) => l.id !== 'buildings-3d' && /building/i.test(l.id) && l.type === 'fill'
        );
      flatBuildingLayers.forEach((l) => {
        try {
          map.setLayoutProperty(l.id, 'visibility', 'none');
        } catch {
          /* silent */
        }
      });

      // ─── Sources de pólizas (4 capas) ──────────────────────────
      ['policy-floors', 'policy-beams', 'policy-halos', 'policy-rings'].forEach(
        (sid) => {
          if (!map.getSource(sid)) {
            map.addSource(sid, {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            });
          }
        }
      );

      // Stack de plantas del edificio (discos blancos transparentes
      // por planta — contexto visual de "está en planta N de M").
      map.addLayer({
        id: 'policy-floors',
        type: 'fill-extrusion',
        source: 'policy-floors',
        paint: {
          'fill-extrusion-color': '#FFFFFF',
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.42,
        },
      });

      // Beam blanco (rayo láser) desde el suelo hasta la planta.
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
            0.5,
          ],
        },
      });

      // Halo coloreado por riesgo en la planta exacta. Base/height
      // se suman a un `liftOffset` por feature-state para animar el
      // ascenso del halo activo desde el suelo a su planta.
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
            0.92,
            0.42,
          ],
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // Ring 2D en el suelo (visible a cualquier zoom).
      map.addLayer({
        id: 'policy-rings',
        type: 'circle',
        source: 'policy-rings',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            14,
            6,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'active'], false],
            3,
            1.2,
          ],
          'circle-opacity': 0.95,
          'circle-pitch-alignment': 'map',
        },
      });

      // Sky atmosférico (cielo del horizonte cuando hay pitch alto).
      if (map.setSky) {
        map.setSky({
          'sky-color': '#A7C5E1',
          'horizon-color': '#E8EEF5',
          'fog-color': '#CBD5E1',
          'fog-ground-blend': 0.05,
          'horizon-fog-blend': 0.5,
          'sky-horizon-blend': 0.65,
          'atmosphere-blend': 0.8,
        });
      }

      setReady(true);
    });

    return () => {
      if (liftAnimRef.current != null) {
        cancelAnimationFrame(liftAnimRef.current);
        liftAnimRef.current = null;
      }
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          /* silent */
        }
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reconstruir entidades cuando cambia la lista de pólizas ───
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map || !policies?.length) return;

    const beams = [];
    const halos = [];
    const floors = [];
    const rings = [];
    policies.forEach((p, i) => {
      const alt = policyAltitude(p);
      const totalFloors = buildingFloors(p);
      const color = RISK_HEX[p.risk_category] || '#94A3B8';
      const props = { idx: i, color };

      beams.push(
        circleFeature(p.lon, p.lat, 0.9, { ...props, top: Math.max(alt, 2.5) }, i)
      );
      halos.push(
        circleFeature(
          p.lon,
          p.lat,
          4.2,
          { ...props, base: Math.max(alt - 0.7, 0.2), top: alt + 1.1 },
          i
        )
      );
      rings.push({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: props,
      });
      for (let f = 1; f <= totalFloors; f++) {
        const z = f * 3;
        floors.push(
          circleFeature(
            p.lon,
            p.lat,
            3.1,
            { ...props, base: z - 0.12, top: z + 0.12 },
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
  }, [ready, policies]);

  // ── Camera flyTo + lift animation cuando cambia activeIndex ────
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map || !policies?.length) return;
    const p = policies[activeIndex];
    if (!p) return;

    // Cancelar lift previo
    if (liftAnimRef.current != null) {
      cancelAnimationFrame(liftAnimRef.current);
      liftAnimRef.current = null;
    }

    // Reset feature-state del active anterior
    const SOURCES = ['policy-beams', 'policy-halos', 'policy-rings'];
    if (prevActiveRef.current >= 0 && prevActiveRef.current !== activeIndex) {
      SOURCES.forEach((s) => {
        try {
          map.setFeatureState(
            { source: s, id: prevActiveRef.current },
            { active: false, liftOffset: 0 }
          );
        } catch {
          /* silent */
        }
      });
    }
    SOURCES.forEach((s) => {
      try {
        map.setFeatureState(
          { source: s, id: activeIndex },
          { active: true }
        );
      } catch {
        /* silent */
      }
    });
    prevActiveRef.current = activeIndex;

    // Lift animation del halo: arranca al nivel del suelo y sube
    // hasta la planta de la póliza en 900 ms (ease-out-quart).
    const targetAlt = policyAltitude(p);
    const startOffset = -targetAlt;
    const startTime = performance.now();
    const DURATION = 900;
    liftRef.current = startOffset;
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      liftRef.current = startOffset * (1 - eased);
      try {
        map.setFeatureState(
          { source: 'policy-halos', id: activeIndex },
          { liftOffset: liftRef.current, active: true }
        );
      } catch {
        /* silent */
      }
      if (t < 1) {
        liftAnimRef.current = requestAnimationFrame(tick);
      } else {
        liftRef.current = 0;
        liftAnimRef.current = null;
      }
    };
    liftAnimRef.current = requestAnimationFrame(tick);

    // ── Camera adaptive (zoom + pitch responden a la altura) ────
    //   Planta baja      → zoom 17.4, pitch 60° (drone cercano)
    //   Piso intermedio  → zoom 17.2, pitch 56°
    //   Ático (12 m+)    → zoom 17.0, pitch 50° (más alto, más horizontal)
    const policyAlt = policyAltitude(p);
    const zoomTarget = Math.max(17.0, 17.4 - policyAlt * 0.02);
    const pitchTarget = Math.max(48, 60 - policyAlt * 0.4);
    const headingDeg = -8 + ((activeIndex * 17) % 30) - 15;

    map.easeTo({
      center: [p.lon, p.lat],
      zoom: zoomTarget,
      pitch: pitchTarget,
      bearing: headingDeg,
      duration: 1500,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
  }, [ready, activeIndex, policies]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-base/80 pointer-events-none">
          <div className="text-13 font-mono uppercase tracking-[0.18em] text-text-secondary animate-pulse">
            Cargando escena 3D…
          </div>
        </div>
      )}

      <CinematicPanel
        policy={policies[activeIndex]}
        index={activeIndex}
        total={policies.length}
      />
      <MiniMap policies={policies} activeIndex={activeIndex} />
    </div>
  );
}

// ─── CinematicPanel ──────────────────────────────────────────────
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
      key={index}
      className="hidden md:block absolute bottom-5 left-5 z-[600] w-[340px] rounded-md p-4 pt-3.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{
        background: 'rgba(15,23,42,0.78)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset',
        color: '#F8FAFC',
      }}
    >
      <div
        className="flex items-center justify-between mb-2 text-10 font-mono uppercase tracking-[0.16em]"
        style={{ color: 'rgba(248,250,252,0.55)' }}
      >
        <span>Póliza {index + 1} de {total}</span>
        <span style={{ color: tint }}>
          Riesgo {RISK_LABEL[policy.risk_category] || policy.risk_category}
        </span>
      </div>
      <div
        className="font-mono text-14 mb-0.5 tracking-tight"
        style={{ color: '#F8FAFC' }}
      >
        {policy.id}
      </div>
      <div
        className="font-serif italic text-13 mb-3 leading-snug"
        style={{ color: 'rgba(248,250,252,0.78)' }}
      >
        {PRODUCT_LABEL[policy.product] || policy.product}
        {policy.subtype ? ` · ${policy.subtype}` : ''} · {planta}
      </div>
      <div
        className="grid grid-cols-2 gap-x-3 gap-y-2 pt-3 border-t"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <PanelMetric
          label="P(flood)"
          value={formatPercent(policy.risk_probability, 1)}
          tint={tint}
        />
        <PanelMetric label="Asegurado" value={formatMoney(policy.insured_value)} />
        <PanelMetric
          label="Pérdida est."
          value={formatMoney(policy.estimated_loss_dana)}
          tint={tint}
        />
        <PanelMetric label="Prima anual" value={formatMoney(policy.annual_premium)} />
      </div>
    </div>
  );
}

function PanelMetric({ label, value, tint }) {
  return (
    <div className="min-w-0">
      <div
        className="text-9 font-mono uppercase tracking-wider mb-0.5"
        style={{ color: 'rgba(248,250,252,0.5)' }}
      >
        {label}
      </div>
      <div
        className="font-mono text-13 truncate"
        style={{ color: tint || '#F8FAFC', fontWeight: 600 }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── MiniMap (SVG, sin cambios) ──────────────────────────────────
function MiniMap({ policies, activeIndex }) {
  if (!policies || policies.length === 0) return null;
  const W = 168;
  const H = 168;
  const PAD = 14;

  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const p of policies) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
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
      <div
        className="px-2.5 pt-1.5 pb-1 text-9 font-mono uppercase tracking-[0.18em]"
        style={{ color: 'rgba(248,250,252,0.55)' }}
      >
        Tour map · {activeIndex + 1}/{policies.length}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <line
          x1={W / 2}
          y1="0"
          x2={W / 2}
          y2={H}
          stroke="rgba(255,255,255,0.04)"
        />
        <line
          x1="0"
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke="rgba(255,255,255,0.04)"
        />
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
        {active && (
          <g>
            <circle
              cx={ax}
              cy={ay}
              r="11"
              fill="none"
              stroke={active._color || '#FFFFFF'}
              strokeWidth="1.5"
              opacity="0.6"
            >
              <animate
                attributeName="r"
                values="8;14;8"
                dur="2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.7;0;0.7"
                dur="2s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={ax}
              cy={ay}
              r="5"
              fill={active._color || '#FFFFFF'}
              stroke="#FFFFFF"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
