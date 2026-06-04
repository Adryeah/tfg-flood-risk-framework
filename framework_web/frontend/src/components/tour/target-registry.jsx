import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney, formatPercent } from '@/lib/format.js';
import {
  useReturnPeriod,
  scaleLoss,
  rpLabel,
  rpVerdict,
} from '@/lib/return-period.js';

// Tinte del verdict pill según severidad — alineado con la paleta
// risk semantics (Zurich spec). 'EXPOSED' rojo crítico,
// 'MONITORED' ámbar, 'SAFE' verde status-live.
const VERDICT_STYLE = {
  EXPOSED: { color: '#FFFFFF', bg: '#E74C3C', label: 'EXPOSED' },
  MONITORED: { color: '#0F172A', bg: '#F39C12', label: 'MONITORED' },
  SAFE: { color: '#0F172A', bg: '#10B981', label: 'SAFE' },
};

const RISK_TINT = {
  low: '#FBBF24',
  moderate: '#F87171',
  high: '#DC2626',
  very_high: '#7F1D1D',
};
const RISK_LABEL = {
  low: 'LOW',
  moderate: 'MOD',
  high: 'HIGH',
  very_high: 'CRIT',
};
const SUBTYPE_LABEL = {
  chalet: 'Chalet unifamiliar',
  casa: 'Vivienda unifamiliar',
  piso_alto: 'Vivienda en altura',
  piso_bajo: 'Vivienda en planta baja',
  piso: 'Vivienda',
  comercio: 'Local comercial',
  oficina: 'Oficina',
  nave: 'Nave industrial',
  coche: 'Vehículo · turismo',
  moto: 'Vehículo · motocicleta',
  furgoneta: 'Vehículo · furgoneta',
};

export function TargetRegistry({ policy, index, total, onPrev, onNext }) {
  const [rp] = useReturnPeriod();
  if (!policy) return null;
  const tint = RISK_TINT[policy.risk_category] || '#94A3B8';
  const desc = SUBTYPE_LABEL[policy.subtype] || policy.subtype || policy.product;

  // Pérdida escalada al RP activo. La baseline (estimated_loss_dana)
  // corresponde al escenario observado, que tomamos como T100. Para
  // otros RP aplicamos la elasticidad publicada de Dottori 2018.
  const baselineLoss = policy.estimated_loss_dana || 0;
  const scaledLoss = scaleLoss(baselineLoss, rp);
  const verdict = rpVerdict(scaledLoss, policy.insured_value);
  const verdictStyle = verdict ? VERDICT_STYLE[verdict] : null;

  return (
    <div
      className="hidden md:block absolute bottom-5 left-5 z-[600] w-[340px] rounded-md p-4 pt-3 backdrop-blur-md"
      style={{
        background: 'rgba(15,23,42,0.82)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset',
        color: '#F8FAFC',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-10 font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(248,250,252,0.5)' }}>
          {String(index + 1).padStart(4, '0')} / {String(total).padStart(4, '0')}
        </span>
        <span className="text-10 font-mono uppercase tracking-widest" style={{ color: tint }}>
          {RISK_LABEL[policy.risk_category] || policy.risk_category}
        </span>
      </div>

      <div className="font-mono text-13 mb-0.5 tracking-tight" style={{ color: '#22D3EE' }}>
        {policy.id}
      </div>

      <div className="text-12 mb-0.5" style={{ color: '#F8FAFC' }}>
        {desc}
      </div>

      <div className="text-10 font-mono mb-3" style={{ color: 'rgba(248,250,252,0.4)' }}>
        {policy.lat?.toFixed(4)}, {policy.lon?.toFixed(4)}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <PanelMetric label="P(flood)" value={formatPercent(policy.risk_probability, 1)} tint={tint} />
        <PanelMetric label="TIV" value={formatMoney(policy.insured_value)} />
        <PanelMetric
          label={`Est. loss · ${rpLabel(rp)}`}
          value={formatMoney(scaledLoss)}
          tint={tint}
        />
        <PanelMetric label="Premium" value={formatMoney(policy.annual_premium)} />
      </div>

      {/* Verdict pill por RP · 'EXPOSED' / 'MONITORED' / 'SAFE' según
       *  la fracción de TIV expuesta. Es el lenguaje del underwriter
       *  ("¿esta póliza me cuesta a partir de qué RP?") traducido a
       *  un chip visual. */}
      {verdictStyle && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-9 font-mono font-semibold uppercase tracking-[0.18em]"
            style={{
              color: verdictStyle.color,
              background: verdictStyle.bg,
            }}
            title={`Loss / TIV = ${((scaledLoss / policy.insured_value) * 100).toFixed(1)}% at RP ${rp} years`}
          >
            {verdictStyle.label} AT {rpLabel(rp)}
          </span>
          <span
            className="text-9 font-mono tabular-nums"
            style={{ color: 'rgba(248,250,252,0.45)' }}
          >
            {((scaledLoss / policy.insured_value) * 100).toFixed(1)}% TIV
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <button
          onClick={onPrev}
          className="w-7 h-7 inline-flex items-center justify-center rounded border border-white/10 hover:bg-white/10 transition-colors"
          aria-label="Previous asset"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-9 font-mono uppercase tracking-widest" style={{ color: 'rgba(248,250,252,0.35)' }}>
          ASSET REGISTRY
        </span>
        <button
          onClick={onNext}
          className="w-7 h-7 inline-flex items-center justify-center rounded border border-white/10 hover:bg-white/10 transition-colors"
          aria-label="Next asset"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function PanelMetric({ label, value, tint }) {
  return (
    <div className="min-w-0">
      <div className="text-9 font-mono uppercase tracking-wider mb-0.5" style={{ color: 'rgba(248,250,252,0.45)' }}>
        {label}
      </div>
      <div className="font-mono text-12 truncate" style={{ color: tint || '#F8FAFC', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}