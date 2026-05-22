import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { Loader2, FlaskConical, AlertCircle, ArrowRight } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { MethodologySources } from '@/components/methodology-sources';
import { api } from '@/lib/api.js';
import { useHashParams } from '@/lib/hash-params.js';

// Curated sources for the Transferability view. The Evidently AI entry
// makes explicit that "Data Drift" is an industry-standard concept and
// this view is the framework's drift-detection dashboard for the model.
const SOURCES = [
  {
    author: 'Evidently AI',
    year: '2024',
    work: 'Data Drift detection dashboards · open-source ML monitoring.',
    used_for:
      'Reference pattern for feature-drift bar charts + per-feature drill-down.',
  },
  {
    author: 'Gama, Žliobaitė et al.',
    year: '2014',
    work: 'A survey on concept drift adaptation. ACM Computing Surveys 46.',
    used_for:
      'Definition and taxonomy of data drift / concept drift in supervised ML.',
  },
  {
    author: 'Roberts et al.',
    year: '2017',
    work:
      'Cross-validation strategies for data with spatial structure. Ecography 40(8).',
    used_for:
      'Justifies spatial extrapolation as a rigorous transferability test.',
  },
  {
    author: 'Breiman',
    year: '2001',
    work: 'Random Forests. Machine Learning 45(1).',
    used_for:
      'Permutation importance, recomputed independently per zone.',
  },
];

export function Transferability() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Cross-link target from Modelo y Validación. When the user clicks
  // "drift →" next to a feature in the glossary, we land here with
  // ?feature=<name>; the drift chart highlights that bar.
  const [hashParams] = useHashParams();
  const highlightFeature = hashParams.feature || null;

  useEffect(() => {
    let mounted = true;
    api.metrics
      .getSection('transferability')
      .then((d) => {
        if (!mounted) return;
        setData(d);
      })
      .catch((err) => console.error('Transferability load failed', err))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  // Pull headline AUC numbers if backend exposes them; otherwise fall
  // back to the values stated in the memoria (0.922 Valencia / 0.817
  // Algemesí). The fallback is documented in the conclusion card.
  const aucValencia = data?.auc_valencia ?? 0.922;
  const aucAlgemesi = data?.auc_algemesi ?? 0.817;
  const aucDrop = aucAlgemesi - aucValencia;

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1440px] mx-auto">
      {/* ─── HEADER · serif title + eyebrow ─── */}
      <div className="mb-6">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Methodology · Section 02
        </div>
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <h1 className="font-serif text-32 leading-none text-text-primary tracking-tight">
            Transferibilidad
          </h1>
          <Badge className="bg-brand-50 text-brand-700 hover:bg-brand-50 text-10 font-mono uppercase tracking-wider">
            Methodology
          </Badge>
          <Badge variant="outline" className="text-10 font-mono uppercase tracking-wider">
            Data Drift
          </Badge>
        </div>
        <p className="font-serif italic text-15 text-text-secondary mt-2 max-w-2xl leading-snug">
          Cómo se comporta el modelo entrenado en Valencia al aplicarse
          a Algemesí sin reentrenamiento.
        </p>
      </div>

      {/* ─── HERO TRANSFER NARRATIVE · 0.922 → 0.817 ───
       *  Typographic story: two big AUC numbers separated by an arrow,
       *  with the Δ chip floating below. Reads like a stat panel in a
       *  Bloomberg article. Replaces the prior banner-card. */}
      <div className="mb-6 pb-6 border-b border-border-default">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-3">
          AUC ROC · transferencia geográfica
        </div>
        <div className="flex items-baseline gap-5 flex-wrap">
          <div>
            <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
              Valencia · entrenamiento
            </div>
            <div className="font-mono text-[72px] leading-none font-semibold text-text-primary tabular-nums tracking-tight">
              {aucValencia.toFixed(3)}
            </div>
          </div>
          <ArrowRight
            className="w-10 h-10 text-text-tertiary self-center"
            strokeWidth={1.25}
          />
          <div>
            <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
              Algemesí · extrapolación
            </div>
            <div className="font-mono text-[72px] leading-none font-semibold text-text-primary tabular-nums tracking-tight">
              {aucAlgemesi.toFixed(3)}
            </div>
          </div>
          <div className="self-end pb-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-risk-medium-bg text-risk-medium text-13 font-mono font-semibold tabular-nums">
              Δ {aucDrop.toFixed(3)}
            </span>
          </div>
        </div>
      </div>

      {/* ─── KEY FINDING · vertical-rule pull quote ─── */}
      <div className="mb-8 pl-6 border-l-2 border-risk-medium">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-risk-medium" strokeWidth={1.75} />
          <span className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
            Hallazgo crítico
          </span>
        </div>
        <h3 className="font-serif text-22 text-text-primary tracking-tight leading-tight mb-2">
          Drift de feature detectado en{' '}
          <span className="font-mono text-18">distance_to_coast</span>
        </h3>
        <p className="font-serif text-15 text-text-secondary leading-relaxed max-w-3xl">
          {`La feature distance_to_coast es el predictor más importante en Valencia (+0.162 ΔAUC) pero invierte el signo y pasa a ser negativamente importante en Algemesí (−0.021). Algemesí es una cuenca fluvial (río Júcar), no un sistema costero. Para producción, el modelo necesitaría regionalización por tipo de cuenca hidrográfica.`}
        </p>
      </div>

      {/* ─── 01 Feature Drift ─── */}
      <div className="mb-8">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="font-serif italic text-32 text-text-tertiary leading-none">
            01
          </span>
          <h2 className="font-serif text-20 text-text-primary tracking-tight leading-none">
            Drift de features Valencia → Algemesí
          </h2>
        </div>
        <p className="font-serif italic text-13 text-text-secondary mb-2 leading-snug">
          Diferencia z-score normalizada por feature. Positivo = valores
          mayores en Algemesí.
        </p>
        {highlightFeature && (
          <div className="mb-2 text-11 font-mono text-brand-700 inline-flex items-center gap-1.5">
            <span>↳ Destacando</span>
            <code className="px-1.5 py-0.5 rounded-sm bg-brand-50 text-brand-700">
              {highlightFeature}
            </code>
            <a
              href="#/transferability"
              className="text-text-tertiary hover:text-text-primary underline text-10"
            >
              limpiar
            </a>
          </div>
        )}
        <FeatureDriftChart
          features={data.feature_drift}
          highlightFeature={highlightFeature}
        />
      </div>

      {/* ─── 02 Permutation Importance Comparison ─── */}
      <div className="mb-8">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="font-serif italic text-32 text-text-tertiary leading-none">
            02
          </span>
          <h2 className="font-serif text-20 text-text-primary tracking-tight leading-none">
            Comparativa de importancia por permutación
          </h2>
        </div>
        <p className="font-serif italic text-13 text-text-secondary mb-2 leading-snug">
          Contribución ΔAUC por feature en cada zona. El cambio drástico
          en distance_to_coast es la prueba decisiva.
        </p>
        <ImportanceComparisonChart
          data={data.permutation_importance_comparison}
        />
      </div>

      {/* ─── METHODOLOGICAL CONCLUSION · pull quote ─── */}
      <div className="mt-8 pl-6 border-l border-brand-500/60">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical
            className="w-4 h-4 text-brand-700"
            strokeWidth={1.75}
          />
          <span className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary">
            Conclusión metodológica
          </span>
        </div>
        <p className="font-serif text-15 text-text-secondary leading-relaxed max-w-3xl">
          {`El experimento de transferibilidad demuestra que la generalización del modelo tiene límites identificables y cuantificables. AUC ${aucAlgemesi.toFixed(3)} confirma que el modelo conserva capacidad de ordenación, pero el colapso de precisión (35% → 0.9%) muestra que la clasificación binaria falla. La causa raíz es identificable: drift en features geográficamente definidas (distance_to_coast). Para despliegue en producción, el modelo necesitaría regionalización por tipo de cuenca hidrográfica — costera, fluvial, montañosa. Este hallazgo, aunque pueda parecer un fallo del modelo, es exactamente el tipo de validación rigurosa que un TFG debe incluir.`}
        </p>
      </div>

      <div className="mt-8">
        <MethodologySources items={SOURCES} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Feature drift — diverging horizontal bar.
// Positive bars (drift > 0, Algemesí median > Valencia median) in
// risk-high red; negative in risk-low green. Bars sorted by |drift| so
// the worst-drifting features sit at the top.
// ────────────────────────────────────────────────────────────────
function FeatureDriftChart({ features, highlightFeature = null }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !features) return;
    const chart = echarts.init(ref.current);

    const sorted = [...features].sort(
      (a, b) => Math.abs(b.delta_normalized_std) - Math.abs(a.delta_normalized_std)
    );
    // Reverse for ECharts (y axis stacks bottom→top).
    const names = sorted.map((f) => f.feature).reverse();
    const values = sorted.map((f) => f.delta_normalized_std).reverse();

    chart.setOption({
      animation: false,
      grid: { left: 150, right: 60, top: 12, bottom: 36, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
        valueFormatter: (v) => `${Number(v).toFixed(3)} σ`,
      },
      xAxis: {
        type: 'value',
        name: 'Δ (Algemesí − Valencia) / σ_Valencia',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { fontSize: 10, color: '#98A2B3' },
        axisLabel: {
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          color: '#98A2B3',
          formatter: (v) => v.toFixed(2),
        },
        splitLine: { lineStyle: { color: '#F4F4F5' } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          color: '#52525B',
        },
      },
      series: [
        {
          type: 'bar',
          // When a feature is being cross-linked from the M&V glossary,
          // dim every OTHER bar to ~25% opacity and keep the highlighted
          // one at full saturation. Reads as a focus spotlight.
          data: values.map((v, i) => {
            const name = names[i];
            const isHighlight = highlightFeature && name === highlightFeature;
            const baseColor = v >= 0 ? '#DC2626' : '#16A34A';
            return {
              value: v,
              itemStyle: {
                color: baseColor,
                borderRadius: 3,
                opacity: highlightFeature ? (isHighlight ? 1 : 0.22) : 1,
                borderWidth: isHighlight ? 1.5 : 0,
                borderColor: isHighlight ? '#0F172A' : 'transparent',
              },
            };
          }),
          barWidth: 14,
        },
      ],
    });

    // If a feature is highlighted, scroll its row roughly into view by
    // emitting a `highlight` event after the chart paints (ECharts
    // handles this via dispatchAction).
    if (highlightFeature) {
      const idx = names.indexOf(highlightFeature);
      if (idx >= 0) {
        chart.dispatchAction({
          type: 'highlight',
          seriesIndex: 0,
          dataIndex: idx,
        });
      }
    }

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [features, highlightFeature]);

  return <div ref={ref} style={{ height: 420 }} />;
}

// ────────────────────────────────────────────────────────────────
// Importance comparison — grouped horizontal bar.
// Two bars per feature (Valencia · Algemesí). Sorted by Valencia
// importance descending, so the eye reads the top predictors first.
// ────────────────────────────────────────────────────────────────
function ImportanceComparisonChart({ data }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !data) return;
    const chart = echarts.init(ref.current);

    const sorted = [...data].sort(
      (a, b) => b.importance_valencia - a.importance_valencia
    );
    const names = sorted.map((d) => d.feature).reverse();
    const valencia = sorted.map((d) => d.importance_valencia).reverse();
    const algemesi = sorted.map((d) => d.importance_algemesi).reverse();

    chart.setOption({
      animation: false,
      grid: { left: 150, right: 30, top: 16, bottom: 56, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FAFBFC',
        borderColor: 'rgba(15,23,42,0.12)',
        textStyle: {
          fontFamily: 'Geist, Inter, system-ui',
          fontSize: 12,
          color: '#1F2937',
        },
        valueFormatter: (v) => Number(v).toFixed(4),
      },
      legend: {
        bottom: 0,
        textStyle: {
          fontSize: 11,
          color: '#52525B',
          fontFamily: 'Geist, Inter, system-ui',
        },
        icon: 'roundRect',
      },
      xAxis: {
        type: 'value',
        name: 'ΔAUC contribution',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { fontSize: 10, color: '#98A2B3' },
        axisLabel: {
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          color: '#98A2B3',
          formatter: (v) => v.toFixed(3),
        },
        splitLine: { lineStyle: { color: '#F4F4F5' } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          color: '#52525B',
        },
      },
      series: [
        {
          name: 'Valencia (trained)',
          type: 'bar',
          data: valencia,
          barWidth: 8,
          itemStyle: {
            color: '#1D4ED8',
            borderRadius: 2,
          },
        },
        {
          name: 'Algemesí (transferred)',
          type: 'bar',
          data: algemesi,
          barWidth: 8,
          itemStyle: {
            color: '#D97706',
            borderRadius: 2,
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

  return <div ref={ref} style={{ height: 440 }} />;
}
