import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Waves, Car } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Map, MapMarker, MarkerContent } from '@/components/Map';
import { PolicyTour3D } from '@/components/PolicyTour3D';
import { TourSceneLayers } from '@/components/tour-scene-layers.jsx';
import { adaptClientToPolicy } from '@/types/policyTour.types.js';
import { TourDock } from '@/components/tour-dock.jsx';
import { LoadErrorState } from '@/components/load-error-state.jsx';

// Basemap con footprints OSM + extrusión (OpenMapTiles schema: source-layer
// 'building' con render_height). CARTO dark-matter NO trae edificios, por
// eso la consola usa OpenFreeMap liberty: sobre él queryRenderedFeatures
// devuelve geometría real de edificios para extruir la planta.
const OFM_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
// Identidad ESTABLE (módulo, no inline): si se pasa un objeto nuevo cada
// render, Map.tsx re-dispara su efecto de estilo y deja isStyleLoaded —y
// por tanto el isLoaded del contexto— colgado en false.
const OFM_STYLES = { light: OFM_LIBERTY, dark: OFM_LIBERTY };

// Categoría de riesgo → color del marcador. Paleta OSCURA propia del tour
// (marcadores sobre basemap oscuro): ámbar→rojo oscuro, NO el verde-low de
// los dashboards. Distinta a propósito de RISK_COLORS (lib/constants.js).
const TOUR_RISK_COLORS = {
  low: '#FBBF24',
  moderate: '#F87171',
  high: '#DC2626',
  very_high: '#7F1D1D',
};

const VALENCIA_CENTER = [-0.38, 39.47];

/** Marcadores de todas las pólizas del tour; click → selecciona. Los coches
 *  (producto autos) no son edificios → marcador de calle con icono de coche;
 *  el resto, punto. Al hacer zoom, los inmuebles se tintan como edificio. */
function ConsoleMarkers({ policies, activeIndex, onSelect }) {
  return policies.map((p, i) => {
    const active = i === activeIndex;
    const border = active ? '2px solid #f7f8f8' : '1px solid rgba(8,9,10,0.6)';
    const ring = active ? '0 0 0 3px rgba(247,248,248,0.18)' : 'none';
    if (p.product === 'autos') {
      const s = active ? 22 : 16;
      return (
        <MapMarker key={p.id} longitude={p.lon} latitude={p.lat}>
          <MarkerContent>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-label={`Coche ${p.id}`}
              className="flex items-center justify-center rounded-[3px] transition-transform hover:scale-125"
              style={{ width: s, height: s, background: p._color, border, boxShadow: ring }}
            >
              <Car size={active ? 13 : 10} color="#0b0d12" strokeWidth={2.4} />
            </button>
          </MarkerContent>
        </MapMarker>
      );
    }
    return (
      <MapMarker key={p.id} longitude={p.lon} latitude={p.lat}>
        <MarkerContent>
          <button
            type="button"
            onClick={() => onSelect(i)}
            aria-label={`Póliza ${p.id}`}
            className="block rounded-full transition-transform hover:scale-125"
            style={{
              width: active ? 15 : 10,
              height: active ? 15 : 10,
              background: p._color,
              border,
              boxShadow: ring,
            }}
          />
        </MarkerContent>
      </MapMarker>
    );
  });
}

/** Leyenda del mapa: cada edificio tintado es una póliza, coloreado por su
 *  categoría de riesgo. Coches como marcador de calle. Superficie de riesgo
 *  de suelo opcional (botón). */
function TourLegend({ floodOn }) {
  const items = [
    ['Bajo', TOUR_RISK_COLORS.low],
    ['Moderado', TOUR_RISK_COLORS.moderate],
    ['Alto', TOUR_RISK_COLORS.high],
    ['Muy alto', TOUR_RISK_COLORS.very_high],
  ];
  return (
    <div className="absolute bottom-3 left-3 z-[2] rounded-md border border-border-default bg-bg-surface/85 backdrop-blur px-3 py-2.5 shadow-lg">
      <div className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary mb-1.5">
        Riesgo por edificio
      </div>
      <div className="flex flex-col gap-1">
        {items.map(([label, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: color }} />
            <span className="text-11 text-text-secondary">{label}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1 mt-1 pt-1.5 border-t border-border-default">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-[3px] flex items-center justify-center"
              style={{ background: TOUR_RISK_COLORS.moderate }}
            >
              <Car size={8} color="#0b0d12" strokeWidth={2.6} />
            </span>
            <span className="text-11 text-text-secondary">Coche asegurado</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-[2px]"
              style={{
                background: 'linear-gradient(90deg,#FEF3C7,#DC2626)',
                outline: floodOn ? '1px solid #DC2626' : 'none',
              }}
            />
            <span
              className={
                'text-11 ' + (floodOn ? 'text-text-primary font-medium' : 'text-text-secondary')
              }
            >
              Superficie de riesgo (suelo)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UnderwriterConsole() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedId, setSelectedId] = useState('wide_distribution');
  const [portfolio, setPortfolio] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [productFilter, setProductFilter] = useState({
    particulares: true,
    pymes: true,
    autos: true,
  });
  const [speed, setSpeed] = useState(1);
  // Superficie de riesgo ON por defecto → las pólizas se ven dentro del mapa
  // de riesgo desde el arranque (el botón la puede ocultar).
  const [floodOn, setFloodOn] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 1) Index de carteras
  useEffect(() => {
    let mounted = true;
    api.portfolio
      .getPredefined()
      .then((res) => mounted && setPortfolios(res?.portfolios || []))
      .catch(
        (err) => mounted && setLoadError(err?.message || 'No se pudo cargar el índice de carteras')
      );
    return () => {
      mounted = false;
    };
  }, []);

  // 2) Cartera seleccionada
  useEffect(() => {
    if (!selectedId) return undefined;
    let mounted = true;
    api.portfolio
      .getById(selectedId)
      .then((p) => {
        if (!mounted) return;
        setPortfolio(p);
        setActiveIndex(0);
      })
      .catch(
        (err) =>
          mounted && setLoadError(err?.message || 'No se pudo cargar la cartera seleccionada')
      );
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  // 3) Pólizas del tour: filtradas por producto, top-N por riesgo desc.
  const tourPolicies = useMemo(() => {
    if (!portfolio?.clients) return [];
    return portfolio.clients
      .filter((c) => productFilter[c.product])
      .sort((a, b) => (b.risk_probability ?? 0) - (a.risk_probability ?? 0))
      .slice(0, showAll ? 100 : 20)
      .map((c) => ({ ...c, _color: TOUR_RISK_COLORS[c.risk_category] || '#94A3B8' }));
  }, [portfolio, productFilter, showAll]);

  // 4) Auto-play: avanza al siguiente cada 5/speed s.
  useEffect(() => {
    if (!isPlaying || tourPolicies.length === 0) return undefined;
    const id = setTimeout(() => setActiveIndex((i) => (i + 1) % tourPolicies.length), 5000 / speed);
    return () => clearTimeout(id);
  }, [isPlaying, activeIndex, tourPolicies.length, speed]);

  // 5) Teclado: ← → navegar, espacio play/pause.
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex((i) => (tourPolicies.length ? (i + 1) % tourPolicies.length : 0));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex((i) =>
          tourPolicies.length ? (i - 1 + tourPolicies.length) % tourPolicies.length : 0
        );
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tourPolicies.length]);

  // 6) Reset al cambiar filtro / cartera
  useEffect(() => {
    setActiveIndex(0);
  }, [productFilter, showAll, selectedId]);

  // 7) Cualquier cambio de selección reabre el panel (lo cierra onClose).
  useEffect(() => {
    setPanelOpen(true);
  }, [activeIndex]);

  const selectedClient = tourPolicies[activeIndex] || null;
  const policy3d = useMemo(
    () => (selectedClient ? adaptClientToPolicy(selectedClient) : null),
    [selectedClient]
  );

  const mapCenter = useMemo(() => {
    if (!tourPolicies.length) return VALENCIA_CENTER;
    const sx = tourPolicies.reduce((s, p) => s + Number(p.lon), 0);
    const sy = tourPolicies.reduce((s, p) => s + Number(p.lat), 0);
    return [sx / tourPolicies.length, sy / tourPolicies.length];
  }, [tourPolicies]);

  const selectPolicy = (i) => {
    setActiveIndex(i);
    setPanelOpen(true);
  };

  // Selección desde el mapa (click en un edificio asegurado) → por id.
  const selectById = (id) => {
    const i = tourPolicies.findIndex((p) => String(p.id) === String(id));
    if (i >= 0) selectPolicy(i);
  };

  if (loadError) return <LoadErrorState message={loadError} />;

  if (!portfolio) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* Aviso desktop — la consola es densa; el mapa sigue renderizando. */}
      <div className="md:hidden shrink-0 m-3 p-3 rounded-md border border-border-default bg-bg-surface text-text-secondary">
        <div className="text-10 font-mono uppercase tracking-[0.16em] mb-1 text-text-tertiary">
          Consola pensada para desktop
        </div>
        <p className="font-serif italic text-12 leading-snug">
          La consola de suscripción usa una densidad informativa pensada para 1280 px+. Funciona en
          móvil pero se lee mucho mejor en portátil.
        </p>
      </div>

      {/* Top strip · controles globales */}
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-border-default bg-bg-surface flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
          UW · Consola de suscripción
        </div>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[200px] sm:w-[240px] h-8 text-12">
            <SelectValue placeholder="Selecciona cartera" />
          </SelectTrigger>
          <SelectContent>
            {portfolios.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-12">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div
          className="inline-flex items-center border border-border-default rounded overflow-hidden h-8 text-10 font-mono uppercase tracking-wider shrink-0"
          role="group"
          aria-label="Tamaño del tour"
        >
          {[
            { v: false, label: 'Top 20' },
            { v: true, label: 'Top 100' },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setShowAll(opt.v)}
              className={
                'px-2 h-8 transition-colors ' +
                (showAll === opt.v
                  ? 'bg-brand-500 text-white'
                  : 'text-text-secondary hover:bg-bg-hover')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-11 font-mono text-text-tertiary tabular-nums hidden sm:inline">
          de {portfolio.clients?.length || 0} pólizas
        </span>
        <div className="sm:ml-auto flex items-center gap-1.5">
          {['particulares', 'pymes', 'autos'].map((p) => (
            <button
              key={p}
              onClick={() => setProductFilter((f) => ({ ...f, [p]: !f[p] }))}
              className={
                'text-10 font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors ' +
                (productFilter[p]
                  ? 'border-brand-500 text-brand-700 bg-brand-50'
                  : 'border-border-default text-text-tertiary hover:bg-bg-hover')
              }
            >
              {p}
            </button>
          ))}
          <span className="w-px h-5 bg-border-default mx-0.5" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setFloodOn((v) => !v)}
            aria-pressed={floodOn}
            title="Muestra la superficie de riesgo del modelo (P de inundación) sobre el suelo, bajo los edificios"
            className={
              'inline-flex items-center gap-1.5 text-10 font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors ' +
              (floodOn
                ? 'border-[#DC2626] bg-[#DC2626] text-white'
                : 'border-border-default text-text-tertiary hover:bg-bg-hover')
            }
          >
            <Waves className="w-3 h-3" />
            {floodOn ? 'Riesgo de suelo · ON' : 'Superficie de riesgo'}
          </button>
        </div>
      </div>

      {/* Mapa · MapLibre + extrusión por planta. Llena el espacio. */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-bg-base">
        {tourPolicies.length > 0 ? (
          <Map
            styles={OFM_STYLES}
            center={mapCenter}
            // Arranque como ciudad 3D oblicua (no plano cenital): a z12.5 los
            // edificios OSM ya renderizan y los asegurados se tintan de
            // entrada, igual que la referencia visual.
            zoom={12.5}
            minZoom={9}
            maxZoom={19}
            pitch={55}
            bearing={-17}
            maxPitch={70}
            className="h-full w-full"
          >
            <TourSceneLayers
              policies={tourPolicies}
              activeId={selectedClient?.id ?? null}
              floodOn={floodOn}
              onSelectPolicy={selectById}
            />
            <ConsoleMarkers
              policies={tourPolicies}
              activeIndex={activeIndex}
              onSelect={selectPolicy}
            />
            {policy3d && panelOpen && (
              <PolicyTour3D policy={policy3d} onClose={() => setPanelOpen(false)} />
            )}
          </Map>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-13">
            Sin pólizas que mostrar con los filtros actuales.
          </div>
        )}
        {tourPolicies.length > 0 && <TourLegend floodOn={floodOn} />}
      </div>

      {/* Dock · lista de pólizas + play/pause/speed (drive activeIndex). */}
      <TourDock
        policies={tourPolicies}
        activeIndex={activeIndex}
        onSelect={selectPolicy}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        speed={speed}
        onSpeed={setSpeed}
      />
    </div>
  );
}
