import React, { useState } from 'react';
import {
  Download,
  ExternalLink,
  FileJson,
  Map as MapIcon,
  Brain,
  BookOpen,
  GitBranch,
  Copy,
  Check,
  Image as ImageIcon,
} from 'lucide-react';

// Resolves backend URLs respecting VITE_API_BASE_URL so the download cards
// point at the live Render backend in production (not the Vercel frontend
// origin, which would 404).
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = (p) => `${API_BASE}${p}`;

const GITHUB_BASE = 'https://github.com/Adryeah/tfg-flood-risk-framework';
const GITHUB_RAW =
  'https://raw.githubusercontent.com/Adryeah/tfg-flood-risk-framework/main';

// Each card declares the artifact metadata + the URL. We keep them in
// data shape so future additions (e.g. Zenodo DOI release) drop in
// without rewriting the JSX.
const ARTIFACTS = [
  {
    section: 'Risk surface',
    items: [
      {
        title: 'Risk surface · Valencia (GeoJSON)',
        desc: 'Pre-baked flood probability surface for the L\'Horta Sud bbox. 9617 polygons binned by P(flood) ∈ {0.25–0.34, … , 0.88–1.0}. EPSG:4326.',
        format: 'application/geo+json · 1.2 MB (gzipped)',
        href: apiUrl('/api/risk/valencia.geojson'),
        icon: MapIcon,
        kind: 'download',
      },
      {
        title: 'Risk surface · Algemesí (GeoJSON)',
        desc: 'Same model, applied to the Ribera Alta del Júcar bbox without retraining. 13324 polygons. Transferability test zone.',
        format: 'application/geo+json · 1.3 MB (gzipped)',
        href: apiUrl('/api/risk/algemesi.geojson'),
        icon: MapIcon,
        kind: 'download',
      },
      {
        title: 'Risk surface · raster tile pyramid',
        desc: 'Pre-rendered PNG tiles (256×256, EPSG:3857) at zoom levels z=10–15. Continuous YlOrRd colormap aplicado en píxel-resolución nativa (10 m).',
        format: 'image/png · 2419 tiles · 70 MB total',
        href: `${GITHUB_BASE}/tree/main/framework_web/backend/data_processed/tiles`,
        icon: ImageIcon,
        kind: 'external',
      },
    ],
  },
  {
    section: 'Ground truth',
    items: [
      {
        title: 'EMSR773 flood mask · Valencia (GeoJSON)',
        desc: 'Polígonos oficiales de Copernicus EMS activación EMSR773 (delineación 31 oct 2024) recortados al bbox de l\'Horta Sud.',
        format: 'application/geo+json · 5 KB',
        href: apiUrl('/api/geo/ground_truth/valencia.geojson'),
        icon: FileJson,
        kind: 'download',
      },
      {
        title: 'EMSR773 flood mask · Algemesí (GeoJSON)',
        desc: 'Misma activación EMSR773, recortada a Algemesí + Alzira (zona de extrapolación).',
        format: 'application/geo+json · 7 KB',
        href: apiUrl('/api/geo/ground_truth/algemesi.geojson'),
        icon: FileJson,
        kind: 'download',
      },
      {
        title: 'Municipios DANA (GeoJSON)',
        desc: '14 municipios L\'Horta Sud + Algemesí + Alzira (16 polígonos). Fuente: OpenStreetMap / municipios oficiales.',
        format: 'application/geo+json · 50 KB',
        href: apiUrl('/api/geo/municipalities.geojson'),
        icon: FileJson,
        kind: 'download',
      },
    ],
  },
  {
    section: 'Modelo y datos sintéticos',
    items: [
      {
        title: 'Random Forest v2 · modelo serializado',
        desc: 'Modelo final entrenado (joblib). 500 árboles, max_depth=15, class_weight=balanced. Compatible con scikit-learn 1.3+.',
        format: 'application/octet-stream · ~200 MB',
        href: `${GITHUB_RAW}/models/random_forest_v2.joblib`,
        icon: Brain,
        kind: 'external',
      },
      {
        title: 'Carteras predefinidas (JSON)',
        desc: '4 carteras sintéticas (Premium Residential, Wide Distribution Mix, Industrial Focus, Autos Fleet) con 1.575 pólizas totales geolocalizadas sobre la superficie de riesgo.',
        format: 'application/json · 900 KB',
        href: apiUrl('/api/portfolios/predefined'),
        icon: FileJson,
        kind: 'download',
      },
    ],
  },
];

export function DataDownloads() {
  const [copied, setCopied] = useState(false);

  const bibtex = `@misc{vargas2026floodframework,
  author = {Vargas Aceituno, Adri\\'an},
  title  = {Predictive Flood Risk Assessment Framework based on
            Sentinel-1 SAR Signal Processing: DANA Valencia 2024
            Case Study},
  year   = {2026},
  howpublished = {TFG, Grado en Ingenier\\'ia de Sistemas de
                  Telecomunicaci\\'on, UAB},
  url    = {https://github.com/Adryeah/tfg-flood-risk-framework}
}`;

  const copyBibtex = async () => {
    try {
      await navigator.clipboard.writeText(bibtex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked — silent */
    }
  };

  return (
    <div className="max-w-[1120px] mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-12 space-y-6">
      {/* ─── HEADER · editorial register ────────────────────────── */}
      <header className="border-b border-border-default pb-5">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Reproducibility · Open data
        </div>
        <h1 className="font-serif text-28 leading-none text-text-primary tracking-tight">
          Data &amp; <span className="italic">downloads</span>
        </h1>
        <p className="font-serif italic text-14 text-text-secondary mt-2 max-w-2xl leading-snug">
          Todos los artefactos del framework, descargables directamente
          desde el navegador. Sin login, sin licencia comercial, sin
          fricción.
        </p>
      </header>

      {/* Sections of artifacts */}
      {ARTIFACTS.map((section) => (
        <section key={section.section}>
          <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-2.5">
            {section.section}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.items.map((item) => (
              <ArtifactCard key={item.title} item={item} />
            ))}
          </div>
        </section>
      ))}

      {/* ─── CITATION + REPO ──────────────────────────────────────
       *  Bloque inferior con la cita BibTeX (copiable) y la tarjeta
       *  del repo. La cita es lo que un investigador en frío busca
       *  primero al evaluar reusar un dataset. */}
      <section>
        <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-2.5">
          Citation &amp; repository
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3">
          {/* BibTeX */}
          <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border-default">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-text-secondary shrink-0" strokeWidth={1.75} />
                <h3 className="font-serif text-15 text-text-primary tracking-tight">
                  Cita académica (BibTeX)
                </h3>
              </div>
              <button
                type="button"
                onClick={copyBibtex}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-11 font-mono uppercase tracking-wider rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" strokeWidth={2.5} /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" strokeWidth={1.75} /> Copiar
                  </>
                )}
              </button>
            </div>
            <pre className="px-4 py-3 text-11 leading-relaxed font-mono text-text-primary overflow-x-auto bg-bg-subtle/30 whitespace-pre">
{bibtex}
            </pre>
          </div>

          {/* Repo + reproducción */}
          <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-default">
              <GitBranch className="w-4 h-4 text-text-secondary" strokeWidth={1.75} />
              <h3 className="font-serif text-15 text-text-primary tracking-tight">
                Código fuente
              </h3>
            </div>
            <div className="px-4 py-3 text-12 text-text-secondary space-y-2 leading-relaxed">
              <p>
                Pipeline SAR, modelo, backend y frontend en un único
                repositorio Git público.
              </p>
              <a
                href={GITHUB_BASE}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-12 font-mono text-corporate-navy hover:underline"
              >
                github.com/Adryeah/<wbr />tfg-flood-risk-framework
                <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
              </a>
              <div className="pt-2 mt-2 border-t border-border-default text-11 text-text-tertiary leading-relaxed">
                Para reproducir el experimento completo: <code className="text-text-secondary">git clone</code> + seguir las instrucciones del Apéndice B de la memoria.
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Tarjeta individual de artefacto ─────────────────────────────
// Distingue visualmente entre "download" (servido por el backend, se
// puede bajar con un click) y "external" (en GitHub o similar, abre
// pestaña nueva). El badge superior derecho lo deja claro.
function ArtifactCard({ item }) {
  const Icon = item.icon || FileJson;
  const isExternal = item.kind === 'external';
  return (
    <a
      href={item.href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noreferrer' : undefined}
      download={!isExternal}
      className="group block bg-bg-surface border border-border-default rounded shadow-sm hover:border-corporate-navy transition-colors p-4"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <Icon className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" strokeWidth={1.5} />
        <span className="inline-flex items-center gap-1 text-10 font-mono uppercase tracking-wider text-text-tertiary shrink-0">
          {isExternal ? (
            <>
              <ExternalLink className="w-3 h-3" strokeWidth={1.75} /> External
            </>
          ) : (
            <>
              <Download className="w-3 h-3" strokeWidth={1.75} /> Download
            </>
          )}
        </span>
      </div>
      <h3 className="font-serif text-15 text-text-primary tracking-tight mb-1.5 group-hover:text-corporate-navy transition-colors">
        {item.title}
      </h3>
      <p className="text-12 text-text-secondary leading-relaxed mb-3">
        {item.desc}
      </p>
      <div className="text-10 font-mono uppercase tracking-wider text-text-tertiary">
        {item.format}
      </div>
    </a>
  );
}
