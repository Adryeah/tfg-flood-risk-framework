import React from 'react';

export function TacticalMiniMap({ policies, activeIndex }) {
  if (!policies || policies.length === 0) return null;
  const W = 180, H = 180, PAD = 18;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const p of policies) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const lonSpan = Math.max(maxLon - minLon, 0.001);
  const latSpan = Math.max(maxLat - minLat, 0.001);
  const project = (lon, lat) => {
    const x = PAD + ((lon - minLon) / lonSpan) * (W - 2 * PAD);
    const y = PAD + ((maxLat - lat) / latSpan) * (H - 2 * PAD);
    return [x, y];
  };

  const active = policies[activeIndex];
  const [ax, ay] = active ? project(active.lon, active.lat) : [W / 2, H / 2];

  return (
    <div
      className="hidden md:block absolute top-3 right-3 z-[600] rounded-md backdrop-blur-md overflow-hidden"
      style={{
        background: 'rgba(15,23,42,0.82)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.32)',
      }}
    >
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-9 font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(248,250,252,0.5)' }}>
          TACTICAL MAP
        </span>
        <span className="text-9 font-mono" style={{ color: 'rgba(248,250,252,0.35)' }}>
          WGS84 · EPSG:4326
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="rgba(255,255,255,0.04)" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.04)" />
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        {policies.map((p, i) => {
          if (i === activeIndex) return null;
          const [x, y] = project(p.lon, p.lat);
          return <circle key={i} cx={x} cy={y} r="2" fill="#38BDF8" fillOpacity="0.6" />;
        })}
        {active && (
          <g>
            <circle cx={ax} cy={ay} r="10" fill="none" stroke="#22D3EE" strokeWidth="1.2" opacity="0.5">
              <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={ax} cy={ay} r="4" fill="#22D3EE" stroke="#FFFFFF" strokeWidth="1.5" />
          </g>
        )}
        <text x={W - PAD} y={H - PAD + 4} textAnchor="end" fontSize="7" fill="rgba(248,250,252,0.3)" fontFamily="monospace">N</text>
        <polygon points={`${W - PAD - 4},${PAD} ${W - PAD},${PAD - 4} ${W - PAD + 4},${PAD}`} fill="rgba(248,250,252,0.3)" />
      </svg>
    </div>
  );
}