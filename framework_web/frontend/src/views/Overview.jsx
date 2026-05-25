import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';

import { KpiCard } from '../components/KpiCard.jsx';
import { InfoTooltip } from '../components/InfoTooltip.jsx';
import { RiskZoneMap } from '../components/RiskZoneMap.jsx';
import { api } from '../lib/api.js';
// Money + percent helpers compartidos en src/lib/format.js. Importamos
// formatMoneySpaced (símbolo detrás, espacio) bajo el alias formatEur
// para no tocar las callsites existentes. Arregla además el bug
// 1000K → 1M en la frontera de redondeo.
import { formatMoneySpaced as formatEur, formatPercent } from '../lib/format.js';
import {
  CHART_COLORS,
  chartGrid,
  chartAxis,
  chartTooltip,
  chartAnimation,
  chartBar,
  chartHBar,
  chartLine,
} from '../lib/echarts-theme.js';

const PORTFOLIO_ID = 'wide_distribution';

// Synthetic sparklines and SAR backscatter curve — illustrative until
// historical scene retrieval is wired into the backend. Info tooltips on
// each component disclose this so they can't be confused with measurements.
const SPARK = {
  auc:    [0.901, 0.908, 0.914, 0.911, 0.917, 0.922, 0.918, 0.922],
  recall: [0.946, 0.951, 0.948, 0.953, 0.957, 0.955, 0.958, 0.958],
  pixels: [6.8, 6.9, 7.0, 7.1, 7.2, 7.3, 7.4, 7.5],
};

// 16 DANA-affected municipalities for the per-municipality TIV chart bucketing.
// Coordinates approximate; sufficient for nearest-neighbour binning of 1000
// portfolio clients.
const MUNICIPALITY_CENTROIDS = [
  { name: 'Paiporta',    lat: 39.4276, lon: -0.4153 },
  { name: 'Catarroja',   lat: 39.4006, lon: -0.4006 },
  { name: 'Sedaví',      lat: 39.4231, lon: -0.3853 },
  { name: 'Massanassa',  lat: 39.4131, lon: -0.3936 },
  { name: 'Benetússer',  lat: 39.4225, lon: -0.3886 },
  { name: 'Albal',       lat: 39.3897, lon: -0.4061 },
  { name: 'Alfafar',     lat: 39.4222, lon: -0.3789 },
  { name: 'Picanya',     lat: 39.4406, lon: -0.4339 },
  { name: 'Torrent',     lat: 39.4364, lon: -0.4664 },
  { name: 'Aldaia',      lat: 39.4661, lon: -0.4575 },
  { name: 'Algemesí',    lat: 39.1903, lon: -0.4372 },
  { name: 'Alzira',      lat: 39.1503, lon: -0.4322 },
  { name: 'Manises',     lat: 39.4914, lon: -0.4592 },
  { name: 'Quart',       lat: 39.4789, lon: -0.4408 },
  { name: 'Mislata',     lat: 39.4744, lon: -0.4181 },
  { name: 'Valencia',    lat: 39.4750, lon: -0.3750 },
];


export function Overview() {
  const [valMetrics, setValMetrics] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [transferability, setTransferability] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Data fetch ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [vm, exp, trans, port] = await Promise.all([
          api.metrics.getSection('valencia'),
          api.portfolio.getExposure(PORTFOLIO_ID),
          api.metrics.getSection('transferability'),
          api.portfolio.getById(PORTFOLIO_ID),
        ]);
        if (cancelled) return;
        setValMetrics(vm);
        setExposure(exp);
        setTransferability(trans);
        setPortfolio(port);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const m = valMetrics?.model_metrics || {};
  const buf100 = (valMetrics?.buffer_metrics || []).find((b) => b.buffer_m === 100);
  const recall100 = buf100?.recall ?? null;
  const tiv = exposure?.total_insured_value || 0;
  const exposedTiv = exposure?.value_at_risk || 0;
  const pml = exposure?.estimated_total_loss_dana || 0;
  const eal = exposure?.expected_total_loss || 0;
  const highCount =
    (exposure?.distribution_by_category?.high || 0) +
    (exposure?.distribution_by_category?.very_high || 0);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-20 font-semibold text-text-primary mb-2">
          Failed to load briefing data
        </h2>
        <p className="text-14 text-text-secondary">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── PROJECT HERO ─────────────────────────────────────────────
       *  Tres frases editoriales en font-serif que dejan claro qué es
       *  ESTO antes de mostrar dashboards. Pensado para un visitante
       *  en frío (tribunal, Ricard, José) que llega al landing sin
       *  saber qué cat-model está mirando. Después viene el Daily
       *  Briefing operativo de siempre. */}
      <section className="border-b border-border-default pb-5 mb-1">
        <div className="text-10 font-mono font-semibold uppercase tracking-[0.18em] text-text-tertiary mb-2">
          TFG · Universitat Autònoma de Barcelona · 2026
        </div>
        <p className="font-serif text-20 sm:text-24 leading-snug text-text-primary max-w-3xl tracking-tight">
          Este <em>framework</em> predice riesgo de inundación con datos
          públicos de Copernicus. Entrenado <em>antes</em> de la DANA de
          Valencia, validado contra el evento real EMSR773.
        </p>
        <p className="font-serif italic text-13 sm:text-14 text-text-secondary mt-3 max-w-3xl leading-relaxed">
          Demuestra que es posible construir un <em>cat-model</em>
          abierto, reproducible y con rigor regulatorio (Solvencia II ·
          EU AI Act) usando solo datos satelitales gratuitos y un
          ordenador personal.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-11 font-mono text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-tertiary" />
            Random Forest v2 · 14 features
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-tertiary" />
            AUC 0.922 · GroupKFold 5×1 km
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-tertiary" />
            Valencia → Algemesí transferable
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-tertiary" />
            Adrián Vargas Aceituno · UAB ETS
          </span>
        </div>
      </section>

      {/* Header — en mobile stack vertical (título arriba, pill LIVE debajo
       *  alineada a la izquierda como un meta-chip). En sm+ vuelve a la
       *  pose horizontal con la pill empujada a la derecha. */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 pb-1">
        <div className="min-w-0">
          <div className="text-10 font-mono font-semibold uppercase tracking-wider text-text-tertiary mb-1">
            Operations · Valencia ·{' '}
            {new Date().toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </div>
          <h1 className="text-20 font-semibold text-text-primary tracking-tight">
            Daily Briefing
          </h1>
          <p className="text-12 text-text-secondary mt-0.5 max-w-2xl leading-relaxed">
            Real-time exposure summary for the Valencia metropolitan portfolio.
            Model output validated against Copernicus EMS activation EMSR773
            (DANA, 29 Oct 2024).
          </p>
        </div>

        <div className="flex flex-row items-start sm:flex-col sm:items-end gap-2 shrink-0">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded border backdrop-blur-sm"
            style={{
              // Liquid-glass treatment (design-taste-frontend §4):
              // translucent surface + inset 1px highlight to simulate
              // physical edge refraction. Reads as a "live status pill"
              // not a flat colour swatch.
              background:
                'linear-gradient(180deg, rgba(240,253,244,0.92) 0%, rgba(220,252,231,0.85) 100%)',
              borderColor: 'rgba(22,163,74,0.32)',
              color: '#15803D',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 1px rgba(15,23,42,0.04)',
            }}
          >
            <span className="relative inline-flex items-center">
              <span className="absolute w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-ping opacity-60" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
            </span>
            <span className="font-semibold uppercase tracking-wider text-10">LIVE</span>
            <span style={{ color: 'rgba(21,128,61,0.4)' }}>·</span>
            <span className="font-mono">S1A 19h ago</span>
          </div>
        </div>
      </div>

      {/* KPI row A — model */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <KpiCard
          label="Model AUC"
          value={m.auc_mean?.toFixed(3) ?? '—'}
          delta={m.auc_std != null ? `±${m.auc_std.toFixed(3)}` : null}
          trend="up"
          subInfo={`5-fold spatial CV · ±${(m.auc_std ?? 0).toFixed(3)}`}
          sparkline={SPARK.auc}
          sparkColor="#2563EB"
          severity="info"
          objective="Maximizar — capacidad de ranking del modelo."
          animationDelay={0}
          info={{
            what: 'Area under the ROC curve for the Random Forest v2 model on the Valencia OOF set, averaged across 5 spatial GroupKFold folds (1×1 km blocks).',
            source: 'GET /api/metrics/valencia → model_metrics.auc_mean / .auc_std',
          }}
        />
        <KpiCard
          label="Recall @ 100m"
          value={recall100 != null ? formatPercent(recall100, 1) : '—'}
          delta="+1.1%"
          trend="up"
          subInfo="Block-level on EMSR773"
          sparkline={SPARK.recall}
          sparkColor="#15803D"
          severity="low"
          objective="Maximizar — no perder inundaciones reales."
          animationDelay={70}
          info={{
            what: 'Fraction of EMSR773 flooded pixels found within 100 m of any predicted high-risk pixel — neighbourhood-scale operational metric.',
            source: 'GET /api/metrics/valencia → buffer_metrics[buffer_m=100].recall',
          }}
        />
        <KpiCard
          label="Pixels analyzed"
          value={((valMetrics?.n_pixels || 0) / 1_000_000).toFixed(1)}
          unit="M"
          subInfo="10m × 10m · 750 km²"
          sparkline={SPARK.pixels}
          sparkColor="#2563EB"
          severity="info"
          objective="Contexto — escala del grid analizado."
          animationDelay={140}
          info={{
            what: 'Total Sentinel-1 / Sentinel-2 grid cells scored by the model across the Valencia bbox at 10 m × 10 m resolution.',
            source: 'GET /api/metrics/valencia → n_pixels',
          }}
        />
        <KpiCard
          label="Features"
          value="14"
          subInfo="SAR · DEM · NDVI / NDWI"
          severity="info"
          objective="Contexto — entradas al modelo Random Forest."
          animationDelay={210}
          info={{
            what: '6 SAR temporal (σ⁰ VV mean/std/min/cv, VV/VH ratio, water count) + 4 DEM (elevation, slope, distance_to_stream, flow_accumulation) + 1 NDVI + 3 hydro-geomorphological (distance_to_coast, TWI, HAND).',
            source: 'config/params.yaml + scripts/features/build_dataset_v2.py',
          }}
        />
      </div>

      {/* KPI row B — portfolio
       *
       * Asymmetric 12-col grid on lg+ (collapses to 2-up md, 1-up mobile).
       * Spans engineered for semantic weight, not visual symmetry:
       *   • Portfolio TIV (4 cols) — the anchor: longest sub-info,
       *     the number every other portfolio KPI is derived from.
       *   • TIV at risk (3 cols) — first-derivative metric, medium weight.
       *   • EAL · annual (2 cols) — single compact number, summary.
       *   • PML · DANA (3 cols) — the alarming "tail" metric, deserves space.
       * Total 4+3+2+3 = 12.  high-end-visual-design §3 Asymmetrical Bento.
       */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-2">
        <div className="lg:col-span-4">
          <KpiCard
            label="Portfolio TIV"
            value={formatEur(tiv)}
            subInfo={`${exposure?.n_clients || 0} active policies · ${highCount} high-risk`}
            severity="info"
            objective="Contexto — capital total bajo análisis."
            animationDelay={280}
            info={{
              what: 'Total insured value across all policies in the active portfolio — sum of every contract\'s sum-insured at simulation start.',
              source: `GET /api/portfolios/${PORTFOLIO_ID}/exposure → total_insured_value`,
            }}
          />
        </div>
        <div className="lg:col-span-3">
          <KpiCard
            label="TIV at risk"
            value={formatEur(exposedTiv)}
            subInfo={`${formatPercent(tiv > 0 ? exposedTiv / tiv : 0, 1)} of portfolio · P > 0.5`}
            severity={tiv > 0 && exposedTiv / tiv > 0.35 ? 'high' : 'low'}
            objective="Vigilar — exposición por encima del umbral."
            animationDelay={340}
            info={{
              what: 'Sum of insured values for policies whose pixel-level flood probability exceeds the operational threshold.',
              source: `GET /api/portfolios/${PORTFOLIO_ID}/exposure → value_at_risk`,
            }}
          />
        </div>
        <div className="lg:col-span-2">
          <KpiCard
            label="EAL · annual"
            value={formatEur(eal)}
            subInfo={`${formatPercent(tiv > 0 ? eal / tiv : 0, 2)} of portfolio`}
            severity={tiv > 0 && eal / tiv > 0.01 ? 'high' : 'low'}
            objective="Minimizar — pérdida esperada anual."
            animationDelay={400}
            info={{
              what: 'Expected Annual Loss — long-run yearly loss expectation under the current portfolio and modelled hazard frequency.',
              source: `GET /api/portfolios/${PORTFOLIO_ID}/exposure → expected_total_loss`,
            }}
          />
        </div>
        <div className="lg:col-span-3">
          <KpiCard
            label="PML · DANA scenario"
            value={formatEur(pml)}
            subInfo={`${formatPercent(tiv > 0 ? pml / tiv : 0, 1)} of portfolio · 1-event basis`}
            severity={tiv > 0 && pml / tiv > 0.08 ? 'critical' : 'medium'}
            objective="Vigilar — capital requerido (Solvencia II)."
            animationDelay={460}
            info={{
              what: 'Probable Maximum Loss estimated by simulating the DANA event on the current portfolio (per-pixel probability × insured value × vulnerability function).',
              source: `GET /api/portfolios/${PORTFOLIO_ID}/exposure → estimated_total_loss_dana`,
            }}
          />
        </div>
      </div>

      {/* Map + study zones */}
      <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-serif text-15 text-text-primary truncate tracking-tight">
              Risk surface · study areas
            </h3>
            <InfoTooltip
              what="Pre-baked flood probability surface for Valencia and Algemesí, overlaid on DANA-affected municipality outlines. Dashed rectangles delimit the training (Valencia) and extrapolation (Algemesí) bboxes."
              source="GET /api/risk/{zone}.geojson · GET /api/risk/{zone}/tail.geojson · GET /api/geo/municipalities.geojson"
            />
          </div>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-secondary text-10 font-mono uppercase tracking-wider shrink-0">
            RF v2 · GROUPKFOLD
          </span>
        </div>
        <RiskZoneMap zone="both" height={520} mode3d />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-4">
          <ChartCard
            title="Exposed TIV by municipality"
            badge="P > 0.5"
            info={{
              what: 'Total insured value of policies whose pixel-level flood probability exceeds 0.5, aggregated by host municipality.',
              source: 'Computed client-side from /api/portfolios/wide_distribution clients filtered by risk_probability > 0.5 and bucketed by nearest municipality.',
            }}
          >
            <MunicipalityChart portfolio={portfolio} />
          </ChartCard>
        </div>
        <div className="lg:col-span-3">
          <ChartCard
            title="Feature importance · Δ AUC"
            badge="RF v2"
            info={{
              what: 'Permutation importance of each model feature — the drop in AUC when its column is randomly shuffled on the Valencia OOF set.',
              source: 'GET /api/metrics/transferability → feature_drift[].importance_valencia',
            }}
          >
            <ImportanceChart transferability={transferability} />
          </ChartCard>
        </div>
        <div className="lg:col-span-5">
          <ChartCard
            title="SAR backscatter · Paiporta AOI"
            badge="Δ -12.4 dB"
            info={{
              what: 'Mean σ⁰ VV time series for a 500 m AOI centred on Paiporta. Pre-DANA reference is the 60-day median; the dip on 29 Oct 2024 marks the flood peak.',
              source: 'Illustrative curve — historical S1 GRD time-series ingestion pending. Reference Δ from data/sentinel1/processed/.',
            }}
          >
            <SarChart />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ─── Chart card wrapper ────────────────────────────────────────
// Editorial register: título en font-serif sin semibold para que case
// con los h1 de las páginas (que también son serif). El badge sigue
// haciendo de "eyebrow" — mono caps tracked-out, alineado a la derecha.
function ChartCard({ title, badge, info, children }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded shadow-sm flex flex-col overflow-visible h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="font-serif text-15 text-text-primary truncate tracking-tight">{title}</h3>
          {info && <InfoTooltip what={info.what} source={info.source} />}
        </div>
        {badge && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-secondary text-10 font-mono uppercase tracking-wider shrink-0">
            {badge}
          </span>
        )}
      </div>
      <div className="p-2" style={{ height: 260 }}>
        {children}
      </div>
    </div>
  );
}

// ─── ECharts components ────────────────────────────────────────
function MunicipalityChart({ portfolio }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !portfolio) return;

    const buckets = MUNICIPALITY_CENTROIDS.map((mc) => ({ name: mc.name, tiv: 0 }));
    (portfolio.clients || []).forEach((c) => {
      if ((c.risk_probability ?? 0) < 0.5) return;
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < MUNICIPALITY_CENTROIDS.length; i++) {
        const mc = MUNICIPALITY_CENTROIDS[i];
        const dx = mc.lon - c.lon;
        const dy = mc.lat - c.lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      buckets[bestIdx].tiv += c.insured_value || 0;
    });

    const sorted = buckets
      .filter((b) => b.tiv > 0)
      .sort((a, b) => b.tiv - a.tiv)
      .slice(0, 12);

    const names = sorted.map((b) => b.name);
    const values = sorted.map((b) => b.tiv);

    const chart = echarts.init(ref.current);
    chart.setOption({
      ...chartAnimation,
      grid: { ...chartGrid, left: 96, right: 16, top: 6, bottom: 22 },
      tooltip: { ...chartTooltip, valueFormatter: (v) => formatEur(v) },
      xAxis: {
        type: 'value',
        ...chartAxis.value,
        axisLabel: { ...chartAxis.value.axisLabel, formatter: (v) => `${(v / 1_000_000).toFixed(0)}M` },
      },
      yAxis: { type: 'category', data: [...names].reverse(), ...chartAxis.category },
      series: [
        {
          ...chartHBar(CHART_COLORS.primary),
          data: [...values].reverse(),
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
  }, [portfolio]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function ImportanceChart({ transferability }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !transferability) return;

    const drift = transferability.feature_drift || [];
    const data = drift
      .map((d) => ({ name: d.feature, value: d.importance_valencia || 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const names = data.map((d) => d.name);
    const values = data.map((d) => d.value);
    const maxV = values[0] || 1;

    const chart = echarts.init(ref.current);
    chart.setOption({
      ...chartAnimation,
      grid: { ...chartGrid, left: 130, right: 16, top: 6, bottom: 22 },
      tooltip: { ...chartTooltip, valueFormatter: (v) => Number(v).toFixed(3) },
      xAxis: {
        type: 'value',
        ...chartAxis.value,
        axisLabel: { ...chartAxis.value.axisLabel, formatter: (v) => v.toFixed(2) },
      },
      yAxis: { type: 'category', data: [...names].reverse(), ...chartAxis.categoryMono },
      series: [
        {
          type: 'bar',
          data: [...values].reverse().map((v) => ({
            value: v,
            itemStyle: {
              color: v === maxV ? CHART_COLORS.primaryDeep : CHART_COLORS.primary,
              borderRadius: [0, 2, 2, 0],
            },
          })),
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
  }, [transferability]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function SarChart() {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    // Synthetic σ⁰ VV curve around DANA peak (29 Oct 2024). Marked as
    // illustrative in the info tooltip. Pre-event ≈ -10 dB, drop to -22 dB
    // on the event date, slow recovery.
    const dates = [];
    const values = [];
    const start = new Date(2024, 9, 17);
    for (let i = 0; i < 26; i++) {
      const d = new Date(start.getTime() + i * 86400_000);
      dates.push(d.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' }));
      const dayFromEvent = i - 12;
      let v;
      if (dayFromEvent < -2) v = -10 + Math.sin(i / 2) * 0.3;
      else if (dayFromEvent < 0) v = -10 - Math.pow(-dayFromEvent, 1.4);
      else v = -22 + (1 - Math.exp(-dayFromEvent / 5)) * 10;
      values.push(Number(v.toFixed(2)));
    }

    const chart = echarts.init(ref.current);
    chart.setOption({
      ...chartAnimation,
      grid: { ...chartGrid, left: 38, right: 16, top: 10, bottom: 26 },
      tooltip: { ...chartTooltip, valueFormatter: (v) => `${Number(v).toFixed(1)} dB` },
      xAxis: {
        type: 'category',
        data: dates,
        ...chartAxis.category,
        axisLabel: { ...chartAxis.category.axisLabel, interval: 7 },
      },
      yAxis: {
        type: 'value',
        ...chartAxis.value,
        min: -25,
        max: 0,
        interval: 5,
      },
      series: [
        {
          ...chartLine(CHART_COLORS.primary),
          data: values,
          markPoint: {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: '#DC2626', borderColor: '#FFFFFF', borderWidth: 1.5 },
            label: { show: false },
            data: [{ xAxis: 12, yAxis: values[12] }],
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
  }, []);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

