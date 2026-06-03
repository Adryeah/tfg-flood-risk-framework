import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import { getIncidentPolygonScale, getIncidentOpacity, MODEL_METRICS } from '@/lib/tour/incident-replay.js';
import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
import { FlyToInterpolator } from '@deck.gl/core';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';
import { GLTFLoader } from '@loaders.gl/gltf';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { formatMoney, formatPercent } from '@/lib/format.js';
import { TourStateProvider, useTourState, useTourActions } from '@/lib/tour/tour-state.jsx';
import { HudOverlay } from '@/components/tour/hud-overlay.jsx';
import { CenterReticle } from '@/components/tour/center-reticle.jsx';
import { useKeyboardModeSwitcher } from '@/components/tour/mode-bank.jsx';
import { getShaderCssFilter } from '@/lib/tour/deck-effects.js';

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const HAS_GOOGLE = Boolean(GOOGLE_KEY);
const GOOGLE_3D_URL = HAS_GOOGLE
  ? `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_KEY}`
  : null;
const FREE_BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

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

const BLUE_BASE = [56, 189, 248, 200];
const BLUE_HOVER = [125, 211, 252, 240];
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

function markerShape(p) {
  if (p.product === 'autos') {
    return { type: 'vehicle', diskResolution: 8, radius: 2.5, elevation: 0.4 };
  }
  if (p.subtype === 'nave') {
    return { type: 'warehouse', diskResolution: 4, radius: 8, elevation: 5 };
  }
  if (p.subtype === 'comercio') {
    return { type: 'retail', diskResolution: 4, radius: 5, elevation: 3.2 };
  }
  const f = policyFloorIdx(p);
  if (f >= 7) {
    return { type: 'tower', diskResolution: 12, radius: 1.5, elevation: f * 3 };
  }
  if (f >= 4) {
    return { type: 'midrise', diskResolution: 14, radius: 3, elevation: f * 3 };
  }
  if (f >= 1) {
    return { type: 'lowrise', diskResolution: 14, radius: 3.5, elevation: f * 3 };
  }
  return { type: 'ground', diskResolution: 14, radius: 4, elevation: 1.2 };
}

function markerColor(p, isActive, isHover) {
  if (isActive) return riskRGBA(p.risk_category, 250);
  if (isHover) return [...BLUE_HOVER];
  return riskRGBA(p.risk_category, 160);
}

const CAR_GLB_URL =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb';

function carYawFor(p, idx) {
  const seed = (idx * 53 + (p.lat * 1e4) | 0) >>> 0;
  return seed % 360;
}

function TourMapInner({ policies, onSelectPolicy }) {
  const { mode, activePolicyIdx, hud, incidentTime } = useTourState();
  const { setActiveIndex, setTotal } = useTourActions();
  useKeyboardModeSwitcher();

  const liftStartRef = useRef(performance.now());
  const [liftT, setLiftT] = useState(1);
  const [pulseT, setPulseT] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const prevActiveRef = useRef(-1);
  const mapContainerRef = useRef(null);
  const mapLibreRef = useRef(null);

  useEffect(() => {
    setTotal(policies?.length || 0);
  }, [policies, setTotal]);

  useEffect(() => {
    if (activePolicyIdx === prevActiveRef.current) return;
    prevActiveRef.current = activePolicyIdx;
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
  }, [activePolicyIdx]);

  useEffect(() => {
    let id;
    const tick = () => {
      setPulseT(performance.now() * 0.001);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const activePolicy = policies?.[activePolicyIdx];
  const initialVS = useMemo(() => {
    const p = activePolicy;
    return p
      ? { longitude: p.lon, latitude: p.lat, zoom: 16.5, pitch: 55, bearing: 0 }
      : { longitude: -0.4, latitude: 39.42, zoom: 15, pitch: 55, bearing: 0 };
  }, []);
  const [viewState, setViewState] = useState(initialVS);

  useEffect(() => {
    const p = activePolicy;
    if (!p) return;
    const policyAlt = policyAltitude(p);
    setViewState({
      longitude: p.lon,
      latitude: p.lat,
      zoom: Math.max(17.0, 17.4 - policyAlt * 0.02),
      pitch: Math.max(48, 60 - policyAlt * 0.4),
      bearing: bearingFor(activePolicyIdx),
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
    });
  }, [activePolicy, activePolicyIdx]);

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
      interactive: false,
      attributionControl: { compact: true },
    });
    mapLibreRef.current = map;
    return () => {
      try { map.remove(); } catch { /* silent */ }
      mapLibreRef.current = null;
    };
  }, []);

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
    } catch { /* silent */ }
  }, [viewState]);

  const layers = useMemo(() => {
    if (!policies?.length) return [];
    const activePol = policies[activePolicyIdx];
    const activeAlt = activePol ? policyAltitude(activePol) : 0;
    const liftOffset = -activeAlt * (1 - liftT);
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

    layers.push(
      new ScatterplotLayer({
        id: 'policy-rings',
        data: policies,
        getPosition: (d) => [d.lon, d.lat, 0],
        getRadius: (d, { index }) => {
          if (index === activePolicyIdx) return pulseRadius;
          if (index === hoverIdx) return 6;
          return 4;
        },
        radiusUnits: 'meters',
        radiusMinPixels: 5,
        getFillColor: (d, { index }) => {
          if (index === activePolicyIdx) return riskRGBA(d.risk_category, 250);
          if (index === hoverIdx) return BLUE_HOVER;
          return BLUE_BASE;
        },
        stroked: true,
        getLineColor: [248, 250, 252, 240],
        getLineWidth: (d, { index }) => (index === activePolicyIdx ? 1.8 : 0.6),
        lineWidthUnits: 'meters',
        extensions: [new TerrainExtension()],
        terrainDrawMode: 'drape',
        pickable: true,
        autoHighlight: true,
        onClick: (info) => {
          if (info.index >= 0 && onSelectPolicy) {
            setActiveIndex(info.index);
          }
        },
        onHover: (info) => {
          setHoverIdx(info.index >= 0 ? info.index : -1);
        },
        updateTriggers: {
          getRadius: [activePolicyIdx, hoverIdx, pulseRadius],
          getFillColor: [activePolicyIdx, hoverIdx],
          getLineWidth: activePolicyIdx,
        },
      })
    );

    const buildingData = policies
      .map((p, i) => ({ ...p, _i: i, _isActive: i === activePolicyIdx, _isHover: i === hoverIdx }))
      .filter((d) => d.product !== 'autos');

    const semanticLayers = [];
    for (const p of buildingData) {
      const shape = markerShape(p);
      const baseAlt = shape.elevation;
      const z = p._isActive ? baseAlt + liftOffset : baseAlt;

      semanticLayers.push(
        new ColumnLayer({
          id: `marker-${p._i}`,
          data: [p],
          getPosition: [p.lon, p.lat, 0],
          diskResolution: shape.diskResolution,
          radius: shape.radius,
          radiusUnits: 'meters',
          extruded: true,
          getElevation: shape.elevation,
          getFillColor: markerColor(p, p._isActive, p._isHover),
          extensions: [new TerrainExtension()],
          terrainDrawMode: 'offset',
          pickable: true,
          onClick: () => setActiveIndex(p._i),
          onHover: (info) => setHoverIdx(info.object ? p._i : -1),
          updateTriggers: { getFillColor: [activePolicyIdx, hoverIdx] },
        })
      );

      if (p._isActive) {
        const dotColor = markerColor(p, true, false);
        semanticLayers.push(
          new ScatterplotLayer({
            id: `beacon-${p._i}`,
            data: [p],
            getPosition: [p.lon, p.lat, z + 1],
            getRadius: 0.6,
            radiusUnits: 'meters',
            getFillColor: [...dotColor.slice(0, 3), 255],
            extensions: [new TerrainExtension()],
            terrainDrawMode: 'offset',
            pickable: false,
          })
        );
      }
    }
    layers.push(...semanticLayers);

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
            const z = d._i === activePolicyIdx ? 0.4 + liftOffset : 0.4;
            return [d.lon, d.lat, z];
          },
          getOrientation: (d) => [0, carYawFor(d, d._i), 90],
          getColor: (d) => {
            if (d._i === activePolicyIdx) return [255, 255, 255, 255];
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
            if (info.object && onSelectPolicy) setActiveIndex(info.object._i);
          },
          onHover: (info) => {
            setHoverIdx(info.object ? info.object._i : -1);
          },
          updateTriggers: {
            getPosition: [activePolicyIdx, liftT],
            getColor: [activePolicyIdx, hoverIdx],
          },
        })
      );
    }

    return layers;
  }, [policies, activePolicyIdx, liftT, pulseT, hoverIdx, onSelectPolicy, setActiveIndex, incidentTime]);

  const cssFilter = getShaderCssFilter(mode);
  const polygonScale = getIncidentPolygonScale(incidentTime || 0);
  const polygonOpacity = getIncidentOpacity(incidentTime || 0);

  const emsrPolygons = useMemo(() => {
    const coords = [
      [[-1.25056, 39.96592], [-1.25033, 39.96574], [-1.24982, 39.96345], [-1.24748, 39.96281], [-1.24819, 39.96255], [-1.24841, 39.96273], [-1.25056, 39.96592]],
      [[-1.24839, 39.96363], [-1.24760, 39.96272], [-1.24748, 39.96281], [-1.24819, 39.96255], [-1.24839, 39.96363]],
      [[-1.22046, 39.95276], [-1.22129, 39.95250], [-1.22152, 39.95250], [-1.22046, 39.95276]],
      [[-1.32357, 39.90547], [-1.32407, 39.90278], [-1.32493, 39.90261], [-1.32577, 39.90189], [-1.32682, 39.90191], [-1.32790, 39.90084], [-1.33032, 39.89763], [-1.35058, 39.87910], [-1.35238, 39.87723], [-1.34739, 39.87626], [-1.34694, 39.87526], [-1.34535, 39.87010], [-1.34316, 39.86944], [-1.34185, 39.86627], [-1.34296, 39.86324], [-1.35305, 39.84697], [-1.35196, 39.85812], [-1.34521, 39.86920], [-1.35777, 39.84019], [-1.36647, 39.81824], [-1.36666, 39.81500], [-1.28890, 39.86230], [-1.28969, 39.86163], [-1.28932, 39.86208]],
    ];
    return coords.map(ring => ring.map(([lon, lat]) => [lon, lat]));
  }, []);

  const allLayers = useMemo(() => {
    const base = layers;
    if ((mode === 'sweep' || incidentTime > 20) && emsrPolygons.length > 0) {
      base.push(
        new PolygonLayer({
          id: 'emsr773-ground-truth',
          data: [{ polygon: emsrPolygons[0] }],
          getPolygon: (d) => d.polygon,
          getFillColor: [245, 158, 11, Math.round(180 * polygonOpacity)],
          getLineColor: [245, 158, 11, Math.round(255 * polygonOpacity)],
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          stroked: true,
          filled: true,
          extruded: false,
          pickable: false,
          visible: polygonScale > 0,
        })
      );
    }
    return base;
  }, [layers, mode, incidentTime, emsrPolygons, polygonOpacity, polygonScale]);

  return (
    <div className="absolute inset-0" style={{ filter: cssFilter }}>
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
        layers={allLayers}
        getCursor={({ isHovering, isDragging }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
        style={{ position: 'absolute', inset: 0 }}
      />

      <HudOverlay policies={policies} onSelectPolicy={setActiveIndex} />

      {hud.reticle && <CenterReticle mode={mode} />}
    </div>
  );
}

export function TourMap({ policies, activeIndex, onSelectPolicy }) {
  return (
    <TourStateProvider>
      <TourMapWithIndex policies={policies} activeIndex={activeIndex} onSelectPolicy={onSelectPolicy} />
    </TourStateProvider>
  );
}

function TourMapWithIndex({ policies, activeIndex, onSelectPolicy }) {
  const { setActiveIndex } = useTourActions();

  useEffect(() => {
    if (activeIndex !== undefined) {
      setActiveIndex(activeIndex);
    }
  }, [activeIndex, setActiveIndex]);

  const handleSelect = (idx) => {
    setActiveIndex(idx);
    if (onSelectPolicy) onSelectPolicy(idx);
  };

  return <TourMapInner policies={policies} onSelectPolicy={handleSelect} />;
}