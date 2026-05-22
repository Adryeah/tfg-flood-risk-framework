import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Dense, scientific metric tile for the Methodology section.
 *
 * Refreshed to drop card chrome (border + rounded + shadow) — the
 * previous design read as a generic dashboard tile. Now it's stacked
 * typography with a tiny hairline divider before the optional
 * `objective` (italic serif, "what we want from this number").
 *
 * Backward compat: existing call sites still work. New props are
 * `objective` (italic serif goal line) and `animationDelay` (stagger).
 */
export default function MetricTile({
  label,
  value,
  std = null,
  unit = null,
  size = 'default',
  description = null,
  hint = null,
  objective = null,
  animationDelay = 0,
}) {
  const sizeClasses = {
    sm: { value: 'text-16', padding: 'p-2.5' },
    default: { value: 'text-20', padding: 'p-3' },
    lg: { value: 'text-24', padding: 'p-4' },
  };
  const s = sizeClasses[size] || sizeClasses.default;

  return (
    <div
      className={cn(
        // Hairline frame instead of full card border + radius + shadow.
        // Hover background hints at interactivity without dressing as
        // a button.
        'relative transition-colors',
        'border-t border-border-default',
        'hover:bg-bg-subtle/40',
        s.padding,
        'animate-in fade-in slide-in-from-bottom-2 duration-500'
      )}
      style={{ animationDelay: `${animationDelay}ms`, animationFillMode: 'backwards' }}
    >
      {/* Label + optional hint icon */}
      <div className="flex items-center gap-1.5">
        <span className="text-10 font-semibold text-text-tertiary uppercase tracking-[0.16em]">
          {label}
        </span>
        {hint}
      </div>

      {/* Value + std + unit */}
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span
          className={cn(
            'font-semibold font-mono text-text-primary leading-none tabular-nums',
            s.value
          )}
        >
          {value}
        </span>
        {std && (
          <span className="text-12 text-text-tertiary font-mono">± {std}</span>
        )}
        {unit && (
          <span className="text-12 text-text-tertiary font-mono">{unit}</span>
        )}
      </div>

      {/* Sub-description */}
      {description && (
        <div className="text-10 text-text-tertiary mt-1">{description}</div>
      )}

      {/* Objective — italic serif "what we want from this metric". Sits
       *  below a 28-px hairline so it reads as a paper annotation. */}
      {objective && (
        <>
          <div className="h-px mt-2 mb-1.5 w-7 bg-border-strong opacity-60" />
          <div className="font-serif italic text-11 text-text-tertiary leading-snug">
            {objective}
          </div>
        </>
      )}
    </div>
  );
}
