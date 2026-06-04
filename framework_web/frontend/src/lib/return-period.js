import { useEffect, useState, useCallback } from 'react';

/**
 * Return Period (RP) state global de la plataforma.
 *
 * El RP es el lenguaje de reaseguro (Munich Re NATHAN / Swiss Re
 * CatNet / Solvency II SCR) — todas las cifras de capital, prima
 * técnica y reinsurance treaty se cotizan en función del RP del
 * escenario.
 *
 * BACKBONE METODOLÓGICO
 * ─────────────────────
 * El "ground truth" para Valencia/Algemesí sería el Sistema Nacional
 * de Cartografía de Zonas Inundables (SNCZI / MITECO) que publica
 * mapas oficiales T10/T100/T500 en GeoTIFF. La integración directa
 * de esos rasters queda como next-step (ver Methodology note en
 * /exposure).
 *
 * Mientras tanto, escalamos las pérdidas estimadas via AEP (Annual
 * Exceedance Probability) usando la elasticidad publicada en:
 *   Dottori et al. (2018) "Increased human and economic losses from
 *   river flooding with anthropogenic warming." Nature Climate
 *   Change 8(9). DOI:10.1038/s41558-018-0257-z
 *
 * Fórmula:
 *     loss(T) = loss(T_ref) * (T / T_ref)^α
 * con α = 0.35 (rango publicado 0.28 – 0.45 para flood losses).
 *
 * El evento DANA Valencia 2024 corresponde a un T75-100 según el
 * reanalysis AEMET (precipitación 8h en cabecera del Poyo) — lo
 * tomamos como T100 (ligero rounding) para que el escalado sea
 * neutral en el escenario que validamos.
 *
 * P(flood) (probabilidad por píxel del modelo RF v2) NO escala:
 * representa la baseline climatológica actual del píxel, no la
 * intensidad de un escenario concreto. Es honest separar las dos
 * dimensiones.
 */

export const RETURN_PERIODS = [10, 50, 100, 250, 500];
export const DEFAULT_RP = 100;

// Elasticidad de pérdidas vs RP — Dottori et al. (2018). Mantenida
// como constante exportada para que la metodología sea visible y
// citables desde el chapter 5 de la memoria.
export const LOSS_ELASTICITY = 0.35;
export const SOURCE_NOTE = 'Dottori et al. (2018), Nat. Clim. Change 8(9)';

/** Multiplicador de loss vs T100 baseline. */
export function getLossMultiplier(rp) {
  if (!Number.isFinite(rp) || rp <= 0) return 1;
  return Math.pow(rp / DEFAULT_RP, LOSS_ELASTICITY);
}

/** Aplica el escalado AEP a una pérdida baseline (T_ref = T100). */
export function scaleLoss(baselineLoss, rp) {
  if (typeof baselineLoss !== 'number') return baselineLoss;
  return baselineLoss * getLossMultiplier(rp);
}

/** Etiqueta corta "T100". */
export function rpLabel(rp) {
  return `T${rp}`;
}

/**
 * Filtros CSS para aplicar al tile raster del risk surface según el
 * RP activo. T100 = baseline (sin filtro), T < 100 desatura/aclara
 * (el escenario es menos extremo, el mapa "respira"), T > 100 satura/
 * oscurece (escenario más extremo, lectura más alarmante).
 *
 * Sin esto el risk surface es estático y el usuario no percibe que
 * está cambiando de escenario. El filtro es honest: no falsifica
 * datos, solo modula la INTENSIDAD VISUAL para reflejar la
 * INTENSIDAD del escenario (los KPIs sí cambian con el multiplicador
 * AEP en paralelo).
 */
export function getRPVisualFilter(rp) {
  if (rp === 100 || !Number.isFinite(rp)) return 'none';
  if (rp === 10) return 'saturate(0.55) brightness(1.08) opacity(0.78)';
  if (rp === 50) return 'saturate(0.78) brightness(1.03) opacity(0.92)';
  if (rp === 250) return 'saturate(1.18) brightness(0.95) contrast(1.05)';
  if (rp === 500) return 'saturate(1.35) brightness(0.88) contrast(1.10)';
  return 'none';
}

/**
 * Veredicto cualitativo para mostrar como pill en cards de póliza:
 *  · 'EXPOSED'    → loss(RP) > 10% TIV
 *  · 'MONITORED'  → 3% < loss(RP) ≤ 10% TIV
 *  · 'SAFE'       → loss(RP) ≤ 3% TIV
 * Umbrales basados en industry-standard catastrophe risk thresholds
 * (Solvency II QIS5 modular para NatCat single-event).
 */
export function rpVerdict(scaledLoss, tiv) {
  if (!tiv || tiv <= 0) return null;
  const pct = scaledLoss / tiv;
  if (pct > 0.10) return 'EXPOSED';
  if (pct > 0.03) return 'MONITORED';
  return 'SAFE';
}

// ─── Backbone source · de dónde vienen los rasters RP ────────────
//
// La plataforma soporta dos backbones intercambiables para los mapas
// de zonas inundables por RP:
//
//  · 'rf_v2'  → modelo propio Random Forest v2 + escalado AEP por
//               Dottori 2018 (todo client-side, sin dependencias
//               externas, defendible metodológicamente). Default.
//  · 'snczi'  → rasters oficiales MITECO (Sistema Nacional de
//               Cartografía de Zonas Inundables), servidos vía
//               WMS o como tiles propios desde el backend Render
//               cuando el operador haya descargado los GeoTIFF.
//
// El switching es opt-in y queda persistido en localStorage. La UI
// muestra una pill "Fuente: RF v2" o "Fuente: SNCZI" en el Console
// y en el Exposure Dashboard.
export const BACKBONE_SOURCES = ['rf_v2', 'snczi'];
export const DEFAULT_BACKBONE = 'rf_v2';

export const BACKBONE_LABELS = {
  rf_v2: 'RF v2 propio',
  snczi: 'SNCZI · MITECO',
};

export const BACKBONE_NOTES = {
  rf_v2: 'Random Forest v2 + escalado AEP (Dottori 2018)',
  snczi: 'Cartografía oficial MITECO · T10/T100/T500 (cuando configurado)',
};

const BACKBONE_KEY = 'frfw.backbone_source';
const backboneListeners = new Set();

export function getBackbone() {
  try {
    const stored = localStorage.getItem(BACKBONE_KEY);
    if (stored && BACKBONE_SOURCES.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  return DEFAULT_BACKBONE;
}

export function setBackbone(source) {
  if (!BACKBONE_SOURCES.includes(source)) return;
  const prev = getBackbone();
  if (prev === source) return;
  try {
    localStorage.setItem(BACKBONE_KEY, source);
  } catch {
    /* private mode */
  }
  backboneListeners.forEach((fn) => {
    try {
      fn(source);
    } catch (err) {
      console.warn('Backbone listener failed', err);
    }
  });
}

export function onBackboneChange(fn) {
  backboneListeners.add(fn);
  return () => backboneListeners.delete(fn);
}

export function useBackbone() {
  const [source, setLocalSource] = useState(getBackbone);
  useEffect(() => {
    return onBackboneChange((next) => setLocalSource(next));
  }, []);
  const set = useCallback((next) => {
    setBackbone(next);
  }, []);
  return [source, set];
}

// ─── State global persistido en localStorage ──────────────────────
const STORAGE_KEY = 'frfw.return_period';
const listeners = new Set();

export function getRP() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (RETURN_PERIODS.includes(n)) return n;
    }
  } catch {
    /* private mode / SSR */
  }
  return DEFAULT_RP;
}

export function setRP(rp) {
  if (!RETURN_PERIODS.includes(rp)) return;
  const prev = getRP();
  if (prev === rp) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(rp));
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => {
    try {
      fn(rp);
    } catch (err) {
      console.warn('RP listener failed', err);
    }
  });
}

export function onRPChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * React hook · suscripción al RP global con setter.
 *
 *   const [rp, setRPState] = useReturnPeriod();
 *   <button onClick={() => setRPState(500)}>T500</button>
 */
export function useReturnPeriod() {
  const [rp, setLocalRP] = useState(getRP);
  useEffect(() => {
    return onRPChange((next) => setLocalRP(next));
  }, []);
  const set = useCallback((next) => {
    setRP(next);
  }, []);
  return [rp, set];
}
