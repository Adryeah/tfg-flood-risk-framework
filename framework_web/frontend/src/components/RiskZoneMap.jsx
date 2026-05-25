import React, { useEffect, useState, useRef } from 'react';

import { Map, MapControls, MapPopup, useMap } from './Map.tsx';
import { GradientLegend } from './Legend.jsx';
import { InfoTooltip } from './InfoTooltip.jsx';
import { api } from '../lib/api.js';
import { ZONES } from '../lib/constants.js';

/**
 * Canonical risk-map widget used across the Daily Briefing bottom map and
 * the Valencia / Algemesí / Comparison views. Built on top of mapcn's
 * <Map> + <MapControls> primitives.
 *
 * Props:
 *   zone                   'valencia' | 'algemesi' | 'both'
 *   height                 CSS height of the map container (default 520)
 *   showOverlays           floating basemap/overlay panel (default true)
 *   showLegend             gradient legend bottom-left (default true)
 *   showZones              dashed study-zone rectangles (default true)
 *   includeTail            low-probability tail toggle (default true)
 *   enablePixelInspection  click → /api/risk/predict → MapPopup (default true)
 *   onPixelInspect         optional callback fired on every pixel click with
 *                          { lat, lon, status, data, error } so the parent
 *                          view can mirror the inspection in its sidebar.
 */
export function RiskZoneMap({
  zone = 'both',
  height = 520,
  showOverlays = true,
  showLegend = true,
  showZones = true,
  includeTail = true,
  enablePixelInspection = true,
  onPixelInspect,
  // 3D mode — tilts the camera, extrudes the risk surface by P(flood),
  // and overlays OpenFreeMap building geometry as fill-extrusion. Off
  // by default so the detail / comparison views stay 2D and fast. The
  // Overview opts in to give the briefing card a "cat-model relief"
  // look without needing a separate component.
  mode3d = false,
  // Optional threshold (0..1) used by the parent's "Binary" view mode.
  // When `binaryView` is true and `threshold` is set, the risk layer's
  // fill-color is swapped to a case expression: red above threshold,
  // muted grey below. In continuous mode (default) the 8-bin palette
  // from the geojson `color` property is used unchanged.
  threshold = null,
  binaryView = false,
}) {
  const targets = zone === 'both' ? ['valencia', 'algemesi'] : [zone];

  // Bounds that comfortably encompass the selected zone(s) plus a small margin.
  // MapLibre takes [[lng, lat], [lng, lat]] — keep that order.
  const margin = 0.05;
  const lats = targets.flatMap((z) => [ZONES[z].bbox[1], ZONES[z].bbox[3]]);
  const lngs = targets.flatMap((z) => [ZONES[z].bbox[0], ZONES[z].bbox[2]]);
  const sw = [Math.min(...lngs) - margin, Math.min(...lats) - margin];
  const ne = [Math.max(...lngs) + margin, Math.max(...lats) + margin];
  const center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];

  // Default visibility — risk on, tails off (heavy, lazy-loaded)
  const initialVisibility = {};
  for (const z of targets) initialVisibility[`risk-${z}`] = true;
  if (showZones) initialVisibility.zones = true;
  if (showOverlays) initialVisibility.municipalities = true;
  if (includeTail) {
    for (const z of targets) initialVisibility[`tail-${z}`] = false;
  }

  const [visibility, setVisibility] = useState(initialVisibility);
  const [tailLoaded, setTailLoaded] = useState({});

  // Pixel inspection state — { lat, lon, status: 'loading'|'ready'|'error', data, error }
  const [inspection, setInspection] = useState(null);

  // Keep the parent in sync without re-rendering the wrapper for every change
  const onPixelInspectRef = useRef(onPixelInspect);
  onPixelInspectRef.current = onPixelInspect;

  return (
    <div className="relative" style={{ height }}>
      <Map
        center={center}
        // 3D: start slightly closer (zoom 11.5) so the OpenFreeMap
        // building extrusions are already starting to render at first
        // paint; the user lands on a populated cityscape, not a flat
        // map. 2D mode keeps the wider zoom 10 fly-over.
        zoom={mode3d ? 11.5 : 10}
        minZoom={9}
        maxZoom={mode3d ? 17 : 14}
        // No maxBounds in 3D — the user can pan freely beyond the
        // affected zones so buildings outside the bbox are reachable
        // (e.g. Valencia city centre, Cullera, Xàtiva). In 2D we keep
        // the bounds tight to focus the eye on the modelled area.
        maxBounds={mode3d ? undefined : [sw, ne]}
        // 3D camera tilt + slight bearing rotation when mode3d. Buildings
        // start emerging visually around zoom 13; the user can drag to
        // dolly in. maxPitch:70 keeps a sane horizon (above 75° the
        // basemap stretches badly on MapLibre).
        pitch={mode3d ? 50 : 0}
        bearing={mode3d ? -17 : 0}
        maxPitch={mode3d ? 70 : 0}
        className="h-full w-full"
      >
        <MapControls />
        <RiskLayers
          targets={targets}
          visibility={visibility}
          showZones={showZones}
          showOverlays={showOverlays}
          includeTail={includeTail}
          tailLoaded={tailLoaded}
          setTailLoaded={setTailLoaded}
          initialBounds={[sw, ne]}
          enablePixelInspection={enablePixelInspection}
          mode3d={mode3d}
          threshold={threshold}
          binaryView={binaryView}
          onClick={
            enablePixelInspection
              ? (lat, lon) => {
                  const fresh = { lat, lon, status: 'loading' };
                  setInspection(fresh);
                  onPixelInspectRef.current?.(fresh);
                  // Fire the predict request; only commit if the current
                  // inspection is still ours (stale-while-clicking guard).
                  api.risk
                    .predict(lat, lon)
                    .then((data) => {
                      setInspection((prev) =>
                        prev && prev.lat === lat && prev.lon === lon
                          ? { lat, lon, status: 'ready', data }
                          : prev
                      );
                      onPixelInspectRef.current?.({ lat, lon, status: 'ready', data });
                    })
                    .catch((err) => {
                      setInspection((prev) =>
                        prev && prev.lat === lat && prev.lon === lon
                          ? {
                              lat,
                              lon,
                              status: 'error',
                              error: err?.message || 'inspection failed',
                            }
                          : prev
                      );
                      onPixelInspectRef.current?.({
                        lat,
                        lon,
                        status: 'error',
                        error: err?.message || 'inspection failed',
                      });
                    });
                }
              : undefined
          }
        />

        {/* Pixel-inspection popup — anchored to the click coordinates. */}
        {inspection && enablePixelInspection && (
          <MapPopup
            longitude={inspection.lon}
            latitude={inspection.lat}
            closeButton
            onClose={() => setInspection(null)}
          >
            <PixelInspectionContent inspection={inspection} />
          </MapPopup>
        )}

        {showOverlays && (
          <OverlayPanel
            targets={targets}
            visibility={visibility}
            setVisibility={setVisibility}
            showZones={showZones}
            includeTail={includeTail}
            onTailFirstActivate={async (z) => {
              if (tailLoaded[z]) return;
              try {
                const geo = await api.risk.getTailGeoJSON(z);
                // Layer is mounted; RiskLayers' effect will call setData when
                // it sees a new tailLoaded entry.
                setTailLoaded((t) => ({ ...t, [z]: geo }));
              } catch (err) {
                console.warn(`Tail layer for ${z} not available:`, err.message);
              }
            }}
          />
        )}

        {showLegend && <GradientLegend />}
      </Map>
    </div>
  );
}

// ─── Inner: adds GeoJSON sources/layers to the mapcn Map ──────────────
function RiskLayers({
  targets,
  visibility,
  showZones,
  showOverlays,
  includeTail,
  tailLoaded,
  setTailLoaded, // eslint-disable-line no-unused-vars
  initialBounds,
  enablePixelInspection,
  onClick,
  mode3d = false,
  threshold = null,
  binaryView = false,
}) {
  const { map, isLoaded } = useMap();

  // Initial layer setup (once style is loaded)
  useEffect(() => {
    if (!map || !isLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        // ─── Risk surface ────────────────────────────────────────────
        // 2D: raster tiles pre-renderizados desde /api/tiles. Fidelidad
        //     píxel-perfect del Random Forest, colormap continuo YlOrRd.
        //     No requiere fetch del geojson → first paint más rápido.
        // 3D: GeoJSON con fill-extrusion (lo de siempre). Necesita
        //     `probability_max` por feature para extrudir.
        let riskGeos = null;
        if (mode3d) {
          riskGeos = await Promise.all(
            targets.map((z) => api.risk.getGeoJSON(z))
          );
          if (cancelled) return;
        }

        targets.forEach((z, i) => {
          const id = `risk-${z}`;
          if (map.getSource(id)) return;

          if (mode3d) {
            map.addSource(id, { type: 'geojson', data: riskGeos[i] });
            // 3D mode: extrude the risk surface by P(flood) so the
            // map reads as a "risk relief" landscape. Height in metres
            // = probability_max × 500 → low-prob bins sit at ~30 m,
            // very_high bins peak ~500 m. Cat-model dashboards
            // (Swiss Re, Munich Re) use this exact metaphor — risk
            // becomes terrain you can fly over.
            map.addLayer({
              id,
              type: 'fill-extrusion',
              source: id,
              paint: {
                'fill-extrusion-color': ['get', 'color'],
                'fill-extrusion-height': [
                  '*',
                  ['coalesce', ['get', 'probability_max'], 0.1],
                  500,
                ],
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.78,
                'fill-extrusion-vertical-gradient': true,
                'fill-extrusion-opacity-transition': {
                  duration: 220,
                  delay: 0,
                },
              },
            });
          } else {
            // 2D — raster tile pyramid del RF. tileSize 256, zoom 10–15
            // (lo que pre-generó tools/07_export_risk_tiles.py). Para
            // zooms fuera de rango MapLibre upscalea el más cercano,
            // que se ve aceptable sin recargas adicionales.
            map.addSource(id, {
              type: 'raster',
              tiles: [api.risk.tilesUrl(z)],
              tileSize: 256,
              minzoom: 10,
              maxzoom: 15,
              attribution: 'Random Forest v2 · TFG Vargas (UAB)',
            });
            map.addLayer({
              id,
              type: 'raster',
              source: id,
              paint: {
                'raster-opacity': 0.7,
                'raster-opacity-transition': { duration: 220, delay: 0 },
                // Resampling lineal para que el zoom intermedio no
                // se vea pixelado feo; en zooms nativos (z=14) los
                // píxeles SAR se ven con sus bordes rectos, que es lo
                // que queremos visualmente.
                'raster-resampling': 'linear',
              },
            });
          }
        });

        if (mode3d) {
          // ─── REAL TERRAIN ──────────────────────────────────────────
          // AWS Open Data Terrarium tiles (gratis, sin token, fusión
          // SRTM/ALOS a 30 m). Cada píxel codifica altitud como
          // RGB: elev = R*256 + G + B/256 − 32768. MapLibre decodifica
          // con encoding:'terrarium'. exaggeration 1.3 — Valencia es
          // plana (cotas 0-200 m en el bbox) y sin amplificación las
          // diferencias no se perciben. 1.3x mantiene la geomorfología
          // honesta y a la vez hace visible la depresión donde el
          // modelo predice riesgo. La superficie de riesgo extrudida
          // sigue cuadrando porque MapLibre eleva fill-extrusion sobre
          // la cota del terreno, no sobre nivel del mar.
          if (!map.getSource('terrain-dem')) {
            map.addSource('terrain-dem', {
              type: 'raster-dem',
              tiles: [
                'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
              ],
              tileSize: 256,
              encoding: 'terrarium',
              maxzoom: 14,
              attribution:
                'Terrain · AWS Open Data Registry (SRTM/ALOS)',
            });
          }
          // setTerrain es idempotente; comprobamos para evitar logs
          // duplicados en hot-reload del dev server.
          if (!map.getTerrain || !map.getTerrain()) {
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.3 });
          }

          // ─── HILLSHADE ─────────────────────────────────────────────
          // Sombras subsumidas del DEM. Visualmente refuerza los valles
          // del Turia y del Júcar incluso cuando la cámara está casi
          // cenital. Insertado BAJO la primera capa de riesgo para que
          // los amarillos/rojos del RF queden por encima.
          if (!map.getLayer('hillshade')) {
            const beforeId = `risk-${targets[0]}`;
            const beforeExists = map.getLayer(beforeId) ? beforeId : undefined;
            map.addLayer(
              {
                id: 'hillshade',
                type: 'hillshade',
                source: 'terrain-dem',
                paint: {
                  'hillshade-exaggeration': 0.45,
                  'hillshade-shadow-color': '#0F172A',
                  'hillshade-highlight-color': '#F8FAFC',
                  'hillshade-accent-color': '#1E293B',
                },
              },
              beforeExists
            );
          }

          // ─── SKY ATMOSPHERE ────────────────────────────────────────
          // MapLibre GL JS 5.x ya no expone `sky` como layer type;
          // pasa a ser una propiedad raíz del style vía `setSky()`.
          // Gradiente atmosférico horizonte → cenit con los colores
          // del cielo mediterráneo a media mañana, que es cuando
          // pasa el Sentinel-1 ascendente sobre Valencia.
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

          // ─── 3D BUILDINGS ──────────────────────────────────────────
          // OpenFreeMap vector tiles (free, no token, no limit;
          // OpenMapTiles schema). Buildings come from the OSM
          // `building` features extruded by `render_height` (metres,
          // already cleaned by the tile producer). We layer them ABOVE
          // the risk surface so a building sitting on a high-risk bin
          // is visually grounded on the red "terrain". Con setTerrain
          // activo, los edificios extruden desde la cota REAL del
          // suelo — un bloque de Catarroja (cota ~5 m) queda más bajo
          // que uno de Torrent (cota ~50 m), igual que en la realidad.
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
              // Tiles include buildings from zoom 12 onwards. We start
              // rendering at 11 (tiles get upscaled — sketchy footprints
              // but city outline visible) and fade in to full opacity by
              // zoom 14 where every building is crisp. Zoom-driven
              // opacity gives a smooth "buildings rise as you descend"
              // effect rather than a hard pop-in at minzoom.
              minzoom: 11,
              paint: {
                'fill-extrusion-color': [
                  'case',
                  ['has', 'colour'],
                  ['get', 'colour'],
                  '#9CA3AF',
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
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  11,
                  0,
                  12.5,
                  0.55,
                  14,
                  0.92,
                ],
                'fill-extrusion-vertical-gradient': true,
              },
            });
          }
        }

        // Municipalities (only on overlay-enabled views)
        if (showOverlays) {
          try {
            const muniGeo = await api.geo.municipalities();
            if (!cancelled && muniGeo && !map.getSource('municipalities')) {
              map.addSource('municipalities', { type: 'geojson', data: muniGeo });
              map.addLayer({
                id: 'municipalities-fill',
                type: 'fill',
                source: 'municipalities',
                paint: {
                  'fill-color': '#1E2B4A',
                  'fill-opacity': 0.04,
                  'fill-opacity-transition': { duration: 220, delay: 0 },
                },
              });
              map.addLayer({
                id: 'municipalities',
                type: 'line',
                source: 'municipalities',
                paint: {
                  'line-color': '#1E2B4A',
                  'line-width': 1.2,
                  'line-opacity': 0.85,
                  'line-opacity-transition': { duration: 220, delay: 0 },
                },
              });
            }
          } catch {
            // municipalities not available — non-fatal
          }
        }

        // Study-zone rectangles
        if (showZones && !map.getSource('zones')) {
          const features = targets.map((z) => ({
            type: 'Feature',
            properties: { zone: z, color: ZONES[z].color },
            geometry: zoneRect(ZONES[z].bbox),
          }));
          map.addSource('zones', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          });
          map.addLayer({
            id: 'zones',
            type: 'line',
            source: 'zones',
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-dasharray': [3, 2],
            },
          });
        }

        // Pre-create empty tail sources/layers so visibility toggles can flip
        // them on/off without waiting for the geojson fetch the first time.
        if (includeTail) {
          for (const z of targets) {
            const id = `tail-${z}`;
            if (!map.getSource(id)) {
              map.addSource(id, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
              });
              // Insert tail BENEATH the corresponding risk layer so the main
              // surface stays on top visually.
              map.addLayer(
                {
                  id,
                  type: 'fill',
                  source: id,
                  paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': 0.45,
                    // Tail fades in/out when toggled — most visible benefit
                    // of paint transitions: first activation downloads ~3 MB
                    // of GeoJSON, and the polygons fade in rather than pop
                    // when setData() runs.
                    'fill-opacity-transition': { duration: 320, delay: 0 },
                  },
                  layout: { visibility: 'none' },
                },
                `risk-${z}`
              );
            }
          }
        }

        // Frame both bbox bounds initially
        map.fitBounds(initialBounds, { padding: 16, maxZoom: 11, duration: 0 });
      } catch (err) {
        console.error('RiskLayers: failed to add layers', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run on style swap; mode3d is included so toggling 2D/3D from
    // the parent rebuilds the risk surface as fill vs fill-extrusion.
  }, [map, isLoaded, mode3d]);

  // Sync layer visibility to map every time the visibility map changes
  useEffect(() => {
    if (!map || !isLoaded) return;
    Object.entries(visibility).forEach(([id, on]) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (id === 'municipalities' && map.getLayer('municipalities-fill')) {
        map.setLayoutProperty(
          'municipalities-fill',
          'visibility',
          on ? 'visible' : 'none'
        );
      }
    });
  }, [map, isLoaded, visibility]);

  // When tail GeoJSON arrives, push it into the pre-mounted source
  useEffect(() => {
    if (!map || !isLoaded) return;
    Object.entries(tailLoaded).forEach(([z, geo]) => {
      const src = map.getSource(`tail-${z}`);
      if (src && geo) {
        // setData is idempotent; cheap to call even if already set.
        src.setData(geo);
      }
    });
  }, [map, isLoaded, tailLoaded]);

  // Pixel-inspection click handler — also flips the cursor to a crosshair
  // when inspection is enabled so the user knows the map is interactive.
  useEffect(() => {
    if (!map || !isLoaded || !enablePixelInspection || !onClick) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    const handler = (e) => {
      const { lng, lat } = e.lngLat;
      onClick(lat, lng);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
      canvas.style.cursor = '';
    };
  }, [map, isLoaded, enablePixelInspection, onClick]);

  // ─── Threshold-driven repaint ────────────────────────────────────
  // When the parent flips to "Binary" view, replace each risk layer's
  // fill-color with a MapLibre `case` expression that re-classifies
  // every bin against the live threshold:
  //   probability_max ≥ threshold → vivid red (flood-positive)
  //   below                        → muted grey (flood-negative)
  //
  // In continuous mode the original 8-bin palette from `feature.color`
  // is restored. The effect handles both 2D fill and 3D fill-extrusion
  // layer types so the swap works in Overview's 3D mode too.
  useEffect(() => {
    if (!map || !isLoaded) return;
    // En 2D la capa es raster — la binaria con `case` sobre
    // `probability_max` no aplica porque el colormap está cocinado
    // en los PNG. La vista binaria sigue funcionando en 3D (geojson).
    // Cuando esté pedida en 2D simplemente no se hace nada.
    if (!mode3d) return;

    const colorProp = 'fill-extrusion-color';
    const opacityProp = 'fill-extrusion-opacity';

    for (const z of targets) {
      const id = `risk-${z}`;
      if (!map.getLayer(id)) continue;
      if (binaryView && threshold != null) {
        map.setPaintProperty(id, colorProp, [
          'case',
          ['>=', ['coalesce', ['get', 'probability_max'], 0], threshold],
          '#DC2626', // above threshold → flood-positive red
          '#94A3B8', // below threshold → neutral slate-grey
        ]);
        map.setPaintProperty(id, opacityProp, 0.85);
      } else {
        map.setPaintProperty(id, colorProp, ['get', 'color']);
        map.setPaintProperty(id, opacityProp, 0.78);
      }
    }
  }, [map, isLoaded, threshold, binaryView, mode3d, targets]);

  return null;
}

function zoneRect(bbox) {
  const [w, s, e, n] = bbox;
  return {
    type: 'LineString',
    coordinates: [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  };
}

// ─── Pixel inspection popup body ──────────────────────────────────────
function PixelInspectionContent({ inspection }) {
  const { lat, lon, status, data, error } = inspection;

  if (status === 'loading') {
    return (
      <div className="px-1 py-1.5 min-w-[240px]">
        <Coords lat={lat} lon={lon} />
        <div className="mt-2 text-12 text-text-secondary inline-flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: '#2563EB', animation: 'pulse 1.4s ease-in-out infinite' }}
          />
          Inspecting model…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="px-1 py-1.5 min-w-[240px]">
        <Coords lat={lat} lon={lon} />
        <div className="mt-2 text-12" style={{ color: '#DC2626' }}>
          {error || 'Point outside model coverage.'}
        </div>
      </div>
    );
  }

  // status === 'ready'
  const prob = Number(data.probability ?? 0);
  const cat = (data.category || categorize(prob)).toUpperCase();
  const sevBg = { LOW: '#ECFDF5', MEDIUM: '#FFFBEB', HIGH: '#FEF2F2' }[cat] || '#F3F5F7';
  const sevFg = { LOW: '#15803D', MEDIUM: '#D97706', HIGH: '#DC2626' }[cat] || '#1F2937';
  const features = data.features || {};
  const topFeatures = Object.entries(features).slice(0, 5);

  return (
    <div className="px-1 py-1.5 min-w-[260px]">
      <Coords lat={lat} lon={lon} />

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-10 font-mono font-semibold uppercase tracking-wider text-text-tertiary">
          Probability
        </span>
        <span className="text-20 font-mono font-semibold text-text-primary tabular-nums">
          {prob.toFixed(3)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-12">
        <span className="text-text-secondary">Risk class</span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider"
          style={{ background: sevBg, color: sevFg }}
        >
          {cat}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-12 text-text-secondary">
        <span>Zone</span>
        <span className="font-mono text-text-primary">{data.zone || '—'}</span>
      </div>

      {data.threshold_operational != null && (
        <div className="mt-1 flex items-center justify-between gap-3 text-12 text-text-secondary">
          <span>vs threshold</span>
          <span className="font-mono text-text-primary">
            {data.is_above_threshold ? 'ABOVE' : 'below'} ·{' '}
            {Number(data.threshold_operational).toFixed(3)}
          </span>
        </div>
      )}

      {topFeatures.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border-default">
          <div className="text-10 font-mono font-semibold uppercase tracking-wider text-text-tertiary mb-1">
            Features
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-11">
            {topFeatures.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-text-secondary font-mono truncate" title={k}>
                  {k}
                </dt>
                <dd className="text-text-primary font-mono text-right tabular-nums">
                  {typeof v === 'number' ? v.toFixed(2) : String(v)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Coords({ lat, lon }) {
  return (
    <div className="text-11 font-mono text-text-tertiary tabular-nums">
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </div>
  );
}

function categorize(p) {
  if (p < 0.3) return 'low';
  if (p < 0.614) return 'medium';
  return 'high';
}

// ─── Floating overlay panel ───────────────────────────────────────────
function OverlayPanel({
  targets,
  visibility,
  setVisibility,
  showZones,
  includeTail,
  onTailFirstActivate,
}) {
  const items = [];
  for (const z of targets) {
    items.push({
      id: `risk-${z}`,
      label: `Risk · ${labelFor(z)}`,
      color: z === 'valencia' ? '#DC2626' : '#7E22CE',
    });
  }
  items.push({
    id: 'municipalities',
    label: 'DANA municipalities',
    color: '#1E2B4A',
  });
  if (showZones) {
    items.push({
      id: 'zones',
      label: 'Study zones',
      color: '#7E22CE',
    });
  }
  if (includeTail) {
    for (const z of targets) {
      items.push({
        id: `tail-${z}`,
        label: `Tail · ${labelFor(z)} (p<0.25)`,
        color: '#94A3B8',
      });
    }
  }

  const toggle = (id) => {
    const next = !visibility[id];
    setVisibility((v) => ({ ...v, [id]: next }));
    const tailMatch = /^tail-(valencia|algemesi)$/.exec(id);
    if (next && tailMatch && onTailFirstActivate) {
      onTailFirstActivate(tailMatch[1]);
    }
  };

  return (
    <div
      // Ancho compacto en mobile (w-52 = 208px) → en md+ vuelve a w-64
      // (256px). En mobile el panel + zoom controls a la derecha caben
      // sin tapar más del 60% del ancho del mapa.
      className="absolute top-2 right-12 sm:top-3 sm:right-14 z-[1000] w-52 sm:w-64 bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 0 0 1px rgba(15,23,42,0.05)' }}
    >
      <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between border-b border-border-default">
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Overlays
        </span>
        <InfoTooltip
          what="Toggle layers on/off. The low-probability tail (p<0.25) is heavy and only fetched the first time you enable it. Click anywhere on the map to inspect that pixel's prediction."
          source="GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson · GET /api/risk/predict?lat=&lon="
        />
      </div>
      <div className="px-2.5 py-1.5 sm:px-3 sm:py-2 space-y-1 sm:space-y-1.5">
        {items.map(({ id, label, color }) => {
          const on = !!visibility[id];
          return (
            <div key={id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-3 h-3 rounded-sm border shrink-0"
                  style={{
                    backgroundColor: color,
                    borderColor: 'rgba(15,23,42,0.10)',
                  }}
                />
                <span className="text-12 text-text-secondary truncate">{label}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggle(id)}
                className="relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-500"
                style={{ backgroundColor: on ? '#1D4ED8' : '#D4D4D8' }}
              >
                <span
                  className="inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform"
                  style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelFor(zone) {
  return zone === 'valencia' ? 'Valencia' : 'Algemesí';
}
