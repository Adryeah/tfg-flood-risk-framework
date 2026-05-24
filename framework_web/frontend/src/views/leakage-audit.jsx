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

export function LeakageAudit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.methodology
      .getLeakageAudit()
      .then((d) => {
        if (!mounted) return;
        setData(d);
      })
      .catch((err) => console.error('Leakage audit load failed', err))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
      </div>
    );
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
      label: 'Phase 1',
      title: 'The suspicious result',
      status: 'warning',
      content: (
        <p>
          {`XGBoost v3 with 24 features reported AUC 0.966 ± 0.011, a jump of +0.044 over Random Forest v2. In a remote sensing problem with correctly validated spatial cross-validation, such improvements are rare unless explained by (a) fundamentally different architecture, (b) qualitatively new features, or (c) leakage.`}
        </p>
      ),
    },
    {
      label: 'Phase 2',
      title: 'Audit design · 4 tests, stop-on-fail',
      status: null,
      content: (
        <p>
          {`Four sequential tests with a stopping rule: if any test fails, halt and reject the model. Test 1: urban_mask as leakage proxy. Test 2: temporal leakage in seasonal features. Test 3: validation of spatial CV identical to RF v2. Test 4: transferability to Algemesí.`}
        </p>
      ),
    },
    {
      label: 'Phase 3',
      title: 'Test 1 PASS · Test 2 FAIL',
      status: 'fail',
      content: (
        <p>
          {`Test 1: AUC with vs without urban_mask identical (ΔAUC = -0.0004). Not leakage. Test 2: bug located in ${bugLocation}. The path-based filter "${bugPattern}" failed to exclude October 2024 event scenes from winter feature aggregation. winter_min_sigma0_vv max abs diff vs the clean version: 16.34 dB.`}
        </p>
      ),
    },
    {
      label: 'Phase 4',
      title: 'Decision · XGBoost v3 rejected',
      status: 'fail',
      content: (
        <p>
          {`Per the stopping rule, XGBoost v3 was discarded. models/xgboost_v3_DEPRECATED.joblib preserved for traceability but excluded from the pipeline. Final model: Random Forest v2 — 14 features, no temporal leakage possible by construction. Documented in scripts/models/README_leakage_finding.md.`}
        </p>
      ),
    },
  ];

  return (
    <div className="max-w-[1120px] mx-auto px-6 pt-6 pb-12 space-y-8">
      {/* ─── CASE FILE HEADER ─────────────────────────────────────
       *  Forensic framing: case id + title + status of the page itself
       *  as an audit artefact. No icon-heavy chrome here; that work is
       *  carried by the verdict block immediately below.
       * ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border-default pb-6">
        <div className="flex items-center gap-3 text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary mb-3">
          <FileSearch className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Case file</span>
          <span className="text-border-strong">·</span>
          <span className="text-text-secondary tabular-nums">{CASE_ID}</span>
          <span className="text-border-strong">·</span>
          <span>{CASE_FRAMEWORK}</span>
        </div>
        <h1 className="text-24 font-semibold text-text-primary tracking-tight">
          Leakage Audit
        </h1>
        <p className="text-13 text-text-secondary mt-1.5 max-w-[68ch]">
          Temporal leakage detection in XGBoost v3 exploratory iteration ·
          Methodological contribution
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
        aria-label="Audit verdict"
        className="grid grid-cols-[auto_1fr_auto] gap-6 items-start bg-risk-high-bg border border-risk-high/25 rounded-md px-6 py-5"
      >
        <Ban
          className="w-9 h-9 text-risk-high mt-1"
          strokeWidth={1.5}
        />
        <div className="min-w-0">
          <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-risk-high/80 mb-1">
            Verdict
          </div>
          <div className="text-20 font-semibold text-risk-high tracking-tight">
            Rejected
          </div>
          <p className="text-13 text-text-secondary leading-relaxed mt-2 max-w-[60ch]">
            {`An exploratory XGBoost iteration reported AUC ${AUC_SUSPECTED.toFixed(3)}, a +${AUC_DELTA.toFixed(3)} jump over the Random Forest v2 baseline. The 4-test audit halted at Test 2: temporal leakage confirmed. Per the stop-on-fail rule, the model was removed from the pipeline.`}
          </p>
        </div>
        <dl className="hidden md:grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-11 font-mono">
          <dt className="text-text-tertiary uppercase tracking-wider">
            Decided by
          </dt>
          <dd className="text-text-primary text-right">Test 2 fail</dd>
          <dt className="text-text-tertiary uppercase tracking-wider">
            Stopping rule
          </dt>
          <dd className="text-text-primary text-right">Stop-on-fail</dd>
          <dt className="text-text-tertiary uppercase tracking-wider">
            Artefact
          </dt>
          <dd className="text-text-primary text-right">
            xgboost_v3_DEPRECATED
          </dd>
        </dl>
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
            <span>Evidence A</span>
            <span className="text-border-strong">·</span>
            <span>Reported vs verifiable AUC</span>
          </div>
          <CardTitle className="text-14">
            The +0.044 jump that prompted the audit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-center py-2">
            {/* Suspected */}
            <div className="text-center md:text-right">
              <div className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary mb-1">
                Suspected
              </div>
              <div className="text-11 text-text-secondary mb-3">
                XGBoost v3 · 24 features
              </div>
              <div
                className="font-mono font-semibold tabular-nums text-risk-high inline-flex items-baseline"
                style={{ fontSize: '40px', lineHeight: 1 }}
              >
                <span className="line-through decoration-2 decoration-risk-high/60">
                  {AUC_SUSPECTED.toFixed(3)}
                </span>
              </div>
              <div className="mt-3 text-11 text-text-secondary max-w-[28ch] mx-auto md:ml-auto md:mr-0 leading-relaxed">
                Inflated by event-date scenes leaking into winter aggregates
              </div>
            </div>

            {/* Delta + verdict pivot */}
            <div className="flex md:flex-col items-center gap-2 md:gap-3 py-2">
              <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                Δ AUC
              </div>
              <div className="font-mono font-semibold tabular-nums text-risk-high text-16">
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
                Verified
              </div>
              <div className="text-11 text-text-secondary mb-3">
                Random Forest v2 · 14 features
              </div>
              <div
                className="font-mono font-semibold tabular-nums text-risk-low inline-flex items-baseline gap-2"
                style={{ fontSize: '40px', lineHeight: 1 }}
              >
                {AUC_VERIFIED.toFixed(3)}
                <ShieldCheck
                  className="w-5 h-5 text-risk-low self-center"
                  strokeWidth={1.75}
                />
              </div>
              <div className="mt-3 text-11 text-text-secondary max-w-[28ch] mx-auto md:mr-auto md:ml-0 leading-relaxed">
                Static DEM + baseline-period aggregates only; no temporal
                leakage by construction
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border-default text-12 text-text-secondary leading-relaxed">
            <span className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary mr-2">
              Auditor's note:
            </span>
            A +0.044 AUC step between two correctly cross-validated models, with
            no qualitatively new feature family added, is the canonical signal
            of leakage in remote-sensing classification. Audit was triggered on
            that prior alone.
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
        <SectionLabel index="01" eyebrow="Methodology">
          Four-phase audit · stop-on-fail rule
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
        <SectionLabel index="02" eyebrow="Exhibit A">
          The bug · path-based filter
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
                className="w-4 h-4 text-risk-high mt-0.5 shrink-0"
                strokeWidth={1.75}
              />
              <p>
                {`October 2024 event scenes (S1_sigma0_20241019.tif and S1_sigma0_20241031.tif) were located directly in data/sentinel1/processed/, not in processed/event/. The path filter missed them. October falls inside the winter aggregation window in the seasonal logic, so both scenes leaked into the winter feature stack alongside the 12 baseline winter scenes.`}
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
        <SectionLabel index="03" eyebrow="Exhibit B">
          Contamination magnitude · winter feature stack
        </SectionLabel>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-12">
              Differences between leaked and re-derived clean features. Values in
              dB unless stated otherwise.
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
        <SectionLabel index="04" eyebrow="Regulatory anchor">
          Why this is a production control, not a thesis exercise
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
                  Directive 2009/138/EC · Internal Model Validation
                </div>
                <p className="text-12 text-text-secondary leading-relaxed">
                  {`Insurers using internal models for capital adequacy must demonstrate that those models pass rigorous validation and backtesting. A model that reports a +0.044 AUC jump without methodological explanation would fail validation. This audit is the documented backtesting that justifies the Random Forest v2 choice.`}
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
                  Regulation 2024/1689 · Annex III §5
                </div>
                <p className="text-12 text-text-secondary leading-relaxed">
                  {`AI systems used for insurance risk scoring are classified high-risk. Providers must keep technical documentation, an audit trail of model decisions, and evidence of human oversight. This page is the audit log: hypothesis, tests run, outcome, and why the suspect model was rejected.`}
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
          Always filter time series by date, not by path. Path-based filters
          depend on directory organisation, which is fragile; date-based filters
          are explicit about temporal intent.
        </p>
        <p className="text-12 text-text-secondary leading-relaxed mt-3">
          Significant metric improvements without an underlying methodological
          change deserve scrutiny. The final TFG model (Random Forest v2) is
          robust by construction: features are static DEM, baseline-period SAR
          aggregates, and baseline NDVI. No temporal leakage is possible.
        </p>
        <div className="mt-3 flex items-center gap-2 text-10 font-mono uppercase tracking-[0.12em] text-text-tertiary">
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
          <span>Methodological appendix · TFG memoria, Ch. 7</span>
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
        No diff data available.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-12">
        <thead>
          <tr className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-[0.12em]">
            <th className="text-left py-2 px-3 font-medium">Feature</th>
            <th className="text-right py-2 px-3 font-medium">
              Median diff · flooded
            </th>
            <th className="text-right py-2 px-3 font-medium">
              Median diff · not-flooded
            </th>
            <th className="text-right py-2 px-3 font-medium">Max abs diff</th>
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
                        className="w-3.5 h-3.5 text-risk-high shrink-0"
                        strokeWidth={2}
                      />
                    )}
                    <span
                      className={
                        isCritical
                          ? 'font-semibold text-risk-high'
                          : 'text-text-primary'
                      }
                    >
                      {row.feature}
                    </span>
                    {isCritical && (
                      <Badge className="ml-1 text-10 font-mono bg-risk-high text-white hover:bg-risk-high">
                        smoking gun
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
                          ? 'text-risk-high font-semibold'
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
