import React from 'react';
import { RETURN_PERIODS, useReturnPeriod, rpLabel } from '@/lib/return-period.js';

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
          Return period
        </span>
      )}
      <div
        className="inline-flex items-center gap-1 p-1 rounded-md border border-border-default bg-bg-subtle"
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
