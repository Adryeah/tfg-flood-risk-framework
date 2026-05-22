import React from 'react';

/**
 * Sidebar Pixel-inspection card body. Consumes the same { lat, lon, status,
 * data, error } shape that RiskZoneMap fires through its `onPixelInspect`
 * callback, but rendered vertically and sticky in the sidebar — the on-map
 * MapPopup is transient (closes on outside click) while this card holds
 * onto the last inspected point until the user explicitly clears it.
 */
export function PixelInfoBody({ info }) {
  if (!info) {
    return (
      <p className="text-12 text-text-secondary leading-relaxed">
        Click any point on the map to query{' '}
        <span className="font-mono text-text-primary">/api/risk/predict</span>. The model returns
        probability, risk category, and the 14 feature values used.
      </p>
    );
  }

  const { lat, lon, status, data, error } = info;

  if (status === 'loading') {
    return (
      <div>
        <Coords lat={lat} lon={lon} />
        <div className="mt-2 text-12 text-text-secondary inline-flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: '#2563EB', animation: 'pulse 1.4s ease-in-out infinite' }}
          />
          Inspecting model…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div>
        <Coords lat={lat} lon={lon} />
        <div className="mt-2 text-12 text-risk-high">
          {error || 'Point outside coverage.'}
        </div>
      </div>
    );
  }

  const prob = Number(data.probability ?? 0);
  const cat = (
    data.category || (prob < 0.3 ? 'low' : prob < 0.614 ? 'medium' : 'high')
  ).toUpperCase();
  const sevBg = { LOW: '#ECFDF5', MEDIUM: '#FFFBEB', HIGH: '#FEF2F2' }[cat] || '#F3F5F7';
  const sevFg = { LOW: '#15803D', MEDIUM: '#D97706', HIGH: '#DC2626' }[cat] || '#1F2937';
  const features = data.features || {};
  const topFeatures = Object.entries(features).slice(0, 6);

  return (
    <div className="space-y-2 text-12">
      <Coords lat={lat} lon={lon} />

      <div className="flex items-baseline justify-between gap-3 pt-1">
        <span className="text-10 font-mono font-semibold uppercase tracking-wider text-text-tertiary">
          Probability
        </span>
        <span className="text-20 font-mono font-semibold text-text-primary tabular-nums">
          {prob.toFixed(3)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-text-secondary">Risk class</span>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider"
          style={{ background: sevBg, color: sevFg }}
        >
          {cat}
        </span>
      </div>

      {data.threshold_operational != null && (
        <div className="flex items-center justify-between gap-3 text-text-secondary">
          <span>vs threshold</span>
          <span className="font-mono text-text-primary">
            {data.is_above_threshold ? 'ABOVE' : 'below'} ·{' '}
            {Number(data.threshold_operational).toFixed(3)}
          </span>
        </div>
      )}

      {topFeatures.length > 0 && (
        <div className="pt-2 mt-2 border-t border-border-default">
          <div className="text-10 font-mono font-semibold uppercase tracking-wider text-text-tertiary mb-1">
            Features
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-11">
            {topFeatures.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-text-secondary font-mono truncate" title={k}>
                  {k}
                </dt>
                <dd className="text-text-primary font-mono text-right tabular-nums">
                  {typeof v === 'number' ? v.toFixed(2) : String(v)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Coords({ lat, lon }) {
  return (
    <div className="text-11 font-mono text-text-tertiary tabular-nums">
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </div>
  );
}
