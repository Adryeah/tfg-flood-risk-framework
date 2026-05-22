import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { applyTranslations, startI18nObserver } from './lib/i18n.js';
// CSS import order matters: vendor (maplibre) MUST come BEFORE our main.css
// so our overrides for `.maplibregl-ctrl-group` (zoom +/- buttons, popup
// chrome) actually win in the cascade. With !important on both sides, the
// last declared rule wins — having vendor last leaves the +/- buttons
// rendering with their default transparent background.
import './styles/tokens.css';
import './styles/base.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';

const root = document.getElementById('app');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// After first paint:
//   - apply any saved language to the rendered DOM
//   - start a MutationObserver so newly-mounted views (route change,
//     async-loaded KPIs, popups) inherit the current language without each
//     component knowing about i18n.
//
// Watch `document.body` rather than `#app` because InfoTooltip popovers are
// React-portaled to document.body (so they can escape ancestor overflow:
// hidden). Observing #app alone would miss their text and they'd stay in EN.
requestAnimationFrame(() => {
  applyTranslations(document.body);
  startI18nObserver(document.body);
});
