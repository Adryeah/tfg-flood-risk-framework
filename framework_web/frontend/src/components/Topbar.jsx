import React from 'react';
import { useState, useEffect } from 'react';
import { getLang, setLang, onLangChange } from '../lib/i18n.js';
import { GlobalSearch } from './global-search.jsx';

const SECTION_TITLES = {
  '/': 'Daily Briefing',
  '/dana': 'DANA · 29 octubre 2024',
  '/valencia': 'Valencia Map',
  '/algemesi': 'Algemesí Map',
  '/comparison': 'Comparison',
  '/portfolio': 'Portfolio Explorer',
  '/policy-map': 'Policy Map',
  '/exposure': 'Exposure Dashboard',
  '/validation': 'Model & Validation',
  '/transferability': 'Transferability',
  '/leakage': 'Leakage Audit',
  '/data': 'Data & Downloads',
};

// Local icon set for the topbar. Accepts className + style so callers can
// absolutely-position the icon inside an input wrapper (search lupa, etc.).
// The original implementation silently dropped both props, which left the
// search icon flowing above its parent — visible as a stray circle/"Q" on
// top of the topbar.
function Icon({ name, size = 14, className = '', style }) {
  const icons = {
    'chevron-right': <polyline points="9 18 15 12 9 6" />,
    'search': <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
    'help-circle': <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    'settings': <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    'menu': <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {icons[name] || null}
    </svg>
  );
}

export function Topbar({ onMenuClick = () => {} }) {
  const [lang, setLangState] = useState(getLang());
  const [sectionTitle, setSectionTitle] = useState('Daily Briefing');
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl/Cmd + K → open global search. Standard pattern (Linear, Notion,
  // Stripe Docs). Listening at window level so it works from any view.
  useEffect(() => {
    const handle = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  // Live counter for the "S1A · 19h ago" pill.
  // Anchor on a base timestamp (last S1A pass) and recompute every 30 s.
  // For the demo we use a sticky anchor 19 h before page load, then it
  // ticks up — "19h 0m" → "19h 1m" → … This is honest telemetry
  // appearance, not fake-real-time.
  const [tickLabel, setTickLabel] = useState('19h 0m');
  useEffect(() => {
    const lastPass = Date.now() - 19 * 3600 * 1000;
    const update = () => {
      const elapsedMs = Date.now() - lastPass;
      const totalMin = Math.floor(elapsedMs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      setTickLabel(`${h}h ${m}m`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const updateTitle = () => {
      const raw = window.location.hash.slice(1) || '/';
      const q = raw.indexOf('?');
      const hash = q === -1 ? raw : raw.slice(0, q);
      setSectionTitle(SECTION_TITLES[hash] || 'Overview');
    };
    updateTitle();
    window.addEventListener('hashchange', updateTitle);
    return () => window.removeEventListener('hashchange', updateTitle);
  }, []);

  useEffect(() => {
    return onLangChange((newLang) => setLangState(newLang));
  }, []);

  const handleLangChange = (code) => {
    setLang(code);
    setLangState(code);
  };

  const TOP_BG = '#243358';
  const INK = '#E6EAF2';
  const INK_MUTED = '#9BA6C1';

  return (
    <header className="h-14 sticky top-0 z-[1100] flex items-center px-3 sm:px-6 gap-2 sm:gap-6 border-b" style={{ backgroundColor: TOP_BG, borderBottomColor: 'rgba(0,0,0,0.18)', color: INK }}>
      {/* Hamburguesa — solo mobile. Abre el sidebar como drawer. md+ no
       *  la necesita porque el sidebar es persistente. */}
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menú"
        className="md:hidden -ml-1 w-9 h-9 inline-flex items-center justify-center rounded hover:bg-white/5 active:bg-white/10 transition-colors shrink-0"
        style={{ color: INK }}
      >
        <Icon name="menu" size={18} />
      </button>

      <div className="flex items-center text-13 gap-2 min-w-0 flex-1 md:flex-initial">
        {/* "Framework" + chip + breadcrumb chevron: SOLO md+. En mobile
         *  el espacio es escaso y el título de la sección ya dice dónde
         *  estamos. */}
        <span className="hidden md:inline" style={{ color: INK_MUTED }}>Framework</span>
        <span
          className="hidden md:inline-block text-10 font-mono uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-sm"
          style={{
            color: INK_MUTED,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          TFG · UAB 2026
        </span>
        <Icon name="chevron-right" size={14} className="hidden md:inline" style={{ color: INK_MUTED, opacity: 0.7 }} />
        <span className="font-medium tracking-tight truncate">{sectionTitle}</span>
        <Icon name="chevron-right" size={14} className="hidden lg:inline" style={{ color: INK_MUTED, opacity: 0.6 }} />
        <span className="hidden lg:inline text-11 font-mono uppercase tracking-wider whitespace-nowrap" style={{ color: INK_MUTED }}>
          ENV · OPS · Valencia
        </span>

        {/* Live ingestion indicator — solo lg+ para que no sature el topbar
         *  estrecho. La actividad del backend ya la indica el dot del sidebar. */}
        <span
          className="hidden lg:inline-flex ml-3 items-center gap-1.5 text-11 font-mono tabular-nums px-2 py-0.5 rounded-sm whitespace-nowrap"
          style={{
            color: '#86EFAC',
            background: 'rgba(22,163,74,0.10)',
            border: '1px solid rgba(22,163,74,0.20)',
          }}
        >
          <span className="relative inline-flex items-center">
            <span
              className="absolute w-1.5 h-1.5 rounded-full animate-ping opacity-60"
              style={{ background: '#16A34A' }}
            />
            <span
              className="relative w-1.5 h-1.5 rounded-full"
              style={{ background: '#16A34A' }}
            />
          </span>
          S1A · {tickLabel} ago
        </span>
      </div>

      {/* Search button — opens GlobalSearch dialog. En mobile sólo el icono
       *  (44px target), en md+ el label + kbd hint. */}
      <button
        onClick={() => setSearchOpen(true)}
        className="md:ml-auto inline-flex items-center gap-2 h-8 w-8 md:w-auto px-0 md:px-2.5 text-12 rounded transition-colors hover:bg-white/5 justify-center md:justify-start shrink-0"
        style={{
          border: '1px solid rgba(255,255,255,0.10)',
          color: INK_MUTED,
        }}
        title="Buscar pólizas · Ctrl+K"
        aria-label="Buscar pólizas"
      >
        <Icon name="search" size={13} />
        <span className="hidden md:inline">Buscar pólizas</span>
        <kbd
          className="hidden md:inline-flex items-center text-10 font-mono ml-1 px-1.5 rounded-sm"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {/* Lang switch — siempre visible (compacto, 56px), permite ES/EN
         *  desde mobile que es donde más probable es la demo en castellano. */}
        <div className="inline-flex items-center rounded overflow-hidden mr-1 text-11 font-mono" style={{ border: '1px solid rgba(255,255,255,0.14)' }}>
          {['en', 'es'].map((code) => (
            <button
              key={code}
              onClick={() => handleLangChange(code)}
              className="px-2 py-1 transition-colors"
              style={{
                backgroundColor: lang === code ? '#FFFFFF' : 'transparent',
                color: lang === code ? TOP_BG : INK_MUTED,
                fontWeight: lang === code ? '600' : '500',
              }}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Help/Settings: ocultos en sm-, son decorativos hoy y le quitan
         *  ancho útil al breadcrumb. En sm+ vuelven. */}
        <button className="hidden sm:flex w-8 h-8 items-center justify-center rounded transition-colors" style={{ color: INK_MUTED }} aria-label="Ayuda">
          <Icon name="help-circle" size={16} />
        </button>
        <button className="hidden sm:flex w-8 h-8 items-center justify-center rounded transition-colors" style={{ color: INK_MUTED }} aria-label="Ajustes">
          <Icon name="settings" size={16} />
        </button>

        <div className="hidden sm:block h-6 w-px mx-2" style={{ backgroundColor: 'rgba(255,255,255,0.10)' }} />

        {/* Avatar — hidden en mobile (espacio limitado), visible en sm+ */}
        <div
          className="hidden sm:flex w-8 h-8 items-center justify-center cursor-pointer text-11 font-mono font-medium tracking-[0.15em]"
          style={{
            border: '1px solid rgba(255,255,255,0.22)',
            color: '#F8FAFC',
          }}
        >
          AV
        </div>
      </div>

      {/* Global search dialog — controlled by Ctrl/Cmd+K + the search
       *  button. Renders nothing when closed. */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}