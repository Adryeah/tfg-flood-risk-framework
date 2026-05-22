import React from 'react';
import { Building2, Building, Factory, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Predefined-portfolio picker for Portfolio Explorer / Exposure Dashboard.
 * 3 cards (residential / mixed / industrial) + a dashed "create custom" tile.
 * Visual register: institutional, dense, brand-50 highlight when selected.
 */
const PORTFOLIO_META = {
  premium_residential: {
    icon: Building2,
    blurb: 'High-value residential · Valencia city',
  },
  wide_distribution: {
    icon: Building,
    blurb: 'Mix 50/30/20 particulares · autos · pymes',
  },
  industrial_focus: {
    icon: Factory,
    blurb: 'Industrial parks · Sedaví, Manises, Quart',
  },
};

export function PortfolioSelector({
  portfolios = [],
  selectedId,
  onSelect,
  onCreateCustom,
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">
        Predefined portfolios
      </div>

      {portfolios.map((p) => {
        const meta = PORTFOLIO_META[p.id] || { icon: Building, blurb: '' };
        const Icon = meta.icon;
        const isSelected = p.id === selectedId;

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect?.(p.id)}
            className={cn(
              'w-full text-left p-2.5 rounded border transition-colors',
              isSelected
                ? 'bg-brand-50 border-brand-500'
                : 'bg-bg-surface border-border-default hover:bg-bg-hover hover:border-border-strong'
            )}
          >
            <div className="flex items-start gap-2.5">
              <div
                className={cn(
                  'w-7 h-7 rounded flex items-center justify-center shrink-0',
                  isSelected
                    ? 'bg-brand-700 text-white'
                    : 'bg-bg-subtle text-text-secondary'
                )}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-12 font-medium text-text-primary truncate">
                  {p.name}
                </div>
                <div className="text-10 font-mono text-text-tertiary mt-0.5 tabular-nums">
                  {p.n_clients.toLocaleString()} clients · €
                  {(p.total_insured_value / 1e6).toFixed(1)}M
                </div>
                {meta.blurb && (
                  <div className="text-10 text-text-tertiary mt-0.5 truncate">
                    {meta.blurb}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}

      {onCreateCustom && (
        <button
          type="button"
          onClick={onCreateCustom}
          className="w-full text-left p-2.5 rounded border border-dashed border-border-strong hover:bg-bg-hover transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded border border-dashed border-border-strong flex items-center justify-center text-text-tertiary">
              <Plus className="w-3.5 h-3.5" strokeWidth={1.6} />
            </div>
            <div>
              <div className="text-12 font-medium text-text-primary">
                Create custom
              </div>
              <div className="text-10 text-text-tertiary mt-0.5">
                Define parameters
              </div>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}
