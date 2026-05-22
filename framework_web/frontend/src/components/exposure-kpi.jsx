import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Editorial KPI tile used across Portfolio Explorer + Exposure Dashboard.
 *
 * Design intent (per `frontend-design` + `minimalist-ui` skills):
 *  - No card chrome. The previous version was a rounded box with a left
 *    variant rail — classic AI-dashboard default. Now it's stacked
 *    typography: tracked-out mono label, large mono number, italic
 *    serif "objective" line at the bottom.
 *  - Variant encoded as a tiny dot next to the label, not a full rail.
 *  - Optional `objective`: a one-line "what we want from this number"
 *    (maximise / minimise / monitor) set in serif italic so it reads
 *    as scholia, not chrome.
 *  - Entry animation: fade + slide-up from bottom over 500 ms. Stagger
 *    via the `animationDelay` prop when rendering in a row.
 */
const VARIANT_DOT = {
  default: '#94A3B8',
  info: '#2563EB',
  warning: '#D97706',
  risk: '#DC2626',
  success: '#16A34A',
};

export function ExposureKpi({
  label,
  value,
  unit,
  sub,
  variant = 'default',
  /** Optional one-line objective in italic serif (e.g. "Maximizar — ranking"). */
  objective = null,
  /**
   * Optional entry-animation delay in ms. Pass `idx * 80` from the parent
   * grid so a row of 5 KPIs reveals left-to-right rather than all at once.
   */
  animationDelay = 0,
}) {
  const dot = VARIANT_DOT[variant] || VARIANT_DOT.default;

  return (
    <div
      className={cn(
        // No card border / radius / shadow. Just internal padding and a
        // hover background shift so the tile responds without dressing
        // up as a button.
        'group relative px-4 py-3 transition-colors',
        'hover:bg-bg-subtle/40',
        'animate-in fade-in slide-in-from-bottom-2 duration-500'
      )}
      style={{ animationDelay: `${animationDelay}ms`, animationFillMode: 'backwards' }}
    >
      {/* Label row: dot + tracked-out uppercase mono caps */}
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

      {/* Big numerical anchor */}
      <div className="flex items-baseline gap-1.5 mt-2">
        <span className="text-22 font-semibold font-mono text-text-primary leading-none tabular-nums tracking-tight">
          {value}
        </span>
        {unit && (
          <span className="text-12 text-text-secondary font-mono">{unit}</span>
        )}
      </div>

      {/* Sub caption */}
      {sub && (
        <div className="mt-1.5 text-11 text-text-secondary leading-snug truncate">
          {sub}
        </div>
      )}

      {/* Goal / objective — italic serif, short. Reads as a paper margin
       *  annotation, NOT a tooltip ("hover to see goal" was the AI tell). */}
      {objective && (
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
