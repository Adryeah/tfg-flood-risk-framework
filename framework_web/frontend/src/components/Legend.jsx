import React from 'react';

const RISK_PALETTE = [
  '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24',
  '#F87171', '#EF4444', '#DC2626', '#991B1B',
];

export function GradientLegend({ title = 'Flood probability', minLabel = '0.25', maxLabel = '1.00', note = '< 0.25 transparent' }) {
  return (
    <div
      className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 z-[400] flex items-center gap-1.5 sm:gap-2.5 px-2 py-1.5 sm:px-2.5 sm:py-2 rounded backdrop-blur-sm"
      style={{ background: 'rgba(250,251,252,0.92)', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 1px 2px rgba(15,23,42,0.06)' }}
    >
      {/* Título — oculto en sm-, en md+ vuelve. El gradiente + los valores
       *  numéricos ya identifican qué es sin necesidad del label completo. */}
      <span className="hidden md:inline text-10 font-mono font-semibold uppercase tracking-wider" style={{ color: '#475467' }}>{title}</span>
      <span className="text-11 font-mono" style={{ color: '#667085' }}>{minLabel}</span>
      <div className="flex h-2 sm:h-2.5 rounded-sm overflow-hidden" style={{ border: '1px solid rgba(15,23,42,0.08)' }}>
        {RISK_PALETTE.map((c) => (
          // Swatches estrechos en mobile (w-3 = 12px → palette 96px),
          // anchos en sm+ (w-5 = 20px → palette 160px).
          <div key={c} className="w-3 sm:w-5" style={{ backgroundColor: c }} />
        ))}
      </div>
      <span className="text-11 font-mono" style={{ color: '#667085' }}>{maxLabel}</span>
      {/* Nota "<0.25 transparente" sólo desde sm+ — en mobile sería ruido
       *  y forzaría el componente a salirse del viewport. */}
      {note && (
        <span className="hidden sm:inline text-10 ml-1 pl-2.5" style={{ color: '#98A2B3', borderLeft: '1px solid rgba(15,23,42,0.08)' }}>
          {note}
        </span>
      )}
    </div>
  );
}
