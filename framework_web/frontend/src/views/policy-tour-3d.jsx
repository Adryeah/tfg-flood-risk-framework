import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { TourDock } from '@/components/tour-dock.jsx';

// Lazy-load del TourMap porque importa CesiumJS (~3 MB). Sólo se
// descarga cuando el usuario navega realmente a /tour; el resto de
// vistas (Overview, Maps, Portfolio, etc.) no cargan Cesium.
const TourMap = React.lazy(() =>
  import('@/components/tour-map.jsx').then((m) => ({ default: m.TourMap }))
);

// Mapeo categoría de riesgo → color del halo y de la fila del dock.
// Coincide con la paleta del risk-surface raster (YlOrRd) para que un
// edificio en zona roja del mapa muestre un halo del mismo rojo.
const RISK_COLORS = {
  low: '#FBBF24',
  moderate: '#F87171',
  high: '#DC2626',
  very_high: '#7F1D1D',
};

export function PolicyTour3D() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedId, setSelectedId] = useState('wide_distribution');
  const [portfolio, setPortfolio] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [productFilter, setProductFilter] = useState({
    particulares: true,
    pymes: true,
    autos: true,
  });
  const [speed, setSpeed] = useState(1);

  // 1) Index de carteras
  useEffect(() => {
    let mounted = true;
    api.portfolio
      .getPredefined()
      .then((res) => {
        if (!mounted) return;
        setPortfolios(res?.portfolios || []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // 2) Cartera seleccionada
  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    api.portfolio
      .getById(selectedId)
      .then((p) => {
        if (!mounted) return;
        setPortfolio(p);
        setActiveIndex(0);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  // 3) Pólizas del tour: filtradas por producto, ordenadas por riesgo
  // descendente, top-20 (o top-100 si showAll). Cada póliza recibe un
  // color derivado de su categoría para que TourMap y TourDock usen
  // la misma paleta sin recomputar.
  const tourPolicies = useMemo(() => {
    if (!portfolio?.clients) return [];
    return portfolio.clients
      .filter((c) => productFilter[c.product])
      .sort((a, b) => (b.risk_probability ?? 0) - (a.risk_probability ?? 0))
      .slice(0, showAll ? 100 : 20)
      .map((c) => ({
        ...c,
        _color: RISK_COLORS[c.risk_category] || '#94A3B8',
      }));
  }, [portfolio, productFilter, showAll]);

  // 4) Auto-play: avanza al siguiente cada 5/speed segundos.
  useEffect(() => {
    if (!isPlaying || tourPolicies.length === 0) return;
    const id = setTimeout(() => {
      setActiveIndex((i) => (i + 1) % tourPolicies.length);
    }, 5000 / speed);
    return () => clearTimeout(id);
  }, [isPlaying, activeIndex, tourPolicies.length, speed]);

  // 5) Teclado: ← → para navegar, espacio para play/pause.
  useEffect(() => {
    const handler = (e) => {
      // Ignorar si el foco está en un input
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex((i) =>
          tourPolicies.length ? (i + 1) % tourPolicies.length : 0
        );
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex((i) =>
          tourPolicies.length
            ? (i - 1 + tourPolicies.length) % tourPolicies.length
            : 0
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

  if (!portfolio) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* Top strip · controles globales */}
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-border-default bg-bg-surface flex items-center gap-2 sm:gap-3 flex-wrap">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
          UW · 3D Policy Tour
        </div>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[200px] sm:w-[240px] h-8 text-12">
            <SelectValue placeholder="Cartera" />
          </SelectTrigger>
          <SelectContent>
            {portfolios.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-12">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Segmented control de tamaño del tour. Toggle entre Top-20
         *  (default, demo concisa) y Top-100 (tour completo). El
         *  número se ordena por riesgo descendente. */}
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
                  ? 'bg-corporate-navy text-white'
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
              onClick={() =>
                setProductFilter((f) => ({ ...f, [p]: !f[p] }))
              }
              className={
                'text-10 font-mono uppercase tracking-wider px-2 py-1 rounded border transition-colors ' +
                (productFilter[p]
                  ? 'border-corporate-navy text-corporate-navy bg-corporate-navy-light'
                  : 'border-border-default text-text-tertiary hover:bg-bg-hover')
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Mapa 3D · llena el espacio disponible. Suspense fallback es
       *  el mismo loading state que usa el TourMap internamente para
       *  inicializar Cesium — sensación visual consistente. */}
      <div className="flex-1 min-h-0 relative bg-bg-base">
        {tourPolicies.length > 0 ? (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-13 font-mono uppercase tracking-[0.18em] text-text-secondary animate-pulse">
                  Inicializando motor 3D…
                </div>
              </div>
            }
          >
            <TourMap policies={tourPolicies} activeIndex={activeIndex} />
          </Suspense>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-13">
            Sin pólizas que mostrar con los filtros actuales.
          </div>
        )}
      </div>

      {/* Dock · controles de tour + lista horizontal */}
      <TourDock
        policies={tourPolicies}
        activeIndex={activeIndex}
        onSelect={setActiveIndex}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        speed={speed}
        onSpeed={setSpeed}
      />
    </div>
  );
}
