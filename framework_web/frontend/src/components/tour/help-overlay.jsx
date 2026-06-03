import React, { useState } from 'react';
import { X, HelpCircle } from 'lucide-react';

const SHORTCUTS = [
  { key: '← →', label: 'Navigate between assets' },
  { key: 'Space', label: 'Play / Pause tour' },
  { key: 'F1', label: 'Photo mode (default)' },
  { key: 'F2', label: 'Thermal mode (risk heat)' },
  { key: 'F3', label: 'Night Ops mode (NVG)' },
  { key: 'F4', label: 'Archive mode (evidence)' },
  { key: 'F5', label: 'Sweep mode (portfolio panoptic)' },
  { key: '1-9', label: 'Jump to top-N risk assets' },
];

export function HelpOverlay({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.88)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-[420px] rounded-lg p-6"
        style={{
          background: 'rgba(15,23,42,0.95)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-14 font-mono uppercase tracking-widest" style={{ color: '#F8FAFC' }}>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-1.5 border-b border-white/5">
              <span className="font-mono text-12" style={{ color: 'rgba(248,250,252,0.6)' }}>
                {label}
              </span>
              <span
                className="px-2 py-0.5 rounded text-11 font-mono"
                style={{ background: 'rgba(34,211,238,0.15)', color: '#22D3EE' }}
              >
                {key}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-3 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <span className="text-10 font-mono uppercase tracking-widest" style={{ color: 'rgba(248,250,252,0.35)' }}>
            Underwriter Console · Zurich Spain · TFG 2025-2026
          </span>
        </div>
      </div>
    </div>
  );
}

export function HelpButton({ onHelp }) {
  return (
    <button
      onClick={onHelp}
      className="absolute bottom-10 right-5 z-[600] w-8 h-8 flex items-center justify-center rounded-md backdrop-blur-md transition-colors hover:bg-white/10"
      style={{ background: 'rgba(15,23,42,0.78)', border: '1px solid rgba(255,255,255,0.10)' }}
      aria-label="Help"
    >
      <HelpCircle className="w-4 h-4" style={{ color: 'rgba(248,250,252,0.6)' }} />
    </button>
  );
}