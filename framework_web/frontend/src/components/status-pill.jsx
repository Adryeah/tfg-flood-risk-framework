import React from 'react';

/**
 * StatusPill · indicador de estado terminal (Bloomberg / Palantir).
 *
 * El "status dot" redondo con breathe leía como AI-generated badge (el
 * puntito de colores que respira es el cliché del dashboard generado).
 * Ahora la señal cromática es un RAIL VERTICAL de acento — la misma
 * primitiva editorial del eyebrow+rail del DESIGN.md, no una luz de
 * estado. La "liveness" la comunica el timestamp que tickea ("19h 1m
 * ago"), no un pulso decorativo.
 *
 *   ❌ <span class="status-dot rounded-full" />  → status-light AI
 *   ✅ rail 2px en t.text + LIVE en mono caps + detalle mono muted
 *
 * Variantes de tono (Linear×Basedash dark): sar / valid / risk → glow
 * bg + border + rail, cada uno con su tinte de texto legible sobre dark.
 *
 * Props:
 *   variant   'light' | 'dark' (legacy, sin efecto cromático ya)
 *   tone      'sar' | 'valid' | 'risk'
 *   label     texto del estado (default 'LIVE')
 *   detail    texto secundario en mono (ej. 'S1A · 19h 1m ago')
 *   color     override del color del rail + label
 */
// Tone sets · Linear×Basedash dark. Each maps to a semantic accent with
// its glow bg + border + dot + a dark-readable text tint.
const TONES = {
  sar: {
    dot: 'var(--accent-sar)',
    bg: 'var(--accent-sar-glow)',
    border: 'var(--accent-sar-border)',
    text: 'var(--accent-sar-text)',
  },
  valid: {
    dot: 'var(--accent-valid)',
    bg: 'var(--accent-valid-glow)',
    border: 'var(--accent-valid-border)',
    text: 'var(--accent-valid-text)',
  },
  risk: {
    dot: 'var(--accent-risk)',
    bg: 'var(--accent-risk-glow)',
    border: 'var(--accent-risk-border)',
    text: 'var(--accent-risk-text)',
  },
};

export function StatusPill({
  variant = 'light',
  label = 'LIVE',
  detail = null,
  color = null,
  tone = 'sar',
  className = '',
}) {
  const t = TONES[tone] || TONES.sar;
  const railColor = color || t.text;
  const detailColor = 'var(--text-secondary)';
  const sepColor = 'var(--text-muted)';

  return (
    <span
      className={
        'inline-flex items-center gap-2 pl-1.5 pr-2 h-6 rounded-sm text-10 font-mono tabular-nums whitespace-nowrap ' +
        className
      }
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      {/* Rail de acento — primitiva eyebrow+rail, no status-light. */}
      <span
        className="inline-block w-0.5 self-stretch my-1 rounded-[1px] shrink-0"
        style={{ background: railColor }}
        aria-hidden="true"
      />
      {label && (
        <span
          className="font-semibold uppercase tracking-[0.14em]"
          style={{ color: t.text }}
        >
          {label}
        </span>
      )}
      {detail && (
        <>
          {label && <span style={{ color: sepColor }}>·</span>}
          <span style={{ color: detailColor }}>{detail}</span>
        </>
      )}
    </span>
  );
}
