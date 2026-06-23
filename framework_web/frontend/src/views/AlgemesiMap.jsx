import React, { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { RiskZoneMap } from '../components/RiskZoneMap.jsx';
import { PixelInfoBody } from '../components/PixelInfoBody.jsx';
import { InfoHint } from '@/components/info-hint';
import { LoadErrorState } from '@/components/load-error-state.jsx';
import { api } from '../lib/api.js';
import { ZONES } from '../lib/constants.js';

// ─── Per-metric documentation shown on hover. Specific to the
// Algemesí (extrapolation) context — same metric, different story
// vs Valencia training. Tone matches Comparativa's METRIC_DOCS.
const METRIC_DOCS = {
  'AUC ROC': {
    cite: 'sklearn.metrics.roc_auc_score',
    body: `Ranking-based AUC. Stays high (0.861) under transfer — even higher than in-domain (0.848) — because ranking is robust to prevalence shift and distance_to_river transfers cleanly across basins. This is the metric to trust in extrapolation; threshold-dependent ones (F1, Precisión) are not.`,
  },
  'AUC PR': {
    cite: 'sklearn.metrics.average_precision_score',
    body: `Area under the Precision-Recall curve. Naturally tiny when positive prevalence is < 1 %: the baseline for a random classifier ≈ prevalence (here 0.0030), so any non-trivial AUC PR above ~0.01 is informative. The 0.011 value isn't broken — it's a faithful reflection of how hard the extrapolation problem is.`,
  },
  'F1 score': {
    cite: 'sklearn.metrics.f1_score',
    body: `Harmonic mean of precision + recall at the single calibrated threshold 0.160 (same as Valencia, no recalibration). Low in both zones (0.348 → 0.023) because precision is structurally limited at pixel level under extreme imbalance — see Precisión. The product aggregates to zone/policy level, where buffered recall (0.94 at 100 m) is the figure that matters.`,
  },
  Precisión: {
    cite: 'sklearn.metrics.precision_score',
    body: `TP / (TP + FP). Low in-domain (0.239) and collapses to 0.012 in Algemesí because positives are ~27× rarer there. With prevalence < 1 %, even a 5 % false-positive rate produces far more FP than TP — hence the floor. This is why the product reads risk at zone level, not pixel level.`,
  },
  Recall: {
    cite: 'sklearn.metrics.recall_score',
    body: `TP / (TP + FN). With v3-T the recall transfers at the SAME calibrated threshold (0.639 → 0.676, it does not even drop) — unlike the prior v2 model whose extrapolated recall collapsed to 0.18. With a 100 m operational buffer it reaches 0.94.`,
  },
  'Recall (100 m)': {
    cite: 'Tellman et al. 2021 · Nature 596',
    body: `Recall when a prediction within 100 m of a true positive counts as a hit. Operational tolerance — accounts for SAR pixel size + geocoding error. The standard in flood remote sensing for benchmarking detection quality.`,
  },
  Exactitud: {
    cite: 'sklearn.metrics.accuracy_score',
    body: `(TP + TN) / total. Misleading when classes are imbalanced — for Algemesí, predicting "no flood" everywhere would yield 99.7 % accuracy. Look at AUC and Recall instead.`,
  },
  'Brier score': {
    cite: 'Brier 1950',
    body: `MSE between predicted probabilities and the true outcome. Measures calibration. Lower = better. v3-T's 0.021 here reflects the isotonic recalibration to natural prevalence — the probabilities are honestly scaled, not inflated.`,
  },
};

// ─── Compact delta chip: shows Δ vs Valencia baseline with arrow.
// Direction-aware colour: AUC drop is concerning (amber), F1/Precisión
// drops are catastrophic (red), Recall improvements are positive (green).
function DeltaVsValencia({ delta }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const abs = Math.abs(delta);
  let tone = 'neutral';
  if (delta < 0 && abs >= 0.25) tone = 'severe';
  else if (delta < 0 && abs >= 0.08) tone = 'moderate';
  else if (delta < 0) tone = 'mild';
  else if (delta > 0) tone = 'positive';
  const palette = {
    severe: 'text-risk-high-soft',
    moderate: 'text-risk-medium-soft',
    mild: 'text-text-tertiary',
    positive: 'text-risk-low-soft',
    neutral: 'text-text-tertiary',
  };
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 text-10 font-mono tabular-nums ml-1.5 ' + palette[tone]
      }
      title={`vs Valencia (training)`}
    >
      <Icon className="w-2.5 h-2.5" strokeWidth={2.5} />
      {delta > 0 ? '+' : ''}
      {delta.toFixed(3)}
    </span>
  );
}

export function AlgemesiMap() {
  const [metrics, setMetrics] = useState(null);
  const [valenciaMetrics, setValenciaMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [threshold, setThreshold] = useState(ZONES.algemesi.threshold);
  const [pixelInfo, setPixelInfo] = useState(null);
  // Same continuous / binary toggle as Valencia — see ValenciaMap.jsx
  const [viewMode, setViewMode] = useState('continuous');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch both zones in parallel so we can render Δ-vs-Valencia
        // chips next to each metric (extrapolation story at a glance).
        const [alg, val] = await Promise.all([
          api.metrics.getSection('algemesi'),
          api.metrics.getSection('valencia'),
        ]);
        if (cancelled) return;
        setMetrics(alg);
        setValenciaMetrics(val);
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

  if (error && !metrics) {
    return <LoadErrorState message={error} />;
  }

  const m = metrics?.model_metrics || {};
  const vm = valenciaMetrics?.model_metrics || {};
  const isCustom = Math.abs(threshold - ZONES.algemesi.threshold) > 1e-6;

  // Recall at 100 m buffer — operational neighbourhood-scale metric.
  // Show "—" if buffer_metrics is absent so the row order stays stable
  // vs Valencia (no silent omission).
  const buf100Alg = (metrics?.buffer_metrics || []).find((b) => b.buffer_m === 100);
  const buf100Val = (valenciaMetrics?.buffer_metrics || []).find((b) => b.buffer_m === 100);

  // Each row carries the algemesí value AND the matching Valencia
  // baseline so the renderer can compute the Δ chip. `compareKind`:
  // 'metric' → severity-coloured Δ; 'absolute' → no chip (e.g. label).
  const rows = [
    {
      label: 'AUC ROC',
      value: m.auc_mean,
      baseline: vm.auc_mean,
    },
    { label: 'AUC PR', value: m.auc_pr, baseline: vm.auc_pr },
    { label: 'F1 score', value: m.f1, baseline: vm.f1 },
    { label: 'Precisión', value: m.precision, baseline: vm.precision },
    { label: 'Recall', value: m.recall, baseline: vm.recall },
    {
      label: 'Recall (100 m)',
      value: buf100Alg?.recall,
      baseline: buf100Val?.recall,
    },
    { label: 'Exactitud', value: m.accuracy, baseline: vm.accuracy },
    { label: 'Brier score', value: m.brier, baseline: vm.brier },
  ];

  return (
    <div className="space-y-3">
      {/* ─── HEADER · editorial register, mismo patrón que ValenciaMap
       *  pero con eyebrow "Zone 02 · Extrapolation" y acento amber
       *  (risk-medium) en el badge para marcar visualmente que esta es
       *  la zona NO entrenada. */}
      <header className="animate-in fade-in slide-in-from-bottom-2 duration-700">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Operations · Zone 02 · Extrapolation
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-serif text-28 leading-none text-text-primary tracking-tight">
            Risk map
            <span className="text-text-tertiary font-normal mx-2 not-italic">·</span>
            <span className="italic">Algemesí</span>
          </h1>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-risk-medium-bg text-risk-medium-soft">
            Extrapolation zone
          </span>
        </div>
        <p className="font-serif italic text-14 text-text-secondary mt-2 max-w-2xl leading-snug">
          Ribera Alta del Júcar · Algemesí + Alzira · Same model, transferred without retraining as
          a geographic generalisation test.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
          <RiskZoneMap
            zone="algemesi"
            height="calc(100vh - 200px)"
            showOverlays
            showLegend
            showZones={false}
            includeTail
            enablePixelInspection
            onPixelInspect={setPixelInfo}
            threshold={threshold}
            binaryView={viewMode === 'binary'}
          />
        </div>

        <aside
          className="space-y-3"
          style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}
        >
          <Card title="Statistics" subtitle="Extrapolation · full surface">
            <dl className="divide-y divide-border-default text-13">
              {rows.map((row) => {
                const docs = METRIC_DOCS[row.label];
                const hasValue = row.value != null && Number.isFinite(row.value);
                const delta =
                  hasValue && Number.isFinite(row.baseline) ? row.value - row.baseline : null;
                return (
                  <div key={row.label} className="flex items-center justify-between py-1.5 group">
                    <dt className="text-text-secondary inline-flex items-center gap-1">
                      {row.label}
                      {docs && <InfoHint cite={docs.cite}>{docs.body}</InfoHint>}
                    </dt>
                    <dd className="font-mono font-medium text-text-primary tabular-nums">
                      {loading || !hasValue ? '—' : row.value.toFixed(3)}
                      {!loading && delta != null && <DeltaVsValencia delta={delta} />}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>

          <Card
            title="Threshold"
            actions={
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-bg-subtle text-text-tertiary">
                {isCustom ? 'custom' : 'recalibrated'}
              </span>
            }
          >
            {/* Continuo / Binario toggle — same control as Valencia */}
            <div className="inline-flex items-center rounded overflow-hidden border border-border-strong text-10 font-mono mb-3">
              {[
                { id: 'continuous', label: 'Continuo' },
                { id: 'binary', label: 'Binario' },
              ].map((opt, i) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setViewMode(opt.id)}
                  className="px-2.5 py-1 uppercase tracking-wider transition-colors"
                  style={{
                    backgroundColor: viewMode === opt.id ? 'rgba(255,255,255,0.10)' : 'transparent',
                    color: viewMode === opt.id ? '#f7f8f8' : '#8a8f98',
                    fontWeight: viewMode === opt.id ? 600 : 400,
                    borderLeft: i > 0 ? '1px solid var(--border-strong)' : 'none',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-bg-subtle rounded-sm appearance-none cursor-pointer accent-brand-500"
              />
              <span className="font-mono text-13 font-medium text-text-primary w-16 text-right">
                {threshold.toFixed(3)}
              </span>
            </div>
            <p className="text-11 text-text-tertiary mt-3 leading-relaxed">
              {viewMode === 'binary' ? (
                <>
                  Capa de inspección · <strong>sensibilidad primero</strong>. Píxeles con{' '}
                  <span className="font-mono text-text-secondary">p ≥ {threshold.toFixed(3)}</span>{' '}
                  se marcan para inspección (rojo). El umbral operacional 0,160 (recall ≥ 0,75)
                  marca ~17 % del territorio <em>a propósito</em>: en seguros, no detectar una
                  inundación es peor que inspeccionar de más. Sube el umbral para aislar el núcleo
                  de alto riesgo (p ≥ 0,50 ≈ 2 %).
                </>
              ) : (
                <>
                  Continuous view: 8-bin colour palette from the geojson. El modelo v3-T aplica el{' '}
                  <span className="font-mono text-text-secondary">
                    mismo umbral calibrado {ZONES.algemesi.threshold.toFixed(3)}
                  </span>{' '}
                  que en Valencia, sin recalibración — la calibración isotónica hace comparable la
                  escala de probabilidad entre zonas. Cambia a Binario para aplicar el slider al
                  mapa.
                </>
              )}
            </p>
          </Card>

          <Card
            title="Inspección de píxel"
            actions={
              pixelInfo && (
                <button
                  type="button"
                  onClick={() => setPixelInfo(null)}
                  className="text-10 font-mono uppercase tracking-wider text-text-tertiary hover:text-text-primary"
                >
                  Clear
                </button>
              )
            }
          >
            <PixelInfoBody info={pixelInfo} />
          </Card>

          {error && (
            <Card title="Error">
              <p className="text-12 text-risk-high-soft">{error}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Card({ title, subtitle, actions, children }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
        <div>
          {/* Mismo registro editorial que ValenciaMap.Card. */}
          <h3 className="font-serif text-15 text-text-primary tracking-tight">{title}</h3>
          {subtitle && (
            <p className="font-serif italic text-12 text-text-tertiary mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
