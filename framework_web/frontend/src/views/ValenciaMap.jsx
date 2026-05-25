import React, { useState, useEffect } from 'react';

import { RiskZoneMap } from '../components/RiskZoneMap.jsx';
import { InfoTooltip } from '../components/InfoTooltip.jsx';
import { PixelInfoBody } from '../components/PixelInfoBody.jsx';
import { api } from '../lib/api.js';
import { ZONES } from '../lib/constants.js';

export function ValenciaMap() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [threshold, setThreshold] = useState(ZONES.valencia.threshold);
  const [pixelInfo, setPixelInfo] = useState(null);
  // View mode: 'continuous' = 8-bin coloured palette (default);
  // 'binary' = single-threshold classification driven by the slider.
  const [viewMode, setViewMode] = useState('continuous');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.metrics.getSection('valencia');
        if (cancelled) return;
        setMetrics(data);
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
  const buf100 = (metrics?.buffer_metrics || []).find((b) => b.buffer_m === 100);
  const recall100 = buf100?.recall ?? null;
  const isCustom = Math.abs(threshold - ZONES.valencia.threshold) > 1e-6;

  const rows = [
    { label: 'AUC ROC', value: m.auc_mean?.toFixed(3) ?? '—' },
    ...(m.auc_pr != null ? [{ label: 'AUC PR', value: m.auc_pr.toFixed(3) }] : []),
    { label: 'F1 score', value: m.f1?.toFixed(3) ?? '—' },
    { label: 'Precision', value: m.precision?.toFixed(3) ?? '—' },
    { label: 'Recall', value: m.recall?.toFixed(3) ?? '—' },
    ...(recall100 != null ? [{ label: 'Recall (100 m)', value: recall100.toFixed(3) }] : []),
    { label: 'Accuracy', value: m.accuracy?.toFixed(3) ?? '—' },
    ...(m.brier != null ? [{ label: 'Brier score', value: m.brier.toFixed(3) }] : []),
  ];

  return (
    <div className="space-y-3">
      {/* ─── HEADER · editorial register (eyebrow + serif title + italic
       *  subtitle). Coincide con el patrón de model-validation.jsx para
       *  que las páginas top-nav se sientan parte de la misma "publicación"
       *  en lugar de cards de SaaS dashboard idénticas. */}
      <header>
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Operations · Zone 01 · Training
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-serif text-28 leading-none text-text-primary tracking-tight">
            Risk map
            <span className="text-text-tertiary font-normal mx-2 not-italic">·</span>
            <span className="italic">Valencia</span>
          </h1>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-brand-50 text-brand-700">
            Training zone
          </span>
        </div>
        <p className="font-serif italic text-14 text-text-secondary mt-2 max-w-2xl leading-snug">
          l'Horta Sud · 14 DANA-affected municipalities · Flood probability surface from Random Forest v2.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
          <RiskZoneMap
            zone="valencia"
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
          <Card title="Statistics" subtitle="GroupKFold 5 × 1 km · out-of-fold">
            <dl className="divide-y divide-border-default text-13">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between py-1.5">
                  <dt className="text-text-secondary">{row.label}</dt>
                  <dd className="font-mono font-medium text-text-primary">
                    {loading ? '—' : row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card
            title="Threshold"
            actions={
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-bg-subtle text-text-tertiary">
                {isCustom ? 'custom' : 'operational'}
              </span>
            }
          >
            {/* View mode toggle — Continuo (8-bin colour) vs Binario
             *  (single-threshold classification). Compact segmented
             *  control so the user sees the slider's effect IMMEDIATELY
             *  when switching to Binario; in Continuo the slider just
             *  records the value without altering the map. */}
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
                  Continuous view: 8-bin colour palette from the
                  geojson. Operational threshold{' '}
                  <span className="font-mono text-text-secondary">
                    {ZONES.valencia.threshold.toFixed(3)}
                  </span>{' '}
                  selected by recall ≥ 0.75 criterion on spatial
                  cross-validation. Switch to Binary to apply the
                  slider live to the map.
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
          <h3 className="text-13 font-semibold text-text-primary tracking-tight">{title}</h3>
          {subtitle && <p className="text-11 text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
