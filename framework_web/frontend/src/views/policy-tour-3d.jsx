import React, { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';

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

/** Marcadores de todas las pólizas del tour; click → selecciona. */
function ConsoleMarkers({ policies, activeIndex, onSelect }) {
  return policies.map((p, i) => (
    <MapMarker key={p.id} longitude={p.lon} latitude={p.lat}>
      <MarkerContent>
        <button
          type="button"
          onClick={() => onSelect(i)}
          aria-label={`Póliza ${p.id}`}
          className="block rounded-full transition-transform hover:scale-125"
          style={{
            width: i === activeIndex ? 15 : 10,
            height: i === activeIndex ? 15 : 10,
            background: p._color,
            border:
              i === activeIndex
                ? '2px solid #f7f8f8'
                : '1px solid rgba(8,9,10,0.6)',
            boxShadow:
              i === activeIndex ? '0 0 0 3px rgba(247,248,248,0.18)' : 'none',
          }}
        />
      </MarkerContent>
    </MapMarker>
  ));
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
  const [loadError, setLoadError] = useState(null);

  // 1) Index de carteras
  useEffect(() => {
    let mounted = true;
    api.portfolio
      .getPredefined()
      .then((res) => mounted && setPortfolios(res?.portfolios || []))
      .catch(
        (err) =>
          mounted &&
          setLoadError(err?.message || 'No se pudo cargar el índice de carteras')
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
          mounted &&
          setLoadError(err?.message || 'No se pudo cargar la cartera seleccionada')
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
    const id = setTimeout(
      () => setActiveIndex((i) => (i + 1) % tourPolicies.length),
      5000 / speed
    );
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
          La Underwriter Console usa una densidad informativa pensada para
          1280 px+. Funciona en móvil pero se lee mucho mejor en portátil.
        </p>
      </div>

      {/* Top strip · controles globales */}
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-border-default bg-bg-surface flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
          UW · Underwriter Console
        </div>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[200px] sm:w-[240px] h-8 text-12">
            <SelectValue placeholder="Select portfolio" />
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
        </div>
      </div>

      {/* Mapa · MapLibre + extrusión por planta. Llena el espacio. */}
      <div className="flex-1 min-h-0 relative bg-bg-base">
        {tourPolicies.length > 0 ? (
          <Map
            styles={OFM_STYLES}
            center={mapCenter}
            zoom={11}
            minZoom={9}
            maxZoom={19}
            maxPitch={70}
            className="h-full w-full"
          >
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
