import React, { useRef, useEffect } from 'react';
import { InfoTooltip } from './InfoTooltip.jsx';

export function KpiCard({
  label,
  value,
  unit,
  delta,
  trend,
  subInfo,
  sparkline,
  sparkColor = '#2563EB',
  dotColor,
  info,
  severity,
  /** Italic-serif "what we want from this metric" annotation. Opt-in. */
  objective = null,
  /** Stagger entry animation across a row (idx × 60-80 ms). */
  animationDelay = 0,
}) {
  const sparkRef = useRef(null);

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

  const severityColors = { info: '#2563EB', low: '#16A34A', medium: '#D97706', high: '#DC2626', critical: '#991B1B' };
  const trendColors = { up: 'text-[#16A34A]', down: 'text-[#D97706]', neutral: 'text-text-tertiary' };
  const trendArrows = { up: '▲', down: '▼', neutral: '·' };

  return (
    <div
      className="bg-bg-surface border border-border-default rounded shadow-sm p-3.5 relative overflow-hidden transition-colors hover:border-border-strong animate-in fade-in slide-in-from-bottom-2 duration-500"
      style={{ animationDelay: `${animationDelay}ms`, animationFillMode: 'backwards' }}
    >
      {severity && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: severityColors[severity] || '#2563EB' }} />}

      <div className="flex items-start justify-between gap-2">
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {dotColor && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />}
          {info && <InfoTooltip what={info.what} source={info.source} />}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 mt-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-22 font-semibold font-mono text-text-primary leading-none tracking-tight">{value}</span>
          {unit && <span className="text-12 text-text-secondary font-mono">{unit}</span>}
          {delta && (
            <span className={`font-mono font-medium text-11 flex items-center gap-0.5 ${trendColors[trend || 'neutral']}`}>
              <span>{trendArrows[trend || 'neutral']}</span>
              <span>{delta}</span>
            </span>
          )}
        </div>
        {sparkline && sparkline.length > 1 && <div ref={sparkRef} className="shrink-0" />}
      </div>

      {subInfo && <div className="mt-1.5 text-11 text-text-secondary truncate">{subInfo}</div>}

      {/* Goal annotation — italic serif, short. Reads as paper margin
       *  note, not as another UI label. */}
      {objective && (
        <>
          <div
            className="h-px mt-2 mb-1.5 w-7"
            style={{ background: severityColors[severity] || '#94A3B8', opacity: 0.6 }}
          />
          <div className="font-serif italic text-11 text-text-tertiary leading-snug">
            {objective}
          </div>
        </>
      )}
    </div>
  );
}