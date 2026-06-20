import React, { useState, useEffect } from 'react';
import {
  Loader2,
  AlertTriangle,
  Code2,
  BookOpen,
  Scale,
  Landmark,
  Ban,
  ShieldCheck,
  ArrowRight,
  Quote,
  FileSearch,
  CircleAlert,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import CodeBlock from '@/components/code-block';
import Timeline from '@/components/timeline';
import { MethodologySources } from '@/components/methodology-sources';
import { LoadErrorState } from '@/components/load-error-state.jsx';
import { api } from '@/lib/api.js';

// Regulatory + governance references that legitimise this audit page
// as a production-grade control, not just a thesis chapter. Solvency II
// requires internal-model validation; the EU AI Act adds documentation
// + traceability requirements for high-risk AI systems (insurance risk
// scoring is explicitly classified high-risk in Annex III).
const SOURCES = [
  {
    author: 'Evidently AI',
    year: '2024',
    work: 'Open-source ML observability · "Too good to be true" audit patterns.',
    used_for:
      'Reference for the "suspect → 4-test audit → stop-on-fail" workflow shape.',
  },
  {
    author: 'EIOPA',
    year: '2009 / 2015',
    work:
      'Directive 2009/138/EC (Solvency II) — Internal Model Validation requirements.',
    used_for:
      'Model validation + backtesting obligations for insurance risk models.',
  },
  {
    author: 'European Commission',
    year: '2024',
    work:
      'Regulation (EU) 2024/1689 — Artificial Intelligence Act, Annex III §5.',
    used_for:
      'High-risk classification of AI used for insurance risk pricing; documentation, traceability and human oversight requirements.',
  },
];

// AUC numbers documented in the memoria. Frozen at the source so the
// hypothesis banner is reproducible even if the backend later drops
// these specific scalars.
const AUC_SUSPECTED = 0.966;
const AUC_VERIFIED = 0.922;
const AUC_DELTA = AUC_SUSPECTED - AUC_VERIFIED;

// Case identifier: makes the page legible at a glance as an audit
// artefact (Solvency II / EU AI Act vocabulary) rather than a chart
// among charts. Stable string, no live state.
const CASE_ID = 'LK-2024-001';
const CASE_FRAMEWORK = 'Solvency II · EU AI Act';

// Linaje completo de modelos del framework — trazabilidad de gobernanza
// (qué se entrenó, qué se descartó y por qué). El XGBoost v3 es el que
// disparó esta auditoría; v3-T es el modelo final transferible.
const MODEL_LINEAGE = [
  {
    model: 'RF v1', feats: 11, auc: '0.853', state: 'superseded', verdict: 'línea base',
    note: 'Línea base: 6 SAR temporales + 4 DEM + NDVI. Valida el pipeline completo y la CV espacial. Superado por v2 al añadir features hidrogeomorfológicas (HAND, TWI).',
  },
  {
    model: 'RF v2', feats: 14, auc: '0.922', state: 'superseded', verdict: 'no transfiere',
    note: 'Añade HAND/TWI/distance_to_coast (14 feat). El MEJOR mapa local de Valencia, pero al extrapolar a Algemesí el recall caía a 0 — la decisión no transfería (H3 refutada): distance_to_coast y elevation son spatial proxies que no generalizan a otra cuenca.',
  },
  {
    model: 'XGBoost v3', feats: 24, auc: '0.966', state: 'rejected', verdict: 'descartado',
    note: 'Iteración exploratoria con AUC 0.966 — sospechosamente alto. La auditoría de esta página detectó FUGA TEMPORAL: las features estacionales incluían escenas del propio evento DANA. Descartado por la regla de parada (falló el Test 2).',
  },
  {
    model: 'RF v3-T', feats: 9, auc: '0.840', state: 'final', verdict: 'final',
    note: 'Modelo FINAL. Features elegidas por ablación Leave-One-Zone-Out (quita las 5 no transferibles, incl. distance_to_coast/elevation), calibración isotónica y envoltura AOA. Único que transfiere la DECISIÓN a zona nueva: recall extrapolado 0 → 0.63 (0.92 con buffer 100 m).',
  },
];

const LINEAGE_STYLE = {
  superseded: { color: 'var(--text-tertiary)', label: 'SUPERADO' },
  rejected: { color: 'var(--accent-risk-text)', label: 'DESCARTADO' },
  final: { color: 'var(--accent-valid-text)', label: 'FINAL' },
};

export function LeakageAudit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.methodology
      .getLeakageAudit()
      .then((d) => {
        if (!mounted) return;
        setData(d);
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError(err?.message || 'No se pudo cargar la auditoría de fugas');
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (loadError || !data) {
    return <LoadErrorState message={loadError} />;
  }

  const bugLocation =
    data.code_references?.bug_location ||
    'scripts/features/extract_advanced_features_v3.py:162';
  const bugPattern =
    data.code_references?.bug_pattern || 'if "event" not in p.parts';
  const fixPattern =
    data.code_references?.fix_pattern ||
    'EVENT_DATES = {"20241019", "20241031"}; if _date_from_name(p) not in EVENT_DATES';

  // Render the buggy line + the corrective pattern as a single code
  // block so the reader sees the bug and the fix without flipping
  // between cards. The shape mirrors a typical Git diff "before/after".
  const bugCode =
    `# ${bugLocation}\n` +
    `for p in processed_dir.rglob("*.tif"):\n` +
    `    ${bugPattern}:           # ← BUG: filters by SUBDIRECTORY, not by date\n` +
    `        scenes.append(p)\n` +
    `\n` +
    `# Correct pattern (Random Forest v2 baseline):\n` +
    `${fixPattern}`;

  const winterRows = data.tables?.winter_features_diff || [];
  // The bug's smoking gun: a feature whose max diff vs the clean version
  // exceeds 10 dB. Marked critical client-side so the badge stays
  // consistent if more rows are added upstream.
  const augmentedRows = winterRows.map((r) => ({
    ...r,
    critical: r.max_abs_diff > 10,
  }));
  const maxDiff = augmentedRows.reduce(
    (m, r) => Math.max(m, Math.abs(Number(r.max_abs_diff) || 0)),
    0
  ) || 1;

  // Timeline phases — each `content` is wrapped in a single <p> with a
  // plain text body so the i18n DOM walker can match it as one text
  // node. Code identifiers (bug paths, feature names) appear verbatim
  // in the text and are not styled — clarity over typographic flair
  // makes translation viable.
  const phases = [
    {
      label: 'Fase1',
      title: 'El resultado sospechoso',
      status: 'warning',
      content: (
        <p>
          {`XGBoost v3 con 24 features reportó AUC 0.966 ± 0.011, un salto de +0.044 sobre Random Forest v2. En un problema de teledetección con validación cruzada espacial correctamente validada, tales mejoras son raras salvo que se expliquen por (a) arquitectura fundamentalmente distinta, (b) features cualitativamente nuevas, o (c) fuga.`}
        </p>
      ),
    },
    {
      label: 'Fase2',
      title: 'Diseño de auditoría · 4 tests, parar-al-fallar',
      status: null,
      content: (
        <p>
          {`Cuatro tests secuenciales con regla de parada: si algún test falla, detener y rechazar el modelo. Test 1: urban_mask como proxy de fuga. Test 2: fuga temporal en features estacionales. Test 3: validación de la CV espacial idéntica a RF v2. Test 4: transferibilidad a Algemesí.`}
        </p>
      ),
    },
    {
      label: 'Fase3',
      title: 'Test 1 OK · Test 2 FALLO',
      status: 'fail',
      content: (
        <p>
          {`Test 1: AUC con vs sin urban_mask idéntico (ΔAUC = -0.0004). No es fuga. Test 2: bug localizado en ${bugLocation}. El filtro por ruta «${bugPattern}» no excluyó las escenas del evento de octubre 2024 de la agregación de features de invierno. winter_min_sigma0_vv máx. dif. abs. vs la versión limpia: 16.34 dB.`}
        </p>
      ),
    },
    {
      label: 'Fase4',
      title: 'Decisión · XGBoost v3 rechazado',
      status: 'fail',
      content: (
        <p>
          {`Según la regla de parada, XGBoost v3 fue descartado. models/xgboost_v3_DEPRECATED.joblib se conserva para trazabilidad pero excluido del pipeline. El modelo elegido entonces fue el Random Forest v2 (14 features, sin fuga temporal posible por construcción) — después refinado al modelo transferible final RF v3-T (9 features; ver "Linaje de modelos" arriba). Documentado en scripts/models/README_leakage_finding.md.`}
        </p>
      ),
    },
  ];

  return (
    <div className="max-w-[1120px] mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-10 sm:pb-12 space-y-6 sm:space-y-8">
      {/* ─── CASE FILE HEADER ─────────────────────────────────────
       *  Forensic framing: case id + title + status of the page itself
       *  as an audit artefact. No icon-heavy chrome here; that work is
       *  carried by the verdict block immediately below.
       * ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border-default pb-6">
        <div className="flex items-center gap-3 text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary mb-3">
          <FileSearch className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Expediente</span>
          <span className="text-border-strong">·</span>
          <span className="text-text-secondary tabular-nums">{CASE_ID}</span>
          <span className="text-border-strong">·</span>
          <span>{CASE_FRAMEWORK}</span>
        </div>
        <h1 className="text-24 font-semibold text-text-primary tracking-tight">
          Auditoría de fuga
        </h1>
        <p className="text-13 text-text-secondary mt-1.5 max-w-[68ch]">
          Detección de fuga temporal en la iteración exploratoria XGBoost v3 ·
          Contribución metodológica
        </p>
      </header>

      {/* ─── VERDICT ──────────────────────────────────────────────
       *  Tinted background (risk-high-bg) with strong red text. NOT
       *  a side-stripe card. Big Ban icon as the dominant visual.
       *  Right rail: case meta (closed date, audit type, decision).
       *  Asymmetric grid (icon | prose | meta) so it does not read
       *  as a generic alert.
       * ─────────────────────────────────────────────────────────── */}
      <section
        aria-label="Veredicto de auditoría"
        className="grid grid-cols-[auto_1fr_auto] gap-6 items-start bg-risk-high-bg border border-risk-high/25 rounded-md px-6 py-5"
      >
        <Ban
          className="w-9 h-9 text-risk-high-soft mt-1"
          strokeWidth={1.5}
        />
        <div className="min-w-0">
          <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-risk-high-soft/80 mb-1">
            Veredicto
          </div>
          <div className="text-20 font-semibold text-risk-high-soft tracking-tight">
            Rechazado
          </div>
          <p className="text-13 text-text-secondary leading-relaxed mt-2 max-w-[60ch]">
            {`Una iteración exploratoria de XGBoost reportó AUC ${AUC_SUSPECTED.toFixed(3)}, un salto de +${AUC_DELTA.toFixed(3)} sobre la baseline Random Forest v2. La auditoría de 4 tests se detuvo en el Test 2: fuga temporal confirmada. Según la regla de parar-al-fallar, el modelo se retiró del pipeline.`}
          </p>
        </div>
        <dl className="hidden md:grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-11 font-mono">
          <dt className="text-text-tertiary uppercase tracking-wider">
            Decidido por
          </dt>
          <dd className="text-text-primary text-right">Test 2 fallo</dd>
          <dt className="text-text-tertiary uppercase tracking-wider">
            Regla de parada
          </dt>
          <dd className="text-text-primary text-right">Parar-al-fallar</dd>
          <dt className="text-text-tertiary uppercase tracking-wider">
            Artefacto
          </dt>
          <dd className="text-text-primary text-right">
            xgboost_v3_DEPRECATED
          </dd>
        </dl>
      </section>

      {/* ─── MODEL LINEAGE · todos los modelos del framework ──────
       *  Trazabilidad de gobernanza completa: los cuatro modelos
       *  entrenados, su veredicto y el motivo. Convierte la auditoría
       *  (centrada en el XGBoost descartado) en la historia íntegra
       *  del modelo, incluida la consolidación del v3-T transferible.
       * ─────────────────────────────────────────────────────────── */}
      <section>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-10 font-mono font-semibold text-text-tertiary uppercase tracking-[0.14em] mb-1">
              <span>Linaje de modelos</span>
              <span className="text-border-strong">·</span>
              <span>trazabilidad de gobernanza</span>
            </div>
            <CardTitle className="text-14">
              Los cuatro modelos del framework — qué se probó, qué se descartó y por qué
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-12">
                <thead>
                  <tr className="text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary border-b border-border-default">
                    <th className="text-left font-semibold py-2 pr-3">Modelo</th>
                    <th className="text-right font-semibold py-2 px-3">Features</th>
                    <th className="text-right font-semibold py-2 px-3">AUC</th>
                    <th className="text-left font-semibold py-2 px-3">Veredicto</th>
                    <th className="text-left font-semibold py-2 pl-3">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_LINEAGE.map((m) => {
                    const st = LINEAGE_STYLE[m.state];
                    const isFinal = m.state === 'final';
                    return (
                      <tr
                        key={m.model}
                        className="border-b border-border-default/60 align-top"
                        style={isFinal ? { background: 'var(--accent-valid-bg, rgba(34,197,94,0.06))' } : undefined}
                      >
                        <td className="py-2.5 pr-3 font-mono font-semibold text-text-primary whitespace-nowrap">
                          {m.model}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-text-secondary">
                          {m.feats}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-text-secondary">
                          {m.auc}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className="text-10 font-mono font-semibold uppercase tracking-[0.1em]"
                            style={{ color: st.color }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-text-secondary leading-snug max-w-[42ch]">
                          {m.note}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-11 text-text-tertiary leading-snug max-w-[80ch]">
              <strong>Por qué el modelo final es el RF v3-T</strong> y no otro:
              el criterio del framework no es el AUC más alto (sería el XGBoost
              descartado, 0,966 — inflado por fuga temporal, ver auditoría
              abajo) ni el mejor mapa local (sería el v2, 0,922, pero su recall
              extrapolado era 0). Es la <strong>transferibilidad honesta</strong>:
              un modelo que generaliza a zonas nuevas (recall 0 → 0,63), está
              calibrado, sabe dónde es válido (AOA) y cuyas métricas no esconden
              fuga. El v3-T es el único que cumple las cuatro — por eso es el
              modelo final del TFG.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ─── EVIDENCE A · MODEL COMPARISON ────────────────────────
       *  Side-by-side AUC confrontation. Big tabular-num numbers,
       *  asymmetric treatment: suspected struck through + red, final
       *  in green with check. Centre column carries the delta and the
       *  REJECTED/FINAL state, with a directional arrow that reads
       *  left-to-right as "this number was the lie; this one is what
       *  the model can actually defend".
       *
       *  Wrapped in a single Card so it reads as one piece of evidence
       *  rather than two competing tiles. Visually, the grid is the
       *  star, not the chrome.
       * ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-10 font-mono font-semibold text-text-tertiary uppercase tracking-[0.14em] mb-1">
            <span>Evidencia A</span>
            <span className="text-border-strong">·</span>
            <span>AUC reportado vs verificable</span>
          </div>
          <CardTitle className="text-14">
            El salto de +0.044 que disparó la auditoría
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-center py-2">
            {/* Suspected */}
            <div className="text-center md:text-right">
              <div className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary mb-1">
                Sospechado
              </div>
              <div className="text-11 text-text-secondary mb-3">
                XGBoost v3 · 24 features
              </div>
              <div
                className="font-mono font-semibold tabular-nums text-risk-high-soft inline-flex items-baseline"
                style={{ fontSize: '40px', lineHeight: 1 }}
              >
                <span className="line-through decoration-2 decoration-risk-high/60">
                  {AUC_SUSPECTED.toFixed(3)}
                </span>
              </div>
              <div className="mt-3 text-11 text-text-secondary max-w-[28ch] mx-auto md:ml-auto md:mr-0 leading-relaxed">
                Inflado por escenas con fecha de evento filtradas a los agregados de invierno
              </div>
            </div>

            {/* Delta + verdict pivot */}
            <div className="flex md:flex-col items-center gap-2 md:gap-3 py-2">
              <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                Δ AUC
              </div>
              <div className="font-mono font-semibold tabular-nums text-risk-high-soft text-16">
                +{AUC_DELTA.toFixed(3)}
              </div>
              <ArrowRight
                className="w-5 h-5 text-text-tertiary hidden md:block"
                strokeWidth={1.75}
              />
              <div className="md:hidden flex items-center text-text-tertiary">
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>

            {/* Verified */}
            <div className="text-center md:text-left">
              <div className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary mb-1">
                Verificado
              </div>
              <div className="text-11 text-text-secondary mb-3">
                Random Forest v2 · 14 features
              </div>
              <div
                className="font-mono font-semibold tabular-nums text-risk-low-soft inline-flex items-baseline gap-2"
                style={{ fontSize: '40px', lineHeight: 1 }}
              >
                {AUC_VERIFIED.toFixed(3)}
                <ShieldCheck
                  className="w-5 h-5 text-risk-low-soft self-center"
                  strokeWidth={1.75}
                />
              </div>
              <div className="mt-3 text-11 text-text-secondary max-w-[28ch] mx-auto md:mr-auto md:ml-0 leading-relaxed">
                Solo DEM estático + agregados del periodo baseline; sin fuga
                temporal por construcción
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border-default text-12 text-text-secondary leading-relaxed">
            <span className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mr-2">
              Nota del auditor:
            </span>
            Un salto de +0.044 AUC entre dos modelos correctamente validados con
            CV, sin añadir ninguna familia de features cualitativamente nueva, es
            la señal canónica de fuga en clasificación de teledetección. La
            auditoría se disparó solo con ese indicio previo.
          </div>
        </CardContent>
      </Card>

      {/* ─── METHODOLOGY · TIMELINE ───────────────────────────────
       *  Strong section header (numbered prefix), then the Timeline
       *  component verbatim. The Timeline owns the visual narrative
       *  of the audit's four phases; we just give it institutional
       *  framing so it reads as procedure rather than a status feed.
       * ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel index="01" eyebrow="Metodología">
          Auditoría de cuatro fases · regla parar-al-fallar
        </SectionLabel>
        <Card>
          <CardContent className="pt-5">
            <Timeline phases={phases} />
          </CardContent>
        </Card>
      </section>

      {/* ─── EVIDENCE B · THE BUG ─────────────────────────────────
       *  The code block IS the evidence. We give it forensic chrome:
       *  a file:line breadcrumb in the card header (monospace, like a
       *  stack-trace line), an "Exhibit" eyebrow, and a forensic
       *  annotation below. CodeBlock signature is preserved.
       * ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel index="02" eyebrow="Prueba A">
          El bug · filtro por ruta
        </SectionLabel>
        <Card>
          <CardHeader className="pb-3 border-b border-border-default">
            <div className="flex items-center gap-2 min-w-0">
              <Code2
                className="w-4 h-4 text-text-tertiary shrink-0"
                strokeWidth={1.75}
              />
              <code className="text-11 font-mono text-text-secondary truncate">
                {bugLocation}
              </code>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <CodeBlock
              code={bugCode}
              caption={bugLocation}
              badge="critical"
            />
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 items-start text-12 text-text-secondary leading-relaxed pt-1">
              <CircleAlert
                className="w-4 h-4 text-risk-high-soft mt-0.5 shrink-0"
                strokeWidth={1.75}
              />
              <p>
                {`Las escenas del evento de octubre 2024 (S1_sigma0_20241019.tif y S1_sigma0_20241031.tif) estaban directamente en data/sentinel1/processed/, no en processed/event/. El filtro de ruta no las detectó. Octubre cae dentro de la ventana de agregación de invierno en la lógica estacional, así que ambas escenas se filtraron al stack de features de invierno junto a las 12 escenas baseline de invierno.`}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── EVIDENCE C · CONTAMINATION MAGNITUDE ─────────────────
       *  Custom-styled diff table with a magnitude bar in the rightmost
       *  column. The critical row carries a leading SMOKING GUN marker
       *  AND a deeper tinted background AND a bold colored bar — three
       *  reinforcing cues so the row reads at a glance even on quick
       *  scrolls. No side-stripe border (banned).
       * ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel index="03" eyebrow="Prueba B">
          Magnitud de contaminación · stack de features de invierno
        </SectionLabel>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-12">
              Diferencias entre las features filtradas y las limpias re-derivadas.
              Valores en dB salvo que se indique lo contrario.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WinterDiffTable rows={augmentedRows} maxDiff={maxDiff} />
          </CardContent>
        </Card>
      </section>

      {/* ─── REGULATORY FRAMING ───────────────────────────────────
       *  One bloc, two pillars. NOT a 2-card grid (banned shape:
       *  identical card grids). The pillars share chrome but differ
       *  internally: Solvency II leads with Landmark + directive id,
       *  EU AI Act leads with Scale + article id. A 1px vertical
       *  divider separates them on md+.
       * ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel index="04" eyebrow="Ancla regulatoria">
          Por qué es un control de producción, no un ejercicio de tesis
        </SectionLabel>
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-border-default">
              <div className="md:pr-6">
                <div className="flex items-center gap-2 mb-2">
                  <Landmark
                    className="w-4 h-4 text-corporate-navy"
                    strokeWidth={1.75}
                  />
                  <span className="text-12 font-semibold text-text-primary">
                    Solvency II
                  </span>
                </div>
                <div className="text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary mb-2">
                  Directiva 2009/138/CE · Validación de modelo interno
                </div>
                <p className="text-12 text-text-secondary leading-relaxed">
                  {`Las aseguradoras que usan modelos internos para adecuación de capital deben demostrar que esos modelos pasan validación y backtesting rigurosos. Un modelo que reporta un salto de +0.044 AUC sin explicación metodológica no pasaría la validación. Esta auditoría es el backtesting documentado que justifica la elección de Random Forest v2.`}
                </p>
              </div>
              <div className="md:pl-6 mt-6 md:mt-0 pt-6 md:pt-0 border-t md:border-t-0 border-border-default">
                <div className="flex items-center gap-2 mb-2">
                  <Scale
                    className="w-4 h-4 text-corporate-navy"
                    strokeWidth={1.75}
                  />
                  <span className="text-12 font-semibold text-text-primary">
                    EU AI Act
                  </span>
                </div>
                <div className="text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary mb-2">
                  Reglamento 2024/1689 · Anexo III §5
                </div>
                <p className="text-12 text-text-secondary leading-relaxed">
                  {`Los sistemas de IA usados para scoring de riesgo en seguros se clasifican como de alto riesgo. Los proveedores deben mantener documentación técnica, un registro de auditoría de las decisiones del modelo, y evidencia de supervisión humana. Esta página es ese registro: hipótesis, tests ejecutados, resultado, y por qué se rechazó el modelo sospechoso.`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── LESSON LEARNED · PULL QUOTE ──────────────────────────
       *  Not a banner with a side stripe (banned). A narrow centered
       *  pull-quote, prose-width, with a quote mark glyph as the only
       *  decoration. Closes the case file.
       * ─────────────────────────────────────────────────────────── */}
      <section className="max-w-[68ch] mx-auto pt-2">
        <Quote
          className="w-6 h-6 text-text-tertiary mb-3"
          strokeWidth={1.5}
        />
        <p className="text-14 text-text-primary leading-relaxed">
          Filtra siempre las series temporales por fecha, no por ruta. Los filtros
          por ruta dependen de la organización de directorios, que es frágil; los
          filtros por fecha son explícitos sobre la intención temporal.
        </p>
        <p className="text-12 text-text-secondary leading-relaxed mt-3">
          Las mejoras significativas de métricas sin un cambio metodológico
          subyacente merecen escrutinio. El modelo final del TFG (Random Forest v2)
          es robusto por construcción: sus features son DEM estático, agregados SAR
          del periodo baseline y NDVI baseline. No es posible fuga temporal.
        </p>
        <div className="mt-3 flex items-center gap-2 text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary">
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Apéndice metodológico · memoria TFG, cap. 7</span>
        </div>
      </section>

      <MethodologySources items={SOURCES} />
    </div>
  );
}

// ─── Section label — numbered eyebrow used between major blocks.
// Pattern: "01 · METHODOLOGY" (mono, tracked) above an h2 with the
// section title. Reads as a case-file table of contents without
// adding chrome (no card, no rule, no icon).
function SectionLabel({ index, eyebrow, children }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mb-1">
        <span className="tabular-nums text-text-secondary">{index}</span>
        <span className="text-border-strong">·</span>
        <span>{eyebrow}</span>
      </div>
      <h2 className="text-14 font-semibold text-text-primary tracking-tight">
        {children}
      </h2>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Winter diff table — three reinforcing cues on the critical row:
//   (1) leading SMOKING-GUN icon + chip in the Feature cell
//   (2) deeper tinted row background (risk-high-bg, not muted)
//   (3) magnitude bar in the rightmost cell, filled to (val / max)
//
// No side-stripe border — that pattern is banned by the design
// system. The triple cue does the same job better, and the table
// stays scannable for tribunals reading it cold.
// ────────────────────────────────────────────────────────────────
function WinterDiffTable({ rows, maxDiff }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-12 text-text-tertiary italic">
        Sin datos de diferencias.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-12">
        <thead>
          <tr className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-[0.12em]">
            <th className="text-left py-2 px-3 font-medium">Variable</th>
            <th className="text-right py-2 px-3 font-medium">
              Dif. mediana · inundado
            </th>
            <th className="text-right py-2 px-3 font-medium">
              Dif. mediana · no inundado
            </th>
            <th className="text-right py-2 px-3 font-medium">Máx. dif. abs.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isCritical = !!row.critical;
            const pct = Math.min(
              100,
              (Math.abs(Number(row.max_abs_diff) || 0) / maxDiff) * 100
            );
            return (
              <tr
                key={idx}
                className={
                  'border-t border-border-default ' +
                  (isCritical ? 'bg-risk-high-bg' : '')
                }
              >
                <td className="py-2.5 px-3 font-mono text-text-primary align-middle">
                  <div className="flex items-center gap-2">
                    {isCritical && (
                      <CircleAlert
                        className="w-3.5 h-3.5 text-risk-high-soft shrink-0"
                        strokeWidth={2}
                      />
                    )}
                    <span
                      className={
                        isCritical
                          ? 'font-semibold text-risk-high-soft'
                          : 'text-text-primary'
                      }
                    >
                      {row.feature}
                    </span>
                    {isCritical && (
                      <Badge className="ml-1 text-10 font-mono bg-risk-high text-white hover:bg-risk-high">
                        prueba clave
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-text-primary tabular-nums">
                  {fmtDiff(row.median_diff_flooded)} {row.unit || 'dB'}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-text-primary tabular-nums">
                  {fmtDiff(row.median_diff_notflooded)} {row.unit || 'dB'}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                  <div className="inline-flex items-center gap-2 justify-end w-full">
                    <div
                      className="hidden md:block h-1.5 rounded-full bg-bg-subtle relative overflow-hidden"
                      style={{ width: 90 }}
                      aria-hidden
                    >
                      <div
                        className={
                          'absolute inset-y-0 left-0 rounded-full ' +
                          (isCritical ? 'bg-risk-high' : 'bg-border-strong')
                        }
                        style={{ width: pct + '%' }}
                      />
                    </div>
                    <span
                      className={
                        isCritical
                          ? 'text-risk-high-soft font-semibold'
                          : 'text-text-primary font-medium'
                      }
                    >
                      {Number(row.max_abs_diff).toFixed(2)} {row.unit || 'dB'}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtDiff(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n === 0) return '0.000';
  return (n > 0 ? '+' : '') + n.toFixed(3);
}
