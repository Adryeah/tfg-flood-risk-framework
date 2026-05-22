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
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatProbability(value) {
  return value.toFixed(3);
}

export function getRiskCategory(probability) {
  if (probability < 0.3) return 'low';
  if (probability < 0.614) return 'medium';
  return 'high';
}

export function getRiskColor(category) {
  return {
    low: '#16A34A',
    medium: '#EAB308',
    high: '#DC2626',
  }[category];
}
