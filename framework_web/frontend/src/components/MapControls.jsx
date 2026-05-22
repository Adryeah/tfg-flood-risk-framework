import React, { useState, useEffect } from 'react';

export function MapControls({ map, basemaps = {}, overlays = [] }) {
  const [activeBase, setActiveBase] = useState('light');
  const [visibility, setVisibility] = useState({});

  useEffect(() => {
    const initial = {};
    overlays.forEach(({ id, enabled }) => {
      initial[id] = enabled !== false;
    });
    setVisibility(initial);
  }, [overlays]);

  const handleBaseChange = (name) => {
    setActiveBase(name);
    if (map) {
      map.setBasemap?.(name);
    }
  };

  const handleOverlayToggle = (id) => {
    setVisibility((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="absolute top-3 right-3 z-[1000] w-60 bg-bg-surface border border-border-default rounded-md shadow-sm overflow-hidden">
      <div className="px-3 pt-2 pb-1 text-10 font-semibold text-text-tertiary uppercase tracking-wider">Basemap</div>
      <div className="flex px-2 pb-2 gap-1">
        {['light', 'satellite', 'dark'].map((id) => (
          <button
            key={id}
            onClick={() => handleBaseChange(id)}
            className={`flex-1 px-2 py-1.5 text-12 font-medium rounded transition-colors ${
              activeBase === id ? 'bg-brand-50 text-brand-700' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {id === 'light' ? 'Plano' : id === 'satellite' ? 'Satélite' : 'Oscuro'}
          </button>
        ))}
      </div>

      {overlays.length > 0 && (
        <>
          <div className="border-t border-border-default" />
          <div className="px-3 pt-2 pb-1 text-10 font-semibold text-text-tertiary uppercase tracking-wider">Overlays</div>
          <div className="px-3 pb-2 space-y-1.5">
            {overlays.map(({ id, label, color }) => (
              <div key={id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {color && <span className="inline-block w-3 h-3 rounded-sm border border-border-default shrink-0" style={{ backgroundColor: color }} />}
                  <span className="text-12 text-text-secondary truncate">{label}</span>
                </div>
                <button
                  onClick={() => handleOverlayToggle(id)}
                  className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-500 ${
                    visibility[id] ? 'bg-brand-700' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={visibility[id]}
                >
                  <span
                    className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${
                      visibility[id] ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}