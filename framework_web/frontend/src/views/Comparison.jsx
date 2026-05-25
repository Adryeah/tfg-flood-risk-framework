import React, { useState, useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { RiskZoneMap } from '../components/RiskZoneMap.jsx';
import { InfoHint } from '@/components/info-hint';
import { api } from '../lib/api.js';

// ─── Per-metric documentation ────────────────────────────────────
// Each row in the metrics table renders an InfoHint with this body.
// Tone: same scientific-but-readable register as Methodology hints.
// Each entry maps the metric to a concrete sentence about WHY the
// number behaves the way it does under transfer — that's the value
// of this view (compare-vs-fail at a glance).
const METRIC_DOCS = {
  'AUC ROC': {
    cite: 'sklearn.metrics.roc_auc_score',
    body: `Area under the Receiver Operating Characteristic curve. Measures pure ranking: does the model assign higher probability to flooded pixels than to dry ones? Robust under prevalence shift — that's why it survives the transfer (0.922 → 0.817) better than F1 or precision.`,
  },
  'F1 score': {
    cite: 'sklearn.metrics.f1_score',
    body: `Harmonic mean of precision and recall at the decision threshold. Tied to a specific operating point, so it collapses when prevalence shifts. The 0.485 → 0.018 drop is mostly precision (prevalence is 27× lower in Algemesí).`,
  },
  Precision: {
    cite: 'sklearn.metrics.precision_score',
    body: `TP / (TP + FP). Fraction of "this pixel is flooded" calls that are correct. Heavily prevalence-dependent: if 99.7% of pixels are truly dry, even a small false-positive rate dominates the positive class.`,
  },
  Recall: {
    cite: 'sklearn.metrics.recall_score',
    body: `TP / (TP + FN). Fraction of actually-flooded pixels the model catches. Counter-intuitively IMPROVES on Algemesí (0.777 → 0.919) because the threshold was recalibrated to maximise F1 in the new prevalence regime.`,
  },
  Threshold: {
    cite: 'Operational decision point',
    body: `Probability above which a pixel is classified as flood. Valencia: 0.614 (recall ≥ 0.75 criterion on spatial CV). Algemesí: 0.389 (recalibrated to max F1 because the prevalence is so much lower that the Valencia threshold misses too many positives).`,
  },
  'Positive prevalence': {
    cite: 'EMSR773 ground truth',
    body: `Fraction of pixels that are truly flooded according to Copernicus EMS. Valencia: 7.98 % (the DANA hit hard). Algemesí: 0.29 % — 27× lower. This single number explains 80% of the difference in every other metric.`,
  },
};

// ─── Inline value bar (renders a thin coloured bar inside a number
// cell, proportional to its value [0..1]). Adds visual character to
// the otherwise plain numeric table.
function ValueBar({ v, color = '#1D4ED8' }) {
  const pct = Math.min(100, Math.max(0, (v ?? 0) * 100));
  return (
    <div className="relative mt-1 h-1 rounded-sm overflow-hidden bg-bg-subtle">
      <div
        className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ─── Delta chip with arrow icon + colour by severity.
// Recall going UP is good (green), F1/precision going DOWN is red,
// AUC mid-drop is amber, threshold/prevalence are neutral. The
// severity rule below keys off both direction and magnitude.
function DeltaChip({ delta, kind = 'numeric', suffix = '' }) {
  if (delta == null || Number.isNaN(delta)) {
    return <span className="text-text-tertiary font-mono">—</span>;
  }
  const abs = Math.abs(delta);
  let tone = 'neutral';
  if (kind === 'metric') {
    if (delta < 0 && abs >= 0.25) tone = 'severe';
    else if (delta < 0 && abs >= 0.08) tone = 'moderate';
    else if (delta < 0) tone = 'mild';
    else if (delta > 0) tone = 'positive';
  }
  const palette = {
    severe: 'bg-risk-high-bg text-risk-high',
    moderate: 'bg-risk-medium-bg text-risk-medium',
    mild: 'bg-bg-subtle text-text-secondary',
    positive: 'bg-risk-low-bg text-risk-low',
    neutral: 'bg-bg-subtle text-text-secondary',
  };
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const sign = delta > 0 ? '+' : '';
  const value =
    kind === 'metric' ? `${sign}${delta.toFixed(3)}` : `${sign}${delta.toFixed(2)}${suffix}`;
  return (
    <span
      className={
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-11 font-mono tabular-nums ' +
        palette[tone]
      }
    >
      <Icon className="w-3 h-3" strokeWidth={2} />
      {value}
    </span>
  );
}

export function Comparison() {
  const [valMetrics, setValMetrics] = useState(null);
  const [algMetrics, setAlgMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [vm, am] = await Promise.all([
          api.metrics.getSection('valencia'),
          api.metrics.getSection('algemesi'),
        ]);
        if (cancelled) return;
        setValMetrics(vm);
        setAlgMetrics(am);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Chart: bar pairs with flow animation + delta overlay ────────
  useEffect(() => {
    if (!chartRef.current || loading || !valMetrics || !algMetrics) return;

    const vm = valMetrics.model_metrics || {};
    const am = algMetrics.model_metrics || {};
    const round = (x) => Number(((x ?? 0) * 1).toFixed(3));
    const valData = [
      round(vm.auc_mean),
      round(vm.f1),
      round(vm.recall),
      round(vm.precision),
    ];
    const algData = [
      round(am.auc_mean),
      round(am.f1),
      round(am.recall),
      round(am.precision),
    ];
    // Delta = Algemesí − Valencia. Used to colour each Algemesí bar
    // by drop severity so the eye catches the catastrophes (F1 / Precision).
    const deltas = algData.map((v, i) => v - valData[i]);
    const algColorByDelta = deltas.map((d) => {
      if (d <= -0.25) return '#DC2626'; // severe red
      if (d <= -0.08) return '#D97706'; // amber
      if (d < 0) return '#94A3B8'; // mild grey
      return '#16A34A'; // positive green
    });

    const chart = echarts.init(chartRef.current);
    chart.setOption({
      animation: true,
      animationDuration: 900,
      animationEasing: 'cubicOut',
      // Stagger by metric index so the 4 pairs sweep in left-to-right
      animationDelay: (idx, params) =>
        (params?.dataIndex || 0) * 160 + (params?.seriesIndex || 0) * 100,
      grid: { left: 56, right: 24, top: 28, bottom: 56, containLabel: false },
      legend: {
        data: ['Valencia (training)', 'Algemesí (extrapolation)'],
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 11,
          color: '#52525B',
        },
        icon: 'roundRect',
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        borderWidth: 1,
        padding: [8, 10],
        extraCssText: 'box-shadow: 0 2px 4px rgba(15,23,42,0.08);',
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
        formatter: (params) => {
          if (!Array.isArray(params)) return '';
          const idx = params[0].dataIndex;
          const v = valData[idx];
          const a = algData[idx];
          const d = deltas[idx];
          const dColor = d <= -0.08 ? '#DC2626' : d > 0 ? '#16A34A' : '#52525B';
          const label = params[0].name;
          return (
            `<div style="font-family:'JetBrains Mono',monospace;font-weight:600;color:#1F2937;margin-bottom:4px;">${label}</div>` +
            `<div style="font-family:'JetBrains Mono',monospace;color:#475467;line-height:1.6;">` +
            `Valencia   <strong style="color:#1F2937;">${v.toFixed(3)}</strong><br/>` +
            `Algemesí   <strong style="color:#1F2937;">${a.toFixed(3)}</strong><br/>` +
            `Δ          <strong style="color:${dColor};">${d > 0 ? '+' : ''}${d.toFixed(3)}</strong>` +
            `</div>`
          );
        },
      },
      xAxis: {
        type: 'category',
        data: ['AUC ROC', 'F1', 'Recall', 'Precision'],
        axisLine: { lineStyle: { color: 'rgba(15,23,42,0.08)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#52525B',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          fontWeight: 600,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        splitLine: {
          lineStyle: { color: 'rgba(15,23,42,0.06)', type: 'dashed' },
        },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: (val) => val.toFixed(1),
        },
      },
      series: [
        {
          name: 'Valencia (training)',
          type: 'bar',
          data: valData,
          itemStyle: {
            color: '#1D4ED8',
            borderRadius: [3, 3, 0, 0],
            shadowColor: 'rgba(29,78,216,0.18)',
            shadowBlur: 6,
            shadowOffsetY: 1,
          },
          barWidth: '28%',
          emphasis: {
            itemStyle: { color: '#1E3A8A' },
          },
        },
        {
          name: 'Algemesí (extrapolation)',
          type: 'bar',
          // Each bar coloured individually by drop severity so the
          // catastrophic F1 + Precision drops jump out as red while the
          // preserved AUC ranks visually muted.
          data: algData.map((v, i) => ({
            value: v,
            itemStyle: {
              color: algColorByDelta[i],
              borderRadius: [3, 3, 0, 0],
              shadowColor: 'rgba(220,38,38,0.18)',
              shadowBlur: 6,
              shadowOffsetY: 1,
            },
          })),
          barWidth: '28%',
        },
        // Overlay: thin "drop lines" connecting each Valencia bar top to
        // the matching Algemesí bar top. Communicates the magnitude of
        // the transfer drop in a single glance — characteristic of
        // Evidently AI model-drift reports.
        {
          name: 'Δ',
          type: 'custom',
          renderItem: () => null, // hide from legend / chart
          silent: true,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [valMetrics, algMetrics, loading]);

  const vm = valMetrics?.model_metrics || {};
  const am = algMetrics?.model_metrics || {};

  // Rows for the Metrics comparison table. `deltaKind: 'metric'` enables
  // severity colour-coding on the Δ chip; 'numeric'/'raw' keep neutral.
  const rows = [
    {
      label: 'AUC ROC',
      v: vm.auc_mean,
      a: am.auc_mean,
      deltaKind: 'metric',
    },
    { label: 'F1 score', v: vm.f1, a: am.f1, deltaKind: 'metric' },
    { label: 'Precision', v: vm.precision, a: am.precision, deltaKind: 'metric' },
    { label: 'Recall', v: vm.recall, a: am.recall, deltaKind: 'metric' },
    {
      label: 'Threshold',
      v: 0.614,
      a: 0.389,
      raw: true,
      deltaKind: 'numeric',
    },
    {
      label: 'Positive prevalence',
      v: 7.98,
      a: 0.29,
      raw: true,
      suffix: ' %',
      deltaKind: 'numeric',
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        {/* Header chips con flex-wrap para que los badges no fuercen
         *  overflow horizontal en mobile. */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="text-20 font-semibold text-text-primary tracking-tight">
            Valencia vs Algemesí
          </h1>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-brand-50 text-brand-700 text-10 font-mono font-semibold uppercase tracking-wider">
            Same model
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-risk-medium-bg text-risk-medium text-10 font-mono font-semibold uppercase tracking-wider">
            Different zone
          </span>
        </div>
        <p className="text-12 text-text-secondary">
          Geographic transferability test — Random Forest v2 applied without
          retraining
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden relative">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border-default">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-13 font-semibold text-text-primary truncate tracking-tight">
                Valencia
              </h3>
              <span className="hidden sm:inline text-11 text-text-tertiary truncate">
                training zone
              </span>
            </div>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-brand-50 text-brand-700 shrink-0">
              Training
            </span>
          </div>
          <RiskZoneMap
            zone="valencia"
            /* clamp(min, ideal, max): mobile (300px viewport-ratio) sale
             * ~240, desktop (1500px) sale 360. Evita mapas inútilmente
             * altos en phone sin tocar el ratio en desktop. */
            height="clamp(240px, 38vh, 360px)"
            showOverlays={false}
            showLegend={false}
            showZones={false}
            includeTail={false}
          />
        </div>

        <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden relative">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border-default">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-13 font-semibold text-text-primary truncate tracking-tight">
                Algemesí
              </h3>
              <span className="hidden sm:inline text-11 text-text-tertiary truncate">
                extrapolation zone
              </span>
            </div>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-risk-medium-bg text-risk-medium shrink-0">
              Extrapolation
            </span>
          </div>
          <RiskZoneMap
            zone="algemesi"
            height="clamp(240px, 38vh, 360px)"
            showOverlays={false}
            showLegend={false}
            showZones={false}
            includeTail={false}
          />
        </div>
      </div>

      {/* ─── Metrics comparison — denser, with inline value bars, Δ
       *  column, and InfoHint per metric. En mobile el `(training)` /
       *  `(extrapolation)` se ocultan (la columna ya lo dice por la
       *  cabecera Valencia/Algemesí), los paddings se reducen, y el
       *  hint del header se oculta (touch no hace hover). Permitimos
       *  scroll horizontal como safety net si el viewport es muy
       *  estrecho. */}
      <div className="bg-bg-surface border border-border-default rounded">
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border-default flex items-center justify-between gap-3">
          <h3 className="text-13 font-semibold text-text-primary">
            Metrics comparison
          </h3>
          <span className="hidden md:inline text-10 font-mono uppercase tracking-wider text-text-tertiary">
            Hover any metric for definition + transfer reasoning
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-13 min-w-[480px]">
            <thead>
              <tr className="text-11 text-text-tertiary uppercase tracking-wider border-b border-border-default font-mono">
                <th className="text-left py-2 px-2 sm:px-4 font-semibold">Metric</th>
                <th className="text-right py-2 px-2 sm:px-4 font-semibold">
                  Valencia{' '}
                  <span className="hidden md:inline text-text-tertiary normal-case font-normal">
                    (training)
                  </span>
                </th>
                <th className="text-right py-2 px-2 sm:px-4 font-semibold">
                  Algemesí{' '}
                  <span className="hidden md:inline text-text-tertiary normal-case font-normal">
                    (extrapolation)
                  </span>
                </th>
                <th className="text-right py-2 px-2 sm:px-4 font-semibold w-[80px] sm:w-[120px]">
                  Δ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {rows.map((r) => {
                const docs = METRIC_DOCS[r.label];
                const vNum = Number(r.v);
                const aNum = Number(r.a);
                const delta = Number.isFinite(vNum) && Number.isFinite(aNum)
                  ? aNum - vNum
                  : null;
                const isMetric = r.deltaKind === 'metric';
                return (
                  <tr
                    key={r.label}
                    className="hover:bg-bg-hover transition-colors"
                  >
                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 text-text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        {r.label}
                        {docs && (
                          <InfoHint cite={docs.cite}>{docs.body}</InfoHint>
                        )}
                      </span>
                    </td>
                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 text-right font-mono font-medium text-text-primary tabular-nums">
                      {r.raw
                        ? `${vNum.toFixed(r.suffix ? 2 : 3)}${r.suffix || ''}`
                        : vNum.toFixed(3)}
                      {isMetric && <ValueBar v={vNum} color="#1D4ED8" />}
                    </td>
                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 text-right font-mono font-medium text-text-primary tabular-nums">
                      {r.raw
                        ? `${aNum.toFixed(r.suffix ? 2 : 3)}${r.suffix || ''}`
                        : aNum.toFixed(3)}
                      {isMetric && (
                        <ValueBar
                          v={aNum}
                          color={
                            delta != null && delta <= -0.25
                              ? '#DC2626'
                              : delta != null && delta <= -0.08
                                ? '#D97706'
                                : delta != null && delta > 0
                                  ? '#16A34A'
                                  : '#94A3B8'
                          }
                        />
                      )}
                    </td>
                    <td className="py-2 sm:py-2.5 px-2 sm:px-4 text-right">
                      <DeltaChip
                        delta={delta}
                        kind={r.deltaKind}
                        suffix={r.suffix?.trim() || ''}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Performance comparison chart — flow animation + per-bar
       *  severity colour on the Algemesí side + rich tooltip with Δ.
       *  Matches Evidently AI's model-drift report visual. ──── */}
      <div className="bg-bg-surface border border-border-default rounded p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-13 font-semibold text-text-primary">
            Performance comparison
          </h3>
          <span className="hidden sm:inline text-10 font-mono uppercase tracking-wider text-text-tertiary">
            Algemesí bars coloured by drop severity
          </span>
        </div>
        <p className="text-11 text-text-tertiary mb-3">
          Per-metric model behaviour under transferability
        </p>
        <div ref={chartRef} className="h-[260px] sm:h-[320px]" />
      </div>

      <div className="bg-brand-50 border-l-2 border-brand-700 rounded p-3 sm:p-4">
        <div className="text-10 font-mono font-semibold text-brand-700 uppercase tracking-wider mb-1.5">
          Transferability insight
        </div>
        <p className="text-13 text-text-primary leading-relaxed">
          The model trained exclusively on Valencia identifies{' '}
          <span className="font-semibold">91.9 %</span> of flooded areas in
          Algemesí without retraining. AUC drops from{' '}
          <span className="font-mono">0.922</span> to{' '}
          <span className="font-mono">0.817</span> but ranking remains highly
          informative. Precision collapses (
          <span className="font-mono">35.3 % → 0.9 %</span>) because positive
          prevalence is <span className="font-mono">27×</span> lower and there
          is feature drift on{' '}
          <span className="font-mono">distance_to_coast</span>.
        </p>
      </div>
    </div>
  );
}
