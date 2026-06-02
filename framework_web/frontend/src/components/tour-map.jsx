import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, ColumnLayer } from '@deck.gl/layers';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
import { FlyToInterpolator } from '@deck.gl/core';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import { GLTFLoader } from '@loaders.gl/gltf';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { formatMoney, formatPercent } from '@/lib/format.js';

// ─── Setup gratuito por defecto, premium con API key ──────────────
//
// Modo GRATIS (sin ninguna key):
//   Basemap: OpenFreeMap Liberty (vector tiles, sin clave)
//   Edificios 3D: extrusión OSM via fill-extrusion del propio estilo
//   Pólizas: marcadores deck.gl encima
//
// Modo PREMIUM (con VITE_GOOGLE_MAPS_API_KEY):
//   Basemap: Google Photorealistic 3D Tiles (Tile3DLayer)
//   Edificios: fotogramétricos reales
//   Pólizas: igual encima
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const HAS_GOOGLE = Boolean(GOOGLE_KEY);
const GOOGLE_3D_URL = HAS_GOOGLE
  ? `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`
  : null;
const FREE_BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// ─── Z-axis logic ───────────────────────────────────────────────
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
  if (p.product === 'autos') return 0;
  if (p.subtype === 'comercio' || p.subtype === 'nave') return 0.5;
  const f = policyFloorIdx(p);
  return f === 0 ? 1.2 : f * 3;
}

// ─── Descripción rica ──────────────────────────────────────────
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

// ─── Paleta · azul para no-activos, color de riesgo para activos
// El cambio del enfoque visual: el color de riesgo se reserva para
// LA póliza que estás inspeccionando ahora; el resto son data points
// azules que invitan a click. Estilo Bloomberg "every dot is data".
const BLUE_BASE = [56, 189, 248, 200]; // sky-400
const BLUE_HOVER = [125, 211, 252, 240]; // sky-300
function riskRGBA(category, alpha = 240) {
  const RGB = {
    low: [251, 191, 36],
    moderate: [248, 113, 113],
    high: [220, 38, 38],
    very_high: [127, 29, 29],
  };
  return [...(RGB[category] || [148, 163, 184]), alpha];
}

function bearingFor(idx) {
  return 35 + ((idx * 17) % 70) - 35;
}

// ─── GLB asset URLs ─────────────────────────────────────────────
// Modelos PBR auto-contenidos del repositorio Khronos glTF Sample
// Assets. Self-contained binary (textures embebidas) → un solo fetch
// + CORS abierto desde raw.githubusercontent.com.
//
// ToyCar es una digitalización fotogramétrica real de un Cadillac de
// juguete (Microsoft Maquette). En geometría tiny (~0.06 m de largo);
// escalamos ~80x para ocupar ~5 m en mapa → tamaño realista de turismo.
const CAR_GLB_URL =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb';

// Yaw determinista por póliza: coches "aparcados" en orientaciones
// distintas para que el conjunto no parezca un copy-paste. 360°
// porque autos pueden ir en cualquier dirección.
function carYawFor(p, idx) {
  const seed = (idx * 53 + (p.lat * 1e4) | 0) >>> 0;
  return seed % 360;
}

// ─── TourMap principal ──────────────────────────────────────────
export function TourMap({ policies, activeIndex, onSelectPolicy }) {
  const liftStartRef = useRef(performance.now());
  const [liftT, setLiftT] = useState(1);
  const [pulseT, setPulseT] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const prevActiveRef = useRef(-1);
  const mapContainerRef = useRef(null);
  const mapLibreRef = useRef(null);

  // ViewState compartida entre DeckGL y MapLibre. DeckGL la actualiza
  // durante las transiciones via onViewStateChange; sincronizamos al
  // basemap MapLibre con .jumpTo() en cada cambio para que la base
  // siga la cámara sin sacudidas (cuando deck.gl es controlled, los
  // intermediate viewStates fluyen a través del callback).
  const initialVS = useMemo(() => {
    const p = policies?.[activeIndex];
    return p
      ? { longitude: p.lon, latitude: p.lat, zoom: 16.5, pitch: 55, bearing: 0 }
      : { longitude: -0.4, latitude: 39.42, zoom: 15, pitch: 55, bearing: 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [viewState, setViewState] = useState(initialVS);

  // ── Animación de "ascenso" del halo al cambiar póliza ──────────
  useEffect(() => {
    if (activeIndex === prevActiveRef.current) return;
    prevActiveRef.current = activeIndex;
    liftStartRef.current = performance.now();
    setLiftT(0);
    let id;
    const tick = (now) => {
      const t = Math.min((now - liftStartRef.current) / 900, 1);
      setLiftT(1 - Math.pow(1 - t, 4));
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [activeIndex]);

  // ── Pulso permanente del activo (radio oscila ±3 m cada 2s) ────
  useEffect(() => {
    let id;
    const tick = () => {
      setPulseT(performance.now() * 0.001);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Lanzar transición de cámara al cambiar póliza ───────────────
  const activePolicy = policies?.[activeIndex];
  useEffect(() => {
    const p = activePolicy;
    if (!p) return;
    const policyAlt = policyAltitude(p);
    setViewState({
      longitude: p.lon,
      latitude: p.lat,
      zoom: Math.max(17.0, 17.4 - policyAlt * 0.02),
      pitch: Math.max(48, 60 - policyAlt * 0.4),
      bearing: bearingFor(activeIndex),
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
    });
  }, [activePolicy, activeIndex]);

  // ── Init MapLibre basemap (solo en modo free) ──────────────────
  useEffect(() => {
    if (HAS_GOOGLE) return;
    if (!mapContainerRef.current || mapLibreRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: FREE_BASEMAP_STYLE,
      center: [initialVS.longitude, initialVS.latitude],
      zoom: initialVS.zoom,
      pitch: initialVS.pitch,
      bearing: initialVS.bearing,
      // No interactive: deck.gl maneja todos los inputs encima.
      interactive: false,
      attributionControl: { compact: true },
    });
    mapLibreRef.current = map;
    return () => {
      try {
        map.remove();
      } catch {
        /* silent */
      }
      mapLibreRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync MapLibre basemap a viewState (con cada tick deck.gl) ──
  useEffect(() => {
    if (HAS_GOOGLE) return;
    const map = mapLibreRef.current;
    if (!map) return;
    try {
      map.jumpTo({
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing,
      });
    } catch {
      /* silent — puede pasar durante el dispose */
    }
  }, [viewState]);

  // ── Layers ────────────────────────────────────────────────────
  const layers = useMemo(() => {
    if (!policies?.length) return [];
    const activePol = policies[activeIndex];
    const activeAlt = activePol ? policyAltitude(activePol) : 0;
    const liftOffset = -activeAlt * (1 - liftT);
    // Pulso del radio del ring activo (sinusoidal entre 8 y 14)
    const pulseRadius = 8 + Math.sin(pulseT * Math.PI) * 3;

    const layers = [];

    if (GOOGLE_3D_URL) {
      layers.push(
        new Tile3DLayer({
          id: 'google-photorealistic-3d',
          data: GOOGLE_3D_URL,
          loader: Tiles3DLoader,
          loadOptions: { fetch: { mode: 'cors' } },
          operation: 'terrain+draw',
        })
      );
    }

    // ─── Rings 2D · interactivos + animados ─────────────────────
    layers.push(
      new ScatterplotLayer({
        id: 'policy-rings',
        data: policies,
        getPosition: (d) => [d.lon, d.lat, 0],
        getRadius: (d, { index }) => {
          if (index === activeIndex) return pulseRadius;
          if (index === hoverIdx) return 6;
          return 4;
        },
        radiusUnits: 'meters',
        radiusMinPixels: 5,
        getFillColor: (d, { index }) => {
          if (index === activeIndex) return riskRGBA(d.risk_category, 250);
          if (index === hoverIdx) return BLUE_HOVER;
          return BLUE_BASE;
        },
        stroked: true,
        getLineColor: [248, 250, 252, 240],
        getLineWidth: (d, { index }) => (index === activeIndex ? 1.8 : 0.6),
        lineWidthUnits: 'meters',
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'drape',
        pickable: true,
        autoHighlight: true,
        onClick: (info) => {
          if (info.index >= 0 && onSelectPolicy) {
            onSelectPolicy(info.index);
          }
        },
        onHover: (info) => {
          setHoverIdx(info.index >= 0 ? info.index : -1);
        },
        updateTriggers: {
          getRadius: [activeIndex, hoverIdx, pulseRadius],
          getFillColor: [activeIndex, hoverIdx],
          getLineWidth: activeIndex,
        },
      })
    );

    // ─── Beams (rayos verticales) ────────────────────────────────
    const beamData = policies
      .map((p, i) => ({ ...p, _i: i, _isActive: i === activeIndex, _isHover: i === hoverIdx }))
      .filter(
        (d) =>
          d.product !== 'autos' && d.subtype !== 'nave' && d.subtype !== 'comercio'
      );
    layers.push(
      new ColumnLayer({
        id: 'policy-beams',
        data: beamData,
        getPosition: (d) => [d.lon, d.lat, 0],
        diskResolution: 14,
        radius: 0.7,
        radiusUnits: 'meters',
        extruded: true,
        getElevation: (d) => policyAltitude(d),
        getFillColor: (d) => {
          if (d._isActive) return [255, 255, 255, 230];
          if (d._isHover) return [...BLUE_HOVER];
          return [...BLUE_BASE.slice(0, 3), 90];
        },
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
        updateTriggers: { getFillColor: [activeIndex, hoverIdx] },
      })
    );

    // ─── Coches · GLB real (ScenegraphLayer + ToyCar) ───────────
    // Sustituye al halo cilíndrico genérico que teníamos para autos.
    // Modelo PBR del repo Khronos, cargado vía GLTFLoader, alineado
    // al suelo real vía TerrainExtension('offset'). sizeScale 80x
    // porque ToyCar mide ~5 cm en model space → ~4 m en mapa. El
    // tint del riesgo se aplica vía getColor (modula la BaseColor del
    // PBR). El activo se tinta blanco y se eleva con liftOffset.
    const carsData = policies
      .map((p, i) => ({ ...p, _i: i }))
      .filter((p) => p.product === 'autos');
    if (carsData.length) {
      layers.push(
        new ScenegraphLayer({
          id: 'policy-cars-gltf',
          data: carsData,
          scenegraph: CAR_GLB_URL,
          loaders: [GLTFLoader],
          _lighting: 'pbr',
          getPosition: (d) => {
            const z = d._i === activeIndex ? 0.4 + liftOffset : 0.4;
            return [d.lon, d.lat, z];
          },
          getOrientation: (d) => [0, carYawFor(d, d._i), 90],
          getColor: (d) => {
            if (d._i === activeIndex) return [255, 255, 255, 255];
            if (d._i === hoverIdx) return [...BLUE_HOVER];
            return [...BLUE_BASE.slice(0, 3), 220];
          },
          sizeScale: 80,
          sizeMinPixels: 6,
          sizeMaxPixels: 90,
          extensions: [new TerrainExtension()],
          terrainDrawMode: 'offset',
          pickable: true,
          onClick: (info) => {
            if (info.object && onSelectPolicy) onSelectPolicy(info.object._i);
          },
          onHover: (info) => {
            setHoverIdx(info.object ? info.object._i : -1);
          },
          updateTriggers: {
            getPosition: [activeIndex, liftT],
            getColor: [activeIndex, hoverIdx],
          },
        })
      );
    }

    // ─── Halos ───────────────────────────────────────────────────
    // Solo no-autos: los coches ya tienen su propio GLB arriba. Los
    // halos siguen sirviendo para apartamentos, locales y naves.
    const haloData = policies
      .map((p, i) => ({ ...p, _i: i }))
      .filter((p) => p.product !== 'autos');
    layers.push(
      new ColumnLayer({
        id: 'policy-halos',
        data: haloData,
        getPosition: (d) => {
          const baseAlt = policyAltitude(d);
          const z = d._i === activeIndex ? baseAlt + liftOffset : baseAlt;
          return [d.lon, d.lat, z];
        },
        diskResolution: 26,
        getElevation: (d) => {
          if (d.subtype === 'nave') return 5;
          if (d.subtype === 'comercio') return 3.2;
          return 1.0;
        },
        getRadius: (d) => {
          if (d.subtype === 'nave') return 7.5;
          if (d.subtype === 'comercio') return 4.2;
          return 4.0;
        },
        radiusUnits: 'meters',
        extruded: true,
        getFillColor: (d) => {
          if (d._i === activeIndex) return riskRGBA(d.risk_category, 230);
          if (d._i === hoverIdx) return [...BLUE_HOVER.slice(0, 3), 180];
          return [...BLUE_BASE.slice(0, 3), 90];
        },
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
        updateTriggers: {
          getPosition: [activeIndex, liftT],
          getFillColor: [activeIndex, hoverIdx],
        },
      })
    );

    // ─── Floor stack ─────────────────────────────────────────────
    const stackData = [];
    policies.forEach((p, i) => {
      if (p.product === 'autos' || p.subtype === 'nave' || p.subtype === 'comercio')
        return;
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
        getFillColor: [248, 250, 252, 85],
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'offset',
      })
    );

    return layers;
  }, [policies, activeIndex, liftT, pulseT, hoverIdx, onSelectPolicy]);

  return (
    <div className="absolute inset-0">
      {/* Basemap detrás (sibling, no child de DeckGL). Solo en modo
       *  free; en modo premium el Tile3DLayer de Google sustituye la
       *  base. interactive: false → todos los inputs los maneja DeckGL
       *  encima, así no compiten por el pan/zoom. */}
      {!HAS_GOOGLE && (
        <div
          ref={mapContainerRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        />
      )}

      <DeckGL
        viewState={viewState}
        onViewStateChange={(e) => setViewState(e.viewState)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering, isDragging }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Badge de modo (esquina inferior derecha) */}
      <div
        className="hidden md:flex absolute bottom-5 right-5 z-[600] items-center gap-2 px-2.5 py-1.5 rounded-sm backdrop-blur-md"
        style={{
          background: 'rgba(15,23,42,0.78)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(248,250,252,0.7)',
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: HAS_GOOGLE ? '#22D3EE' : '#94A3B8' }}
        />
        <span className="text-10 font-mono uppercase tracking-[0.16em]">
          {HAS_GOOGLE
            ? 'Google Photorealistic 3D'
            : 'OpenFreeMap · Free tier'}
        </span>
      </div>

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
        boxShadow:
          '0 8px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset',
        color: '#F8FAFC',
      }}
    >
      <div
        className="flex items-center justify-between mb-2 text-10 font-mono uppercase tracking-[0.16em]"
        style={{ color: 'rgba(248,250,252,0.55)' }}
      >
        <span>
          Póliza {index + 1} de {total}
        </span>
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
        className="font-serif italic text-15 leading-snug mb-0.5"
        style={{ color: '#F8FAFC' }}
      >
        {description}
      </div>
      <div
        className="text-12 leading-snug mb-1"
        style={{ color: 'rgba(248,250,252,0.72)' }}
      >
        {location}
      </div>
      <div
        className="text-10 font-mono uppercase tracking-wider mb-3"
        style={{ color: 'rgba(248,250,252,0.45)' }}
      >
        {year ? `Construido ${year} · ` : ''}
        {policy.lat?.toFixed(4)}, {policy.lon?.toFixed(4)}
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
        <PanelMetric
          label="Prima anual"
          value={formatMoney(policy.annual_premium)}
        />
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

// ─── MiniMap SVG ─────────────────────────────────────────────────
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
      <div
        className="px-2.5 pt-1.5 pb-1 text-9 font-mono uppercase tracking-[0.18em]"
        style={{ color: 'rgba(248,250,252,0.55)' }}
      >
        Tour map · {activeIndex + 1}/{policies.length}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="rgba(255,255,255,0.04)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.04)" />
        {policies.map((p, i) => {
          if (i === activeIndex) return null;
          const [x, y] = project(p.lon, p.lat);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill="#38BDF8"
              fillOpacity="0.75"
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
