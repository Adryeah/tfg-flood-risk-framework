import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

import { api } from '@/lib/api.js';
import { navigateTo } from '@/lib/hash-params.js';

/**
 * Global search dialog — opens with Ctrl/Cmd + K or clicking the
 * search button in the topbar. Searches policy IDs across the active
 * predefined portfolios.
 *
 * Implementation:
 *  - Loads the first ~3 portfolios on first open (cached in a ref)
 *  - Filters policies whose `id` contains the typed text (case-insensitive)
 *  - Up to 8 results shown
 *  - Enter on top result navigates to /policy-map?p=<portfolio>&policy=<id>
 *
 * This is a client-side filter, not a backend search — the dataset is
 * <3 MB total and lives in memory once loaded.
 */
export function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const portfoliosRef = useRef(null); // { [id]: clients[] }

  // Load policy lists once (cached for the lifetime of the page).
  useEffect(() => {
    if (!open || portfoliosRef.current) return;
    setLoading(true);
    (async () => {
      try {
        const idx = await api.portfolio.getPredefined();
        const ids = (idx?.portfolios || []).map((p) => p.id);
        const loaded = await Promise.all(
          ids.map((id) =>
            api.portfolio.getById(id).then((p) => [id, p?.clients || []])
          )
        );
        portfoliosRef.current = Object.fromEntries(loaded);
      } catch (err) {
        console.error('GlobalSearch · failed to load portfolios', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  // Recompute matches on query change.
  useEffect(() => {
    if (!open || !portfoliosRef.current) {
      setResults([]);
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      setResults([]);
      return;
    }
    const hits = [];
    for (const [portfolioId, clients] of Object.entries(portfoliosRef.current)) {
      for (const c of clients) {
        if ((c.id || '').toLowerCase().includes(q)) {
          hits.push({ ...c, _portfolio: portfolioId });
          if (hits.length >= 8) break;
        }
      }
      if (hits.length >= 8) break;
    }
    setResults(hits);
  }, [query, open]);

  // Auto-focus input on open + ESC to close.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handle = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Enter' && results[0]) {
        navigateTo('/policy-map', {
          p: results[0]._portfolio,
          policy: results[0].id,
        });
        onClose?.();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, results, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-[560px] mx-4 bg-bg-surface border border-border-default rounded shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
          <Search
            className="w-4 h-4 text-text-tertiary shrink-0"
            strokeWidth={1.75}
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar póliza por ID (p.ej. 67381)…"
            // Explicit text-primary — otherwise the input inherits a
            // light colour from the modal backdrop and the user can't
            // see what they're typing on the cream surface.
            className="flex-1 bg-transparent text-13 outline-none text-text-primary placeholder:text-text-tertiary caret-text-primary"
          />
          <kbd className="text-10 font-mono uppercase tracking-wider text-text-tertiary border border-border-default px-1.5 py-0.5 rounded-sm">
            ESC
          </kbd>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary"
            aria-label="Close search"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-12 text-text-tertiary">
              Cargando carteras…
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-12 text-text-tertiary">
              Sin coincidencias para{' '}
              <span className="font-mono text-text-primary">{query}</span>
            </div>
          )}
          {!loading && !query.trim() && (
            <div className="px-4 py-6 text-center text-12 text-text-tertiary">
              Escribe parte del ID de una póliza (los IDs empiezan por{' '}
              <span className="font-mono">POL-000001</span>).
            </div>
          )}
          {results.map((r, idx) => (
            <button
              key={`${r._portfolio}-${r.id}`}
              onClick={() => {
                navigateTo('/policy-map', {
                  p: r._portfolio,
                  policy: r.id,
                });
                onClose?.();
              }}
              // Visible hover state — bg-brand-50 + border-l-2 accent so
              // keyboard / mouse focus reads at a glance. Plus the ↵
              // indicator follows the hovered row (not just the first).
              className="w-full text-left flex items-center justify-between px-4 py-2.5 border-b border-border-default last:border-b-0 group transition-colors hover:bg-brand-50 hover:border-l-2 hover:border-l-brand-500 hover:pl-[14px] focus:bg-brand-50 focus:border-l-2 focus:border-l-brand-500 focus:pl-[14px] focus:outline-none"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={
                    'text-10 font-mono uppercase tracking-wider shrink-0 transition-opacity ' +
                    (idx === 0
                      ? 'text-brand-700 opacity-100'
                      : 'text-brand-700 opacity-0 group-hover:opacity-100')
                  }
                >
                  ↵
                </span>
                <span className="font-mono text-12 text-text-primary group-hover:text-brand-700 truncate">
                  {r.id}
                </span>
                <span className="text-10 font-mono uppercase tracking-wider text-text-tertiary shrink-0">
                  {r.product || r.type}
                </span>
              </div>
              <div className="flex items-center gap-3 text-11 font-mono tabular-nums shrink-0">
                <span className="text-text-secondary">
                  P={Number(r.risk_probability || 0).toFixed(3)}
                </span>
                <span className="text-text-tertiary">
                  €{((r.insured_value || 0) / 1000).toFixed(0)}K
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
