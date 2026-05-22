import React, { useState, useEffect } from 'react';

// ─── Section accent palette ───────────────────────────────────
// Each top-level section carries its own colour so the sidebar reads
// as 3 registers, not one uniform list:
//   ANALYSIS    → institutional blue (operational dashboards register)
//   PORTFOLIO   → amber              (commercial / underwriting register)
//   METHODOLOGY → green              (academic / rigorous register)
// The accent drives: the dot next to the section label, the left rail
// of the active item, and the icon colour when the item is active.
const SIDEBAR_SECTIONS = [
  {
    label: 'ANALYSIS',
    accent: '#2563EB', // brand-500
    items: [
      { id: 'overview', label: 'Overview', icon: 'layout-dashboard', path: '/' },
      { id: 'valencia', label: 'Valencia Map', icon: 'map', path: '/valencia' },
      { id: 'algemesi', label: 'Algemesí Map', icon: 'map', path: '/algemesi' },
      { id: 'comparison', label: 'Comparison', icon: 'git-compare', path: '/comparison' },
    ],
  },
  {
    label: 'PORTFOLIO',
    accent: '#D97706', // amber 600
    items: [
      { id: 'portfolio', label: 'Portfolio Explorer', icon: 'briefcase', path: '/portfolio' },
      { id: 'policy-map', label: 'Policy Map', icon: 'map', path: '/policy-map' },
      { id: 'exposure', label: 'Exposure Dashboard', icon: 'bar-chart-3', path: '/exposure' },
    ],
  },
  {
    label: 'METHODOLOGY',
    accent: '#15803D', // green 700
    items: [
      { id: 'validation', label: 'Model & Validation', icon: 'shield-check', path: '/validation' },
      { id: 'transferability', label: 'Transferability', icon: 'flask-conical', path: '/transferability' },
      { id: 'leakage', label: 'Leakage Audit', icon: 'alert-triangle', path: '/leakage' },
    ],
  },
];

function Icon({ name, size = 16, className = '', style }) {
  const icons = {
    'layout-dashboard': <path d="M3 3h7v9H3V3zm11 0h7v5h-7V3zm0 9h7v9h-7v-9zM3 16h7v5H3v-5z" />,
    'map': <><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>,
    'git-compare': <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></>,
    'briefcase': <><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
    'bar-chart-3': <><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>,
    'shield-check': <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></>,
    'flask-conical': <><path d="M14 2v6l2 2h4l2-2V2" /><path d="M10 2v6" /><path d="M6 14h12l-1 10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 14z" /></>,
    'alert-triangle': <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  };
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name] || null}
    </svg>
  );
}

export function Sidebar() {
  const [statusDot, setStatusDot] = useState('#475569');
  const [statusLabel, setStatusLabel] = useState('Checking backend…');

  useEffect(() => {
    const pingHealth = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const data = r.ok ? await r.json() : null;
        const ok = data?.status === 'ok' && data?.model_loaded === true;
        setStatusDot(ok ? '#16A34A' : '#D97706');
        setStatusLabel(ok ? 'Backend online · model loaded' : 'Backend degraded');
      } catch {
        setStatusDot('#DC2626');
        setStatusLabel('Backend offline');
      }
    };
    pingHealth();
    const interval = setInterval(pingHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const currentPath = window.location.hash.slice(1) || '/';

  return (
    <aside className="w-80 min-h-[100dvh] h-[100dvh] flex flex-col fixed left-0 top-0 z-[1200] shrink-0" style={{ backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid rgba(0,0,0,0.18)' }}>
      {/* ─── Editorial wordmark ───
       *  Serif italic "Flood Risk" paired with tracked-out small caps
       *  "FRAMEWORK" — typographic juxtaposition (serif × mono caps)
       *  replaces the generic sans wordmark that read as default AI
       *  dashboard chrome (per `frontend-design` skill: "Avoid generic
       *  fonts ... opt instead for distinctive choices"). */}
      <div
        className="h-16 px-5 flex items-center border-b"
        style={{ borderBottomColor: 'rgba(255,255,255,0.06)' }}
      >
        <a
          href="#/"
          className="flex items-center gap-2.5 hover:opacity-95 transition-opacity"
        >
          <img src="/logo.svg" alt="" width="24" height="24" />
          <div className="flex flex-col leading-none">
            <span
              className="font-serif italic text-16 tracking-tight"
              style={{ color: '#F8FAFC' }}
            >
              Flood Risk
            </span>
            <span
              className="text-[9px] font-mono uppercase tracking-[0.28em] mt-1.5"
              style={{ color: 'rgba(248,250,252,0.45)' }}
            >
              Framework
            </span>
          </div>
        </a>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            {/* Section header with accent dot. Dot is sized at 1.5×1.5 px
             *  so it reads as a typographic accent, not a status badge. */}
            <div
              className="px-5 mb-1.5 text-10 font-mono font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 w-full"
              style={{ color: 'var(--sidebar-text-muted)' }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: section.accent }}
                aria-hidden="true"
              />
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = item.path === currentPath;
              return (
                <a
                  key={item.id}
                  href={`#${item.path}`}
                  className={`group flex items-center gap-2.5 px-5 py-1.5 text-13 border-l-2 transition-colors ${isActive ? 'is-active' : ''}`}
                  style={{
                    color: isActive ? '#ffffff' : 'var(--sidebar-text-muted)',
                    backgroundColor: isActive ? 'var(--sidebar-active)' : 'transparent',
                    // Active rail picks up the section accent — this is
                    // what turns the sidebar into 3 visual registers.
                    borderLeftColor: isActive ? section.accent : 'transparent',
                    // CSS variable so the .is-active inset-shadow rail in
                    // main.css can pick up this section's accent too.
                    ['--section-accent']: section.accent,
                  }}
                >
                  <Icon
                    name={item.icon}
                    size={16}
                    className="shrink-0"
                    style={isActive ? { color: section.accent } : undefined}
                  />
                  <span className="truncate">{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ─── Minimal footer ───
       *  Two-row typographic info block. No Docs link (removed per
       *  request). Build label set in tracked small caps mono. The
       *  health dot stays compact; status text reads as caption. */}
      <div
        className="px-5 py-3 border-t"
        style={{ borderTopColor: 'rgba(255,255,255,0.06)' }}
      >
        <div
          className="flex items-center gap-2 text-11 mb-1.5"
          style={{ color: 'var(--sidebar-text-muted)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: statusDot }}
          />
          <span>{statusLabel}</span>
        </div>
        <div
          className="text-[9px] font-mono uppercase tracking-[0.22em]"
          style={{ color: 'rgba(248,250,252,0.32)' }}
        >
          Build 0.1.0 · RF v2 · GroupKFold 5×1km
        </div>
      </div>
    </aside>
  );
}