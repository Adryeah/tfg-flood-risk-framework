import React from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/animations.js';

/**
 * ScaleRail — firma unificada de los KPIs de la plataforma.
 *
 * Convierte un número plano en una lectura de instrumento: dónde cae el valor
 * dentro de su escala, con un tick semántico opcional (umbral operacional,
 * baseline de azar, objetivo). Sale del ADN del proyecto — todo gira en torno
 * a puntos de operación (AUC vs azar 0.5, recall ≥ 0.75, threshold 0.614).
 *
 * Comportamientos según el tipo de métrica (los fija el caller con min/max):
 *   - score:     min=0.5,max=1.0  → el fill refleja el rango ÚTIL (azar→perfecto)
 *   - umbral:    min=0,max=1, threshold=0.75 → tick del objetivo operacional
 *   - magnitud-share: value=parte, max=total → fill = % del total (PML/TIV)
 *
 * @param {{
 *   value:number, min?:number, max?:number, color?:string,
 *   threshold?:number|null, thresholdLabel?:string|null,
 *   leftLabel?:string|null, rightLabel?:string|null
 * }} props
 */
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

export function ScaleRail({
  value,
  min = 0,
  max = 1,
  color = 'var(--accent-sar-text)',
  threshold = null,
  thresholdLabel = null,
  leftLabel = null,
  rightLabel = null,
}) {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView({ threshold: 0.3 });

  const span = max - min || 1;
  const pct = clamp01((value - min) / span) * 100;
  const tickPct = threshold != null ? clamp01((threshold - min) / span) * 100 : null;
  const w = reduced ? pct : inView ? pct : 0;

  const hasLabels = leftLabel || rightLabel || thresholdLabel;

  return (
    <div ref={ref} className="mt-2.5">
      <div
        className="relative h-[5px] rounded-[3px]"
        style={{
          background: 'var(--surface-canvas)',
          boxShadow: 'inset 0 0 0 1px var(--border-default)',
        }}
        role="img"
        aria-label={`${pct.toFixed(0)} por ciento de la escala`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[3px]"
          style={{
            width: `${w}%`,
            background: color,
            transition: reduced ? 'none' : 'width 900ms cubic-bezier(0.23,1,0.32,1)',
          }}
        />
        {tickPct != null && (
          <div
            className="absolute"
            style={{
              left: `${tickPct}%`,
              top: -3,
              bottom: -3,
              width: 1,
              background: 'var(--text-secondary)',
            }}
            aria-hidden="true"
          />
        )}
      </div>
      {hasLabels && (
        <div className="mt-1 flex items-center justify-between text-10 font-mono uppercase tracking-[0.1em] text-text-tertiary">
          <span>{leftLabel}</span>
          {thresholdLabel && (
            <span style={{ color: 'var(--accent-warn-text)' }}>{thresholdLabel}</span>
          )}
          <span className="text-right">{rightLabel}</span>
        </div>
      )}
    </div>
  );
}
