import { PathLayer } from '@deck.gl/layers';

export function createTraceLayer({ path, visible = true, opacity = 0.6 }) {
  return new PathLayer({
    id: 'policy-trace',
    data: [{ path }],
    getPath: (d) => d.path,
    getColor: [34, 211, 238, Math.round(255 * opacity)],
    getWidth: 1.5,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    visible,
    pickable: false,
  });
}

export function buildTracePath(policies, visitedIndices) {
  if (visitedIndices.length < 2) return [];
  return visitedIndices
    .filter((idx) => policies[idx])
    .map((idx) => [policies[idx].lon, policies[idx].lat]);
}