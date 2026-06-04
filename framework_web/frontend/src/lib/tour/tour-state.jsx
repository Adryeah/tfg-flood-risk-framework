import React, { createContext, useContext, useReducer, useCallback } from 'react';

export const TOUR_MODES = {
  PHOTO: 'photo',
  THERMAL: 'thermal',
  NIGHT: 'night',
  ARCHIVE: 'archive',
  SWEEP: 'sweep',
};

export const MODE_LABELS = {
  photo: 'PHOTO',
  thermal: 'THERMAL',
  night: 'NIGHT OPS',
  archive: 'ARCHIVE',
  sweep: 'SWEEP',
};

// HUD defaults · qué se renderiza al boot del console.
// grid (tactical mini-map) = true porque sin él la consola pierde
// contexto espacial — el underwriter no sabe dónde está mirando
// dentro del bbox global de la cartera.
// trace, scanlines son opt-in por modo (sweep activa trace,
// archive activa scanlines).
export const HUD_DEFAULTS = {
  callsigns: true,
  reticle: true,
  trace: false,
  grid: true,
  scanlines: false,
};

const initialState = {
  mode: TOUR_MODES.PHOTO,
  hud: { ...HUD_DEFAULTS },
  activePolicyIdx: 0,
  totalPolicies: 0,
  isPlaying: false,
  speed: 1,
  incidentTime: 0,
  isReplaying: false,
  transitionProgress: 1,
};

function tourReducer(state, action) {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode, transitionProgress: 0 };
    case 'SET_HUD':
      return { ...state, hud: { ...state.hud, ...action.hud } };
    case 'TOGGLE_HUD':
      return {
        ...state,
        hud: { ...state.hud, [action.key]: !state.hud[action.key] },
      };
    case 'SET_ACTIVE_INDEX':
      return { ...state, activePolicyIdx: action.index };
    case 'SET_TOTAL':
      return { ...state, totalPolicies: action.total };
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.playing };
    case 'SET_SPEED':
      return { ...state, speed: action.speed };
    case 'SET_INCIDENT_TIME':
      return { ...state, incidentTime: action.time };
    case 'SET_REPLAYING':
      return { ...state, isReplaying: action.replaying };
    case 'SET_TRANSITION':
      return { ...state, transitionProgress: action.progress };
    default:
      return state;
  }
}

const TourStateContext = createContext(null);
const TourDispatchContext = createContext(null);

export function TourStateProvider({ children }) {
  const [state, dispatch] = useReducer(tourReducer, initialState);
  return (
    <TourStateContext.Provider value={state}>
      <TourDispatchContext.Provider value={dispatch}>
        {children}
      </TourDispatchContext.Provider>
    </TourStateContext.Provider>
  );
}

export function useTourState() {
  const ctx = useContext(TourStateContext);
  if (!ctx) throw new Error('useTourState must be used within TourStateProvider');
  return ctx;
}

export function useTourDispatch() {
  const ctx = useContext(TourDispatchContext);
  if (!ctx) throw new Error('useTourDispatch must be used within TourStateProvider');
  return ctx;
}

export function useTourActions() {
  const dispatch = useTourDispatch();
  return {
    setMode: useCallback(
      (mode) => dispatch({ type: 'SET_MODE', mode }),
      [dispatch]
    ),
    toggleHud: useCallback(
      (key) => dispatch({ type: 'TOGGLE_HUD', key }),
      [dispatch]
    ),
    setActiveIndex: useCallback(
      (index) => dispatch({ type: 'SET_ACTIVE_INDEX', index }),
      [dispatch]
    ),
    setTotal: useCallback(
      (total) => dispatch({ type: 'SET_TOTAL', total }),
      [dispatch]
    ),
    setPlaying: useCallback(
      (playing) => dispatch({ type: 'SET_PLAYING', playing }),
      [dispatch]
    ),
    setSpeed: useCallback(
      (speed) => dispatch({ type: 'SET_SPEED', speed }),
      [dispatch]
    ),
    setIncidentTime: useCallback(
      (time) => dispatch({ type: 'SET_INCIDENT_TIME', time }),
      [dispatch]
    ),
    setReplaying: useCallback(
      (replaying) => dispatch({ type: 'SET_REPLAYING', replaying }),
      [dispatch]
    ),
  };
}