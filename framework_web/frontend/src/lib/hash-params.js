/**
 * Lightweight URL hash params helper.
 *
 * The app uses hash routing (`#/portfolio`, `#/policy-map`, …).  This util
 * lets views attach `?key=value&key2=value2` query parameters AFTER the
 * route — so the hash becomes `#/portfolio?p=wide_distribution&prod=autos`.
 * Reload-stable, shareable, no React Router dependency.
 *
 *   useHashParams() → [params, setParams]
 *
 * params is a plain object {key: value}; setParams merges with current
 * params and rewrites the hash. The hash route segment (`#/portfolio`) is
 * preserved untouched.
 */
import { useEffect, useState, useCallback } from 'react';

function splitHash() {
  const raw = window.location.hash.slice(1) || '/';
  const qIdx = raw.indexOf('?');
  if (qIdx === -1) return { path: raw, query: '' };
  return { path: raw.slice(0, qIdx), query: raw.slice(qIdx + 1) };
}

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) {
      out[decodeURIComponent(pair)] = '';
    } else {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
        pair.slice(eq + 1)
      );
    }
  }
  return out;
}

function stringifyQuery(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

export function getHashParams() {
  return parseQuery(splitHash().query);
}

export function setHashParams(next, { replace = false } = {}) {
  const { path } = splitHash();
  const current = replace ? {} : getHashParams();
  const merged = { ...current, ...next };
  // Drop empty / null values so the URL stays clean.
  for (const k of Object.keys(merged)) {
    if (merged[k] == null || merged[k] === '') delete merged[k];
  }
  const qs = stringifyQuery(merged);
  const newHash = qs ? `#${path}?${qs}` : `#${path}`;
  if (newHash !== window.location.hash) {
    // history.replaceState avoids polluting the back button stack on
    // every filter tweak. View navigation (path change) uses href anchors,
    // which DO push state — so the back button still works for routes.
    window.history.replaceState(null, '', newHash);
    // Manually dispatch hashchange so the App router notices the change.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

/**
 * React hook — returns [params, setParams]. Listens for hashchange so any
 * external nav (back button, programmatic) re-syncs the component state.
 */
export function useHashParams() {
  const [params, setParamsState] = useState(getHashParams);

  useEffect(() => {
    const handle = () => setParamsState(getHashParams());
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);

  const setParams = useCallback((next) => {
    setHashParams(next);
  }, []);

  return [params, setParams];
}

/**
 * Convenience: navigate to a route + params in one shot. Used by the
 * cross-linking features ("see feature X in Transferability"). Pushes to
 * history (back-button restores previous view).
 */
export function navigateTo(path, params = {}) {
  const qs = stringifyQuery(params);
  const target = qs ? `#${path}?${qs}` : `#${path}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
