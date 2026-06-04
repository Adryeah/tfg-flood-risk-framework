import React from 'react';
import { useTourState } from '@/lib/tour/tour-state.jsx';
import { useTourActions } from '@/lib/tour/tour-state.jsx';
import { TOUR_MODES, MODE_LABELS } from '@/lib/tour/tour-state.jsx';

// Cada modo lleva su propio tinte semántico — refuerza la
// transición visual y desambigua el modo activo del resto.
//   PHOTO   → azul cian (analítica neutra)
//   THERMAL → rojo flood (heat-map register)
//   NIGHT   → verde NVG (low-light register)
//   ARCHIVE → ámbar (evidence/dossier)
//   SWEEP   → dorado (god-mode panoptic)
const MODE_KEYS = [
  { mode: TOUR_MODES.PHOTO, key: 'F1', label: 'PHOTO', tint: '#22D3EE', fg: '#0F172A' },
  { mode: TOUR_MODES.THERMAL, key: 'F2', label: 'THERMAL', tint: '#E74C3C', fg: '#FFFFFF' },
  { mode: TOUR_MODES.NIGHT, key: 'F3', label: 'NIGHT', tint: '#22C55E', fg: '#052E16' },
  { mode: TOUR_MODES.ARCHIVE, key: 'F4', label: 'ARCHIVE', tint: '#F39C12', fg: '#1F2937' },
  { mode: TOUR_MODES.SWEEP, key: 'F5', label: 'SWEEP', tint: '#FBBF24', fg: '#1F2937' },
];

export function ModeBank({ currentMode }) {
  const { setMode } = useTourActions();

  return (
    <div
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[600] flex items-center gap-1 px-2 py-1.5 rounded-md backdrop-blur-md"
      style={{
        background: 'rgba(15,23,42,0.78)',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {MODE_KEYS.map(({ mode, key, label, tint, fg }) => {
        const isActive = mode === currentMode;
        return (
          <button
            key={mode}
            onClick={() => setMode(mode)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-all"
            style={
              isActive
                ? { background: tint, color: fg }
                : { color: 'rgb(203,213,225)' }
            }
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
            title={`${key} · ${label}`}
          >
            <span className="text-9 font-mono" style={{ opacity: isActive ? 0.65 : 0.4 }}>
              {key}
            </span>
            <span className="text-10 font-mono uppercase tracking-widest">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function useKeyboardModeSwitcher() {
  const { setMode } = useTourActions();

  React.useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      switch (e.key) {
        case 'F1': e.preventDefault(); setMode(TOUR_MODES.PHOTO); break;
        case 'F2': e.preventDefault(); setMode(TOUR_MODES.THERMAL); break;
        case 'F3': e.preventDefault(); setMode(TOUR_MODES.NIGHT); break;
        case 'F4': e.preventDefault(); setMode(TOUR_MODES.ARCHIVE); break;
        case 'F5': e.preventDefault(); setMode(TOUR_MODES.SWEEP); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode]);
}