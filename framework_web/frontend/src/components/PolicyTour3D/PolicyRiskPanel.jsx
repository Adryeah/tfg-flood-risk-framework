import React from 'react';
import { X } from 'lucide-react';

import { useFloorRisk } from '../../hooks/useFloorRisk.js';
import { floodReachesFloor } from '../../utils/floodGeometry.js';
import { FloorRiskIndicator } from './FloorRiskIndicator.jsx';

/** €1.2M / €340K / €1.2K — compacto para los KPIs del panel. */
function fmtEuro(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `€${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `€${Math.round(n / 1e3)}K`;
  return `€${Math.round(n)}`;
}

function floorLabel(i) {
  if (i === 0) return 'PB';
  if (i === -1) return 'Parking';
  if (i < -1) return `Sótano ${-i}`;
  return `Planta ${i}`;
}

const ASSET_LABELS = {
  local_comercial: 'Local comercial',
  nave_industrial: 'Nave industrial',
  parking: 'Parking',
  vivienda: 'Vivienda',
  oficina: 'Oficina',
  atico: 'Ático',
  default: 'Genérico',
};

/**
 * PolicyRiskPanel — panel lateral derecho con el riesgo vertical de la
 * póliza seleccionada. Responde a la pregunta del underwriter: ¿alcanza la
 * lámina T500 la planta asegurada? Y muestra EAL/PML ajustados por el
 * factor de exposición del tipo de activo.
 *
 * @param {{ policy: import('../../types/policyTour.types.js').PolicyTour3DPolicy,
 *           onClose: () => void }} props
 */
export function PolicyRiskPanel({ policy, onClose }) {
  const risk = useFloorRisk({
    floorIndex: policy.floorIndex,
    assetType: policy.assetType,
    pFlood: policy.pFlood,
    tiv: policy.tiv,
    eal: policy.eal,
    pml: policy.pml,
    terrainElevationM: policy.terrainElevationM,
    floodDepthT500M: policy.floodDepthT500M,
  });

  // Pila de plantas (top→bottom), siempre con parking de contexto y techo
  // acotado para no desbordar el panel.
  const topFloor = Math.min(Math.max(policy.floorCount - 1, policy.floorIndex, 2), 8);
  const bottomFloor = Math.min(policy.floorIndex, -1);
  const floors = [];
  for (let f = topFloor; f >= bottomFloor; f -= 1) {
    const { reaches, marginMeters } = floodReachesFloor(
      f,
      policy.terrainElevationM,
      policy.floodDepthT500M
    );
    floors.push({
      index: f,
      label: floorLabel(f),
      reaches,
      active: f === policy.floorIndex,
      depthLabel: reaches ? `+${marginMeters} m` : `${Math.abs(marginMeters)} m seco`,
    });
  }

  const assetLabel = ASSET_LABELS[policy.assetType] || ASSET_LABELS.default;

  return (
    <aside className="ptour-panel" role="dialog" aria-label={`Riesgo vertical póliza ${policy.id}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-border-default">
        <div className="min-w-0">
          <div className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary">
            Riesgo vertical · T500
          </div>
          <div className="mono-val text-15 text-text-primary truncate mt-0.5">{policy.id}</div>
          <div className="text-11 text-text-secondary mt-0.5">
            {assetLabel} · {floorLabel(policy.floorIndex)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded hover:bg-white/5 text-text-secondary"
        >
          <X size={15} />
        </button>
      </div>

      {/* Veredicto — ¿llega el agua a la planta asegurada? */}
      <div
        className="px-4 py-3 border-b border-border-default"
        style={{ '--risk': risk.riskColor }}
      >
        <div
          className="text-13 font-semibold leading-snug"
          style={{ color: risk.riskColor }}
        >
          {risk.reaches
            ? `El agua T500 alcanza esta planta`
            : `Planta por encima de la lámina T500`}
        </div>
        <div className="mono-val text-22 text-text-primary mt-1">
          {risk.reaches ? `+${risk.marginMeters} m` : `${Math.abs(risk.marginMeters)} m`}
          <span className="text-12 text-text-secondary ml-1.5">
            {risk.reaches ? 'de agua sobre el suelo' : 'de margen seco'}
          </span>
        </div>
      </div>

      {/* KPIs — exposición ajustada por planta */}
      <div className="grid grid-cols-2 gap-px bg-border-default border-b border-border-default">
        {[
          { k: 'TIV', v: fmtEuro(policy.tiv) },
          { k: 'Factor exposición', v: `×${risk.exposureFactor.toFixed(2)}` },
          { k: 'EAL ajustado', v: fmtEuro(risk.adjustedEAL) },
          { k: 'PML ajustado', v: fmtEuro(risk.adjustedPML) },
        ].map((kpi) => (
          <div key={kpi.k} className="bg-bg-surface px-4 py-2.5">
            <div className="text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary">
              {kpi.k}
            </div>
            <div className="mono-val text-16 text-text-primary mt-0.5">{kpi.v}</div>
          </div>
        ))}
      </div>

      {/* Indicador de plantas */}
      <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <div className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary mb-2">
          Corte vertical · P(flood) {(policy.pFlood * 100).toFixed(0)}%
        </div>
        <FloorRiskIndicator floors={floors} riskColor={risk.riskColor} />
      </div>

      {/* Nota de fallback — honestidad sobre datos estimados */}
      {policy._estimatedElevation && (
        <div className="px-4 py-2.5 border-t border-border-default">
          <p className="font-serif italic text-11 text-text-muted leading-snug">
            Elevación del terreno y cota de lámina T500 estimadas (sin DEM por
            póliza): suelo {policy.terrainElevationM} m s.n.m, lámina{' '}
            {policy.floodDepthT500M.toFixed(1)} m. Sustituibles por SRTM + raster
            SNCZI cuando estén disponibles.
          </p>
        </div>
      )}
    </aside>
  );
}
