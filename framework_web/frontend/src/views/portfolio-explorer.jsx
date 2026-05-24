import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import * as echarts from 'echarts';
import { Download, Loader2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { PortfolioSelector } from '@/components/portfolio-selector.jsx';
import {
  PortfolioFilters,
  INITIAL_FILTERS,
} from '@/components/portfolio-filters.jsx';
import { ExposureKpi } from '@/components/exposure-kpi.jsx';
import { CreateCustomPortfolioDialog } from '@/components/create-custom-portfolio-dialog.jsx';

import { api } from '@/lib/api.js';
import { useHashParams } from '@/lib/hash-params.js';

// ─── Money formatter shared across this view ─────────────────────
// Goal: never show "€1000K" or "€5000K" — switch to €M at 1M.
// Strips a trailing .0 so "5.0M" reads as "5M". Used by AG Grid
// value formatters and the heat-bar normalisation logic.
function fmtMoney(v) {
  if (v == null) return '';
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    const fixed = m.toFixed(1);
    return `€${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}M`;
  }
  return `€${(v / 1000).toFixed(0)}K`;
}

// ─── Exposure aggregator for custom portfolios ──────────────────────
// The backend doesn't persist custom portfolios, so /exposure isn't
// available for them. We reconstruct the same shape client-side from
// the policy list — enough to drive the KPI bar + donut.
function computeLocalExposure(portfolio) {
  const clients = portfolio?.clients || [];
  let totalTiv = 0;
  let valueAtRisk = 0;
  let pml = 0;
  let eal = 0;
  let probSum = 0;
  const distribution_by_category = { low: 0, moderate: 0, high: 0, very_high: 0 };
  for (const c of clients) {
    const iv = c.insured_value || 0;
    totalTiv += iv;
    const p = c.risk_probability || 0;
    probSum += p;
    valueAtRisk += iv * p;
    pml += c.estimated_loss_dana || 0;
    eal += c.expected_annual_loss || 0;
    const cat = c.risk_category || 'low';
    if (cat in distribution_by_category) distribution_by_category[cat] += 1;
  }
  return {
    total_insured_value: totalTiv,
    value_at_risk: Math.round(valueAtRisk),
    estimated_total_loss_dana: Math.round(pml),
    expected_total_loss: Math.round(eal),
    avg_risk_probability: clients.length ? probSum / clients.length : 0,
    distribution_by_category,
  };
}

// AG Grid 35 requires registering modules once per app. AllCommunityModule
// bundles the bits we need (client-side row model, sorting, pagination,
// CSV export). Registration is idempotent — calling at module-load time is
// safe even if another view also registered.
ModuleRegistry.registerModules([AllCommunityModule]);

// 4 backend categories → 3 colour buckets for the UI.
const RISK_COLORS = {
  low: '#16A34A',
  moderate: '#D97706',
  medium: '#D97706', // alias when something passes "medium"
  high: '#DC2626',
  very_high: '#991B1B',
};
const RISK_BG = {
  low: '#ECFDF5',
  moderate: '#FFFBEB',
  medium: '#FFFBEB',
  high: '#FEF2F2',
  very_high: '#FEF2F2',
};

const PRODUCT_COLORS = {
  particulares: '#2563EB',
  pymes: '#D97706',
  autos: '#7C3AED',
};
const PRODUCT_LABELS = {
  particulares: 'Particulares',
  pymes: 'Pymes',
  autos: 'Autos',
};

// AG Grid cellRenderer components. Returning JSX (not HTML strings) is
// required for AG Grid 35 + React — otherwise the markup is escaped.
function ProductBadgeCell(params) {
  const prod = params.value || 'particulares';
  const color = PRODUCT_COLORS[prod] || '#94A3B8';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: `${color}1A`,
        color,
      }}
    >
      {PRODUCT_LABELS[prod] || prod}
    </span>
  );
}
function RiskBadgeCell(params) {
  const cat = params.value || 'low';
  const fg = RISK_COLORS[cat] || '#52525B';
  const bg = RISK_BG[cat] || '#F4F4F5';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        background: bg,
        color: fg,
      }}
    >
      {cat.replace('_', ' ')}
    </span>
  );
}

// Maps client → product (post-C1 the backend ships `product` directly).
// Old client records that only had `type` get coerced for back-compat.
function productOf(client) {
  if (client.product) return client.product;
  if (client.type === 'residential') return 'particulares';
  if (client.type === 'auto') return 'autos';
  return 'pymes';
}

// Mapping between filter UI buckets ↔ backend categories. The Medium filter
// matches "moderate", the High filter matches "high" OR "very_high".
function clientMatchesFilters(client, filters) {
  const prod = productOf(client);
  if (!filters.products?.[prod]) return false;

  const cat = client.risk_category;
  const passLow = filters.riskCategories.low && cat === 'low';
  const passMedium = filters.riskCategories.medium && cat === 'moderate';
  const passHigh =
    filters.riskCategories.high && (cat === 'high' || cat === 'very_high');
  if (!(passLow || passMedium || passHigh)) return false;

  const v = client.insured_value ?? 0;
  if (v < filters.valueRange[0] || v > filters.valueRange[1]) return false;

  return true;
}

export function PortfolioExplorer() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(null);
  const [portfolioData, setPortfolioData] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  // Custom portfolios persisted across reloads in localStorage so a user
  // can share a link to one (#/portfolio?p=custom-xxx) and the parquet
  // we re-POSTed at generation time isn't lost on F5.
  const [customCache, setCustomCache] = useState(() => {
    try {
      const raw = localStorage.getItem('frfw.customPortfolios');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // Persist whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(
        'frfw.customPortfolios',
        JSON.stringify(customCache)
      );
    } catch {
      /* quota or private mode — silent */
    }
  }, [customCache]);

  // URL hash params — drive (and reflect) the active selection so the
  // current view state is shareable via link.
  //   ?p=<portfolio_id>      active portfolio
  //   ?prod=particulares     product filter (single)
  const [hashParams, setHashParams] = useHashParams();

  // 1) Load portfolio list on mount, auto-select first.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.portfolio.getPredefined();
        if (!mounted) return;
        const list = res?.portfolios || [];
        // Merge predefined list with any persisted custom portfolios
        // (they're still in customCache from localStorage at mount).
        const customList = Object.values(customCache).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          n_clients: p.n_clients,
          total_insured_value: p.total_insured_value,
        }));
        setPortfolios([...customList, ...list]);

        // Initial selection priority:
        //   1. ?p=<id> from the URL (shareable link)
        //   2. wide_distribution (the 1000-client mix demo)
        //   3. First in the list
        const merged = [...customList, ...list];
        const fromUrl =
          hashParams.p && merged.find((p) => p.id === hashParams.p);
        const preferred =
          fromUrl ||
          merged.find((p) => p.id === 'wide_distribution') ||
          merged[0];
        if (preferred) setSelectedPortfolioId(preferred.id);
      } catch (err) {
        console.error('Portfolios index failed', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Mirror active portfolio id into the URL hash for shareability.
  // Don't fire on the first paint when selection is still null.
  useEffect(() => {
    if (!selectedPortfolioId) return;
    if (hashParams.p !== selectedPortfolioId) {
      setHashParams({ p: selectedPortfolioId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPortfolioId]);

  // 2) Load selected portfolio (full client list) + exposure metrics.
  // Custom portfolios live in `customCache` only (not on the backend
  // persistence layer), so we short-circuit to the cache for those.
  useEffect(() => {
    if (!selectedPortfolioId) return;
    let mounted = true;
    setLoading(true);

    // Cached custom portfolio path — synthesise exposure client-side
    // from the policy list since the backend doesn't have it stored.
    if (selectedPortfolioId.startsWith('custom-') && customCache[selectedPortfolioId]) {
      const p = customCache[selectedPortfolioId];
      const e = computeLocalExposure(p);
      setPortfolioData(p);
      setExposure(e);
      const max = (p.clients || []).reduce(
        (m, c) => Math.max(m, c.insured_value || 0),
        0
      );
      setFilters({
        ...INITIAL_FILTERS,
        valueRange: [0, max || 5_000_000],
      });
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const [p, e] = await Promise.all([
          api.portfolio.getById(selectedPortfolioId),
          api.portfolio.getExposure(selectedPortfolioId),
        ]);
        if (!mounted) return;
        setPortfolioData(p);
        setExposure(e);
        // Reset filters when the portfolio changes — the slider's max
        // depends on this portfolio's insured-value distribution, so
        // any old [min, max] range carried over from the previous
        // portfolio would be out of bounds and confuse the user.
        const max = (p?.clients || []).reduce(
          (m, c) => Math.max(m, c.insured_value || 0),
          0
        );
        setFilters({
          ...INITIAL_FILTERS,
          valueRange: [0, max || 5_000_000],
        });
      } catch (err) {
        console.error('Portfolio load failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedPortfolioId]);

  // Max insured value of the FULL portfolio (used as slider upper bound).
  // Independent of current filter state — the slider extent reflects what
  // CAN be filtered, not what's already filtered.
  const portfolioMaxValue = useMemo(() => {
    if (!portfolioData?.clients?.length) return 5_000_000;
    return portfolioData.clients.reduce(
      (m, c) => Math.max(m, c.insured_value || 0),
      0
    );
  }, [portfolioData]);

  // 3) Filter the clients list reactively and alias the backend's
  // `estimated_loss_dana` field as `estimated_loss_flood` for downstream
  // consumers (AG Grid column field, MapPopup, CSV export). Display labels
  // use the generic "Flood" wording — a future event isn't necessarily DANA.
  const filteredClients = useMemo(() => {
    if (!portfolioData?.clients) return [];
    return portfolioData.clients
      .filter((c) => clientMatchesFilters(c, filters))
      .map((c) => ({ ...c, estimated_loss_flood: c.estimated_loss_dana }));
  }, [portfolioData, filters]);

  // 3b) Recompute exposure metrics over the FILTERED subset so the KPI bar
  // and risk donut reaccionan al filtro (producto / risk / value range). El
  // backend solo manda la exposición pre-calculada para la cartera entera;
  // los mismos sums hechos client-side son lineales en clientes y baratos.
  const filteredExposure = useMemo(
    () => computeLocalExposure({ clients: filteredClients }),
    [filteredClients]
  );

  // Max-value lookups for AG Grid heat-bar normalization. The bar in each
  // monetary/probability cell fills proportionally to (value / dataset max)
  // so the user instantly sees which rows are the outliers — borrowed from
  // AG Grid Financial Dashboard conventions. Recompute only when filters
  // change (the visible max is what matters for visual contrast).
  const heatMax = useMemo(() => {
    let mInsured = 0,
      mLoss = 0,
      mPrem = 0;
    for (const c of filteredClients) {
      if ((c.insured_value || 0) > mInsured) mInsured = c.insured_value;
      if ((c.estimated_loss_flood || 0) > mLoss) mLoss = c.estimated_loss_flood;
      if ((c.annual_premium || 0) > mPrem) mPrem = c.annual_premium;
    }
    return { insured: mInsured || 1, loss: mLoss || 1, premium: mPrem || 1 };
  }, [filteredClients]);

  // Builds an AG Grid cellStyle that paints a horizontal heat-bar behind
  // the value (linear-gradient over background). `colorRgba` is the bar
  // colour (any rgba/hex). The number text stays on top.
  const heatBarStyle = (max, colorRgba) => (params) => {
    if (params.value == null) return { textAlign: 'right' };
    const pct = Math.min(100, (params.value / max) * 100);
    return {
      background: `linear-gradient(90deg, ${colorRgba} 0%, ${colorRgba} ${pct}%, transparent ${pct}%, transparent 100%)`,
      textAlign: 'right',
    };
  };

  // Special bar for P(flood) — colour depends on the value itself (green
  // at low, amber moderate, red high) so the visual semantics match the
  // Risk badge column next to it.
  const probBarStyle = (params) => {
    if (params.value == null) return { textAlign: 'right' };
    const p = params.value;
    const pct = Math.min(100, p * 100);
    const colour =
      p >= 0.75
        ? 'rgba(153,27,27,0.22)'
        : p >= 0.5
          ? 'rgba(220,38,38,0.20)'
          : p >= 0.25
            ? 'rgba(217,119,6,0.20)'
            : 'rgba(22,163,74,0.16)';
    return {
      background: `linear-gradient(90deg, ${colour} 0%, ${colour} ${pct}%, transparent ${pct}%, transparent 100%)`,
      textAlign: 'right',
    };
  };

  // 5) AG Grid column definitions. Depends on heatMax so bars rescale
  // when filters change the dataset (the "visible max" is what matters
  // for visual contrast). AG Grid 35 + React: cellRenderer must return a
  // React element — returning an HTML string would render as escaped text
  // (the "<span style=…>" literal we were seeing).
  const columnDefs = useMemo(
    () => [
      { field: 'id', headerName: 'Policy ID', flex: 1.3, minWidth: 160 },
      {
        field: 'product',
        headerName: 'Product',
        flex: 0.9,
        minWidth: 110,
        valueGetter: (p) => productOf(p.data),
        cellRenderer: ProductBadgeCell,
      },
      { field: 'subtype', headerName: 'Subtype', flex: 0.9, minWidth: 110 },
      {
        field: 'insured_value',
        headerName: 'Insured value',
        flex: 1,
        minWidth: 120,
        type: 'numericColumn',
        valueFormatter: (p) => (p.value != null ? fmtMoney(p.value) : ''),
        cellClass: 'font-mono text-right',
        cellStyle: heatBarStyle(heatMax.insured, 'rgba(37,99,235,0.13)'),
      },
      {
        field: 'risk_probability',
        headerName: 'P(flood)',
        flex: 0.7,
        minWidth: 90,
        type: 'numericColumn',
        valueFormatter: (p) => (p.value != null ? p.value.toFixed(3) : ''),
        cellClass: 'font-mono text-right',
        cellStyle: probBarStyle,
      },
      {
        field: 'risk_category',
        headerName: 'Risk',
        flex: 0.8,
        minWidth: 110,
        cellRenderer: RiskBadgeCell,
      },
      {
        field: 'estimated_loss_flood',
        headerName: 'Est. loss Flood',
        flex: 1,
        minWidth: 130,
        type: 'numericColumn',
        valueFormatter: (p) => (p.value != null ? fmtMoney(p.value) : ''),
        cellClass: 'font-mono text-right',
        cellStyle: heatBarStyle(heatMax.loss, 'rgba(220,38,38,0.16)'),
      },
      {
        field: 'annual_premium',
        headerName: 'Premium',
        flex: 0.7,
        minWidth: 90,
        type: 'numericColumn',
        valueFormatter: (p) =>
          p.value != null ? `€${Math.round(p.value)}` : '',
        cellClass: 'font-mono text-right text-text-tertiary',
        cellStyle: heatBarStyle(heatMax.premium, 'rgba(100,116,139,0.10)'),
      },
    ],
    [heatMax]
  );

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: false,
      suppressMovable: true,
    }),
    []
  );

  const exportCsv = () => {
    if (filteredClients.length === 0) return;
    const cols = [
      'id',
      'type',
      'subtype',
      'lat',
      'lon',
      'insured_value',
      'risk_probability',
      'risk_category',
      'estimated_loss_flood',
      'annual_premium',
    ];
    const csv = [
      cols.join(','),
      ...filteredClients.map((c) =>
        cols
          .map((k) => {
            const v = c[k];
            if (v == null) return '';
            if (typeof v === 'string' && /[,"\n]/.test(v))
              return `"${v.replace(/"/g, '""')}"`;
            return v;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_${selectedPortfolioId}_${filteredClients.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col min-h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-3.5rem)] gap-3 p-3 sm:p-5 pb-3">
      {/* Aviso mobile — la tabla AG Grid con 9 columnas no es manejable
       *  con touch sin scroll horizontal incomprensible. Mostramos un
       *  banner explícito en sm- y mantenemos la tabla disponible para
       *  los que insistan. */}
      <div className="md:hidden border border-amber-200 bg-amber-50 rounded p-3 text-12 text-amber-900 leading-relaxed shrink-0">
        <div className="font-semibold mb-1">Vista pensada para desktop</div>
        <p>
          El Portfolio Explorer usa una tabla de 9 columnas pensada para
          pantallas anchas. Funciona en móvil pero la lectura es más
          cómoda en un portátil o tablet en horizontal.
        </p>
      </div>

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-20 font-semibold text-text-primary tracking-tight">
              Portfolio Explorer
            </h1>
            <Badge
              variant="secondary"
              className="bg-brand-50 text-brand-700 hover:bg-brand-50 text-10 font-mono uppercase tracking-wider"
            >
              Underwriting demo
            </Badge>
          </div>
          <p className="text-12 text-text-secondary">
            Simulated client portfolio overlaid on flood risk surface · Synthetic
            data with realistic distributions
          </p>
        </div>
        <Button
          onClick={exportCsv}
          variant="outline"
          size="sm"
          disabled={filteredClients.length === 0}
        >
          <Download className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
          Export CSV
        </Button>
      </div>

      {/* KPI bar — horizontal, full-width, True Flood Risk-style.
       *  5 portfolio-level metrics + a compact risk-distribution donut.
       *  Recibe la exposición YA RECALCULADA sobre el subset filtrado, así
       *  que TIV/EAL/PML/distribución refleja el filtro de producto y de
       *  rango de valor que el usuario tenga activo. */}
      {exposure && portfolioData ? (
        <KpiBar
          exposure={filteredExposure}
          filteredClients={filteredClients}
          totalCount={portfolioData.n_clients || portfolioData.clients?.length || 0}
        />
      ) : (
        <div className="shrink-0 h-[88px] flex items-center justify-center bg-bg-surface border border-border-default rounded">
          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
        </div>
      )}

      {/* Main grid: filters rail · AG Grid clients table. Map removed —
       *  geographic browsing lives in Policy Map. Here the focus is the
       *  data table at full height, so the underwriter can scan, sort
       *  and export the entire portfolio without scrolling.
       *
       *  En mobile el rail se apila ARRIBA de la tabla (1 columna) para
       *  que el filtro siga siendo accesible; en md+ vuelve a la
       *  composición lateral 260px + 1fr clásica. */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 flex-1 min-h-0">
        {/* Left rail: portfolio + filters */}
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="py-2.5 px-4 border-b border-border-default shrink-0">
            <CardTitle className="text-13 tracking-tight">Portfolio</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-3 space-y-4">
            <PortfolioSelector
              portfolios={portfolios}
              selectedId={selectedPortfolioId}
              onSelect={setSelectedPortfolioId}
              onCreateCustom={() => setCustomDialogOpen(true)}
            />

            <div className="border-t border-border-default pt-3">
              <div className="text-12 font-semibold text-text-primary mb-2">
                Filters
              </div>
              <PortfolioFilters
                filters={filters}
                onFiltersChange={setFilters}
                totalClients={portfolioData?.clients?.length || 0}
                filteredCount={filteredClients.length}
                maxInsuredValue={portfolioMaxValue}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: AG Grid table — fills all remaining space */}
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="py-2 px-4 border-b border-border-default shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-13 tracking-tight">
                Clients ·{' '}
                <span className="font-mono text-text-secondary tabular-nums">
                  {filteredClients.length.toLocaleString()}
                </span>
              </CardTitle>
              <span className="text-10 font-mono text-text-tertiary uppercase tracking-wider">
                Sortable · paginated · CSV-exportable
              </span>
            </div>
          </CardHeader>
          <div className="flex-1 min-h-0 ag-theme-quartz ag-theme-quartz-tight relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-bg-base/50 z-[5]">
                <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
              </div>
            ) : null}
            <AgGridReact
              rowData={filteredClients}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              pagination
              paginationPageSize={50}
              paginationPageSizeSelector={[25, 50, 100, 200]}
              animateRows={false}
              suppressCellFocus
              rowHeight={32}
              headerHeight={32}
            />
          </div>
        </Card>
      </div>

      {/* Custom-portfolio dialog. On success: cache locally, prepend to
       *  list, select it. The generated portfolio isn't persisted on the
       *  backend so we live in the cache for the rest of the session. */}
      <CreateCustomPortfolioDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onCreated={(p) => {
          setCustomCache((prev) => ({ ...prev, [p.id]: p }));
          setPortfolios((prev) => {
            // Avoid duplicates on re-create with same id
            const filtered = prev.filter((q) => q.id !== p.id);
            // Strip clients before adding to the index card list (the
            // card only needs name + n_clients + total_insured_value).
            return [
              {
                id: p.id,
                name: p.name,
                description: p.description,
                n_clients: p.n_clients,
                total_insured_value: p.total_insured_value,
              },
              ...filtered,
            ];
          });
          setSelectedPortfolioId(p.id);
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Horizontal KPI bar — 5 portfolio-level metrics + compact donut.
// Inspired by True Flood Risk's Map Intelligence Dashboard: total
// insured value, EAL, PML scenario, high-risk exposure (€), and
// # of affected (high+very_high) policies, all visible above the map.
//
// Recibe la exposición YA recalculada sobre `filteredClients`, así que
// cada filtro de PortfolioFilters (producto · risk · value range) se
// refleja directamente en los 5 KPIs + el donut. `totalCount` se
// preserva sólo para el sub-label "X of Y shown" del primer KPI.
// ────────────────────────────────────────────────────────────────
function KpiBar({ exposure, filteredClients, totalCount }) {
  const tiv = exposure.total_insured_value || 0;
  const vaR = exposure.value_at_risk || 0;
  const pml = exposure.estimated_total_loss_dana || 0;
  const eal = exposure.expected_total_loss || 0;
  const filteredCount = filteredClients.length;
  const highCount =
    (exposure.distribution_by_category?.high || 0) +
    (exposure.distribution_by_category?.very_high || 0);

  const highValue = useMemo(() => {
    return filteredClients.reduce(
      (sum, c) =>
        c.risk_category === 'high' || c.risk_category === 'very_high'
          ? sum + (c.insured_value || 0)
          : sum,
      0
    );
  }, [filteredClients]);

  return (
    <div className="shrink-0 grid grid-cols-[repeat(5,minmax(0,1fr))_220px] gap-2">
      <ExposureKpi
        label="Portfolio TIV"
        value={fmtMoney(tiv)}
        sub={`${totalCount.toLocaleString()} active · ${filteredCount.toLocaleString()} shown`}
        variant="info"
        objective="Contexto — base de exposición total de la cartera."
        animationDelay={0}
      />
      <ExposureKpi
        label="EAL · annual"
        value={fmtMoney(eal)}
        sub="Expected annual loss"
        variant="warning"
        objective="Minimizar — pérdida esperada en un año medio."
        animationDelay={80}
      />
      <ExposureKpi
        label="PML · DANA scenario"
        value={fmtMoney(pml)}
        sub="If a DANA hits today"
        variant="risk"
        objective="Vigilar — peor caso single-event para capital."
        animationDelay={160}
      />
      <ExposureKpi
        label="High-risk exposure"
        value={fmtMoney(highValue)}
        sub={`${tiv ? ((highValue / tiv) * 100).toFixed(1) : '0'}% of TIV`}
        variant="risk"
        objective="Reducir — concentración en píxeles de alto riesgo."
        animationDelay={240}
      />
      <ExposureKpi
        label="Affected policies"
        value={highCount.toLocaleString()}
        unit={`/ ${totalCount.toLocaleString()}`}
        sub={`Value at risk ${fmtMoney(vaR)}`}
        variant="risk"
        objective="Identificar — pólizas críticas para underwriting."
        animationDelay={320}
      />
      <Card className="overflow-hidden">
        <CardHeader className="py-1.5 px-3 border-b border-border-default">
          <CardTitle className="text-10 font-mono uppercase tracking-wider text-text-tertiary">
            Risk distribution
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <RiskDonut distribution={exposure.distribution_by_category || {}} />
        </CardContent>
      </Card>
    </div>
  );
}

function RiskDonut({ distribution }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: true,
      animationDuration: 250,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
      },
      // Donut compacto sin leyenda — ahora vive en el KPI bar horizontal;
      // los colores son los mismos que las heat-bars de la tabla así que
      // el usuario los aprende rápido sin necesidad de leyenda explícita.
      series: [
        {
          type: 'pie',
          radius: ['58%', '90%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 2,
            borderColor: '#FAFBFC',
            borderWidth: 1.5,
          },
          label: { show: false },
          labelLine: { show: false },
          data: [
            {
              value: distribution.low || 0,
              name: 'Low',
              itemStyle: { color: '#16A34A' },
            },
            {
              value: distribution.moderate || 0,
              name: 'Moderate',
              itemStyle: { color: '#D97706' },
            },
            {
              value: distribution.high || 0,
              name: 'High',
              itemStyle: { color: '#DC2626' },
            },
            {
              value: distribution.very_high || 0,
              name: 'Very high',
              itemStyle: { color: '#991B1B' },
            },
          ],
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [distribution]);

  return <div ref={ref} style={{ height: 64 }} />;
}
