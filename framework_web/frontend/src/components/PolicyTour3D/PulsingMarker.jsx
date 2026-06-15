import React from 'react';

/**
 * PulsingMarker — punto flotante animado a la altura de la planta.
 *
 * Es solo el VISUAL; el anclaje geográfico lo pone el padre envolviéndolo
 * en <MapMarker> (Map.tsx) en [lon,lat]. MapLibre v5 no expone altitud de
 * marcador sin terreno, así que la "elevación" de la planta se simula con
 * un offset vertical en pantalla (translateY) proporcional a floorAltitudeM
 * — esquemático pero honesto: plantas altas flotan más arriba. Un tether
 * vertical conecta el punto con el edificio.
 *
 * El color de riesgo entra como custom property `--risk` (no inline color).
 *
 * @param {{ riskColor: string, floorAltitudeM: number, label?: string }} props
 */
export function PulsingMarker({ riskColor, floorAltitudeM, label }) {
  // ~6 px por metro a z18 pitched — escala suficiente para separar plantas
  // sin que el ático se salga del viewport. Tope a 7 plantas (~120 px).
  const tetherPx = Math.min(Math.max(floorAltitudeM, 0) * 6, 120);

  return (
    <div
      className="ptour-marker"
      style={{ '--risk': riskColor, transform: `translateY(${-tetherPx}px)` }}
    >
      {label && <span className="ptour-marker__label">{label}</span>}
      <span className="ptour-marker__dot" />
      <span className="ptour-marker__tether" style={{ height: tetherPx }} />
    </div>
  );
}
