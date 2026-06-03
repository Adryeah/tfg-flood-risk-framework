import React from 'react';
import { MODE_LABELS } from '@/lib/tour/tour-state.jsx';
import { MODEL_METRICS } from '@/lib/tour/incident-replay.js';

export function StatusStrip({ mode, activeIndex, total, isPlaying, speed, incidentTime, isReplaying }) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[600] h-7 flex items-center px-4 gap-4 text-9 font-mono uppercase tracking-widest backdrop-blur-md"
      style={{
        background: 'rgba(15,23,42,0.75)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        color: 'rgba(248,250,252,0.55)',
      }}
    >
      <span className="tracking-[0.22em]">UW CONSOLE</span>
      <span style={{ color: 'rgba(248,250,252,0.3)' }}>·</span>
      <span>
        ASSETS: <span style={{ color: '#F8FAFC' }}>{total}</span>
      </span>
      <span>
        MONITORED: <span style={{ color: '#22D3EE' }}>{activeIndex + 1}</span>
      </span>
      <span style={{ color: 'rgba(248,250,252,0.3)' }}>·</span>
      <span>
        MODE: <span style={{ color: '#F8FAFC' }}>{MODE_LABELS[mode] || mode}</span>
      </span>
      <span style={{ color: 'rgba(248,250,252,0.3)' }}>·</span>
      <span>SPEED: {speed}×</span>
      {(mode === 'sweep' || isReplaying) && (
        <>
          <span style={{ color: 'rgba(248,250,252,0.3)' }}>·</span>
          <span>
            AUC: <span style={{ color: '#10B981' }}>{MODEL_METRICS.auc}</span>
          </span>
          <span>
            RECALL: <span style={{ color: '#10B981' }}>{MODEL_METRICS.recall}</span>
          </span>
        </>
      )}
    </div>
  );
}