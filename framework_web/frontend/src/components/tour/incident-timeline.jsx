import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useTourState } from '@/lib/tour/tour-state.jsx';
import { useTourActions } from '@/lib/tour/tour-state.jsx';
import { DANA_TIMELINE } from '@/lib/tour/incident-replay.js';

export function IncidentTimeline() {
  const { incidentTime, isReplaying } = useTourState();
  const { setIncidentTime, setReplaying } = useTourActions();

  const handlePlay = () => {
    if (isReplaying) {
      setReplaying(false);
    } else {
      setReplaying(true);
    }
  };

  const handleScrub = (e) => {
    setReplaying(false);
    setIncidentTime(Number(e.target.value));
  };

  const handleReset = () => {
    setReplaying(false);
    setIncidentTime(0);
  };

  const handleEnd = () => {
    setReplaying(false);
    setIncidentTime(100);
  };

  return (
    <div
      className="absolute left-4 right-4 z-[600] rounded-md backdrop-blur-md"
      style={{
        background: 'rgba(15,23,42,0.82)',
        border: '1px solid rgba(255,255,255,0.10)',
        bottom: '2.5rem',
      }}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleReset}
            className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            aria-label="Reset to pre-DANA"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handlePlay}
            className="w-8 h-8 inline-flex items-center justify-center rounded bg-[#22D3EE] text-slate-900 hover:bg-[#67E8F9] transition-colors"
            aria-label={isReplaying ? 'Pause replay' : 'Play replay'}
          >
            {isReplaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={handleEnd}
            className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            aria-label="Jump to ground truth"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-9 font-mono uppercase tracking-widest" style={{ color: 'rgba(248,250,252,0.5)' }}>
              Incident replay
            </span>
            <div className="flex items-center gap-3">
              <span className="text-9 font-mono" style={{ color: '#F59E0B' }}>
                {DANA_TIMELINE.preDANA.date}
              </span>
              <span className="text-9 font-mono" style={{ color: 'rgba(248,250,252,0.3)' }}>→</span>
              <span className="text-9 font-mono" style={{ color: '#22D3EE' }}>
                {DANA_TIMELINE.postDANA.date}
              </span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={incidentTime}
            onChange={handleScrub}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #F59E0B ${incidentTime}%, rgba(255,255,255,0.15) ${incidentTime}%)`,
            }}
          />
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-9 font-mono uppercase" style={{ color: 'rgba(248,250,252,0.3)' }}>
              Pre-DANA
            </span>
            <span className="text-9 font-mono uppercase" style={{ color: 'rgba(248,250,252,0.3)' }}>
              Ground truth
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-10 font-mono" style={{ color: '#22D3EE' }}>
            {Math.round(incidentTime)}%
          </div>
          <div className="text-9 font-mono uppercase tracking-wider" style={{ color: 'rgba(248,250,252,0.4)' }}>
            replay
          </div>
        </div>
      </div>
    </div>
  );
}