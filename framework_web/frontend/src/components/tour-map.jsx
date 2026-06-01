import React, { useEffect, useMemo, useRef, useState } from 'react';

import { formatMoney, formatPercent } from '@/lib/format.js';

// ─── Lazy-load Cesium desde CDN ──────────────────────────────────
//
// Cesium 1.141 desde jsDelivr (~800 KB gzipped). Se descarga UNA VEZ
// y la primera vez que se monta este componente; en navegaciones
// subsecuentes a /tour la promesa cacheada lo devuelve inmediato.
//
// Cargamos también widgets.css (~24 KB) y configuramos CESIUM_BASE_URL
// para que los workers y assets resolvan correctamente desde el CDN.
const CESIUM_VERSION = '1.141.0';
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;

let cesiumLoadPromise = null;
function loadCesium() {
  if (cesiumLoadPromise) return cesiumLoadPromise;
  if (typeof window !== 'undefined' && window.Cesium) {
    cesiumLoadPromise = Promise.resolve(window.Cesium);
    return cesiumLoadPromise;
  }
  cesiumLoadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    window.CESIUM_BASE_URL = CESIUM_BASE;
    // CSS
    if (!document.querySelector('link[data-cesium]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${CESIUM_BASE}Widgets/widgets.css`;
      link.dataset.cesium = 'true';
      document.head.appendChild(link);
    }
    // JS
    const script = document.createElement('script');
    script.src = `${CESIUM_BASE}Cesium.js`;
    script.async = true;
    script.onload = () => {
      if (window.Cesium) resolve(window.Cesium);
      else reject(new Error('Cesium global no encontrado tras la carga'));
    };
    script.onerror = () => reject(new Error('No se pudo cargar Cesium desde el CDN'));
    document.head.appendChild(script);
  });
  return cesiumLoadPromise;
}

// ─── Configuración Cesium ion ────────────────────────────────────
//
// Cesium funciona con un token de Cesium ion que da acceso a:
//   - Cesium World Terrain (terreno fotométrico global)
//   - Cesium OSM Buildings (extrusiones de edificios OSM, default)
//   - Cesium Sentinel-2 imagery (opcional)
//
// Si VITE_CESIUM_ION_TOKEN está definida, la usamos. Si no, Cesium
// trae un default access token integrado que basta para demos. Para
// Google Photorealistic 3D Tiles hay que añadir el asset 2275207
// a la cuenta de Cesium ion (free tier suficiente).
const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;

// Toggle: si la variable existe y es no-empty, intentamos cargar
// Google Photorealistic 3D Tiles (edificios fotogramétricos reales).
// Si falla o no está, fallback automático a Cesium OSM Buildings.
const USE_GOOGLE_3D = import.meta.env.VITE_USE_GOOGLE_3D_TILES === 'true';

// ─── Mapeo planta / altitud ──────────────────────────────────────
function policyFloorIdx(policy) {
  if (policy.product === 'autos') return 0;
  if (policy.ground_floor) return 0;
  return Math.max(1, Math.min(policy.floor_count || 1, 12));
}
function buildingFloors(policy) {
  if (policy.product === 'autos') return 1;
  return Math.max(policyFloorIdx(policy) + 1, policy.floor_count || 1, 1);
}
function policyAltitude(policy) {
  if (policy.product === 'autos') return 0.5;
  const f = policyFloorIdx(policy);
  return f === 0 ? 1.2 : f * 3;
}

// Color del halo por categoría de riesgo. Devuelve un Cesium.Color
// pero requiere que Cesium esté cargado — recibimos la referencia por
// parámetro porque a nivel module-scope Cesium no existe todavía.
function colorFor(Cesium, category) {
  const hex = {
    low: '#FBBF24',
    moderate: '#F87171',
    high: '#DC2626',
    very_high: '#7F1D1D',
  }[category] || '#94A3B8';
  return Cesium.Color.fromCssColorString(hex);
}

// ─── TourMap principal ───────────────────────────────────────────
// Wrapper que primero carga Cesium dinámicamente, después renderiza
// el viewer. Mientras carga, fallback con el panel de "Cargando…".
export function TourMap(props) {
  const [Cesium, setCesium] = useState(
    typeof window !== 'undefined' ? window.Cesium : null
  );
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (Cesium) return;
    let cancelled = false;
    loadCesium()
      .then((c) => {
        if (cancelled) return;
        if (ION_TOKEN) c.Ion.defaultAccessToken = ION_TOKEN;
        setCesium(c);
      })
      .catch((err) => !cancelled && setLoadError(err.message || String(err)));
    return () => {
      cancelled = true;
    };
  }, [Cesium]);

  if (loadError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-base p-6 text-center">
        <div>
          <div className="text-13 text-risk-high font-semibold mb-1">
            No se pudo cargar el motor 3D
          </div>
          <div className="text-12 text-text-secondary max-w-sm">
            {loadError}
            <br />
            Comprueba tu conexión o recarga la página.
          </div>
        </div>
      </div>
    );
  }

  if (!Cesium) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-13 font-mono uppercase tracking-[0.18em] text-text-secondary animate-pulse">
          Cargando motor 3D · ~800 KB…
        </div>
      </div>
    );
  }

  return <TourMapInner Cesium={Cesium} {...props} />;
}

// ─── Componente interno con acceso a Cesium ya cargado ──────────
function TourMapInner({ Cesium, policies, activeIndex }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const entitiesRef = useRef({ beams: [], halos: [], floors: [], rings: [] });
  const liftAnimRef = useRef(null);
  const liftValueRef = useRef(0);
  const [ready, setReady] = useState(false);

  // ── Init Cesium viewer once ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let cancelled = false;
    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      // CARTO dark imagery como base — coincide con la identidad de
      // la app. Cuando carguemos Google 3D Tiles más abajo, esta
      // imagery se ve apenas en los bordes del bbox.
      imageryProvider: new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        credit: '© CARTO · © OpenStreetMap contributors',
      }),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });
    viewerRef.current = viewer;

    // Estetica: cielo + niebla + atmósfera. Los flags de skyAtmosphere
    // y skyBox vienen activos por defecto en Cesium; aquí los afinamos
    // para que el horizonte se vea cinematográfico.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.hueShift = -0.02;
    viewer.scene.skyAtmosphere.saturationShift = -0.1;
    viewer.scene.skyAtmosphere.brightnessShift = -0.05;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.0001;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;

    // Quitar el logo de Cesium del DOM (se mantiene en el credit
    // container, donde toca para cumplir la atribución).
    viewer.cesiumWidget.creditContainer.style.display = 'none';

    // Carga terreno mundial + edificios 3D
    (async () => {
      try {
        const terrain = await Cesium.createWorldTerrainAsync({
          requestVertexNormals: true,
          requestWaterMask: false,
        });
        if (cancelled) return;
        viewer.terrainProvider = terrain;
      } catch (err) {
        console.warn('Cesium World Terrain unavailable, using ellipsoid:', err.message);
      }

      // Intentar Google Photorealistic 3D Tiles si el flag está activo;
      // fallback automático a Cesium OSM Buildings (extruidos pero
      // todavía con sombras + light dinámico de Cesium).
      try {
        if (USE_GOOGLE_3D) {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          if (cancelled) {
            tileset.destroy?.();
            return;
          }
          viewer.scene.primitives.add(tileset);
        } else {
          const osm = await Cesium.createOsmBuildingsAsync();
          if (cancelled) {
            osm.destroy?.();
            return;
          }
          viewer.scene.primitives.add(osm);
        }
      } catch (err) {
        console.warn('3D buildings unavailable:', err.message);
        // Fallback final: OSM Buildings
        try {
          const osm = await Cesium.createOsmBuildingsAsync();
          if (cancelled) return;
          viewer.scene.primitives.add(osm);
        } catch {
          /* sin edificios — escena minimalista */
        }
      }

      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      if (liftAnimRef.current != null) {
        cancelAnimationFrame(liftAnimRef.current);
        liftAnimRef.current = null;
      }
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
    };
  }, []);

  // ── Crear entidades (beams + halos + floor stack + rings) ──────
  useEffect(() => {
    if (!ready) return;
    const viewer = viewerRef.current;
    if (!viewer || !policies?.length) return;

    // Limpiar entidades anteriores
    const all = entitiesRef.current;
    [...all.beams, ...all.halos, ...all.floors, ...all.rings].forEach((e) => {
      try {
        viewer.entities.remove(e);
      } catch {
        /* silent */
      }
    });
    entitiesRef.current = { beams: [], halos: [], floors: [], rings: [] };

    policies.forEach((p, idx) => {
      const targetAlt = policyAltitude(p);
      const totalFloors = buildingFloors(p);
      const isActive = idx === activeIndex;
      const baseColor = colorFor(Cesium, p.risk_category);

      // ─── BEAM blanco vertical desde el suelo hasta la planta ────
      const beam = viewer.entities.add({
        id: `beam-${idx}`,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, targetAlt / 2),
        cylinder: {
          length: targetAlt,
          topRadius: 0.7,
          bottomRadius: 0.7,
          material: Cesium.Color.WHITE.withAlpha(isActive ? 0.95 : 0.42),
          outline: false,
        },
      });
      entitiesRef.current.beams.push(beam);

      // ─── HALO de color en la planta exacta ───────────────────────
      // Usamos CallbackProperty para la posición Z porque cuando la
      // póliza activa cambia, animamos un "ascenso" desde el suelo.
      // Para las no-activas el offset es 0 (estáticas).
      const halo = viewer.entities.add({
        id: `halo-${idx}`,
        position: new Cesium.CallbackProperty((_time, result) => {
          const offset = idx === activeIndex ? liftValueRef.current : 0;
          return Cesium.Cartesian3.fromDegrees(
            p.lon,
            p.lat,
            targetAlt + offset,
            Cesium.Ellipsoid.WGS84,
            result
          );
        }, false),
        ellipsoid: {
          radii: new Cesium.Cartesian3(4.5, 4.5, 0.9),
          material: baseColor.withAlpha(isActive ? 0.88 : 0.35),
          outline: false,
        },
      });
      entitiesRef.current.halos.push(halo);

      // ─── FLOOR STACK · discos transparentes por planta ──────────
      for (let f = 1; f <= totalFloors; f++) {
        const z = f * 3;
        const disc = viewer.entities.add({
          id: `floor-${idx}-${f}`,
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, z),
          ellipsoid: {
            radii: new Cesium.Cartesian3(3.0, 3.0, 0.18),
            material: Cesium.Color.fromCssColorString('#F8FAFC').withAlpha(0.28),
            outline: false,
          },
        });
        entitiesRef.current.floors.push(disc);
      }

      // ─── RING en el suelo (point siempre visible) ────────────────
      const ring = viewer.entities.add({
        id: `ring-${idx}`,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0.2),
        point: {
          pixelSize: isActive ? 16 : 8,
          color: baseColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: isActive ? 2.5 : 1.2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      entitiesRef.current.rings.push(ring);
    });
  }, [ready, policies]);

  // ── Camera flyTo + lift animation cuando cambia activeIndex ────
  const prevActiveRef = useRef(-1);
  useEffect(() => {
    if (!ready) return;
    const viewer = viewerRef.current;
    if (!viewer || !policies?.length) return;
    const p = policies[activeIndex];
    if (!p) return;

    // Reset visual del active anterior
    if (prevActiveRef.current >= 0 && prevActiveRef.current !== activeIndex) {
      const prev = policies[prevActiveRef.current];
      if (prev) {
        const prevColor = colorFor(Cesium, prev.risk_category);
        const prevBeam = entitiesRef.current.beams[prevActiveRef.current];
        if (prevBeam) {
          prevBeam.cylinder.material = Cesium.Color.WHITE.withAlpha(0.42);
        }
        const prevHalo = entitiesRef.current.halos[prevActiveRef.current];
        if (prevHalo) {
          prevHalo.ellipsoid.material = prevColor.withAlpha(0.35);
        }
        const prevRing = entitiesRef.current.rings[prevActiveRef.current];
        if (prevRing) {
          prevRing.point.pixelSize = 8;
          prevRing.point.outlineWidth = 1.2;
        }
      }
    }
    // Highlight nuevo activo
    const activeBeam = entitiesRef.current.beams[activeIndex];
    if (activeBeam) {
      activeBeam.cylinder.material = Cesium.Color.WHITE.withAlpha(0.95);
    }
    const activeHalo = entitiesRef.current.halos[activeIndex];
    if (activeHalo) {
      activeHalo.ellipsoid.material = colorFor(Cesium, p.risk_category).withAlpha(0.88);
    }
    const activeRing = entitiesRef.current.rings[activeIndex];
    if (activeRing) {
      activeRing.point.pixelSize = 16;
      activeRing.point.outlineWidth = 2.5;
    }
    prevActiveRef.current = activeIndex;

    // ── Lift animation (active halo sube del suelo a su planta) ──
    if (liftAnimRef.current != null) {
      cancelAnimationFrame(liftAnimRef.current);
      liftAnimRef.current = null;
    }
    const targetAlt = policyAltitude(p);
    const startOffset = -targetAlt;
    const startTime = performance.now();
    const DURATION = 900;
    liftValueRef.current = startOffset;
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      liftValueRef.current = startOffset * (1 - eased);
      if (t < 1) {
        liftAnimRef.current = requestAnimationFrame(tick);
      } else {
        liftValueRef.current = 0;
        liftAnimRef.current = null;
      }
    };
    liftAnimRef.current = requestAnimationFrame(tick);

    // ── Camera flyTo ─────────────────────────────────────────────
    // Bearing variado por póliza (en Cesium: heading). Pitch 58° de
    // MapLibre se traduce aquí en pitch -32° (Cesium mide desde el
    // horizonte hacia abajo: -90 = nadir, 0 = horizonte).
    const headingDeg = -15 + ((activeIndex * 23) % 70) - 35;
    const heading = Cesium.Math.toRadians(headingDeg);
    const pitch = Cesium.Math.toRadians(-32);
    // Posición destino: ligeramente desplazada en altura para que el
    // edificio del centro se vea con perspectiva, no de frente.
    const targetCart = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 240);

    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(targetCart, 90),
      {
        offset: new Cesium.HeadingPitchRange(heading, pitch, 320),
        duration: 1.5,
        easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
      }
    );
  }, [ready, activeIndex, policies]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay mientras Cesium inicializa */}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm pointer-events-none">
          <div className="text-13 font-mono uppercase tracking-[0.18em] text-text-secondary animate-pulse">
            Cargando escena 3D…
          </div>
        </div>
      )}

      {/* Panel cinematográfico + mini-map se mantienen */}
      <CinematicPanel
        policy={policies[activeIndex]}
        index={activeIndex}
        total={policies.length}
      />
      <MiniMap policies={policies} activeIndex={activeIndex} />
    </div>
  );
}

// ─── Panel cinematográfico (sin cambios respecto a la versión MapLibre) ────
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
      <div className="flex items-center justify-between mb-2 text-10 font-mono uppercase tracking-[0.16em]" style={{ color: 'rgba(248,250,252,0.55)' }}>
        <span>Póliza {index + 1} de {total}</span>
        <span style={{ color: tint }}>Riesgo {RISK_LABEL[policy.risk_category] || policy.risk_category}</span>
      </div>
      <div className="font-mono text-14 mb-0.5 tracking-tight" style={{ color: '#F8FAFC' }}>
        {policy.id}
      </div>
      <div className="font-serif italic text-13 mb-3 leading-snug" style={{ color: 'rgba(248,250,252,0.78)' }}>
        {PRODUCT_LABEL[policy.product] || policy.product}
        {policy.subtype ? ` · ${policy.subtype}` : ''} · {planta}
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

// ─── MiniMap SVG (sin cambios) ───────────────────────────────────
function MiniMap({ policies, activeIndex }) {
  if (!policies || policies.length === 0) return null;
  const W = 168;
  const H = 168;
  const PAD = 14;

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
