import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Info,
  ExternalLink,
  X,
  Download,
  Map as MapIcon,
  Layers,
  Globe,
} from 'lucide-react';

import { useBackbone, useSnczAvailability } from '@/lib/return-period.js';

/**
 * Banner editorial que aparece cuando el operador activa el backbone
 * SNCZI pero el deployment todavía no lo tiene configurado (manifest
 * 503). Persiste mientras el toggle siga en 'snczi' — desaparece al
 * volver a 'rf_v2' o cuando el backend confirma SNCZI ready.
 *
 * Dos variantes via prop `variant`:
 *   · 'inline'  → banner editorial para /exposure (white card con
 *                 borde ámbar)
 *   · 'console' → ribbon mil-spec navy para /tour (top del canvas)
 *
 * Click en "Ver detalles de la integración" abre el SnczInfoModal
 * con los 5 pasos para activar SNCZI en producción.
 */
export function SnczNoticeBar({ variant = 'inline' }) {
  const [backbone] = useBackbone();
  const avail = useSnczAvailability();
  const [showModal, setShowModal] = useState(false);

  // Solo renderizamos cuando el operador ha activado SNCZI Y el
  // backend dice que no está configurado (o no se pudo verificar).
  if (backbone !== 'snczi') return null;
  if (avail.state === 'checking') return null;
  if (avail.state === 'ready') return null;

  const isError = avail.state === 'error';
  const title = isError
    ? 'No se pudo verificar la fuente SNCZI'
    : 'SNCZI no está configurado en este deployment';
  const body = isError
    ? 'El backend no respondió a la verificación. Si Render acaba de despertar, intenta de nuevo en unos segundos. Mientras tanto la plataforma sigue usando RF v2 con el escalado AEP.'
    : 'Los rasters oficiales MITECO requieren descarga manual con aceptación de términos web — proceso no automatizable. Mientras tanto la plataforma sigue usando RF v2 con el escalado AEP de Dottori (2018), que es la fuente documentada en el capítulo 5 de la memoria.';

  if (variant === 'console') {
    // Variante mil-spec para el HUD del /tour. Ribbon delgado top
    // del canvas. No bloquea interacción del mapa.
    return (
      <>
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[700] max-w-[640px] px-3 py-2 rounded-md backdrop-blur-md"
          style={{
            background: 'rgba(217, 119, 6, 0.18)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            boxShadow: '0 4px 12px rgba(15,27,53,0.30)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className="w-4 h-4 shrink-0"
              style={{ color: '#FBBF24' }}
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <div
                className="text-9 font-mono font-semibold uppercase tracking-[0.18em]"
                style={{ color: '#FBBF24' }}
              >
                {isError ? 'BACKBONE · CHECK FALLÓ' : 'BACKBONE · NO CONFIGURADO'}
              </div>
              <div
                className="text-11 mt-0.5 leading-snug"
                style={{ color: 'rgba(248,250,252,0.90)' }}
              >
                {title}. Usando <strong>RF v2 + Dottori 2018</strong> como
                fallback.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="shrink-0 text-9 font-mono uppercase tracking-widest px-2 py-1 rounded transition-colors"
              style={{
                color: '#FBBF24',
                border: '1px solid rgba(251,191,36,0.55)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(251,191,36,0.18)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Ver pasos
            </button>
          </div>
        </div>
        {showModal && <SnczInfoModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  // variant === 'inline' · para /exposure
  return (
    <>
      <div
        className="rounded-md border bg-amber-50 border-amber-200 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start gap-3"
        role="status"
      >
        <div
          className="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center"
          style={{ background: 'rgba(245,158,11,0.18)' }}
        >
          <AlertTriangle className="w-4 h-4 text-amber-700" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-10 font-mono font-semibold uppercase tracking-[0.18em] text-amber-700 mb-1">
            Backbone SNCZI · pendiente de configuración
          </div>
          <h3 className="font-serif text-15 text-text-primary tracking-tight leading-tight mb-1.5">
            {title}
          </h3>
          <p className="font-serif italic text-12 text-text-secondary leading-snug max-w-[58ch]">
            {body}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="shrink-0 inline-flex items-center gap-1.5 text-11 font-mono uppercase tracking-wider px-2.5 py-1.5 rounded border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          Ver pasos
        </button>
      </div>
      {showModal && <SnczInfoModal onClose={() => setShowModal(false)} />}
    </>
  );
}

/**
 * Modal con los 5 pasos para activar SNCZI en producción. Replica
 * el contenido del docstring del router backend con tono editorial.
 *
 * Mil-spec backdrop (navy 88% + blur 8 px). Cierre con click outside
 * o tecla Escape.
 */
export function SnczInfoModal({ onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const STEPS = [
    {
      icon: Download,
      title: 'Descarga manual de rasters MITECO',
      body: (
        <>
          Bajar los GeoTIFF oficiales para los periodos de retorno
          T10, T100 y T500 desde el portal del Ministerio. Requiere
          aceptar los términos web del visor (no automatizable).
        </>
      ),
      ext: {
        label: 'Portal MITECO · cartografía-zi-lamina',
        url: 'https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/cartografia-zi-lamina.html',
      },
    },
    {
      icon: MapIcon,
      title: 'Recorte al bbox de cada zona',
      body: (
        <>
          Usar <code className="font-mono text-10 bg-bg-subtle px-1 rounded">gdalwarp</code> para
          recortar cada raster al bbox de Valencia (l'Horta Sud) y al
          de Algemesí (Ribera Alta del Júcar). Reproyectar a EPSG:4326
          si la fuente trae otra proyección.
        </>
      ),
    },
    {
      icon: Layers,
      title: 'Generar tile pyramid (z=10-15)',
      body: (
        <>
          Convertir cada raster recortado a tile pyramid PNG con{' '}
          <code className="font-mono text-10 bg-bg-subtle px-1 rounded">gdal2tiles.py -z 10-15</code>.
          Tamaño esperado por zona+RP: ~30 MB. Total ~180 MB para
          T10/T100/T500 × 2 zonas.
        </>
      ),
    },
    {
      icon: Globe,
      title: 'Servir desde el backend Render',
      body: (
        <>
          Levantar la flag{' '}
          <code className="font-mono text-10 bg-bg-subtle px-1 rounded">SNCZI_AVAILABLE = True</code>{' '}
          en{' '}
          <code className="font-mono text-10 bg-bg-subtle px-1 rounded">
            routers/return_periods.py
          </code>{' '}
          y exponer{' '}
          <code className="font-mono text-10 bg-bg-subtle px-1 rounded">
            /api/return-periods/snczi/&#123;zone&#125;/&#123;rp&#125;/&#123;z&#125;/&#123;x&#125;/&#123;y&#125;.png
          </code>{' '}
          desde el directorio de tiles.
        </>
      ),
    },
    {
      icon: ExternalLink,
      title: 'Alternativa · WMS INSPIRE proxy',
      body: (
        <>
          Para evitar la descarga manual, montar un proxy en el backend
          contra el WMS oficial de MITECO. Pros: sin almacenamiento ni
          coste de bandwidth. Contras: dependencia de uptime MITECO y
          CORS resuelto vía nuestro proxy.
        </>
      ),
      ext: {
        label: 'WMS INSPIRE · servicios.idee.es',
        url: 'https://servicios.idee.es/wms-inspire/inundabilidad?service=WMS&request=GetCapabilities',
      },
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center px-4 py-8"
      style={{ background: 'rgba(15,27,53,0.78)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sncz-modal-title"
    >
      <div
        className="w-full max-w-[640px] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-lg bg-bg-surface shadow-2xl"
        style={{ border: '1px solid var(--border-default)' }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border-default flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-10 font-mono font-semibold uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
              Integración SNCZI · 5 pasos
            </div>
            <h2
              id="sncz-modal-title"
              className="font-serif text-22 tracking-tight leading-tight text-text-primary"
            >
              Cómo activar la cartografía oficial MITECO
            </h2>
            <p className="font-serif italic text-12 text-text-secondary mt-1.5 max-w-[52ch] leading-snug">
              Los rasters oficiales del Sistema Nacional de Cartografía
              de Zonas Inundables son la fuente defendible al 100% ante
              tribunal y reguladores. Estos son los pasos para
              integrarlos en este deployment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded hover:bg-bg-subtle transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Steps */}
        <ol className="px-6 py-5 space-y-4">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <li key={idx} className="flex items-start gap-3">
                <div
                  className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center font-mono text-11 font-semibold border"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: '#f7f8f8',
                    borderColor: '#D4DCEC',
                  }}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className="w-3.5 h-3.5 text-text-tertiary" />
                    <h3 className="font-serif text-14 text-text-primary tracking-tight leading-tight">
                      {step.title}
                    </h3>
                  </div>
                  <p className="text-12 text-text-secondary leading-relaxed">
                    {step.body}
                  </p>
                  {step.ext && (
                    <a
                      href={step.ext.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-11 font-mono mt-1.5 text-brand-500 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {step.ext.label}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Footer */}
        <div className="px-6 pt-3 pb-5 border-t border-border-default">
          <p className="font-serif italic text-11 text-text-tertiary leading-snug">
            Mientras tanto la plataforma usa RF v2 propio + escalado
            AEP (Dottori et al. 2018). Defendible metodológicamente,
            sin dependencia externa. Detalle completo en el capítulo 5
            de la memoria.
          </p>
        </div>
      </div>
    </div>
  );
}
