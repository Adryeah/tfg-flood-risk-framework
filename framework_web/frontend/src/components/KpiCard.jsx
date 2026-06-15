import React, { useRef, useEffect } from 'react';
import { InfoTooltip } from './InfoTooltip.jsx';
import { useInView, useCountUp } from '@/lib/animations.js';

/**
 * KpiCard · variante de KPI para métricas de TENDENCIA (con sparkline).
 *
 * Contrato compartido con ExposureKpi (ver DESIGN.md §6):
 *   - Misma motion (hover lift, mount fade+slide, count-up opt-in).
 *   - Mismo eyebrow mono caps tracked [0.16em].
 *   - Mismo count-up: pasa `numeric` (number) + `format` (v→string) y el
 *     número anima 0→target con ease-out cuártico al entrar al viewport.
 *
 * Cuándo usar KpiCard vs ExposureKpi:
 *   - KpiCard      → métrica de tendencia con evolución temporal (AUC,
 *                    recall, píxeles). El sparkline da el contexto del
 *                    "cómo ha cambiado". Severity rail por nivel.
 *   - ExposureKpi  → magnitud de cartera con jerarquía (TIV, PML, EAL).
 *                    El sistema TIER da el peso visual. Change pill ▲▼.
 */
export function KpiCard({
  label,
  value,
  unit,
  delta,
  trend,
  subInfo,
  sparkline,
  sparkColor = '#3B82F6',
  dotColor,
  info,
  severity,
  /** Italic-serif "what we want from this metric" annotation. Opt-in. */
  objective = null,
  /** Stagger entry animation across a row (idx × 60-80 ms). */
  animationDelay = 0,
  /**
   * Count-up opt-in. Pasa `numeric` (target) + `format` (función v→string)
   * y la card ignora `value` y anima 0→target con ease-out cuártico cuando
   * entra al viewport. Mismo contrato que ExposureKpi. Sin ambos, muestra
   * el string `value` directo (backwards-compat).
   */
  numeric = null,
  format = null,
  /** Linear×Basedash dark: acento semántico → top-border 2px (color =
   *  significado). sar/valid/purple/warn/risk. Sustituye al severity rail. */
  accent = null,
}) {
  const sparkRef = useRef(null);

  const ACCENT_BORDER = {
    sar: 'var(--accent-sar)',
    valid: 'var(--accent-valid)',
    purple: 'var(--accent-purple)',
    warn: 'var(--accent-warn)',
    risk: 'var(--accent-risk)',
  };
  const topBorder = accent ? ACCENT_BORDER[accent] : null;

  // Count-up opt-in: requiere AMBOS numeric (target) + format (formatter).
  // Trigger via IntersectionObserver — aunque los KPIs de Overview están
  // above-the-fold, el threshold 0.3 dispara igual en el primer paint.
  const animateCountUp =
    typeof numeric === 'number' && typeof format === 'function';
  const [inViewRef, inView] = useInView({ threshold: 0.3 });
  const animatedValue = useCountUp(animateCountUp ? numeric : 0, {
    active: animateCountUp && inView,
    duration: 1100,
    startDelay: animationDelay,
  });
  const displayValue = animateCountUp ? format(animatedValue) : value;

  useEffect(() => {
    if (!sparkRef.current || !sparkline || sparkline.length < 2) return;

    const width = 80;
    const height = 26;
    const padding = 2;
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const dx = (width - padding * 2) / (sparkline.length - 1);

    const pts = sparkline.map((v, i) => {
      const x = padding + i * dx;
      const y = padding + (height - padding * 2) * (1 - (v - min) / range);
      return [x, y];
    });

    const line = pts.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`)).join(' ');
    const fill = `${line} L${(width - padding).toFixed(1)},${height} L${padding},${height} Z`;

    // Render with the stroke "hidden" (full dashoffset) and the fill area
    // at opacity 0. After the next frame, snap them to their target values
    // so the CSS transition kicks in. Net effect: stroke draws in left-to-
    // right, fill area fades in underneath. ~520 ms total — within emil's
    // <300 ms-for-UI budget for occasional decorations like KPI sparklines
    // that the user sees on a single dashboard render, not 100×/day.
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path data-spark-area d="${fill}" fill="${sparkColor}" fill-opacity="0"
              style="transition: fill-opacity 380ms cubic-bezier(0.23,1,0.32,1) 80ms;" />
        <path data-spark-line d="${line}" fill="none" stroke="${sparkColor}" stroke-width="1.5"
              stroke-linejoin="round" stroke-linecap="round" />
      </svg>
    `;
    sparkRef.current.innerHTML = svg;

    const linePath = sparkRef.current.querySelector('[data-spark-line]');
    const areaPath = sparkRef.current.querySelector('[data-spark-area]');
    if (!linePath) return;

    // getTotalLength is the canonical SVG path-length API. We freeze the
    // path "hidden" by setting stroke-dasharray = length and dashoffset =
    // length (the dash equals the path, so nothing's visible). Then we
    // transition dashoffset to 0 — the dash "moves" along, revealing the
    // stroke left-to-right.
    const L = linePath.getTotalLength();
    linePath.style.strokeDasharray = String(L);
    linePath.style.strokeDashoffset = String(L);
    linePath.style.transition = 'stroke-dashoffset 520ms cubic-bezier(0.23,1,0.32,1)';

    // Two RAFs so the initial style commits BEFORE the transition target,
    // otherwise Chrome batches both and the draw-in skips.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        linePath.style.strokeDashoffset = '0';
        if (areaPath) areaPath.setAttribute('fill-opacity', '0.08');
      });
    });
  }, [sparkline, sparkColor]);

  // Paleta alineada con Flood Risk × Zurich Design System — accent-info
  // para informativo, paleta de risk semantics (risk-low/medium/high/
  // critical) para los niveles de severidad. Antes hardcodeaba los
  // greens/ambers/blues del sistema anterior y desentonaba con
  // ExposureKpi.VARIANT_DOT.
  const severityColors = { info: '#3B82F6', low: '#10B981', medium: '#F39C12', high: '#E74C3C', critical: '#DC2626' };
  const trendColors = { up: 'text-[#10B981]', down: 'text-[#F39C12]', neutral: 'text-text-tertiary' };
  const trendArrows = { up: '▲', down: '▼', neutral: '·' };

  return (
    <div
      ref={inViewRef}
      className="kpi-card group bg-bg-surface rounded-lg p-3.5 relative overflow-hidden transition-all duration-200 ease-out hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2"
      data-accent={accent || undefined}
      style={{
        boxShadow: 'var(--shadow-card)',
        animationDelay: `${animationDelay}ms`,
        animationDuration: '500ms',
        animationFillMode: 'backwards',
        // Linear×Basedash: 2px top-border en el accent semántico.
        borderTop: topBorder ? `2px solid ${topBorder}` : undefined,
      }}
    >
      {/* Left severity rail solo cuando NO hay accent top-border (modo
       *  legacy). En el dark redesign el color va arriba. */}
      {severity && !accent && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-300 ease-out group-hover:w-[4px]"
          style={{ backgroundColor: severityColors[severity] || 'var(--accent-sar)' }}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <span className="text-10 font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)', fontWeight: 510 }}>{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {info && <InfoTooltip what={info.what} source={info.source} />}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 mt-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="mono-val text-[26px] text-text-primary leading-none tracking-tight" style={{ fontWeight: 500 }}>{displayValue}</span>
          {unit && <span className="mono-val text-12 text-text-secondary">{unit}</span>}
          {delta && (
            <span className={`mono-val font-medium text-11 flex items-center gap-0.5 ${trendColors[trend || 'neutral']}`}>
              <span>{trendArrows[trend || 'neutral']}</span>
              <span>{delta}</span>
            </span>
          )}
        </div>
        {/* Sparklines removed in dark redesign (spec Agent 4). Kept render
         *  path only when no accent (legacy light usage). */}
        {!accent && sparkline && sparkline.length > 1 && <div ref={sparkRef} className="shrink-0" />}
      </div>

      {/* Separator 20px del spec, en el accent color */}
      {topBorder && (
        <div className="mt-2 mb-1" style={{ width: 20, height: 1.5, background: topBorder }} />
      )}

      {subInfo && <div className="mt-1.5 text-11 text-text-secondary truncate">{subInfo}</div>}

      {/* Goal annotation — italic serif, short. Reads as paper margin
       *  note. El hairline propio solo cuando NO hay accent (en dark el
       *  separator del accent ya hace de divisor). */}
      {objective && (
        <>
          {!topBorder && (
            <div
              className="h-px mt-2 mb-1.5 w-7"
              style={{ background: severityColors[severity] || 'var(--text-muted)', opacity: 0.6 }}
            />
          )}
          <div className="font-serif italic text-11 leading-snug" style={{ color: 'var(--text-muted)' }}>
            {objective}
          </div>
        </>
      )}
    </div>
  );
}