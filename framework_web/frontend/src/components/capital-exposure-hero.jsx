import React from 'react';
import { useInView, useCountUp, usePrefersReducedMotion } from '@/lib/animations.js';

/**
 * CapitalExposureHero — hero de exposición de cartera para /exposure.
 *
 * Sustituye los 4 tiles KPI sueltos (TIV/EAL/PML/afectadas) por UN instrumento
 * conectado: la barra capital-en-riesgo. El relato real del underwriter de
 * catástrofe es una proporción — "de €X de capital asegurado, €Y (Z%) está en
 * riesgo en el escenario Tn" — no cuatro números aislados. La barra hace ese
 * ratio PML/TIV legible de un vistazo y crece con el Return Period activo.
 *
 * Tema dark (tokens reales del runtime). Boldness concentrada en la barra;
 * el resto, mono/serif disciplinado.
 */

const euro = (n) => {
  const a = Math.abs(Number(n) || 0);
  if (a >= 1e6) return `€${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `€${Math.round(n / 1e3)}K`;
  return `€${Math.round(n || 0)}`;
};

export function CapitalExposureHero({
  tiv = 0,
  pml = 0,
  eal = 0,
  totalCount = 0,
  highCount = 0,
  highValue = 0,
  rpLabel = 'T100',
}) {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView({ threshold: 0.25 });
  const active = inView && !reduced;

  // Fracción de TIV en riesgo en este escenario. PML ≤ TIV siempre; clamp por
  // robustez ante datos parciales. La barra ES esta fracción.
  const frac = tiv > 0 ? Math.min(Math.max(pml / tiv, 0), 1) : 0;
  const pct = frac * 100;

  // useCountUp devuelve 0 cuando active=false; por eso con reduced-motion (o
  // antes de entrar al viewport) tomamos el valor final directo, no el 0.
  const tivAnim = useCountUp(tiv / 1e6, { active, duration: 1200 });
  const pmlAnim = useCountUp(pml, { active, duration: 1200, startDelay: 120 });
  const pctAnim = useCountUp(pct, { active, duration: 1200, startDelay: 120 });
  const ealAnim = useCountUp(eal, { active, duration: 1200, startDelay: 240 });
  const tivM = reduced ? tiv / 1e6 : tivAnim;
  const pmlM = reduced ? pml : pmlAnim;
  const pctC = reduced ? pct : pctAnim;
  const ealC = reduced ? eal : ealAnim;
  // Ancho de la barra: anima 0→frac al entrar al viewport, salvo reduced-motion.
  const barW = reduced ? frac : inView ? frac : 0;

  return (
    <section
      ref={ref}
      aria-label="Exposición de cartera"
      className="rounded-lg p-5 sm:p-6 animate-in fade-in slide-in-from-bottom-2"
      style={{
        background: 'var(--bg-surface)',
        boxShadow: 'var(--shadow-card)',
        animationDuration: '500ms',
      }}
    >
      {/* Eyebrow + hairline rail + scope */}
      <div className="flex items-baseline gap-3">
        <span className="text-10 font-mono font-semibold uppercase tracking-[0.18em] text-text-tertiary">
          Exposición de cartera · {rpLabel}
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--border-default)' }} />
        <span className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary tabular-nums">
          {totalCount.toLocaleString('es-ES')} pólizas
        </span>
      </div>

      {/* Anchor TIV + callout PML */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div
            className="font-mono font-semibold tabular-nums tracking-tight leading-none text-text-primary text-[34px] sm:text-[40px]"
          >
            €{tivM.toFixed(1)}M
          </div>
          <div className="mt-1.5 text-11 font-mono uppercase tracking-[0.12em] text-text-tertiary">
            capital asegurado · TIV
          </div>
        </div>
        <div className="text-right">
          <div
            className="font-mono font-semibold tabular-nums tracking-tight leading-none text-[22px]"
            style={{ color: 'var(--accent-risk-text)' }}
          >
            PML {euro(pmlM)}
          </div>
          <div className="mt-1 text-11 font-serif italic text-text-secondary">
            {pctC.toFixed(0)}% del capital en riesgo · escenario {rpLabel}
          </div>
        </div>
      </div>

      {/* La barra — signature. Track = TIV; fill = PML. */}
      <div className="mt-4">
        <div
          className="relative h-3 w-full overflow-hidden rounded-[3px]"
          style={{ background: 'var(--surface-canvas)', boxShadow: 'inset 0 0 0 1px var(--border-default)' }}
          role="img"
          aria-label={`${pct.toFixed(0)} por ciento del capital en riesgo`}
        >
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${barW * 100}%`,
              background:
                'linear-gradient(90deg, var(--accent-risk) 0%, var(--accent-risk-text) 100%)',
              transition: reduced ? 'none' : 'width 1100ms cubic-bezier(0.23,1,0.32,1)',
            }}
          />
          {/* Borde derecho del fill: marca dura donde acaba el capital en riesgo */}
          <div
            className="absolute inset-y-0"
            style={{
              left: `calc(${barW * 100}% - 1px)`,
              width: 2,
              background: 'var(--accent-risk-text)',
              opacity: barW > 0 ? 0.9 : 0,
              transition: reduced ? 'none' : 'left 1100ms cubic-bezier(0.23,1,0.32,1)',
            }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary">
          <span>0</span>
          <span className="tabular-nums">TIV €{(tiv / 1e6).toFixed(1)}M</span>
        </div>
      </div>

      {/* Stats secundarias — mono, jerarquía menor, no big tiles */}
      <div
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-12"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <Stat label="EAL anual" value={`${euro(ealC)}/año`} hint="prima técnica" />
        <span className="text-text-tertiary">·</span>
        <Stat
          label="En alto riesgo"
          value={`${highCount.toLocaleString('es-ES')}/${totalCount.toLocaleString('es-ES')}`}
          hint={`${euro(highValue)} concentrados`}
          accent="var(--accent-risk-text)"
        />
      </div>
    </section>
  );
}

function Stat({ label, value, hint, accent }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
      <span
        className="font-mono font-semibold tabular-nums text-13"
        style={{ color: accent || 'var(--text-primary)' }}
      >
        {value}
      </span>
      {hint && <span className="text-11 text-text-tertiary">· {hint}</span>}
    </span>
  );
}
