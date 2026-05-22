import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { Loader2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Map, MapClusterLayer, MapControls, useMap } from '@/components/Map.tsx';
import { ExposureKpi } from '@/components/exposure-kpi.jsx';
import { api } from '@/lib/api.js';
import { ZONES } from '@/lib/constants.js';

const RISK_COLORS = {
  low: '#16A34A',
  moderate: '#D97706',
  high: '#DC2626',
  very_high: '#991B1B',
};

export function ExposureDashboard() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1) Portfolio list
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.portfolio.getPredefined();
        if (!mounted) return;
        const list = res?.portfolios || [];
        setPortfolios(list);
        // Default to wide_distribution for demo consistency with the other
        // portfolio views (1000 clients, full product mix).
        const preferred =
          list.find((p) => p.id === 'wide_distribution') || list[0];
        if (preferred) setSelectedId(preferred.id);
      } catch (err) {
        console.error('Portfolios index failed', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 2) Load selected portfolio + exposure
  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const [p, e] = await Promise.all([
          api.portfolio.getById(selectedId),
          api.portfolio.getExposure(selectedId),
        ]);
        if (!mounted) return;
        setPortfolio(p);
        setExposure(e);
      } catch (err) {
        console.error('Exposure load failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  return (
    <div className="p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-20 font-semibold text-text-primary tracking-tight">
              Exposure Dashboard
            </h1>
            {portfolio && (
              <Badge
                variant="secondary"
                className="bg-brand-50 text-brand-700 hover:bg-brand-50 text-10 font-mono uppercase tracking-wider"
              >
                {portfolio.name}
              </Badge>
            )}
          </div>
          <p className="text-12 text-text-secondary">
            Aggregate risk metrics and loss projections for the selected portfolio
          </p>
        </div>

        <Select
          value={selectedId || ''}
          onValueChange={(v) => v && setSelectedId(v)}
        >
          <SelectTrigger className="w-[260px] h-8 text-12">
            <SelectValue placeholder="Select portfolio" />
          </SelectTrigger>
          <SelectContent>
            {portfolios.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-12">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading || !portfolio || !exposure ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
        </div>
      ) : (
        <>
          {/* Hero KPI strip — True Flood Risk Map Intelligence Dashboard
           *  pattern: the top of the screen is dominated by the 4 numbers
           *  an underwriter checks first (TIV / EAL / PML / Affected). */}
          <HeroKpis portfolio={portfolio} exposure={exposure} />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Concentration map spans 2 columns — CARTO Portfolio
             *  Screening emphasises spatial accumulation as the primary
             *  visual; clustering reveals where the portfolio piles up. */}
            <Widget
              title="Geographic concentration"
              badge="clustered · 2 study areas"
              className="lg:col-span-2 lg:row-span-2"
            >
              <GeographicMap clients={portfolio.clients} />
            </Widget>

            <Widget title="Risk distribution" badge={`${portfolio.n_clients} policies`}>
              <RiskDonut distribution={exposure.distribution_by_category || {}} />
            </Widget>

            <Widget title="Exposure by product" badge="€ insured value">
              <ExposureByTypeChart clients={portfolio.clients} />
            </Widget>

            {/* Oasis LMF-inspired exceedance curve (OEP-like single-event
             *  approximation): for each policy, plot Σ losses ≥ x as x
             *  varies. The shape tells the underwriter what fraction of
             *  total loss concentrates in the worst tail. */}
            <Widget title="Loss exceedance curve" badge="Oasis OEP-style">
              <LossExceedanceCurve clients={portfolio.clients} />
            </Widget>

            <Widget title="Loss breakdown" badge="DANA scenario">
              <LossBreakdownChart clients={portfolio.clients} />
            </Widget>

            <Widget title="Top 10 highest risk" badge="sorted by est. loss">
              <TopRiskClientsTable clients={portfolio.clients} />
            </Widget>
          </div>

          <MethodologyFooter />
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hero KPI strip — 4 large headline numbers above the widget grid.
// Mirrors the Portfolio Explorer KpiBar so the two views feel like
// one product. Variants drive the left-edge accent rail colour.
// ────────────────────────────────────────────────────────────────
function HeroKpis({ portfolio, exposure }) {
  const tiv = portfolio.total_insured_value || 0;
  const eal = exposure.expected_total_loss || 0;
  const pml = exposure.estimated_total_loss_dana || 0;
  const totalCount = portfolio.n_clients || portfolio.clients?.length || 0;
  const highCount =
    (exposure.distribution_by_category?.high || 0) +
    (exposure.distribution_by_category?.very_high || 0);
  const vaR = exposure.value_at_risk || 0;
  const highValue = useMemo(() => {
    return (portfolio.clients || []).reduce(
      (sum, c) =>
        c.risk_category === 'high' || c.risk_category === 'very_high'
          ? sum + (c.insured_value || 0)
          : sum,
      0
    );
  }, [portfolio]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <ExposureKpi
        label="Total insured value"
        value={`€${(tiv / 1e6).toFixed(1)}`}
        unit="M"
        sub={`${totalCount.toLocaleString()} policies in scope`}
        variant="info"
        objective="Contexto — capital total bajo análisis."
        animationDelay={0}
      />
      <ExposureKpi
        label="EAL · annual"
        value={`€${(eal / 1000).toFixed(0)}`}
        unit="K"
        sub={`Probability-weighted · €${(vaR / 1e6).toFixed(1)}M VaR`}
        variant="warning"
        objective="Minimizar — base de prima técnica anual."
        animationDelay={80}
      />
      <ExposureKpi
        label="PML · DANA scenario"
        value={`€${(pml / 1e6).toFixed(1)}`}
        unit="M"
        sub="Single-event loss if a DANA hits today"
        variant="risk"
        objective="Vigilar — capital requerido por Solvencia II."
        animationDelay={160}
      />
      <ExposureKpi
        label="Affected policies"
        value={highCount.toLocaleString()}
        unit={`/ ${totalCount.toLocaleString()}`}
        sub={`€${(highValue / 1e6).toFixed(1)}M high-risk exposure`}
        variant="risk"
        objective="Identificar — pólizas a revisar manualmente."
        animationDelay={240}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Methodology footer — surfaces the Oasis LMF lineage of the metrics
// (PML, EAL) so the project tribunal can verify the calc chain isn't
// hand-waved. Compact, low-attention, lives below the widget grid.
// ────────────────────────────────────────────────────────────────
function MethodologyFooter() {
  return (
    <div className="border border-border-default rounded bg-bg-subtle/40 px-4 py-3 text-11 text-text-secondary space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Methodology
        </span>
      </div>
      <p>
        <span className="font-mono text-text-primary">PML</span> = Σ
        <code className="px-1">insured_value × P(flood) × damage_ratio</code>
        over all policies, computed per the Oasis LMF Probable Maximum Loss
        convention (single-event loss given hazard footprint). <span className="font-mono text-text-primary">EAL</span> = PML ×{' '}
        <code className="px-1">prob_event_year</code> (5% — return period ≈ 20y for DANA-class events).
      </p>
      <p>
        Hazard layer: <span className="font-mono text-text-primary">P(flood)</span> from
        Random Forest v2 (14 features, GroupKFold 5×1km, operational threshold 0.614)
        trained on Sentinel-1 SAR backscatter pre/post DANA Valencia 2024 and validated
        against Copernicus EMS EMSR773.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Generic widget card — same chrome for all 6 widgets.
// ────────────────────────────────────────────────────────────────
function Widget({ title, badge, children, className = '' }) {
  return (
    <Card className={'overflow-visible flex flex-col ' + className}>
      <CardHeader className="py-2.5 px-4 border-b border-border-default">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-13 tracking-tight">{title}</CardTitle>
          {badge && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-secondary text-10 font-mono uppercase tracking-wider shrink-0">
              {badge}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 flex-1">{children}</CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Widget — Risk distribution donut (4 categories)
// ────────────────────────────────────────────────────────────────
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
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 11,
          color: '#52525B',
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 3,
            borderColor: '#FAFBFC',
            borderWidth: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          data: [
            { value: distribution.low || 0, name: 'Low', itemStyle: { color: RISK_COLORS.low } },
            { value: distribution.moderate || 0, name: 'Moderate', itemStyle: { color: RISK_COLORS.moderate } },
            { value: distribution.high || 0, name: 'High', itemStyle: { color: RISK_COLORS.high } },
            { value: distribution.very_high || 0, name: 'Very high', itemStyle: { color: RISK_COLORS.very_high } },
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

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 3 — Exposure by client type (€ insured value, horizontal bar)
// ────────────────────────────────────────────────────────────────
function ExposureByTypeChart({ clients }) {
  const ref = useRef(null);

  // Aggregate by PRODUCT (particulares/pymes/autos) — falls back to legacy
  // `type` for backwards compat with pre-C1 client records.
  const buckets = useMemo(() => {
    const acc = {};
    (clients || []).forEach((c) => {
      const p = c.product || c.type || 'unknown';
      acc[p] = (acc[p] || 0) + (c.insured_value || 0);
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [clients]);

  const PRODUCT_LABEL = {
    particulares: 'Particulares',
    pymes: 'Pymes',
    autos: 'Autos',
    // Legacy fallback labels for old clients that still have `type`
    residential: 'Residential',
    commercial: 'Commercial',
    industrial: 'Industrial',
    auto: 'Autos',
  };
  const PRODUCT_COLOR = {
    particulares: '#2563EB',
    pymes: '#D97706',
    autos: '#7C3AED',
    residential: '#2563EB',
    commercial: '#D97706',
    industrial: '#475467',
    auto: '#7C3AED',
  };

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: true,
      animationDuration: 250,
      animationEasing: 'cubicOut',
      grid: { left: 100, right: 16, top: 6, bottom: 22, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        textStyle: { fontFamily: 'Geist, Inter, system-ui', fontSize: 12, color: '#1F2937' },
        valueFormatter: (v) => `€${(v / 1e6).toFixed(1)}M`,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: (v) => `${(v / 1e6).toFixed(0)}M`,
        },
      },
      yAxis: {
        type: 'category',
        data: buckets.map(([k]) => PRODUCT_LABEL[k] || k).reverse(),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#475467',
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
        },
      },
      series: [
        {
          type: 'bar',
          // Each bar takes its product's brand colour — visual link with
          // the Policy Map points + the Portfolio Explorer filter dots.
          data: buckets.map(([k, v]) => ({
            value: v,
            itemStyle: {
              color: PRODUCT_COLOR[k] || '#94A3B8',
              borderRadius: [0, 2, 2, 0],
            },
          })).reverse(),
          barWidth: '58%',
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [buckets]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 4 — Geographic concentration (mini MapLibre with clustered points)
// ────────────────────────────────────────────────────────────────
function GeographicMap({ clients }) {
  const clientsGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (clients || []).map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { id: c.id, risk_category: c.risk_category },
      })),
    }),
    [clients]
  );

  // Centered on the union of both study areas (Valencia + Algemesí) so
  // both clusters are visible at the default zoom.
  return (
    <div className="h-full min-h-[420px] rounded overflow-hidden">
      <Map
        center={[
          (Math.min(ZONES.valencia.bbox[0], ZONES.algemesi.bbox[0]) +
            Math.max(ZONES.valencia.bbox[2], ZONES.algemesi.bbox[2])) /
            2,
          (Math.min(ZONES.valencia.bbox[1], ZONES.algemesi.bbox[1]) +
            Math.max(ZONES.valencia.bbox[3], ZONES.algemesi.bbox[3])) /
            2,
        ]}
        zoom={10}
        minZoom={8}
        maxZoom={14}
        className="h-full w-full"
      >
        <MapControls />
        <ConcentrationRiskBackdrop />
        <MapClusterLayer
          data={clientsGeoJSON}
          clusterRadius={40}
          clusterMaxZoom={13}
          clusterColors={['#3B82F6', '#1D4ED8', '#1E3A8A']}
          clusterThresholds={[20, 100]}
          pointColor="#2563EB"
        />
      </Map>
    </div>
  );
}

/** Loads both study-area risk surfaces underneath the cluster bubbles
 *  so the underwriter sees concentration vs hazard intensity in one
 *  glance. Two async fetches in parallel; non-fatal on either failure. */
function ConcentrationRiskBackdrop() {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    let cancelled = false;
    (async () => {
      const zones = ['valencia', 'algemesi'];
      await Promise.all(
        zones.map(async (zone) => {
          try {
            const geo = await api.risk.getGeoJSON(zone);
            if (cancelled) return;
            const id = `exposure-risk-${zone}`;
            if (!map.getSource(id)) {
              map.addSource(id, { type: 'geojson', data: geo });
              map.addLayer({
                id,
                type: 'fill',
                source: id,
                paint: {
                  'fill-color': ['get', 'color'],
                  'fill-opacity': 0.28,
                },
              });
            }
          } catch {
            /* non-fatal */
          }
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [map, isLoaded]);
  return null;
}

// ────────────────────────────────────────────────────────────────
// Widget — Loss Exceedance Curve (Oasis LMF-style OEP approximation)
// X axis: loss threshold L · Y axis: total € of policies with loss ≥ L
// Lets the underwriter see how concentrated the tail is — the steeper
// the descent, the more dependent the portfolio is on a few outliers.
// ────────────────────────────────────────────────────────────────
function LossExceedanceCurve({ clients }) {
  const ref = useRef(null);

  const points = useMemo(() => {
    const losses = (clients || [])
      .map((c) => c.estimated_loss_dana || 0)
      .filter((x) => x > 0)
      .sort((a, b) => b - a);
    if (!losses.length) return [];
    // Cumulative sum of losses ≥ each threshold (in increasing index order).
    let cum = 0;
    return losses.map((loss, i) => {
      cum += loss;
      return [loss, cum];
    });
  }, [clients]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      // Long, eased entry animation — the curve "draws itself" from
      // (0, 0) along its full length over 1.4 s. cubicOut feels
      // natural (fast then settling). Reinforces "cumulative" feel.
      animation: true,
      animationDuration: 1400,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 16, top: 12, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: '#DC2626', width: 1, type: 'dashed' },
        },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
        formatter: (p) => {
          const [loss, cum] = p[0].data;
          const totalLoss = points[points.length - 1]?.[1] || 1;
          const pctOfTotal = ((cum / totalLoss) * 100).toFixed(1);
          return (
            `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#475467;line-height:1.6;">` +
            `Threshold ≥ <strong style="color:#1F2937;">€${(loss / 1000).toFixed(1)}K</strong><br/>` +
            `Cumulative <strong style="color:#DC2626;">€${(cum / 1e6).toFixed(2)}M</strong><br/>` +
            `<span style="color:#98A2B3;">${pctOfTotal} % of total PML</span>` +
            `</div>`
          );
        },
      },
      xAxis: {
        type: 'value',
        name: 'Loss threshold (€)',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: {
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          color: '#98A2B3',
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (v) => `${(v / 1000).toFixed(0)}K`,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (v) => `${(v / 1e6).toFixed(1)}M`,
        },
      },
      series: [
        {
          type: 'line',
          data: points,
          symbol: 'circle',
          showSymbol: false,
          // Hovering the line shows a single highlighted symbol at the
          // current data point — same visual cue as Bloomberg / Datadog
          // line charts. Adds tactile feedback to a long static curve.
          emphasis: {
            scale: 1.6,
            itemStyle: {
              color: '#DC2626',
              borderColor: '#FAFBFC',
              borderWidth: 2,
              shadowColor: 'rgba(220,38,38,0.5)',
              shadowBlur: 8,
            },
          },
          symbolSize: 6,
          lineStyle: {
            color: '#DC2626',
            width: 2,
            shadowColor: 'rgba(220,38,38,0.35)',
            shadowBlur: 6,
            shadowOffsetY: 1,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(220,38,38,0.30)' },
                { offset: 1, color: 'rgba(220,38,38,0.02)' },
              ],
            },
          },
          smooth: true,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [points]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 5 — Loss breakdown stacked bar by risk category
// ────────────────────────────────────────────────────────────────
function LossBreakdownChart({ clients }) {
  const ref = useRef(null);

  const data = useMemo(() => {
    const acc = { low: 0, moderate: 0, high: 0, very_high: 0 };
    (clients || []).forEach((c) => {
      const k = c.risk_category || 'low';
      if (k in acc) acc[k] += c.estimated_loss_dana || 0;
    });
    return acc;
  }, [clients]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      // Stagger the 4 stacks: Low slides in first, then Moderate,
      // then High, then Very-high. 280 ms gap per layer → the stacked
      // bar literally "builds up" left-to-right by severity, matching
      // the legend reading order. Total reveal: ~1.4 s.
      animation: true,
      animationDuration: 700,
      animationDurationUpdate: 360,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        borderWidth: 1,
        padding: [8, 10],
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
        valueFormatter: (v) =>
          v >= 1_000_000
            ? `€${(v / 1_000_000).toFixed(2)}M`
            : `€${(v / 1000).toFixed(0)}K`,
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { fontFamily: 'Geist, Inter, system-ui', fontSize: 11, color: '#52525B' },
        data: ['Low', 'Moderate', 'High', 'Very high'],
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: (v) => `${(v / 1e6).toFixed(1)}M`,
        },
      },
      yAxis: {
        type: 'category',
        data: ['DANA loss'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#475467', fontFamily: 'Geist, Inter, system-ui', fontSize: 11 },
      },
      series: [
        {
          name: 'Low',
          type: 'bar',
          stack: 'loss',
          data: [data.low],
          itemStyle: { color: RISK_COLORS.low },
          barWidth: 28,
          animationDelay: 0,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(22,163,74,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'Moderate',
          type: 'bar',
          stack: 'loss',
          data: [data.moderate],
          itemStyle: { color: RISK_COLORS.moderate },
          animationDelay: 280,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(217,119,6,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'High',
          type: 'bar',
          stack: 'loss',
          data: [data.high],
          itemStyle: { color: RISK_COLORS.high },
          animationDelay: 560,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(220,38,38,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'Very high',
          type: 'bar',
          stack: 'loss',
          data: [data.very_high],
          itemStyle: { color: RISK_COLORS.very_high },
          animationDelay: 840,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(153,27,27,0.45)',
              shadowBlur: 8,
            },
          },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 6 — Top 10 highest-risk clients table (sorted by est. loss DANA)
// ────────────────────────────────────────────────────────────────
function TopRiskClientsTable({ clients }) {
  const top = useMemo(() => {
    return [...(clients || [])]
      .sort(
        (a, b) =>
          (b.estimated_loss_dana || 0) - (a.estimated_loss_dana || 0)
      )
      .slice(0, 10);
  }, [clients]);

  // Max est. loss in the top-10 — drives the inline bar normalisation
  // so the #1 row renders a 100 % bar and everyone else scales down.
  const maxLoss = top[0]?.estimated_loss_dana || 1;

  // Local money formatter (M for ≥ 1M, K below). Same convention as
  // Portfolio Explorer's fmtMoney — keeps the two views aligned.
  const fmt = (v) => {
    if (v == null) return '—';
    if (Math.abs(v) >= 1_000_000) {
      const m = v / 1_000_000;
      const fixed = m.toFixed(1);
      return `€${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}M`;
    }
    return `€${(v / 1000).toFixed(0)}K`;
  };

  return (
    <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
      <table className="w-full text-11">
        <thead className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-default sticky top-0 bg-bg-surface z-[1]">
          <tr>
            <th className="text-left py-1.5 pr-2 font-semibold w-6">#</th>
            <th className="text-left py-1.5 pr-2 font-semibold">Policy</th>
            <th className="text-left py-1.5 pr-2 font-semibold">Type</th>
            <th className="text-right py-1.5 pr-2 font-semibold">P</th>
            <th className="text-right py-1.5 font-semibold">Est. loss</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {top.map((c, idx) => {
            const cat = c.risk_category || 'low';
            const fg = RISK_COLORS[cat] || '#52525B';
            const loss = c.estimated_loss_dana || 0;
            const pct = Math.min(100, (loss / maxLoss) * 100);
            // Sequential entry animation — each row fades + slides in
            // 60ms after the previous. Total: top-10 fully visible in
            // 600 ms. Gives the table a "loading data" feel without
            // adding any spinner UI.
            const animationDelay = `${idx * 60}ms`;
            return (
              <tr
                key={c.id}
                className="hover:bg-bg-hover transition-colors group animate-in fade-in slide-in-from-bottom-1"
                style={{ animationDelay, animationDuration: '320ms' }}
              >
                <td className="py-1.5 pr-2 font-mono text-text-tertiary tabular-nums">
                  {idx + 1}
                </td>
                <td className="py-1.5 pr-2 font-mono text-text-primary truncate">
                  {c.id}
                </td>
                <td className="py-1.5 pr-2 text-text-secondary capitalize">
                  {c.type}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-text-primary tabular-nums">
                  {c.risk_probability?.toFixed(3) ?? '—'}
                </td>
                <td className="py-1.5 text-right relative">
                  {/* Inline value bar — width = loss / max. Drawn behind
                   *  the text via absolute positioning so the cell stays
                   *  numeric-readable. */}
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-4 rounded-sm pointer-events-none transition-[width] duration-700 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: `${fg}1A`,
                      borderRight: `2px solid ${fg}`,
                    }}
                  />
                  <span
                    className="relative font-mono font-medium tabular-nums pr-1"
                    style={{ color: fg }}
                  >
                    {fmt(loss)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
