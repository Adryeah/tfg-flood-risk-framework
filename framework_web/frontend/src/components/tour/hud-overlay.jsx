import React, { useState, useEffect } from 'react';
import { useTourState } from '@/lib/tour/tour-state.jsx';
import { MODE_LABELS } from '@/lib/tour/tour-state.jsx';
import { TargetRegistry } from '@/components/tour/target-registry.jsx';
import { TacticalMiniMap } from '@/components/tour/tactical-minimap.jsx';
import { ModeBank } from '@/components/tour/mode-bank.jsx';
import { StatusStrip } from '@/components/tour/status-strip.jsx';
import { IncidentTimeline } from '@/components/tour/incident-timeline.jsx';
import { HelpButton, HelpOverlay } from '@/components/tour/help-overlay.jsx';

export function HudOverlay({ policies, onSelectPolicy }) {
  const { mode, hud, activePolicyIdx, totalPolicies, isPlaying, speed, incidentTime, isReplaying } =
    useTourState();
  const [showHelp, setShowHelp] = useState(false);
  const activePolicy = policies?.[activePolicyIdx];

  // Keyboard shortcuts globales del console — no específicos de mode
  // bank (eso vive en useKeyboardModeSwitcher). '?' o '/' o 'h' abren
  // la ayuda; ESC la cierra.
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      // '?' viene con Shift+/. Capturamos ambos por compatibilidad
      // multiplataforma (Mac, ES layout, etc.).
      if (e.key === '?' || (e.shiftKey && e.key === '/') || e.key === 'h') {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      } else if (e.key === 'Escape' && showHelp) {
        e.preventDefault();
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHelp]);

  return (
    <>
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      <HelpButton onHelp={() => setShowHelp(true)} />

      {hud.callsigns && (
        <TargetRegistry
          policy={activePolicy}
          index={activePolicyIdx}
          total={totalPolicies}
          onPrev={() => onSelectPolicy(Math.max(0, activePolicyIdx - 1))}
          onNext={() => onSelectPolicy(Math.min(totalPolicies - 1, activePolicyIdx + 1))}
        />
      )}

      {hud.grid && (
        <TacticalMiniMap policies={policies} activeIndex={activePolicyIdx} />
      )}

      <ModeBank currentMode={mode} />

      <StatusStrip
        mode={mode}
        activeIndex={activePolicyIdx}
        total={totalPolicies}
        isPlaying={isPlaying}
        speed={speed}
        incidentTime={incidentTime}
        isReplaying={isReplaying}
      />

      {(mode === 'sweep' || isReplaying) && <IncidentTimeline />}

      <div className="absolute bottom-5 right-5 z-[600] flex items-center gap-2 px-2.5 py-1.5 rounded-sm backdrop-blur-md md:hidden"
        style={{ background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(248,250,252,0.7)' }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
        <span className="text-10 font-mono uppercase tracking-[0.16em]">OpenFreeMap · Free tier</span>
      </div>
    </>
  );
}
