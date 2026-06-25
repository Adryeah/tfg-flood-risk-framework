import React from 'react';
import { CloudRain, Satellite, Map as MapIcon, AlertOctagon, BookOpen } from 'lucide-react';

import { DanaSwipeCompare } from '../components/dana-swipe-compare.jsx';
import { RevealSection } from '../components/reveal-section.jsx';
import { useInView, useCountUp } from '../lib/animations.js';

// ─── Hero stats ──────────────────────────────────────────────────
// Cuatro números que cuentan la escala del evento. `numericValue` es
// lo que se anima (count-up de 0 → target); `displayPrefix/Suffix`
// son los add-ons que rodean al número (signo, coma decimal, etc.).
const HERO_STATS = [
  {
    numericValue: 400,
    unit: 'mm',
    label: 'precipitación en 8 horas (zona crítica)',
  },
  {
    numericValue: 199,
    unit: 'km²',
    label: 'área inundada confirmada por EMSR773',
  },
  {
    numericValue: 90,
    unit: 'mil',
    label: 'residentes directamente afectados',
  },
  {
    numericValue: 14,
    unit: '+2',
    label: 'municipios DANA (Valencia) + Algemesí · Alzira',
  },
];

// ─── Timeline phases ─────────────────────────────────────────────
// Cinco bloques antes / durante / después con paleta Zurich aplicada
// a cada acento. El recorrido cromático cuenta el arco narrativo:
// gris frío (observación dormida) → azul (predicción) → rojo (evento)
// → rojo oscuro (daño) → verde (validación). `weight` controla la
// densidad visual: la fase 3 (la DANA) lleva weight='heavy' que dobla
// el border del icono y la mete en serif más grande.
const PHASES = [
  {
    date: '19 octubre 2024',
    time: '18:12 UTC',
    title: 'Última pasada Sentinel-1 antes del evento',
    icon: Satellite,
    accent: '#4B5563', // neutral-600 — observación rutinaria
    weight: 'normal',
    body: (
      <>
        El satélite Sentinel-1A captura la zona en órbita ascendente. Es la imagen más reciente con
        la que el modelo tiene contacto antes de la DANA. <strong>Diez días después</strong> la zona
        se inundaría — pero el modelo no lo sabe aún.
      </>
    ),
  },
  {
    date: 'pre-evento',
    time: 'baseline 2022–2024',
    title: 'Lo que nuestro modelo había predicho',
    icon: MapIcon,
    accent: '#3B82F6', // accent-info — predicción / analítica
    weight: 'normal',
    body: (
      <>
        Entrenado con 28 escenas baseline (sin nunca ver las dos del evento), Random Forest v3-T
        emitía mapas de probabilidad sobre l'Horta Sud. Las cotas bajas, los cauces del Turia y el
        sur de Catarroja ya aparecían en <strong>rojo oscuro (p &gt; 0.75)</strong> en julio de
        2024.
      </>
    ),
  },
  {
    date: '29 octubre 2024',
    time: '~18:00 hora local',
    title: 'La DANA',
    icon: CloudRain,
    accent: '#E74C3C', // risk-high flood red — el evento
    weight: 'heavy', // este es el corazón del relato
    body: (
      <>
        Un sistema convectivo profundo, alimentado por la entrada de aire frío en altura y el
        Mediterráneo a temperatura récord, descarga <strong>hasta 400 mm en 8 horas</strong> sobre
        la cabecera del Poyo y el Magro. La escorrentía colapsa los barrancos urbanizados de l'Horta
        Sud al atardecer.
      </>
    ),
  },
  {
    date: '31 octubre 2024',
    time: '18:12 UTC',
    title: 'Sentinel-1 captura el daño',
    icon: AlertOctagon,
    accent: '#DC2626', // risk-critical — daño confirmado
    weight: 'normal',
    body: (
      <>
        Dos días después del evento, la siguiente pasada SAR observa la zona con láminas de agua
        todavía visibles en Catarroja, Paiporta, Albal y Beniparrell. Copernicus EMS se activa el
        mismo día como <strong>EMSR773 (Floods in Valencia, Spain)</strong> y publica una
        delineación oficial.
      </>
    ),
  },
  {
    date: '31 oct — 6 nov',
    time: 'ground truth oficial',
    title: 'EMSR773 vs nuestro modelo',
    icon: BookOpen,
    accent: '#10B981', // risk-low / status-live — validación
    weight: 'normal',
    body: (
      <>
        La delineación de Copernicus EMS identifica <strong>199 km² inundados</strong>. Comparado
        con la predicción del modelo de antes del evento:{' '}
        <strong>AUC 0,848 · Recall 63,9 % · Recall con tolerancia 100 m 97,0 %</strong>. El modelo,
        entrenado solo con datos anteriores, había marcado correctamente la geometría del riesgo.
      </>
    ),
  },
];

export function DanaTimeline() {
  return (
    <div className="max-w-[1200px] mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-16 space-y-10">
      {/* ─── HEADER · editorial register, denso narrativo ─────────── */}
      <header className="border-b border-border-default pb-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
        <div className="text-10 font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">
          Case study · The day that triggered this project
        </div>
        <h1 className="font-serif text-28 sm:text-32 leading-[1.05] text-text-primary tracking-tight">
          DANA <span className="italic text-text-tertiary mx-1">·</span> 29 octubre 2024
        </h1>
        <p className="font-serif italic text-14 sm:text-15 text-text-secondary mt-3 max-w-3xl leading-snug">
          La depresión aislada en niveles altos descargó sobre Valencia en ocho horas el equivalente
          a un año de lluvia. Lo que siguió fue la catástrofe más grave del siglo en territorio
          español. Esta página reconstruye el evento desde la última observación SAR pre-DANA hasta
          la validación oficial contra el ground truth Copernicus EMS.
        </p>
      </header>

      {/* ─── HERO STATS · count-up + stagger + hover lift ────────────
       *  Cuatro tarjetas con la magnitud del evento. Cada número
       *  cuenta desde 0 hasta target en 1.2s ease-out cuártico cuando
       *  la sección entra en viewport. Stagger 120 ms entre cards.
       *  Hover: 1.5 px translateY + shadow elevation + accent
       *  navy en el border. */}
      <HeroStatsGrid />

      {/* ─── COMPARACIÓN SWIPE · PREDICCIÓN ↔ GROUND TRUTH ────────── */}
      <RevealSection delay={0}>
        {/* Eyebrow Agent 5: línea de acento SAR + label simple. */}
        <div className="flex items-center gap-3 mb-3">
          <span style={{ width: 20, height: 1.5, background: 'var(--accent-sar)' }} />
          <span
            className="text-10 font-mono uppercase"
            style={{ color: 'var(--text-muted)', fontWeight: 510, letterSpacing: '0.07em' }}
          >
            Evidencia · Modelo vs Evento
          </span>
        </div>
        <DanaSwipeCompare zone="valencia" height={460} />
        <p className="font-serif italic text-13 text-text-secondary mt-3 max-w-3xl leading-snug">
          Una sola superficie geográfica (l'Horta Sud), dos lecturas: el heatmap rojo es lo que el
          modelo predijo antes de la DANA; la capa cian es lo que Copernicus EMS confirmó dos días
          después. Arrastra el divisor para revelar el ground truth sobre el mapa de predicción —
          las dos siluetas se superponen en los valles de Catarroja, Paiporta y Albal.
        </p>
      </RevealSection>

      {/* ─── EL VEREDICTO NUMÉRICO ──────────────────────────────────── */}
      <RecallVerdict />

      {/* ─── TIMELINE · 5 fases con reveal-on-scroll ─────────────────
       *  Cada fase se desvela cuando entra al viewport (no en mount,
       *  para que el lector "descubra" el bloque al avanzar). La
       *  fase 3 (la DANA) lleva weight='heavy' → icono con border doble
       *  y título un punto más grande, marcando el clímax narrativo. */}
      <RevealSection delay={0}>
        <div className="flex items-baseline gap-3 mb-5">
          <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Reconstrucción cronológica
          </div>
          <div
            className="h-px flex-1 max-w-[80px]"
            style={{ background: 'var(--border-default)' }}
          />
        </div>
        <ol className="relative space-y-7 pl-7 sm:pl-9 border-l border-border-default">
          {PHASES.map((phase, idx) => (
            <PhaseItem key={phase.title} phase={phase} idx={idx} />
          ))}
        </ol>
      </RevealSection>

      {/* ─── CLOSING NOTE · pull-quote final ────────────────────────
       *  Tesis del caso, glifo de cita sutil al inicio + serif
       *  centrado prose-width + em-dashes reales. */}
      <RevealSection delay={0}>
        <div className="max-w-[68ch] mx-auto pt-2 pl-5 sm:pl-7 relative">
          {/* Glifo de cita decorativo, fina raya navy a la izquierda */}
          <div
            className="absolute left-0 top-2 bottom-2 w-[2px]"
            style={{ background: 'var(--brand-500)' }}
            aria-hidden="true"
          />
          <p className="font-serif text-16 sm:text-17 text-text-primary leading-relaxed">
            La DANA de Valencia ocurrió. Lo que este TFG demuestra es que{' '}
            <em>podría haberse anticipado</em> <span className="text-text-tertiary">—</span> no en
            hora cero como una alerta meteorológica, sino con días o semanas de antelación como mapa
            de exposición <span className="text-text-tertiary">—</span> con datos públicos, un
            ordenador personal y rigor metodológico. No hace falta un proveedor comercial de
            cat-models para construir esa señal.
          </p>
          <p className="font-serif italic text-13 text-text-secondary mt-4">
            Memoria del TFG, Capítulo 7 · <em>Discusión</em>.
          </p>
        </div>
      </RevealSection>
    </div>
  );
}

// ─── Hero stats grid ─────────────────────────────────────────────
function HeroStatsGrid() {
  const [ref, inView] = useInView({ threshold: 0.3 });
  return (
    <section ref={ref} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {HERO_STATS.map((s, idx) => (
        <HeroStatCard key={s.label} stat={s} idx={idx} active={inView} />
      ))}
    </section>
  );
}

function HeroStatCard({ stat, idx, active }) {
  // Stagger: cada card arranca el count-up 140 ms después de la anterior.
  // 1100ms de duración para que el primer número termine antes de que el
  // último arranque demasiado tarde (1100 + 3*140 = 1520 ms total).
  const animated = useCountUp(stat.numericValue, {
    active,
    duration: 1100,
    startDelay: idx * 140,
  });
  const display = Math.round(animated).toLocaleString('es-ES');

  return (
    <div
      className="group relative bg-bg-surface border border-border-default rounded-md shadow-sm px-4 py-4 transition-all duration-200 ease-out hover:shadow-md hover:-translate-y-0.5 hover:border-brand-500/40 animate-in fade-in slide-in-from-bottom-3"
      style={{
        animationDelay: `${idx * 80}ms`,
        animationDuration: '700ms',
        animationFillMode: 'backwards',
      }}
    >
      {/* Hairline navy accent — solo visible al hover. Lee como "esto
       *  es interactivo" sin requerir un click target. */}
      <div
        className="absolute top-0 left-0 h-[2px] bg-brand-500 transition-all duration-300 ease-out group-hover:w-12"
        style={{ width: '20px' }}
        aria-hidden="true"
      />
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span
          className="font-mono font-semibold tabular-nums text-text-primary"
          style={{ fontSize: '32px', lineHeight: 1 }}
        >
          {display}
        </span>
        <span className="text-13 font-mono text-text-secondary">{stat.unit}</span>
      </div>
      <p className="font-serif italic text-12 text-text-secondary leading-snug">{stat.label}</p>
    </div>
  );
}

// ─── Recall verdict ───────────────────────────────────────────────
// Big 95.8% cuenta desde 0 + barra de progreso anima fill + KPIs
// secundarios cuentan también con stagger ligero. Todo se dispara
// cuando la sección entra al viewport.
function RecallVerdict() {
  const [ref, inView] = useInView({ threshold: 0.25 });
  const recall = useCountUp(97.0, { active: inView, duration: 1400 });
  const pixelRecall = useCountUp(63.9, { active: inView, duration: 1400, startDelay: 200 });
  const auc = useCountUp(0.848, { active: inView, duration: 1400, startDelay: 300 });
  const f1 = useCountUp(0.348, { active: inView, duration: 1400, startDelay: 400 });
  const captured = useCountUp(193.0, { active: inView, duration: 1400, startDelay: 100 });
  const missed = useCountUp(6.0, { active: inView, duration: 1400, startDelay: 100 });

  return (
    <section ref={ref}>
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary">
          El veredicto numérico
        </div>
        <div
          className="h-px flex-1 max-w-[120px]"
          style={{ background: 'var(--border-default)' }}
        />
        <div className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary">
          cómo de bien acertó el modelo
        </div>
      </div>

      <div className="bg-bg-surface border border-border-default rounded-md shadow-sm p-5 sm:p-6 transition-shadow duration-200 hover:shadow-md">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 items-center">
          {/* Big recall number con count-up */}
          <div>
            <div className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary mb-2">
              Recall · tolerancia 100 m
            </div>
            <div className="flex items-baseline gap-2 mb-3">
              <span
                className="font-mono font-semibold tabular-nums"
                style={{ fontSize: 52, lineHeight: 1, color: '#10B981' }}
              >
                {recall.toFixed(1)}%
              </span>
              <span className="text-12 font-mono text-text-tertiary">cobertura</span>
            </div>
            <p className="font-serif italic text-13 text-text-secondary leading-snug">
              De cada 100 píxeles que se inundaron realmente, el modelo había marcado 96 como riesgo
              alto en su predicción pre-DANA. Sin haber visto nunca el evento.
            </p>
          </div>

          {/* Barra de cobertura animada + KPIs secundarios */}
          <div>
            <div className="text-10 font-mono uppercase tracking-wider text-text-tertiary mb-1.5">
              Área inundada según EMSR773
            </div>
            <div className="h-3 bg-bg-subtle rounded-sm overflow-hidden flex relative">
              {/* Fill verde — width animada de 0 → 95.8% */}
              <div
                className="h-full transition-[width] duration-[1400ms] ease-out"
                style={{
                  width: inView ? '95.8%' : '0%',
                  background: 'linear-gradient(90deg, #0F766E 0%, #10B981 100%)',
                }}
                title="Detectados por el modelo"
              />
              {/* Fill gris — width animada de 0 → 4.2% (entra al final) */}
              <div
                className="h-full transition-[width] duration-[1400ms] ease-out"
                style={{
                  width: inView ? '4.2%' : '0%',
                  background: '#9CA3AF',
                  transitionDelay: '300ms',
                }}
                title="No detectados (zona estructural)"
              />
            </div>
            <div className="mt-1.5 flex justify-between text-11 font-mono tabular-nums">
              <span style={{ color: '#10B981' }}>≈ {captured.toFixed(1)} km² capturados</span>
              <span className="text-text-tertiary">≈ {missed.toFixed(1)} km² no detectados</span>
            </div>

            {/* KPIs secundarios con count-up */}
            <div className="mt-4 pt-3 border-t border-border-default grid grid-cols-3 gap-3">
              <SecondaryKpi
                label="Recall · píxel-exacto"
                value={`${pixelRecall.toFixed(1)}%`}
                note="Sin tolerancia espacial"
              />
              <SecondaryKpi label="AUC ROC" value={auc.toFixed(3)} note="Capacidad de ranking" />
              <SecondaryKpi label="F1 · operacional" value={f1.toFixed(3)} note="Threshold 0.160" />
            </div>
          </div>
        </div>
      </div>
      <p className="font-serif italic text-13 text-text-secondary mt-3 max-w-3xl leading-snug">
        Las dos siluetas de los mapas de arriba no son anecdóticas: el modelo había anticipado el{' '}
        <strong>95.8% de la geografía del evento real</strong> a tolerancia de manzana (100 m). El
        4.2% no detectado corresponde casi en su totalidad a píxeles aislados — artefactos de la
        rasterización del shapefile EMSR773 — no a errores estructurales del modelo. Detalle
        metodológico completo en el capítulo 5 de la memoria.
      </p>
    </section>
  );
}

// ─── Phase item con reveal individual al entrar viewport ──────────
function PhaseItem({ phase, idx }) {
  const [ref, inView] = useInView({ threshold: 0.4 });
  const Icon = phase.icon;
  const heavy = phase.weight === 'heavy';
  return (
    <li
      ref={ref}
      className="relative transition-all duration-700 ease-out"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(12px)',
      }}
    >
      {/* Dot + icon — borderWidth doble cuando weight='heavy' marca el clímax */}
      <span
        className="absolute -left-[34px] sm:-left-[42px] top-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-surface transition-transform duration-200 ease-out"
        style={{
          border: `${heavy ? 3 : 2}px solid ${phase.accent}`,
          boxShadow: heavy
            ? `0 0 0 4px rgba(231, 76, 60, 0.10)` // halo rojo para la fase DANA
            : 'none',
          transform: inView ? 'scale(1)' : 'scale(0.6)',
          transitionDelay: '150ms',
        }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: phase.accent }} strokeWidth={2} />
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
      <h3
        className={`font-serif text-text-primary tracking-tight leading-tight mb-2 ${
          heavy ? 'text-20 sm:text-22' : 'text-18 sm:text-20'
        }`}
      >
        {phase.title}
      </h3>
      <p className="text-13 text-text-secondary leading-relaxed max-w-3xl">{phase.body}</p>
    </li>
  );
}

// ─── KPI secundario para la sección de recall ───────────────────
function SecondaryKpi({ label, value, note }) {
  return (
    <div className="min-w-0">
      <div className="text-10 font-mono uppercase tracking-wider text-text-tertiary mb-0.5 truncate">
        {label}
      </div>
      <div className="font-mono font-medium tabular-nums text-13 text-text-primary">{value}</div>
      {note && (
        <div className="text-10 text-text-tertiary font-serif italic mt-0.5 truncate">{note}</div>
      )}
    </div>
  );
}
