// Single source of truth for money / percent / probability formatting.
//
// Bug histórico que esta refactor arregla: cada vista tenía su propio
// `fmtMoney`/`formatEur` con el mismo patrón ingenuo:
//   if (v >= 1_000_000) -> M else -> K
// Produce "€1000K" para valores en [999_500, 999_999] porque
// (v/1000).toFixed(0) redondea a 1000 antes de comprobar el branch.
// El threshold se baja a 999_500 para que la frontera de redondeo
// caiga ya en el lado M, eliminando el "1000K" indeseado.

/** Punto exacto donde Math.round(v/1000) === 1000. */
const M_THRESHOLD = 999_500;

function fmtM(v, decimals = 1) {
  const m = v / 1_000_000;
  // 100M+ no necesita decimales (ruido); 1-99M un decimal; trailing
  // ".0" se limpia para que "5.0M" se lea "5M".
  const dp = Math.abs(m) >= 100 ? 0 : decimals;
  const fixed = m.toFixed(dp);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

function fmtK(v) {
  // Math.round (no toFixed) para que valores tipo 999_499.6 redondeen
  // a 999 K predictiblemente.
  return String(Math.round(v / 1000));
}

/** "€1.2M" | "€345K" | "€12"  (símbolo delante, sin espacio). */
export function formatMoney(v) {
  if (v == null || Number.isNaN(v)) return '';
  const abs = Math.abs(v);
  if (abs >= M_THRESHOLD) return `€${fmtM(v)}M`;
  if (abs >= 1000) return `€${fmtK(v)}K`;
  return `€${Math.round(v)}`;
}

/** "1.2M €" | "345K €" | "12 €"  (símbolo detrás, espacio). Compat con
 *  el formato usado en Overview/Daily Briefing. */
export function formatMoneySpaced(v) {
  if (v == null || Number.isNaN(v)) return '';
  const abs = Math.abs(v);
  if (abs >= M_THRESHOLD) return `${fmtM(v)}M €`;
  if (abs >= 1000) return `${fmtK(v)}K €`;
  return `${Math.round(v)} €`;
}

// ─── Legacy utilities (preservadas por compatibilidad) ──────────

export function formatCurrency(value, options = {}) {
  const { compact = false, currency = 'EUR' } = options;
  return new Intl.NumberFormat('en-EU', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat('en-EU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value, decimals = 1) {
  if (value == null || Number.isNaN(value)) return '';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatProbability(value) {
  return value.toFixed(3);
}

export function getRiskCategory(probability) {
  // 4 bandas alineadas con el backend (categorize_probability).
  if (probability < 0.25) return 'low';
  if (probability < 0.5) return 'moderate';
  if (probability < 0.75) return 'high';
  return 'very_high';
}

export function getRiskColor(category) {
  return {
    low: '#16A34A',
    moderate: '#D97706',
    high: '#DC2626',
    very_high: '#991B1B',
  }[category];
}
