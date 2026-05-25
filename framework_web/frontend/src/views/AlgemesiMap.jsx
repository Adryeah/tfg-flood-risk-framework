import React, { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { RiskZoneMap } from '../components/RiskZoneMap.jsx';
import { PixelInfoBody } from '../components/PixelInfoBody.jsx';
import { InfoHint } from '@/components/info-hint';
import { api } from '../lib/api.js';
import { ZONES } from '../lib/constants.js';

// ─── Per-metric documentation shown on hover. Specific to the
// Algemesí (extrapolation) context — same metric, different story
// vs Valencia training. Tone matches Comparativa's METRIC_DOCS.
const METRIC_DOCS = {
  'AUC ROC': {
    cite: 'sklearn.metrics.roc_auc_score',
    body: `Ranking-based AUC. Stays high (0.817) under transfer because ranking is robust to prevalence shift. This is the metric to trust in extrapolation; threshold-dependent ones (F1, Precisión) are not.`,
  },
  'AUC PR': {
    cite: 'sklearn.metrics.average_precision_score',
    body: `Area under the Precision-Recall curve. Naturally tiny when positive prevalence is < 1 %: the baseline for a random classifier ≈ prevalence (here 0.0029), so any non-trivial AUC PR above ~0.01 is informative. The 0.007 value isn't broken — it's a faithful reflection of how hard the extrapolation problem is.`,
  },
  'F1 score': {
    cite: 'sklearn.metrics.f1_score',
    body: `Harmonic mean of precision + recall at the recalibrated threshold 0.389. Drops dramatically (0.485 → 0.018) because precision collapses — see Precisión.`,
  },
  Precisión: {
    cite: 'sklearn.metrics.precision_score',
    body: `TP / (TP + FP). Collapses from 0.353 → 0.009 because positives are 27× rarer in Algemesí. With prevalence < 1 %, even a 5 % false-positive rate produces 17× more FP than TP — hence the floor.`,
  },
  Recall: {
    cite: 'sklearn.metrics.recall_score',
    body: `TP / (TP + FN). Counter-intuitively IMPROVES on Algemesí (0.777 → 0.919) because the threshold was recalibrated downward (0.614 → 0.389) to catch the rare positives.`,
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
    body: `MSE between predicted probabilities and the true outcome. Measures calibration. Lower = better. Random Forest's 0.111 here is decent given the prevalence shift.`,
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
    severe: 'text-risk-high',
    moderate: 'text-risk-medium',
    mild: 'text-text-tertiary',
    positive: 'text-risk-low',
    neutral: 'text-text-tertiary',
  };
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 text-10 font-mono tabular-nums ml-1.5 ' +
        palette[tone]
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

  const m = metrics?.model_metrics || {};
  const vm = valenciaMetrics?.model_metrics || {};
  const isCustom = Math.abs(threshold - ZONES.algemesi.threshold) > 1e-6;

  // Recall at 100 m buffer — operational neighbourhood-scale metric.
  // Show "—" if buffer_metrics is absent so the row order stays stable
  // vs Valencia (no silent omission).
  const buf100Alg = (metrics?.buffer_metrics || []).find(
    (b) => b.buffer_m === 100
  );
  const buf100Val = (valenciaMetrics?.buffer_metrics || []).find(
    (b) => b.buffer_m === 100
  );

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
      <header>
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Operations · Zone 02 · Extrapolation
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-serif text-28 leading-none text-text-primary tracking-tight">
            Risk map
            <span className="text-text-tertiary font-normal mx-2 not-italic">·</span>
            <span className="italic">Algemesí</span>
          </h1>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-risk-medium-bg text-risk-medium">
            Extrapolation zone
          </span>
        </div>
        <p className="font-serif italic text-14 text-text-secondary mt-2 max-w-2xl leading-snug">
          Ribera Alta del Júcar · Algemesí + Alzira · Same model, transferred without retraining as a geographic generalisation test.
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

        <aside className="space-y-3" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <Card title="Statistics" subtitle="Extrapolation · full surface">
            <dl className="divide-y divide-border-default text-13">
              {rows.map((row) => {
                const docs = METRIC_DOCS[row.label];
                const hasValue = row.value != null && Number.isFinite(row.value);
                const delta =
                  hasValue && Number.isFinite(row.baseline)
                    ? row.value - row.baseline
                    : null;
                return (
                  <div
                    key={row.label}
                    className="flex items-center justify-between py-1.5 group"
                  >
                    <dt className="text-text-secondary inline-flex items-center gap-1">
                      {row.label}
                      {docs && (
                        <InfoHint cite={docs.cite}>{docs.body}</InfoHint>
                      )}
                    </dt>
                    <dd className="font-mono font-medium text-text-primary tabular-nums">
                      {loading || !hasValue ? '—' : row.value.toFixed(3)}
                      {!loading && delta != null && (
                        <DeltaVsValencia delta={delta} />
                      )}
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
                    backgroundColor:
                      viewMode === opt.id ? '#1E2B4A' : '#FAFBFC',
                    color: viewMode === opt.id ? '#FFFFFF' : '#98A2B3',
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
                  Binary view: pixels with{' '}
                  <span className="font-mono text-text-secondary">
                    p ≥ {threshold.toFixed(3)}
                  </span>{' '}
                  are coloured red (flood-positive); the rest are muted
                  grey. Drag the slider to see the classification update
                  live.
                </>
              ) : (
                <>
                  Continuous view: 8-bin colour palette from the geojson.
                  Recalibrated threshold{' '}
                  <span className="font-mono text-text-secondary">
                    {ZONES.algemesi.threshold.toFixed(3)}
                  </span>{' '}
                  (original 0.614 was recalibrated because positive
                  prevalence differs by ~27× — 0.29 % vs 7.98 %). Switch
                  to Binary to apply the slider live to the map.
                </>
              )}
            </p>
          </Card>

          <Card
            title="Pixel inspection"
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
              <p className="text-12 text-risk-high">{error}</p>
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
          {subtitle && <p className="font-serif italic text-12 text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
