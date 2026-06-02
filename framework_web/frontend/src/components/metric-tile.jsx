import React from 'react';
import { cn } from '@/lib/utils';
import { useInView, useCountUp } from '@/lib/animations.js';

/**
 * Dense, scientific metric tile for the Methodology section.
 *
 * Refreshed to drop card chrome (border + rounded + shadow) — the
 * previous design read as a generic dashboard tile. Now it's stacked
 * typography with a tiny hairline divider before the optional
 * `objective` (italic serif, "what we want from this number").
 *
 * Count-up opt-in: pasa `numeric` (number target) + `format` (función
 * v→string) y el tile anima 0 → target con ease-out cuártico cuando
 * entra al viewport. Stagger via `animationDelay`. Backwards-compat:
 * sin numeric/format, sigue mostrando el string `value` directo.
 *
 * Backward compat: existing call sites still work. New props are
 * `objective` (italic serif goal line), `animationDelay` (stagger),
 * `numeric` / `format` (count-up).
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
  numeric = null,
  format = null,
}) {
  const sizeClasses = {
    sm: { value: 'text-16', padding: 'p-2.5' },
    default: { value: 'text-20', padding: 'p-3' },
    lg: { value: 'text-24', padding: 'p-4' },
  };
  const s = sizeClasses[size] || sizeClasses.default;

  // Count-up opt-in. Trigger via IntersectionObserver — el tile en
  // dashboards de methodology puede estar below-the-fold.
  const animateCountUp =
    typeof numeric === 'number' && typeof format === 'function';
  const [inViewRef, inView] = useInView({ threshold: 0.3 });
  const animatedValue = useCountUp(animateCountUp ? numeric : 0, {
    active: animateCountUp && inView,
    duration: 1100,
    startDelay: animationDelay,
  });
  const displayValue = animateCountUp ? format(animatedValue) : value;

  return (
    <div
      ref={inViewRef}
      className={cn(
        // Hairline frame instead of full card border + radius + shadow.
        // Hover background hints at interactivity without dressing as
        // a button.
        'group relative transition-all duration-200 ease-out',
        'border-t border-border-default',
        'hover:bg-bg-subtle/40',
        s.padding,
        'animate-in fade-in slide-in-from-bottom-2'
      )}
      style={{
        animationDelay: `${animationDelay}ms`,
        animationDuration: '500ms',
        animationFillMode: 'backwards',
      }}
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
          {displayValue}
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
          <div className="h-px mt-2 mb-1.5 w-7 bg-border-strong opacity-60 transition-all duration-300 ease-out group-hover:w-12" />
          <div className="font-serif italic text-11 text-text-tertiary leading-snug">
            {objective}
          </div>
        </>
      )}
    </div>
  );
}
