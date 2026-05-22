import { applyTranslations, onLangChange, startI18nObserver } from './i18n.js';

const routes = new Map();
let currentView = null;

export function registerRoute(path, viewFn) {
  routes.set(path, viewFn);
}

export function navigate(path) {
  window.location.hash = path;
}

async function handleRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const route = routes.get(hash) || routes.get('/');

  if (!route) {
    console.error('No route matched', hash);
    return;
  }

  // Cleanup previous view
  if (currentView?.destroy) {
    try {
      currentView.destroy();
    } catch (err) {
      console.warn('view destroy() error', err);
    }
  }
  currentView = null;

  // Render new view
  const container = document.getElementById('main-content');
  if (container) {
    container.innerHTML = '';
    currentView = await route(container);
  }

  // Update active nav
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.route === hash);
  });

  // i18n — translate the freshly mounted view. Async-rendered content
  // (charts, map tooltips that arrive later) re-applies via onLangChange.
  applyTranslations();
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('load', handleRoute);
  // Re-apply translations whenever the user toggles language so the
  // entire workspace switches without a page reload.
  onLangChange(() => applyTranslations());
  // Pick up async-rendered content (KPI fills, chart text, map popups)
  // by observing the entire app subtree.
  startI18nObserver();
  // If already loaded (e.g. dev hot reload), trigger now
  if (document.readyState === 'complete') {
    handleRoute();
  }
}
