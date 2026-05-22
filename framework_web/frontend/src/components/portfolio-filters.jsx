import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

/**
 * Filter panel for the Portfolio Explorer left rail.
 *
 * Filters work in 3 UI buckets — Low / Medium / High — but the backend
 * stores 4 categories on each client (low / moderate / high / very_high).
 * `clientMatchesFilters` in PortfolioExplorer maps Medium ↔ moderate and
 * High ↔ {high, very_high}. The filter state stays UI-friendly here.
 */
// Filter UI is keyed by PRODUCT now (particulares / pymes / autos).
// The mapper in portfolio-explorer.jsx (`clientMatchesFilters`) translates
// these UI flags into matches against the backend `product` field.
export const INITIAL_FILTERS = {
  products: { particulares: true, pymes: true, autos: true },
  riskCategories: { low: true, medium: true, high: true },
  valueRange: [0, 5_000_000],
};

const PRODUCT_LABELS = {
  particulares: 'Particulares',
  pymes: 'Pymes',
  autos: 'Autos',
};
const PRODUCT_DOT = {
  particulares: 'bg-brand-500',
  pymes: 'bg-risk-medium',
  autos: 'bg-[#7C3AED]',
};
const RISK_LABELS = {
  low: 'Low',
  medium: 'Medium (moderate)',
  high: 'High + very high',
};
const RISK_DOT = {
  low: 'bg-risk-low',
  medium: 'bg-risk-medium',
  high: 'bg-risk-high',
};

// Display helper: <1M → "€350K", ≥1M → "€5M" or "€2.5M". Keeps the
// label compact and readable next to the slider thumbs. Strips trailing
// .0 so "5.0M" reads as "5M" — looks intentional, not auto-generated.
function fmtCurrency(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    const fixed = m.toFixed(1);
    return `€${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}M`;
  }
  return `€${(v / 1000).toFixed(0)}K`;
}

export function PortfolioFilters({
  filters,
  onFiltersChange,
  totalClients = 0,
  filteredCount = 0,
  // Maximum insured value present in the current portfolio. The slider
  // upper bound snaps to this so the user can actually drag to the
  // observed maximum (default 5M kept as a safety floor).
  maxInsuredValue = 5_000_000,
}) {
  const update = (key, value) => onFiltersChange?.({ ...filters, [key]: value });
  const reset = () =>
    onFiltersChange?.({ ...INITIAL_FILTERS, valueRange: [0, maxInsuredValue] });

  // Slider step adapts to the range — smaller steps for €<1M portfolios,
  // €50K coarse steps for big ones. Keeps the thumb's movement fluid.
  const step = maxInsuredValue >= 2_000_000 ? 50_000 : 10_000;

  return (
    <div className="space-y-3 text-12">
      <div className="flex items-center justify-between">
        <span className="text-text-tertiary">Showing</span>
        <span className="font-mono font-medium text-text-primary tabular-nums">
          {filteredCount.toLocaleString()} / {totalClients.toLocaleString()}
        </span>
      </div>

      <Separator />

      <div className="space-y-1.5">
        <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Product
        </div>
        {Object.entries(filters.products).map(([prod, checked]) => (
          <label
            key={prod}
            className="flex items-center gap-2 text-13 cursor-pointer select-none"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(v) =>
                update('products', { ...filters.products, [prod]: Boolean(v) })
              }
            />
            <span className="flex items-center gap-1.5 text-text-primary">
              <span
                className={`inline-block w-2 h-2 rounded-full ${PRODUCT_DOT[prod]}`}
              />
              {PRODUCT_LABELS[prod] || prod}
            </span>
          </label>
        ))}
      </div>

      <Separator />

      <div className="space-y-1.5">
        <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Risk category
        </div>
        {Object.entries(filters.riskCategories).map(([cat, checked]) => (
          <label
            key={cat}
            className="flex items-center gap-2 text-13 cursor-pointer select-none"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(v) =>
                update('riskCategories', {
                  ...filters.riskCategories,
                  [cat]: Boolean(v),
                })
              }
            />
            <span className="flex items-center gap-1.5 text-text-primary">
              <span
                className={`inline-block w-2 h-2 rounded-full ${RISK_DOT[cat]}`}
              />
              {RISK_LABELS[cat] || cat}
            </span>
          </label>
        ))}
      </div>

      <Separator />

      <div className="space-y-2.5">
        <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Insured value
        </div>
        <Slider
          value={filters.valueRange}
          onValueChange={(v) => update('valueRange', v)}
          min={0}
          max={maxInsuredValue}
          step={step}
          className="w-full"
        />
        <div className="flex items-center justify-between text-11 font-mono text-text-secondary tabular-nums">
          <span>{fmtCurrency(filters.valueRange[0])}</span>
          <span>{fmtCurrency(filters.valueRange[1])}</span>
        </div>
      </div>

      <Separator />

      <Button
        variant="outline"
        size="sm"
        onClick={reset}
        className="w-full text-12"
      >
        Reset filters
      </Button>
    </div>
  );
}
