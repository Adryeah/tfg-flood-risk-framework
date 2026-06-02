import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { RiskZoneMap } from './RiskZoneMap.jsx';

/**
 * Comparador swipe estilo NYTimes / Planet Labs / Maxar para la vista
 * narrativa /dana. Un mapa single full-width con un divisor vertical
 * arrastrable: a la izquierda revela la silueta EMSR773 (ground truth),
 * a la derecha la predicción del Random Forest. Ambas capas comparten
 * el heatmap base de predicción para que el ojo tenga una referencia
 * constante.
 *
 * Implementación:
 *  · Dos <RiskZoneMap> apiladas en absolute inset-0:
 *    - Bottom: solo predicción (heatmap rojo)
 *    - Top: predicción + overlay EMSR773 cian, recortado vía clipPath
 *      a la izquierda del divisor.
 *  · Divisor = línea vertical blanca + handle circular con flechas
 *    ←→. El handle captura pointer/touch events y publica la posición
 *    a un useState. La línea es decorativa (pointer-events: none).
 *  · Los mapas son visuales — el wrapper tiene CSS
 *    .swipe-layer { pointer-events: none } para que ni pan ni zoom ni
 *    click-to-inspect ocurra. La única interacción es el handle.
 *  · Hide forzado de los controles MapLibre via main.css.
 *
 * El componente es controlled internally — no prop de posición externa.
 * El consumer solo le pasa zone y height.
 */
export function DanaSwipeCompare({ zone = 'valencia', height = 460 }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);
  const [pos, setPos] = useState(50);

  useEffect(() => {
    // Pointer y touch globales mientras el handle está siendo
    // arrastrado. La doble registro window+touch garantiza que el
    // drag no se pierda si el cursor sale del div del mapa.
    const onMove = (e) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.touches
        ? e.touches[0]?.clientX
        : e.clientX;
      if (typeof clientX !== 'number') return;
      const x = clientX - rect.left;
      const p = Math.max(2, Math.min(98, (x / rect.width) * 100));
      setPos(p);
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const onHandleDown = (e) => {
    draggingRef.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    if (e.cancelable) e.preventDefault();
  };

  // Track click anywhere along the container to "snap" the divider
  // there — atajo cómodo para no tener que arrastrar el handle.
  const onContainerClick = (e) => {
    // Solo respondemos si el click no impactó el handle (que ya
    // arranca el drag desde su propio onMouseDown).
    if (!containerRef.current) return;
    if (e.target?.closest?.('.swipe-divider-handle')) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const p = Math.max(2, Math.min(98, (x / rect.width) * 100));
    setPos(p);
  };

  return (
    <div
      ref={containerRef}
      onClick={onContainerClick}
      className="dana-swipe-container relative bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden cursor-pointer"
      style={{ height }}
    >
      {/* Capa inferior · predicción base, siempre visible */}
      <div className="swipe-layer absolute inset-0">
        <RiskZoneMap
          zone={zone}
          height="100%"
          showOverlays={false}
          showLegend={false}
          showZones={false}
          includeTail={false}
          enablePixelInspection={false}
        />
      </div>

      {/* Capa superior · predicción + EMSR773 overlay, recortada a la
       *  izquierda del divisor. clip-path inset toma TOP RIGHT BOTTOM
       *  LEFT → para mostrar solo el lado izquierdo necesitamos
       *  recortar (100 - pos)% del lado derecho. */}
      <div
        className="swipe-layer absolute inset-0 transition-[clip-path] duration-75"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <RiskZoneMap
          zone={zone}
          height="100%"
          showOverlays={false}
          showLegend={false}
          showZones={false}
          includeTail={false}
          enablePixelInspection={false}
          showGroundTruth
        />
      </div>

      {/* Línea divisora vertical · blanca con halo, decorativa */}
      <div
        className="swipe-divider-line absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `calc(${pos}% - 1px)`,
          width: 2,
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 0 8px rgba(15,27,53,0.5)',
          zIndex: 40,
        }}
        aria-hidden="true"
      />

      {/* Handle circular con flechas — único elemento que recibe pointer
       *  events para drag. role="slider" para accesibilidad básica. */}
      <button
        type="button"
        onMouseDown={onHandleDown}
        onTouchStart={onHandleDown}
        onClick={(e) => e.stopPropagation()}
        role="slider"
        aria-label="Arrastra para comparar predicción y ground truth"
        aria-valuenow={Math.round(pos)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="swipe-divider-handle absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white border border-border-strong shadow-lg flex items-center justify-center cursor-ew-resize hover:scale-105 active:scale-95 transition-transform duration-150"
        style={{ left: `${pos}%`, zIndex: 50 }}
      >
        <ChevronLeft className="w-4 h-4 text-text-primary -mr-1" strokeWidth={2.5} />
        <ChevronRight className="w-4 h-4 text-text-primary -ml-1" strokeWidth={2.5} />
      </button>

      {/* Etiquetas izquierda · ground truth */}
      <div className="absolute top-3 left-3 z-30 pointer-events-none">
        <div
          className="rounded-md px-2.5 py-1.5 flex items-center gap-2 backdrop-blur-md"
          style={{
            background: 'rgba(15,27,53,0.85)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: '#0EA5E9' }}
            aria-hidden="true"
          />
          <span className="text-10 font-mono uppercase tracking-[0.16em] text-white">
            Ground Truth · EMSR773
          </span>
        </div>
      </div>

      {/* Etiqueta derecha · predicción */}
      <div className="absolute top-3 right-3 z-30 pointer-events-none">
        <div
          className="rounded-md px-2.5 py-1.5 flex items-center gap-2 backdrop-blur-md"
          style={{
            background: 'rgba(15,27,53,0.85)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: '#E74C3C' }}
            aria-hidden="true"
          />
          <span className="text-10 font-mono uppercase tracking-[0.16em] text-white">
            Predicción · Random Forest v2
          </span>
        </div>
      </div>

      {/* Hint inferior — visible solo cuando el divisor está cerca del
       *  centro para no contaminar visualmente cuando el usuario ya
       *  está usando el control. Fade-out cuando pos < 20 o pos > 80. */}
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-opacity duration-300"
        style={{
          opacity: pos > 20 && pos < 80 ? 1 : 0,
        }}
      >
        <div
          className="rounded-full px-2.5 py-1 flex items-center gap-1.5 backdrop-blur-md"
          style={{
            background: 'rgba(15,27,53,0.78)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <ChevronLeft className="w-3 h-3 text-white" />
          <span className="text-10 font-mono uppercase tracking-wider text-white">
            Arrastra el divisor
          </span>
          <ChevronRight className="w-3 h-3 text-white" />
        </div>
      </div>
    </div>
  );
}
