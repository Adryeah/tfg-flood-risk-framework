import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Estado compartido para vistas que no pueden renderizar nada útil
// porque la llamada API que las alimenta ha fallado. Sustituye al
// patrón anterior `if (loading || !data) return <Spinner/>` que
// dejaba el spinner indefinidamente cuando la promesa terminaba en
// rechazo.
//
// Tono editorial consistente con el resto: serif italic para el
// mensaje, mono uppercase para la metadata, paleta corporativa
// navy/amber. No usa "callout box" con borde lateral (banneado en
// CLAUDE.md de design); en su lugar, icono + texto centrado.
export function LoadErrorState({
  message,
  title = 'No se pudieron cargar los datos',
  hint = 'Probablemente el backend está reiniciándose en Render (cold start ≈ 30 s tras inactividad). Recarga en unos segundos.',
}) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 text-amber-600 mb-4">
          <AlertTriangle className="w-6 h-6" strokeWidth={1.8} />
        </div>
        <div className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary mb-2">
          Fallo de carga
        </div>
        <h2 className="font-serif italic text-20 text-text-primary leading-snug mb-2">
          {title}
        </h2>
        <p className="text-13 text-text-secondary leading-relaxed mb-5">
          {hint}
        </p>
        {message && (
          <div className="text-10 font-mono uppercase tracking-wider text-text-tertiary mb-5 px-3 py-2 rounded bg-bg-subtle inline-block max-w-full truncate">
            {message}
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border-default bg-bg-surface text-12 text-text-primary hover:bg-bg-hover transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      </div>
    </div>
  );
}
