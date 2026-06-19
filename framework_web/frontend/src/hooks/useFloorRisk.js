import { useMemo } from 'react';
import {
  floodReachesFloor,
  getExposureFactor,
  getFloorMinHeight,
} from '../utils/floodGeometry.js';

/**
 * @typedef {Object} FloorRiskInput
 * @property {number} floorIndex      -1 parking · 0 PB · 1 P1…
 * @property {string} assetType       tipo de activo (ver getExposureFactor)
 * @property {number} pFlood          P(inundación) del modelo RF [0,1]
 * @property {number} tiv             Total Insured Value (€)
 * @property {number} eal             Expected Annual Loss base (€)
 * @property {number} pml             Probable Maximum Loss base (€)
 * @property {number} terrainElevationM cota del terreno (m.s.n.m)
 * @property {number} floodDepthT500M  cota absoluta lámina T500 (m.s.n.m)
 */

/**
 * Hook de lógica del riesgo vertical de una póliza. Sin JSX: solo deriva.
 * Combina la geometría de planta (floodGeometry) con el factor de
 * exposición para producir EAL/PML ajustados a la vulnerabilidad de la
 * planta concreta y el color de riesgo que pintarán la extrusión y el
 * marcador.
 *
 * @param {FloorRiskInput} input
 * @returns {{
 *   reaches: boolean, marginMeters: number, exposureFactor: number,
 *   adjustedEAL: number, adjustedPML: number, floorAltitudeM: number,
 *   riskColor: string
 * }}
 */
export function useFloorRisk(input) {
  // Desestructurar a primitivos: el consumer (PolicyTour3D) pasa un objeto
  // literal nuevo en cada render, así que depender de `[input]` rompía la
  // memoización (recalculaba ~60×/s durante el rAF del marcador pulsante).
  // Con primitivos como deps, solo recalcula cuando cambia un valor real.
  const {
    floorIndex,
    assetType,
    pFlood,
    eal,
    pml,
    terrainElevationM,
    floodDepthT500M,
  } = input;

  return useMemo(() => {
    const { reaches, marginMeters } = floodReachesFloor(
      floorIndex,
      terrainElevationM,
      floodDepthT500M
    );
    const exposureFactor = getExposureFactor(assetType, floorIndex);
    const adjustedEAL = Math.round(eal * exposureFactor);
    const adjustedPML = Math.round(pml * exposureFactor);
    // Centro de la planta = base + 1.5 m (media de la banda de 3 m).
    const floorAltitudeM = getFloorMinHeight(floorIndex) + 1.5;

    return {
      reaches,
      marginMeters,
      exposureFactor,
      adjustedEAL,
      adjustedPML,
      floorAltitudeM,
      // Verde si el agua no llega; si llega, ámbar/rojo según P(flood).
      // Tokens del sistema dark: accent-valid / accent-warn-text / accent-risk-text.
      riskColor: reaches ? (pFlood > 0.7 ? '#f87171' : '#d2a24a') : '#5DCAA5',
    };
  }, [floorIndex, assetType, pFlood, eal, pml, terrainElevationM, floodDepthT500M]);
}
