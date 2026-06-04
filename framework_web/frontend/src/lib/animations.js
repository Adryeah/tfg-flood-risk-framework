import { useEffect, useRef, useState } from 'react';

/**
 * Returns true when the user has the OS-level "reduce motion" pref
 * activado (System Settings → Accessibility en macOS, Settings →
 * Ease of Access → Display en Windows, etc.). Componentes que disparan
 * fly-throughs, count-ups largos, o transiciones >300ms deben
 * cortocircuitar a "snap" instantáneo cuando esto es true.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => setReduced(e.matches);
    // Safari < 14 usa addListener; el resto addEventListener.
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);
  return reduced;
}

/**
 * Hooks de animación scroll-driven para la plataforma.
 *
 * Por qué hooks y no clases CSS sueltas: tailwindcss-animate cubre el
 * caso "mount → animar una vez", pero para revelar al entrar en
 * viewport hace falta IntersectionObserver, y para number tickers
 * (0 → 95.8% en 1.2s con ease-out) hace falta rAF + control de timing.
 *
 * Tono "enterprise": animaciones discretas (300–1200ms ease-out
 * cuártico), magnitudes pequeñas (translateY 8px, opacity 0→1, scale
 * 0.98→1), sin bouncing ni spring. Mismo lenguaje motorial que Linear /
 * Vercel / Stripe.
 *
 * Respeta prefers-reduced-motion vía main.css (animation-duration
 * 0.01ms !important) — los hooks NO chequean la media query
 * directamente porque el override CSS-side ya neutraliza el efecto
 * visual.
 */

/**
 * Trigger boolean cuando el elemento entra en viewport. `once = true`
 * (default) deja el flag a true tras la primera intersección — útil
 * para reveals (no quieres que el contenido desaparezca al hacer
 * scroll hacia arriba). `threshold` controla qué porcentaje del
 * elemento debe verse para activar (0.15 = 15%).
 *
 *   const [ref, inView] = useInView({ threshold: 0.3 });
 *   <div ref={ref} className={inView ? 'opacity-100' : 'opacity-0'}>
 */
export function useInView({ threshold = 0.15, once = true, rootMargin = '0px' } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // SSR / browser sin IO → considerar visible para no romper
      // contenido sin necesidad de fallback complejo.
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) obs.unobserve(el);
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, once, rootMargin]);

  return [ref, inView];
}

/**
 * Anima un número desde 0 hasta `target` con ease-out cuártico
 * cuando `active` pasa a true. Devuelve el valor actual (re-render
 * cada frame). El caller decide el formato (toLocaleString,
 * toFixed, etc.).
 *
 * Curva: 1 - (1 - t)^4 → arranque rápido, frenado pronunciado al final.
 * Da la sensación de "el número se asienta" en vez de "marcador
 * lineal de tablero".
 *
 *   const v = useCountUp(95.8, { active: inView, duration: 1200 });
 *   <span>{v.toFixed(1)}%</span>
 */
export function useCountUp(target, { duration = 1200, active = true, startDelay = 0 } = {}) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (!Number.isFinite(target)) {
      setValue(target);
      return;
    }

    let startedAt = null;
    const tick = (now) => {
      if (startedAt === null) startedAt = now + startDelay;
      const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(targetRef.current * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, active, startDelay]);

  return value;
}
