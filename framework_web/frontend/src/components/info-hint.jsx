import React from 'react';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Inline "ℹ️" hover hint for dense scientific dashboards.
 *
 * Sits next to a metric or chart title. On hover, surfaces a multi-line
 * explanation + optional citation chip so a non-specialist (or a thesis
 * tribunal) can understand what they're looking at without leaving the
 * page.
 *
 * Why a custom wrapper over plain `<Tooltip>`:
 *   - shadcn's default `TooltipContent` uses bg-primary (dark) + text-xs;
 *     fine for one-word hints, illegible for two sentences. We override
 *     to bg-surface + text-12 + max-width 320 for paragraph content.
 *   - The trigger is a 12px Info icon (subtle, low-attention) so it
 *     doesn't compete with the metric value visually.
 *   - `cite` renders as a mono chip ("Brier 1950 · J. Sklearn") below
 *     the body — gives the tribunal a paper to cross-check without
 *     turning the dashboard into a footnotes wall.
 *
 * Props:
 *   - children: the explanation body (string or ReactNode).
 *   - cite (optional): citation chip text (e.g., "Roberts et al. 2017").
 *   - side: tooltip side ('top'|'right'|'bottom'|'left'). Default 'top'.
 *   - size: trigger icon size in px. Default 12.
 */
export function InfoHint({
  children,
  cite = null,
  side = 'top',
  size = 12,
  className = '',
}) {
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            aria-label="More info"
            className={cn(
              'inline-flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors',
              className
            )}
          >
            <Info width={size} height={size} strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          sideOffset={6}
          className={cn(
            // Override shadcn's dark primary tooltip → light surface
            // with subtle border so the long-form text reads like a
            // doc card, not a tiny chip.
            'max-w-[320px] bg-bg-surface text-text-primary',
            'border border-border-default shadow-md',
            'px-3 py-2.5 rounded'
          )}
        >
          <div className="text-12 leading-relaxed text-text-secondary">
            {children}
          </div>
          {cite && (
            <div className="mt-2 pt-2 border-t border-border-default text-10 font-mono uppercase tracking-wider text-text-tertiary">
              {cite}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
