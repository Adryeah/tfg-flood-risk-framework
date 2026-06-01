import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, ColumnLayer } from '@deck.gl/layers';
// _TerrainExtension viene con prefijo underscore en deck.gl 9.x
// porque es experimental. Lo aliasamos para que el resto del código
// se lea limpio.
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
import { FlyToInterpolator } from '@deck.gl/core';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';

import { formatMoney, formatPercent } from '@/lib/format.js';

// ─── Google Photorealistic 3D Tiles ──────────────────────────────
//
// Es la base fotogramétrica REAL que Google publica para más de 2.500
// ciudades del mundo, incluida toda Valencia metropolitana. Renderiza
// fachadas, tejados, balcones, persianas reales — no extrusiones.
// Lo usan CARTO con deck.gl, GeoFlood Studio (NYU) y Google Earth
// Studio. Es el "Hollywood-grade" del análisis de cartera.
//
// La API key se carga de VITE_GOOGLE_MAPS_API_KEY al build. Sin key
// el Tile3DLayer no carga — fallback a un mapa MapLibre con OSM
// queda como TODO (ahora preferimos fallar rápido con mensaje claro).
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const GOOGLE_3D_URL = GOOGLE_KEY
  ? `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`
  : null;

// ─── Mapeo planta / altitud (Z-axis logic) ───────────────────────
// Convierte el subtype textual en metros sobre el suelo, que es lo
// que TerrainExtension('offset') usa para colocar el marker a la
// altura correcta del piso del cliente.
function policyFloorIdx(p) {
  if (p.product === 'autos') return 0;
  if (p.ground_floor) return 0;
  return Math.max(1, Math.min(p.floor_count || 1, 12));
}
function policyAltitude(p) {
  if (p.product === 'autos') return 0; // pavimento
  if (p.subtype === 'comercio' || p.subtype === 'nave') return 0.5;
  const f = policyFloorIdx(p);
  return f === 0 ? 1.2 : f * 3; // 3 m por planta — TerrainExtension
                                  // SUMA esto a la cota real del DEM
                                  // de las 3D Tiles, así que la altitud
                                  // queda anclada al edificio real.
}
function buildingFloors(p) {
  if (p.product === 'autos') return 1;
  return Math.max(policyFloorIdx(p) + 1, p.floor_count || 1, 1);
}

// ─── Descripción rica de la póliza (para el panel) ───────────────
function describePolicy(p) {
  const SUBTYPE_LABEL = {
    chalet: 'Chalet unifamiliar',
    casa: 'Vivienda unifamiliar',
    piso_alto: 'Vivienda en altura',
    piso_bajo: 'Vivienda en planta baja',
    piso: 'Vivienda',
    comercio: 'Local comercial',
    oficina: 'Oficina',
    nave: 'Nave industrial',
    coche: 'Vehículo · turismo',
    moto: 'Vehículo · motocicleta',
    furgoneta: 'Vehículo · furgoneta',
  };
  return SUBTYPE_LABEL[p.subtype] || p.subtype || p.product;
}
function locationText(p) {
  if (p.product === 'autos') return 'Aparcamiento a pie de calle';
  if (p.subtype === 'nave') return 'Local industrial · planta baja';
  if (p.subtype === 'comercio') return 'Local a pie de calle · planta baja';
  if (p.ground_floor) {
    const n = p.floor_count || 1;
    return n > 1 ? `Planta baja · edificio de ${n} alturas` : 'Planta baja';
  }
  const f = p.floor_count || 1;
  return `Planta ${f}.ª · ático del edificio (${f + 1} plantas)`;
}

// ─── Color RGB por categoría de riesgo ───────────────────────────
// deck.gl quiere arrays [r, g, b, a] en 0–255.
function colorRGBA(category, alpha = 220) {
  const RGB = {
    low: [251, 191, 36],
    moderate: [248, 113, 113],
    high: [220, 38, 38],
    very_high: [127, 29, 29],
  };
  return [...(RGB[category] || [148, 163, 184]), alpha];
}

// ─── Bearing rotado por póliza (variedad cinematográfica) ───────
function bearingFor(idx) {
  return 35 + ((idx * 17) % 70) - 35;
}

// ─── TourMap principal ──────────────────────────────────────────
export function TourMap({ policies, activeIndex }) {
  const liftStartRef = useRef(performance.now());
  const [liftT, setLiftT] = useState(1);
  const prevActiveRef = useRef(-1);

  // Re-lanzar animación de "ascenso" del halo cuando cambia el activo
  useEffect(() => {
    if (activeIndex === prevActiveRef.current) return;
    prevActiveRef.current = activeIndex;
    liftStartRef.current = performance.now();
    setLiftT(0);
    let id;
    const tick = (now) => {
      const dt = (now - liftStartRef.current) / 900;
      const t = Math.min(dt, 1);
      setLiftT(1 - Math.pow(1 - t, 4)); // ease-out-quart
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [activeIndex]);

  // ── Camera view state (DeckGL controla la cámara via React) ──
  const activePolicy = policies?.[activeIndex];
  const viewState = useMemo(() => {
    const p = activePolicy;
    if (!p) {
      return {
        longitude: -0.4,
        latitude: 39.42,
        zoom: 15,
        pitch: 55,
        bearing: 0,
      };
    }
    const policyAlt = policyAltitude(p);
    // Cámara adaptativa a la planta (igual que la versión anterior):
    //   - planta baja  → zoom 17.4 · pitch 60° (drone cercano)
    //   - ático        → zoom 17.0 · pitch 50° (más alto, más horizontal)
    return {
      longitude: p.lon,
      latitude: p.lat,
      zoom: Math.max(17.0, 17.4 - policyAlt * 0.02),
      pitch: Math.max(48, 60 - policyAlt * 0.4),
      bearing: bearingFor(activeIndex),
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
    };
  }, [activePolicy, activeIndex]);

  // ── Layers ────────────────────────────────────────────────────
  const layers = useMemo(() => {
    if (!policies?.length) return [];

    const activePol = policies[activeIndex];
    const activeAlt = activePol ? policyAltitude(activePol) : 0;
    // El offset de "ascenso" se aplica SOLO al halo activo. Empieza
    // en -activeAlt (a ras de suelo) y termina en 0 (en su planta).
    const liftOffset = -activeAlt * (1 - liftT);

    const layers = [];

    // Google Photorealistic 3D Tiles — solo si hay API key.
    if (GOOGLE_3D_URL) {
      layers.push(
        new Tile3DLayer({
          id: 'google-photorealistic-3d',
          data: GOOGLE_3D_URL,
          loader: Tiles3DLoader,
          // Sin este flag los tiles del horizonte no se cargan en
          // ángulos altos de pitch.
          loadOptions: { fetch: { mode: 'cors' } },
          operation: 'terrain+draw',
        })
      );
    }

    // Ring 2D en el suelo · clamp al terreno real de las tiles 3D.
    layers.push(
      new ScatterplotLayer({
        id: 'policy-rings',
        data: policies,
        getPosition: (d) => [d.lon, d.lat, 0],
        getRadius: (d, { index }) => (index === activeIndex ? 8 : 4),
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        getFillColor: (d, { index }) =>
          colorRGBA(d.risk_category, index === activeIndex ? 240 : 160),
        stroked: true,
        getLineColor: [248, 250, 252, 240],
        getLineWidth: (d, { index }) => (index === activeIndex ? 1.5 : 0.7),
        lineWidthUnits: 'meters',
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'drape', // se pegan al suelo de las 3D Tiles
        pickable: true,
        updateTriggers: { getRadius: activeIndex, getFillColor: activeIndex, getLineWidth: activeIndex },
      })
    );

    // Beam blanco vertical · ColumnLayer extruded desde el suelo
    // hasta la planta de la póliza. Las pólizas non-edificio
    // (autos, nave, comercio) NO necesitan beam.
    const beamData = policies.map((p, i) => ({
      ...p,
      _i: i,
      _isActive: i === activeIndex,
      _hasBeam: p.product !== 'autos' && p.subtype !== 'nave' && p.subtype !== 'comercio',
    }));
    layers.push(
      new ColumnLayer({
        id: 'policy-beams',
        data: beamData.filter((d) => d._hasBeam),
        getPosition: (d) => [d.lon, d.lat, 0],
        diskResolution: 14,
        radius: 0.8,
        radiusUnits: 'meters',
        extruded: true,
        getElevation: (d) => policyAltitude(d),
        getFillColor: (d) =>
          d._isActive ? [255, 255, 255, 230] : [226, 232, 240, 120],
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
        updateTriggers: { getFillColor: activeIndex },
      })
    );

    // Halo coloreado en la planta de la póliza. El activo se anima
    // (sube desde el suelo a su altura) vía liftOffset.
    layers.push(
      new ColumnLayer({
        id: 'policy-halos',
        data: policies,
        getPosition: (d, { index }) => {
          const baseAlt = policyAltitude(d);
          const z = index === activeIndex ? baseAlt + liftOffset : baseAlt;
          return [d.lon, d.lat, z];
        },
        diskResolution: 26,
        getElevation: (d) => {
          if (d.product === 'autos') return 1.2;
          if (d.subtype === 'nave') return 5;
          if (d.subtype === 'comercio') return 3.2;
          return 1.0;
        },
        getLineColor: [248, 250, 252, 255],
        getRadius: (d) => {
          if (d.subtype === 'nave') return 7.5;
          if (d.subtype === 'comercio') return 4.2;
          if (d.product === 'autos') return 2.2;
          return 4.0;
        },
        radiusUnits: 'meters',
        extruded: true,
        getFillColor: (d, { index }) =>
          colorRGBA(d.risk_category, index === activeIndex ? 230 : 100),
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
        updateTriggers: {
          getPosition: [activeIndex, liftT],
          getFillColor: activeIndex,
        },
      })
    );

    // Floor stack — discos blancos por planta del edificio (solo
    // para productos con plantas reales).
    const stackData = [];
    policies.forEach((p, i) => {
      if (p.product === 'autos' || p.subtype === 'nave' || p.subtype === 'comercio') return;
      const total = buildingFloors(p);
      for (let f = 1; f <= total; f++) {
        stackData.push({ ...p, _i: i, _floor: f, _z: f * 3 });
      }
    });
    layers.push(
      new ColumnLayer({
        id: 'policy-floor-stack',
        data: stackData,
        getPosition: (d) => [d.lon, d.lat, d._z - 0.1],
        diskResolution: 14,
        radius: 3,
        radiusUnits: 'meters',
        extruded: true,
        getElevation: 0.2,
        getFillColor: [248, 250, 252, 90],
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
      })
    );

    return layers;
  }, [policies, activeIndex, liftT]);

  // ── Render ───────────────────────────────────────────────────
  if (!GOOGLE_3D_URL) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-base p-6 text-center">
        <div>
          <div className="text-13 text-risk-high font-semibold mb-2">
            Falta la API key de Google Maps Platform
          </div>
          <div className="text-12 text-text-secondary max-w-md mx-auto leading-relaxed">
            Esta vista usa Google Photorealistic 3D Tiles (CARTO + deck.gl
            stack). Crea un proyecto en console.cloud.google.com, activa la
            <code className="font-mono mx-1">Map Tiles API</code>, genera
            una API key y añádela como variable de entorno{' '}
            <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> en
            Vercel + tu .env.local.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={layers}
        style={{ position: 'absolute', inset: 0 }}
      />

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
  const description = describePolicy(policy);
  const location = locationText(policy);
  const year = policy.construction_year;
  return (
    <div
      key={index}
      className="hidden md:block absolute bottom-5 left-5 z-[600] w-[360px] rounded-md p-4 pt-3.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{
        background: 'rgba(15,23,42,0.80)',
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
      <div className="font-mono text-14 mb-0.5 tracking-tight" style={{ color: '#F8FAFC' }}>
        {policy.id}
      </div>
      <div className="font-serif italic text-15 leading-snug mb-0.5" style={{ color: '#F8FAFC' }}>
        {description}
      </div>
      <div className="text-12 leading-snug mb-1" style={{ color: 'rgba(248,250,252,0.72)' }}>
        {location}
      </div>
      <div className="text-10 font-mono uppercase tracking-wider mb-3" style={{ color: 'rgba(248,250,252,0.45)' }}>
        {year ? `Construido ${year} · ` : ''}
        {policy.lat?.toFixed(4)}, {policy.lon?.toFixed(4)}
      </div>
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

// ─── MiniMap (sin cambios) ───────────────────────────────────────
function MiniMap({ policies, activeIndex }) {
  if (!policies || policies.length === 0) return null;
  const W = 168, H = 168, PAD = 14;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
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
      <div className="px-2.5 pt-1.5 pb-1 text-9 font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(248,250,252,0.55)' }}>
        Tour map · {activeIndex + 1}/{policies.length}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="rgba(255,255,255,0.04)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.04)" />
        {policies.map((p, i) => {
          if (i === activeIndex) return null;
          const [x, y] = project(p.lon, p.lat);
          return (
            <circle key={i} cx={x} cy={y} r={2.5} fill={p._color || '#94A3B8'} fillOpacity="0.85" />
          );
        })}
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
