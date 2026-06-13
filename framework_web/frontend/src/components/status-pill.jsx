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
export function StatusPill({
  variant = 'light',
  label = 'LIVE',
  detail = null,
  color = '#10B981',
  className = '',
}) {
  const isDark = variant === 'dark';
  // El verde token #10B981 no alcanza 4.5:1 sobre blanco; en variante
  // light usamos data-7 #15803D para el label (sí legible). El dot
  // siempre #10B981 porque sobre el tinte verde sí se ve.
  const labelColor = isDark ? color : '#15803D';
  const detailColor = isDark
    ? 'var(--sidebar-text-muted)'
    : 'var(--text-secondary)';
  const sepColor = isDark ? 'rgba(214,222,240,0.30)' : 'var(--text-tertiary)';

  return (
    <span
      className={
        'inline-flex items-center gap-1.5 px-2 h-6 rounded-sm text-10 font-mono tabular-nums whitespace-nowrap ' +
        className
      }
      style={{
        background: isDark
          ? 'rgba(16,185,129,0.10)'
          : 'rgba(16,185,129,0.08)',
        border: `1px solid ${
          isDark ? 'rgba(16,185,129,0.24)' : 'rgba(16,185,129,0.22)'
        }`,
      }}
    >
      <span
        className="status-dot inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden="true"
      />
      {label && (
        <span
          className="font-semibold uppercase tracking-[0.14em]"
          style={{ color: labelColor }}
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
