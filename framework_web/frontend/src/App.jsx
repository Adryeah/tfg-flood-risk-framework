import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout.jsx';
import { Overview } from './views/Overview.jsx';
import { ValenciaMap } from './views/ValenciaMap.jsx';
import { AlgemesiMap } from './views/AlgemesiMap.jsx';
import { Comparison } from './views/Comparison.jsx';
import { PortfolioExplorer } from './views/portfolio-explorer.jsx';
import { PolicyMap } from './views/policy-map.jsx';
import { ExposureDashboard } from './views/exposure-dashboard.jsx';
import { ModelValidation } from './views/model-validation.jsx';
import { Transferability } from './views/transferability.jsx';
import { LeakageAudit } from './views/leakage-audit.jsx';

const SECTIONS = {
  '/': Overview,
  '/valencia': ValenciaMap,
  '/algemesi': AlgemesiMap,
  '/comparison': Comparison,
  '/portfolio': PortfolioExplorer,
  '/policy-map': PolicyMap,
  '/exposure': ExposureDashboard,
  '/validation': ModelValidation,
  '/transferability': Transferability,
  '/leakage': LeakageAudit,
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
      <ViewComponent />
    </Layout>
  );
}
