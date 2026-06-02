/**
 * Shared ECharts visual theme — muted gridlines, soft axes, institutional
 * palette. Functions return ready-to-spread option fragments so each chart
 * can pick the pieces it needs without losing per-chart customisation.
 *
 * Usage:
 *   import { chartGrid, chartAxis, chartTooltip, CHART_COLORS } from '...';
 *   chart.setOption({
 *     grid: { ...chartGrid, left: 96 },
 *     xAxis: { type: 'value', ...chartAxis.value },
 *     yAxis: { type: 'category', data: names, ...chartAxis.category },
 *     tooltip: chartTooltip,
 *     series: [{ ...chartBar('#3B82F6'), data }],
 *   });
 */

// Paleta sincronizada con Flood Risk × Zurich Design System.
// primary = accent-info (azul brillante para data series — el navy
// del brand queda reservado para chrome estructural). amber/green
// alineados con risk-medium / status-live. textPrimary/Secondary
// pasan a neutral-900/600. rgbas pasan al tinte navy (15,27,53).
export const CHART_COLORS = {
  primary: '#3B82F6',      // accent-info — data series 1
  primaryDeep: '#0F1B35',  // Zurich navy — énfasis / encabezados
  secondary: '#10B981',    // emerald — data series 2 / OK
  amber: '#F39C12',        // spec amber — warning
  red: '#E74C3C',          // spec flood red — risk high
  green: '#10B981',        // spec status-live green
  axis: '#9CA3AF',         // neutral-400
  axisLine: 'rgba(15,27,53,0.10)',
  splitLine: 'rgba(15,27,53,0.06)',
  tooltipBorder: 'rgba(15,27,53,0.10)',
  tooltipBg: '#FFFFFF',
  textPrimary: '#111827',  // neutral-900
  textSecondary: '#4B5563', // neutral-600
  zone: {
    valencia: '#0F1B35',   // Zurich navy
    algemesi: '#F39C12',   // spec amber
  },
};

export const chartGrid = {
  left: 60,
  right: 16,
  top: 16,
  bottom: 28,
  containLabel: false,
};

export const chartAxis = {
  category: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: CHART_COLORS.axis,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 11,
    },
  },
  categoryMono: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: CHART_COLORS.axis,
      fontFamily: 'JetBrains Mono',
      fontSize: 11,
    },
  },
  value: {
    axisLine: { lineStyle: { color: CHART_COLORS.axisLine } },
    axisTick: { show: false },
    splitLine: {
      lineStyle: { color: CHART_COLORS.splitLine, type: 'dashed' },
    },
    axisLabel: {
      color: CHART_COLORS.axis,
      fontFamily: 'JetBrains Mono',
      fontSize: 11,
    },
  },
};

export const chartTooltip = {
  trigger: 'axis',
  axisPointer: { type: 'shadow' },
  borderColor: CHART_COLORS.tooltipBorder,
  backgroundColor: CHART_COLORS.tooltipBg,
  textStyle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: CHART_COLORS.textPrimary,
  },
  extraCssText: 'box-shadow: 0 4px 6px -1px rgba(15,27,53,0.08); border-radius: 6px;',
};

/**
 * Top-level animation defaults. ECharts ships with a slow 1000 ms ease-in
 * cubic that makes ops dashboards feel laggy. Override to a snappy 250 ms
 * ease-out — see emil-design-eng "How fast should it be" + "ease-out":
 * entering elements should use ease-out so the user sees movement
 * immediately. Spread into every `setOption({...})` call.
 */
export const chartAnimation = {
  animation: true,
  animationDuration: 250,
  animationDurationUpdate: 180,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

export const chartLegend = {
  bottom: 0,
  itemWidth: 10,
  itemHeight: 10,
  textStyle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: CHART_COLORS.textSecondary,
  },
};

export function chartBar(color = CHART_COLORS.primary) {
  return {
    type: 'bar',
    itemStyle: { color, borderRadius: [1, 1, 0, 0] },
    barWidth: '60%',
  };
}

export function chartHBar(color = CHART_COLORS.primary) {
  return {
    type: 'bar',
    itemStyle: { color, borderRadius: [0, 1, 1, 0] },
    barWidth: '60%',
  };
}

export function chartLine(color = CHART_COLORS.primary) {
  return {
    type: 'line',
    smooth: true,
    symbol: 'none',
    lineStyle: { color, width: 1.75 },
    areaStyle: {
      color: {
        type: 'linear',
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: 'rgba(59,130,246,0.18)' },
          { offset: 1, color: 'rgba(59,130,246,0.02)' },
        ],
      },
    },
  };
}
