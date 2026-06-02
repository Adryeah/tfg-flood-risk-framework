import React from 'react';
import { useInView } from '@/lib/animations.js';

/**
 * Section wrapper que se desvela (fade + translateY) cuando entra al
 * viewport. Reusable a lo largo de la plataforma para evitar el
 * "todo aparece de golpe en mount" típico de dashboards AI.
 *
 *   <RevealSection delay={120}>...</RevealSection>
 *
 * Tono enterprise: magnitud pequeña (16 px translate, opacity 0→1),
 * curva ease-out, duración 700 ms. Sin bouncing.
 *
 * Props:
 *   delay     ms antes de empezar la transición (para stagger).
 *   threshold porcentaje de visibilidad para disparar (0..1).
 *   as        tag HTML a renderizar (default 'section').
 *   ...rest   propagado al elemento raíz.
 */
export function RevealSection({
  children,
  delay = 0,
  threshold = 0.1,
  as: Tag = 'section',
  className = '',
  style = {},
  ...rest
}) {
  const [ref, inView] = useInView({ threshold });
  return (
    <Tag
      ref={ref}
      className={`transition-all duration-700 ease-out ${className}`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(16px)',
        transitionDelay: `${delay}ms`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
