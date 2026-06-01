import React from 'react';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';

import { formatMoney, formatPercent } from '@/lib/format.js';

const PRODUCT_LABEL = {
  particulares: 'PART',
  pymes: 'PYME',
  autos: 'AUTO',
};

// Acento por categoría de riesgo — usado en el chip "Pérdida est."
// del strip superior del dock.
const RISK_FG = {
  low: '#A16207',
  moderate: '#C2410C',
  high: '#B91C1C',
  very_high: '#7F1D1D',
};

export function TourDock({
  policies,
  activeIndex,
  onSelect,
  isPlaying,
  onTogglePlay,
  speed,
  onSpeed,
}) {
  const active = policies[activeIndex];
  const n = policies.length;

  // Auto-scroll del chip activo al centro de la cinta cuando cambia.
  const stripRef = React.useRef(null);
  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const chip = strip.querySelector(`[data-idx="${activeIndex}"]`);
    if (chip) {
      chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <div className="shrink-0 bg-bg-surface border-t border-border-default">
      {/* ─── Strip superior · datos de la póliza activa ─────────── */}
      {active && (
        <div className="px-3 sm:px-4 py-2.5 border-b border-border-default grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-2 text-12">
          <DockMetric label="Póliza" value={active.id} mono />
          <DockMetric
            label="Producto"
            value={`${PRODUCT_LABEL[active.product] || active.product} · ${active.subtype || ''}`}
          />
          <DockMetric
            label="Planta"
            value={
              active.product === 'autos'
                ? 'Parking'
                : active.ground_floor
                  ? 'Baja'
                  : `${active.floor_count || 1}.ª`
            }
          />
          <DockMetric
            label="P(flood)"
            value={formatPercent(active.risk_probability, 1)}
            mono
            accent={RISK_FG[active.risk_category]}
          />
          <DockMetric
            label="Asegurado"
            value={formatMoney(active.insured_value)}
            mono
          />
          <DockMetric
            label="Pérdida est."
            value={formatMoney(active.estimated_loss_dana)}
            mono
            accent={RISK_FG[active.risk_category]}
          />
        </div>
      )}

      {/* ─── Strip inferior · controles + cinta de pólizas ──────── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => onSelect(((activeIndex - 1) + n) % n)}
          disabled={n === 0}
          aria-label="Póliza anterior"
          className="w-8 h-8 inline-flex items-center justify-center rounded border border-border-default hover:bg-bg-hover transition-colors shrink-0 disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={onTogglePlay}
          disabled={n === 0}
          aria-label={isPlaying ? 'Pausar tour' : 'Reproducir tour'}
          className="w-9 h-8 inline-flex items-center justify-center rounded border border-corporate-navy text-corporate-navy bg-corporate-navy-light hover:bg-brand-100 transition-colors shrink-0 disabled:opacity-40"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" strokeWidth={1.75} />
          ) : (
            <Play className="w-4 h-4" strokeWidth={1.75} />
          )}
        </button>
        <button
          onClick={() => onSelect((activeIndex + 1) % n)}
          disabled={n === 0}
          aria-label="Póliza siguiente"
          className="w-8 h-8 inline-flex items-center justify-center rounded border border-border-default hover:bg-bg-hover transition-colors shrink-0 disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
        </button>

        {/* Velocidades */}
        <div
          className="inline-flex items-center border border-border-default rounded overflow-hidden h-8 text-11 font-mono shrink-0"
          role="group"
          aria-label="Velocidad del tour"
        >
          {[0.5, 1, 2].map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              className={
                'px-2 h-8 transition-colors ' +
                (speed === s
                  ? 'bg-corporate-navy text-white'
                  : 'text-text-secondary hover:bg-bg-hover')
              }
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="text-11 font-mono text-text-tertiary tabular-nums ml-1 shrink-0">
          {n > 0 ? activeIndex + 1 : 0} / {n}
        </div>

        {/* Cinta horizontal de pólizas */}
        <div
          ref={stripRef}
          className="flex-1 min-w-0 overflow-x-auto scrollbar-thin"
        >
          <div className="flex items-center gap-1.5 pl-1 pr-1">
            {policies.map((p, i) => (
              <button
                key={p.id || i}
                data-idx={i}
                onClick={() => onSelect(i)}
                className={
                  'shrink-0 inline-flex items-center gap-1.5 px-2 h-7 rounded border text-10 font-mono uppercase tracking-wider transition-colors ' +
                  (i === activeIndex
                    ? 'border-corporate-navy bg-corporate-navy text-white'
                    : 'border-border-default text-text-secondary hover:bg-bg-hover')
                }
                title={`#${i + 1} · ${p.id} · ${formatPercent(p.risk_probability, 1)} · ${formatMoney(p.insured_value)}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm shrink-0"
                  style={{ background: p._color }}
                  aria-hidden
                />
                {String(i + 1).padStart(3, '0')}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block text-10 font-mono text-text-tertiary uppercase tracking-wider whitespace-nowrap shrink-0">
          ← → · espacio
        </div>
      </div>
    </div>
  );
}

function DockMetric({ label, value, mono, accent }) {
  return (
    <div className="min-w-0">
      <div className="text-10 font-mono uppercase tracking-wider text-text-tertiary mb-0.5">
        {label}
      </div>
      <div
        className={'truncate ' + (mono ? 'font-mono ' : '')}
        style={{
          color: accent || undefined,
          fontWeight: accent ? 600 : 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}
