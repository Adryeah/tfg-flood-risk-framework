import React from 'react';
import {
  CloudRain,
  Satellite,
  Map as MapIcon,
  AlertOctagon,
  BookOpen,
} from 'lucide-react';

import { RiskZoneMap } from '../components/RiskZoneMap.jsx';

// ─── Hero stats ──────────────────────────────────────────────────
// Cuatro números que cuentan la escala del evento. Ordenados de
// causa (lluvia) a efecto (afectados). El recurso visual deliberado:
// número grande mono + sub-label serif italic.
const HERO_STATS = [
  { value: '400', unit: 'mm', label: 'precipitación en 8 horas (zona crítica)' },
  { value: '199', unit: 'km²', label: 'área inundada confirmada por EMSR773' },
  { value: '90', unit: 'mil', label: 'residentes directamente afectados' },
  { value: '14', unit: '+2', label: 'municipios DANA (Valencia) + Algemesí · Alzira' },
];

// ─── Timeline phases ─────────────────────────────────────────────
// Cinco bloques que componen el "antes / durante / después":
// 1. Pre-DANA (S1 adquirida una semana antes — la única ventana
//    cerrada antes del evento). Esta es la imagen que alimentó al
//    modelo. NADA del evento está en el training set.
// 2. La predicción del modelo (entrenado solo con baseline).
// 3. El día del evento (29 oct, 18:00 h, ~400 mm/8h).
// 4. Adquisición post-DANA (31 oct) — la primera observación SAR del
//    daño + activación EMS.
// 5. Validación contra EMSR773 (qué predijimos vs qué pasó).
const PHASES = [
  {
    date: '19 octubre 2024',
    time: '18:12 UTC',
    title: 'Última pasada Sentinel-1 antes del evento',
    icon: Satellite,
    accent: '#475569',
    body: (
      <>
        El satélite Sentinel-1A captura la zona en órbita ascendente.
        Es la imagen más reciente con la que el modelo tiene contacto
        antes de la DANA. <strong>Diez días después</strong> la zona se
        inundaría — pero el modelo no lo sabe aún.
      </>
    ),
  },
  {
    date: 'pre-evento',
    time: 'baseline 2022–2024',
    title: 'Lo que nuestro modelo había predicho',
    icon: MapIcon,
    accent: '#7C3AED',
    body: (
      <>
        Entrenado con 28 escenas baseline (sin nunca ver las dos del
        evento), Random Forest v2 emitía mapas de probabilidad sobre
        l'Horta Sud. Las cotas bajas, los cauces del Turia y el sur
        de Catarroja ya aparecían en{' '}
        <strong>rojo oscuro (p &gt; 0.75)</strong> en julio de 2024.
      </>
    ),
  },
  {
    date: '29 octubre 2024',
    time: '~18:00 hora local',
    title: 'La DANA',
    icon: CloudRain,
    accent: '#DC2626',
    body: (
      <>
        Un sistema convectivo profundo, alimentado por la entrada de
        aire frío en altura y el Mediterráneo a temperatura récord,
        descarga <strong>hasta 400 mm en 8 horas</strong> sobre la
        cabecera del Poyo y el Magro. La escorrentía colapsa los
        barrancos urbanizados de l'Horta Sud al atardecer.
      </>
    ),
  },
  {
    date: '31 octubre 2024',
    time: '18:12 UTC',
    title: 'Sentinel-1 captura el daño',
    icon: AlertOctagon,
    accent: '#991B1B',
    body: (
      <>
        Dos días después del evento, la siguiente pasada SAR observa la
        zona con láminas de agua todavía visibles en Catarroja,
        Paiporta, Albal y Beniparrell. Copernicus EMS se activa el
        mismo día como{' '}
        <strong>EMSR773 (Floods in Valencia, Spain)</strong> y publica
        una delineación oficial.
      </>
    ),
  },
  {
    date: '31 oct — 6 nov',
    time: 'ground truth oficial',
    title: 'EMSR773 vs nuestro modelo',
    icon: BookOpen,
    accent: '#15803D',
    body: (
      <>
        La delineación de Copernicus EMS identifica{' '}
        <strong>199 km² inundados</strong>. Comparado con la
        predicción del modelo de antes del evento:{' '}
        <strong>AUC 0.922 · Recall 77.7 % · Buffered recall a 100 m
        95.8 %</strong>. El modelo, entrenado solo con datos
        anteriores, había marcado correctamente la geometría del
        riesgo.
      </>
    ),
  },
];

export function DanaTimeline() {
  return (
    <div className="max-w-[1200px] mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-12 space-y-8">
      {/* ─── HEADER · editorial register, denso narrativo ─────────── */}
      <header className="border-b border-border-default pb-5">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
          Case study · The day that triggered this project
        </div>
        <h1 className="font-serif text-28 sm:text-32 leading-none text-text-primary tracking-tight">
          DANA <span className="italic">·</span> 29 octubre 2024
        </h1>
        <p className="font-serif italic text-14 sm:text-15 text-text-secondary mt-3 max-w-3xl leading-snug">
          La depresión aislada en niveles altos descargó sobre Valencia
          en ocho horas el equivalente a un año de lluvia. Lo que
          siguió fue la catástrofe más grave del siglo en territorio
          español. Esta página reconstruye el evento desde la última
          observación SAR pre-DANA hasta la validación oficial contra
          el ground truth Copernicus EMS.
        </p>
      </header>

      {/* ─── HERO STATS ──────────────────────────────────────────────
       *  Cuatro tarjetas con la magnitud del evento. Tipografía mono
       *  grande para el número, serif italic para el sub-label. No
       *  uso el patrón hero-metric SaaS porque cada tarjeta tiene
       *  igual peso visual (la cantidad cuenta una sola historia). */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {HERO_STATS.map((s) => (
          <div
            key={s.label}
            className="bg-bg-surface border border-border-default rounded shadow-sm px-4 py-4"
          >
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span
                className="font-mono font-semibold tabular-nums text-text-primary"
                style={{ fontSize: '32px', lineHeight: 1 }}
              >
                {s.value}
              </span>
              <span className="text-13 font-mono text-text-secondary">
                {s.unit}
              </span>
            </div>
            <p className="font-serif italic text-12 text-text-secondary leading-snug">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {/* ─── SIDE-BY-SIDE · predicción vs ground truth ────────────────
       *  El corazón narrativo: lo que el modelo había marcado en rojo
       *  antes de la DANA (izquierda) y lo que confirmó EMSR773
       *  después (derecha). Ambos mapas usan el mismo bbox y zoom
       *  inicial para que el lector pueda comparar píxel a píxel. */}
      <section>
        <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-3">
          La comparación que hace el caso
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-default flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-serif text-15 text-text-primary tracking-tight">
                  Predicción del modelo
                </h3>
                <span className="text-11 font-mono text-text-tertiary uppercase tracking-wider hidden sm:inline">
                  pre-DANA
                </span>
              </div>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-brand-50 text-brand-700 shrink-0">
                Random Forest v2
              </span>
            </div>
            <RiskZoneMap
              zone="valencia"
              height="clamp(320px, 50vh, 460px)"
              showOverlays={false}
              showLegend
              showZones={false}
              includeTail={false}
              enablePixelInspection={false}
            />
          </div>
          <div className="bg-bg-surface border border-border-default rounded shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-default flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-serif text-15 text-text-primary tracking-tight">
                  Lo que pasó realmente
                </h3>
                <span className="text-11 font-mono text-text-tertiary uppercase tracking-wider hidden sm:inline">
                  ground truth
                </span>
              </div>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-10 font-mono font-semibold uppercase tracking-wider bg-risk-high-bg text-risk-high shrink-0">
                EMSR773
              </span>
            </div>
            <RiskZoneMap
              zone="valencia"
              height="clamp(320px, 50vh, 460px)"
              showOverlays={false}
              showLegend={false}
              showZones={false}
              includeTail={false}
              enablePixelInspection={false}
              showGroundTruth
            />
          </div>
        </div>
        <p className="font-serif italic text-13 text-text-secondary mt-3 max-w-3xl leading-snug">
          Ambos mapas cubren exactamente el mismo bbox (l'Horta Sud).
          La superposición es geográficamente honesta: si las manchas
          de la izquierda no caen sobre las áreas confirmadas a la
          derecha, el modelo está fallando. Hazlo a mano: las dos
          siluetas coinciden en los valles de Catarroja, Paiporta y
          Albal.
        </p>
      </section>

      {/* ─── TIMELINE · 5 fases ──────────────────────────────────────
       *  Estructura editorial: línea vertical fina + bloques de fecha
       *  + título + prosa serif. Cada fase tiene icono y acento de
       *  color. Lee como página de revista, no como log de eventos. */}
      <section>
        <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-3">
          Reconstrucción cronológica
        </div>
        <ol className="relative space-y-6 pl-7 sm:pl-9 border-l border-border-default">
          {PHASES.map((phase, idx) => {
            const Icon = phase.icon;
            return (
              <li key={phase.title} className="relative">
                {/* Dot + icon */}
                <span
                  className="absolute -left-[34px] sm:-left-[42px] top-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-surface border-2"
                  style={{ borderColor: phase.accent }}
                >
                  <Icon
                    className="w-3.5 h-3.5"
                    style={{ color: phase.accent }}
                    strokeWidth={2}
                  />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                  <span
                    className="text-10 font-mono font-semibold uppercase tracking-[0.14em]"
                    style={{ color: phase.accent }}
                  >
                    {phase.date}
                  </span>
                  <span className="text-10 font-mono uppercase tracking-wider text-text-tertiary">
                    {phase.time}
                  </span>
                </div>
                <h3 className="font-serif text-18 sm:text-20 text-text-primary tracking-tight leading-tight mb-2">
                  {phase.title}
                </h3>
                <p className="text-13 text-text-secondary leading-relaxed max-w-3xl">
                  {phase.body}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ─── CLOSING NOTE ────────────────────────────────────────────
       *  Pull-quote final con la tesis del caso. Sin "callout box"
       *  con borde lateral (banned). Solo glifo de cita + serif
       *  centrado, prose-width. */}
      <section className="max-w-[68ch] mx-auto pt-2 text-center sm:text-left">
        <p className="font-serif text-16 sm:text-17 text-text-primary leading-relaxed">
          La DANA de Valencia ocurrió. Lo que este TFG demuestra es
          que <em>podría haberse anticipado</em> ---no en hora cero
          como una alerta meteorológica, sino con días o semanas de
          antelación como mapa de exposición--- con datos públicos,
          un ordenador personal y rigor metodológico. No hace falta
          un proveedor comercial de cat-models para construir esa
          señal.
        </p>
        <p className="font-serif italic text-13 text-text-secondary mt-4">
          Memoria del TFG, Capítulo 7 · <em>Discusión</em>.
        </p>
      </section>
    </div>
  );
}
