import { TOUR_MODES, MODE_LABELS } from './tour-state.jsx';

export const DANA_TIMELINE = {
  preDANA: { label: 'Pre-DANA', date: '19 OCT 2024', t: 0 },
  eventStart: { label: 'DANA onset', date: '29 OCT 2024', t: 33 },
  peak: { label: 'Peak flood', date: '30 OCT 2024', t: 66 },
  postDANA: { label: 'Ground truth', date: '31 OCT 2024', t: 100 },
};

export const MODEL_METRICS = {
  auc: 0.922,
  recall: 0.958,
  f1: 0.782,
};

export function getIncidentPolygonScale(t) {
  if (t < 33) return 0;
  if (t < 66) return (t - 33) / 33;
  return 1;
}

export function getIncidentOpacity(t) {
  if (t < 20) return 0;
  if (t < 40) return (t - 20) / 20 * 0.7;
  return 0.7;
}

export function getDateFromT(t) {
  const start = new Date('2024-10-19');
  const end = new Date('2024-10-31');
  const days = Math.round((t / 100) * 12);
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function createSweepCamera(viewState, bearing) {
  const cx = (viewState.longitude + 0.15);
  const cy = (viewState.latitude + 0.08);
  return {
    ...viewState,
    longitude: cx,
    latitude: cy,
    zoom: 11.5,
    pitch: 48,
    bearing: bearing % 360,
    transitionDuration: 200,
  };
}