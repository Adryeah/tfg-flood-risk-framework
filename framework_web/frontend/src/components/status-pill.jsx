import React from 'react';

/**
 * StatusPill · indicador de estado mil-spec (Bloomberg / Palantir).
 *
 * Reemplaza las dos pills "LIVE" que leían como AI-generated badge:
 *   ❌ animate-ping (anillo expansivo = pulso AI por defecto)
 *   ❌ verdes fuera de paleta (#86EFAC green-300, #16A34A green-600)
 *   ❌ glassmorphism / liquid-glass (gradient + inset highlight)
 *
 * Ahora:
 *   ✅ token colors (status-live #10B981, data-7 #15803D para texto
 *      sobre fondo claro donde el #10B981 no llega a 4.5:1)
 *   ✅ dot con breathe sutil de opacidad (.status-dot keyframe en
 *      main.css) — el dot "respira", no dispara un anillo
 *   ✅ chrome plano: tinte verde sutil + borde, sin gradients
 *   ✅ el dot carga el color de estado, el detalle va en mono neutro
 *      (patrón terminal: la señal cromática es el punto, no el texto)
 *
 * Variantes:
 *   'light'  → sobre fondo claro (Overview header). Label en verde
 *              oscuro legible (#15803D), detalle en text-secondary.
 *   'dark'   → sobre el navy del Topbar. Label en #10B981 (legible
 *              sobre navy), detalle en sidebar-text-muted.
 *
 * Props:
 *   variant   'light' | 'dark'
 *   label     texto del estado (default 'LIVE')
 *   detail    texto secundario en mono (ej. 'S1A · 19h 0m ago')
 *   color     color del dot + label (default status-live #10B981)
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
  const dotColor = color || t.dot;
  const detailColor = 'var(--text-secondary)';
  const sepColor = 'var(--text-muted)';

  return (
    <span
      className={
        'inline-flex items-center gap-1.5 px-2 h-6 rounded-sm text-10 font-mono tabular-nums whitespace-nowrap ' +
        className
      }
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      <span
        className="status-dot inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: dotColor }}
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
