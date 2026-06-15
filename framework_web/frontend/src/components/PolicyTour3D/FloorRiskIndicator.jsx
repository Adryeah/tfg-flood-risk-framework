import React from 'react';

const ROW_PX = 26;
const GAP_PX = 3;

/**
 * FloorRiskIndicator — barra vertical de plantas con la lámina de agua T500.
 *
 * CSS puro con divs (sin Chart.js / Recharts, spec §NO HAGAS). Cada planta
 * es una fila; las que el agua alcanza llevan tinte; la planta de la póliza
 * lleva borde en color de riesgo; una línea discontinua marca la superficie
 * de la lámina T500 sobre la pila.
 *
 * @param {{
 *   floors: Array<{ index:number, label:string, reaches:boolean,
 *                   active:boolean, depthLabel?:string }>,  // ordenadas top→bottom
 *   riskColor: string
 * }} props
 */
export function FloorRiskIndicator({ floors, riskColor }) {
  // Superficie del agua = borde superior de la planta mojada más alta.
  const firstWetIdx = floors.findIndex((f) => f.reaches);
  const showWaterline = firstWetIdx >= 0;
  const waterlineTop =
    firstWetIdx <= 0 ? 0 : firstWetIdx * (ROW_PX + GAP_PX) - GAP_PX / 2;

  return (
    <div className="ptour-floors" style={{ '--risk': riskColor }}>
      {floors.map((f) => (
        <div
          key={f.index}
          className={
            'ptour-floor' +
            (f.reaches ? ' ptour-floor--wet' : '') +
            (f.active ? ' ptour-floor--active' : '')
          }
          aria-current={f.active ? 'true' : undefined}
        >
          <span className="ptour-floor__tag">{f.label}</span>
          {f.depthLabel && <span className="ptour-floor__depth">{f.depthLabel}</span>}
        </div>
      ))}

      {showWaterline && (
        <div className="ptour-waterline" style={{ top: waterlineTop }}>
          <span className="ptour-waterline__tag">T500</span>
        </div>
      )}
    </div>
  );
}
