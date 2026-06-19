import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Layout } from './components/Layout.jsx';
import { Loading } from './components/Loading.jsx';

// Lazy por ruta: cada vista en su propio chunk, fuera del bundle de entrada.
// Saca ag-grid (/portfolio), maplibre (mapas) y echarts (dashboards) del
// entry. Las vistas exportan named, así que se mapean a `default`.
const lazyView = (loader, name) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const Overview = lazyView(() => import('./views/Overview.jsx'), 'Overview');
const DanaTimeline = lazyView(() => import('./views/dana-timeline.jsx'), 'DanaTimeline');
const ValenciaMap = lazyView(() => import('./views/ValenciaMap.jsx'), 'ValenciaMap');
const AlgemesiMap = lazyView(() => import('./views/AlgemesiMap.jsx'), 'AlgemesiMap');
const Comparison = lazyView(() => import('./views/Comparison.jsx'), 'Comparison');
const PortfolioExplorer = lazyView(() => import('./views/portfolio-explorer.jsx'), 'PortfolioExplorer');
const PolicyMap = lazyView(() => import('./views/policy-map.jsx'), 'PolicyMap');
const ExposureDashboard = lazyView(() => import('./views/exposure-dashboard.jsx'), 'ExposureDashboard');
const UnderwriterConsole = lazyView(() => import('./views/policy-tour-3d.jsx'), 'UnderwriterConsole');
const ModelValidation = lazyView(() => import('./views/model-validation.jsx'), 'ModelValidation');
const Transferability = lazyView(() => import('./views/transferability.jsx'), 'Transferability');
const LeakageAudit = lazyView(() => import('./views/leakage-audit.jsx'), 'LeakageAudit');
const DataDownloads = lazyView(() => import('./views/data-downloads.jsx'), 'DataDownloads');

const SECTIONS = {
  '/': Overview,
  '/dana': DanaTimeline,
  '/valencia': ValenciaMap,
  '/algemesi': AlgemesiMap,
  '/comparison': Comparison,
  '/portfolio': PortfolioExplorer,
  '/policy-map': PolicyMap,
  '/exposure': ExposureDashboard,
  '/tour': UnderwriterConsole,
  '/validation': ModelValidation,
  '/transferability': Transferability,
  '/leakage': LeakageAudit,
  '/data': DataDownloads,
};

function getHashPath() {
  const raw = window.location.hash.slice(1) || '/';
  // Strip query-string portion ("/portfolio?p=X&prod=Y" → "/portfolio").
  // The query is read separately by useHashParams() in the active view.
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

export default function App() {
  const [route, setRoute] = useState(getHashPath);

  useEffect(() => {
    const handleHashChange = () => setRoute(getHashPath());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const ViewComponent = SECTIONS[route] || SECTIONS['/'];

  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <ViewComponent />
      </Suspense>
    </Layout>
  );
}
