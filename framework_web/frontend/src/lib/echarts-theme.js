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
 *     series: [{ ...chartBar('#2563EB'), data }],
 *   });
 */

export const CHART_COLORS = {
  primary: '#2563EB',      // brand-500
  primaryDeep: '#1E3A8A',  // emphasis
  secondary: '#0E9F8E',    // teal accent
  amber: '#D97706',
  red: '#DC2626',
  green: '#15803D',
  axis: '#98A2B3',
  axisLine: 'rgba(31,41,55,0.10)',
  splitLine: 'rgba(31,41,55,0.06)',
  tooltipBorder: 'rgba(31,41,55,0.10)',
  tooltipBg: '#FAFBFC',
  textPrimary: '#1F2937',
  textSecondary: '#667085',
  zone: {
    valencia: '#1E3A8A',
    algemesi: '#D97706',
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
      fontFamily: 'Geist, Inter, system-ui',
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
  extraCssText: 'box-shadow: 0 1px 3px rgba(15,23,42,0.08); border-radius: 4px;',
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
          { offset: 0, color: 'rgba(37,99,235,0.18)' },
          { offset: 1, color: 'rgba(37,99,235,0.02)' },
        ],
      },
    },
  };
}
