import React from 'react';
import { cn } from '@/lib/utils';

/**
 * KPI tile con sistema de jerarquía TIER (1 | 2 | 3) usado en
 * Portfolio Explorer y Exposure Dashboard.
 *
 * SISTEMA TIER (spec Zurich · KPI hierarchy)
 *  · TIER 1 — anchor metric. Borde navy, gradient background, sombra
 *    profunda, big number text-32. Ocupa 2 columnas en el grid (vía
 *    .kpi-card[data-tier="1"] { grid-column: span 2 } en main.css).
 *    Para los dos números que el stakeholder mira primero (TIV, PML).
 *  · TIER 2 — operational metric. Borde sutil, sombra estándar,
 *    number text-22. Ancho normal (1 columna). EAL, exposición de
 *    riesgo alto.
 *  · TIER 3 — drill-down. Sombra mínima, opacidad ligeramente
 *    reducida, number text-18. Para conteos secundarios.
 *
 * CHANGE INDICATOR
 *  · Opcional `change={{ value: 12.3, isPositive: true, format: '%' }}`
 *  · Pinta ▲ o ▼ + valor + unidad en verde (positive) o rojo
 *    (negative), bajo el número principal. La semántica
 *    "positivo = bueno" la decide el caller, no la card (un EAL
 *    bajando ES positivo aunque el delta sea negativo).
 *
 * El componente sigue siendo controlled-by-props: todas las
 * variantes son visuales (data-attributes + Tailwind classes). No
 * añade lógica nueva.
 */
const VARIANT_DOT = {
  default: '#9CA3AF',
  info: '#3B82F6',
  warning: '#F39C12',
  risk: '#E74C3C',
  success: '#10B981',
};

export function ExposureKpi({
  label,
  value,
  unit,
  sub,
  variant = 'default',
  /** Jerarquía visual: 1 = anchor (span 2), 2 = standard, 3 = drill-down. */
  tier = 2,
  /**
   * Indicador delta. Forma: { value: number, isPositive: boolean,
   * format?: string }. `format` es lo que se imprime después del
   * número (ej. '%' o 'pts'). Si no se pasa, no se renderiza
   * indicador.
   */
  change = null,
  /** Optional one-line objective en serif italic (margin annotation). */
  objective = null,
  /**
   * Entry-animation delay en ms para staggered reveals. Pasa
   * `idx * 80` desde el grid padre para que la fila se desvele
   * left-to-right.
   */
  animationDelay = 0,
}) {
  const dot = VARIANT_DOT[variant] || VARIANT_DOT.default;

  // Tamaño del número principal escala con tier — anchor más grande.
  const valueSizeClass =
    tier === 1
      ? 'text-32 leading-none'
      : tier === 3
        ? 'text-18 leading-none'
        : 'text-22 leading-none';

  return (
    <div
      className={cn(
        // Base · .kpi-card es el hook CSS que aplica tier-specific
        // border/bg/shadow/span vía main.css. Aquí solo padding +
        // transition + animation.
        'kpi-card group relative px-4 py-3.5 transition-all duration-200',
        'animate-in fade-in slide-in-from-bottom-2 duration-500'
      )}
      data-tier={tier}
      data-variant={variant}
      style={{
        animationDelay: `${animationDelay}ms`,
        animationFillMode: 'backwards',
      }}
    >
      {/* Label row: dot variant + tracked-out uppercase mono caps */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: dot }}
          aria-hidden="true"
        />
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>

      {/* Big numerical anchor — el tamaño cambia por tier */}
      <div className="flex items-baseline gap-1.5 mt-2">
        <span
          className={cn(
            valueSizeClass,
            'font-semibold font-mono text-text-primary tabular-nums tracking-tight'
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-12 text-text-secondary font-mono">{unit}</span>
        )}
      </div>

      {/* Change indicator opcional · ▲ verde / ▼ rojo / ◦ neutral
       *
       *  Tres direcciones lógicas, no dos:
       *   · value > 0 + isPositive=true  → ▲ verde (delta favorable)
       *   · value > 0 + isPositive=false → ▼ rojo  (delta desfavorable)
       *   · value === 0                  → ◦ neutral grey ("flat")
       *  Sin esto, un delta de cero rendía "▲ 0" o "▼ 0" — semánticamente
       *  incorrecto. El caller decide la semántica positivo/negativo
       *  (un EAL bajando es POSITIVO aunque value sea negativo). */}
      {change && typeof change.value === 'number' && (
        <div className="mt-1.5 inline-flex items-center gap-1">
          <span
            className="kpi-change inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-11 font-mono font-semibold tabular-nums"
            data-direction={
              change.value === 0
                ? 'neutral'
                : change.isPositive
                  ? 'positive'
                  : 'negative'
            }
          >
            <span aria-hidden="true">
              {change.value === 0 ? '◦' : change.isPositive ? '▲' : '▼'}
            </span>
            <span>
              {Math.abs(change.value).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}
              {change.format || ''}
            </span>
          </span>
          {change.label && (
            <span className="text-10 font-mono text-text-tertiary uppercase tracking-wider">
              {change.label}
            </span>
          )}
        </div>
      )}

      {/* Sub caption */}
      {sub && (
        <div className="mt-1.5 text-11 text-text-secondary leading-snug truncate">
          {sub}
        </div>
      )}

      {/* Goal / objective — italic serif, short. Reads as paper-margin
       *  annotation. Reservado para TIER 1 y TIER 2; TIER 3 lo omite
       *  para mantener la densidad compacta. */}
      {objective && tier !== 3 && (
        <>
          <div
            className="h-px mt-2 mb-1.5"
            style={{
              width: 28,
              background: dot,
              opacity: 0.6,
            }}
          />
          <div className="font-serif italic text-11 text-text-tertiary leading-snug">
            {objective}
          </div>
        </>
      )}
    </div>
  );
}
