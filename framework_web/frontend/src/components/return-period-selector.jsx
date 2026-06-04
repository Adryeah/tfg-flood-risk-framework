import React from 'react';
import {
  RETURN_PERIODS,
  useReturnPeriod,
  rpLabel,
  useBackbone,
  BACKBONE_LABELS,
  BACKBONE_SOURCES,
} from '@/lib/return-period.js';

/**
 * Selector global de Return Period.
 *
 * Dos variantes via prop `variant`:
 *  · 'console' — mil-spec ribbon dentro del HUD del Underwriter
 *    Console. Compacto, pills 22 px alto, tipografía mono 9 px,
 *    sobre fondo navy semi-transparente. Pensado para el bottom
 *    StatusStrip.
 *  · 'dashboard' — versión más amplia para Exposure Dashboard.
 *    Pills 28 px, labels con typografia editorial, fondo white card.
 *
 * Persiste el estado en localStorage automáticamente vía
 * useReturnPeriod hook. Cualquier consumer que lea useReturnPeriod
 * recibe el nuevo valor al instante.
 *
 * Props:
 *   variant     'console' | 'dashboard' (default 'console')
 *   showLabel   muestra "RP" prefix (default true en console, false
 *               en dashboard donde el contexto está implícito)
 */
const RP_TINT = {
  // Tinte por RP refuerza la severidad: T10 frío azul, T500 rojo
  // oscuro. Misma curva semántica que el risk-low → risk-critical.
  10: '#3B82F6',
  50: '#22D3EE',
  100: '#F59E0B',
  250: '#E74C3C',
  500: '#7F1D1D',
};

export function ReturnPeriodSelector({
  variant = 'console',
  showLabel,
  className = '',
}) {
  const [rp, setRP] = useReturnPeriod();
  const isConsole = variant === 'console';
  const labelOn = showLabel ?? isConsole;

  if (isConsole) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        {labelOn && (
          <span className="text-9 font-mono uppercase tracking-[0.18em] text-white/55">
            RP:
          </span>
        )}
        <div
          className="inline-flex items-center gap-0.5 px-0.5 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          role="radiogroup"
          aria-label="Return period"
        >
          {RETURN_PERIODS.map((value) => {
            const active = value === rp;
            const tint = RP_TINT[value] || '#94A3B8';
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setRP(value)}
                className="px-1.5 py-0.5 rounded text-9 font-mono uppercase tracking-widest tabular-nums transition-all"
                style={
                  active
                    ? { background: tint, color: '#0F172A' }
                    : { color: 'rgba(255,255,255,0.55)' }
                }
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = '#F8FAFC';
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                }}
                title={`Return period ${value} años`}
              >
                {rpLabel(value)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // variant === 'dashboard' · pill grandes, fondo white card
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {labelOn && (
        <span className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary">
          Periodo de retorno
        </span>
      )}
      <div
        className="inline-flex items-center gap-1 p-1 rounded-md border border-border-default bg-bg-subtle"
        role="radiogroup"
        aria-label="Periodo de retorno"
      >
        {RETURN_PERIODS.map((value) => {
          const active = value === rp;
          const tint = RP_TINT[value] || '#94A3B8';
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setRP(value)}
              className="px-2.5 py-1 rounded text-11 font-mono font-semibold uppercase tracking-widest tabular-nums transition-all"
              style={
                active
                  ? { background: tint, color: '#FFFFFF' }
                  : { color: 'var(--text-secondary)' }
              }
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.background = 'rgba(15,27,53,0.05)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
              title={`Periodo de retorno ${value} años`}
            >
              {rpLabel(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Selector de fuente backbone (RF v2 propio vs SNCZI oficial).
 * Variante 'console' (mil-spec compacto) y 'dashboard' (chip más grande).
 * Persistido global en localStorage vía useBackbone hook.
 */
export function BackboneSourceSelector({ variant = 'console', className = '' }) {
  const [source, setSource] = useBackbone();
  const isConsole = variant === 'console';

  if (isConsole) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span className="text-9 font-mono uppercase tracking-[0.18em] text-white/55">
          Fuente:
        </span>
        <div
          className="inline-flex items-center gap-0.5 px-0.5 py-0.5 rounded"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          role="radiogroup"
          aria-label="Fuente del backbone"
        >
          {BACKBONE_SOURCES.map((s) => {
            const active = s === source;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSource(s)}
                className="px-1.5 py-0.5 rounded text-9 font-mono uppercase tracking-widest transition-all"
                style={
                  active
                    ? { background: '#0F1B35', color: '#F8FAFC' }
                    : { color: 'rgba(255,255,255,0.55)' }
                }
                title={BACKBONE_LABELS[s]}
              >
                {s === 'rf_v2' ? 'RF V2' : 'SNCZI'}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // dashboard variant
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary">
        Fuente backbone
      </span>
      <div
        className="inline-flex items-center gap-1 p-1 rounded-md border border-border-default bg-bg-subtle"
        role="radiogroup"
        aria-label="Fuente del backbone"
      >
        {BACKBONE_SOURCES.map((s) => {
          const active = s === source;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSource(s)}
              className="px-2.5 py-1 rounded text-11 font-mono font-semibold uppercase tracking-widest transition-all"
              style={
                active
                  ? { background: '#0F1B35', color: '#F8FAFC' }
                  : { color: 'var(--text-secondary)' }
              }
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.background = 'rgba(15,27,53,0.05)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
              title={BACKBONE_LABELS[s]}
            >
              {s === 'rf_v2' ? 'RF v2' : 'SNCZI'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
