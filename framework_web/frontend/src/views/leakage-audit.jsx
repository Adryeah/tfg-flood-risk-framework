import React, { useState, useEffect } from 'react';
import {
  Loader2,
  AlertTriangle,
  Code2,
  BookOpen,
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
import { Scale, Landmark } from 'lucide-react';
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
      title: 'Audit design — 4 tests, stop-on-fail',
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
      title: 'Decision — XGBoost v3 rejected',
      status: 'fail',
      content: (
        <p>
          {`Per the stopping rule, XGBoost v3 was discarded. models/xgboost_v3_DEPRECATED.joblib preserved for traceability but excluded from the pipeline. Final model: Random Forest v2 — 14 features, no temporal leakage possible by construction. Documented in scripts/models/README_leakage_finding.md.`}
        </p>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4 max-w-[1024px] mx-auto">
      {/* HEADER */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-24 font-semibold text-text-primary tracking-tight">
              Leakage Audit
            </h1>
            <Badge className="bg-risk-high-bg text-risk-high hover:bg-risk-high-bg text-10 font-mono uppercase tracking-wider">
              Case study
            </Badge>
            <Badge
              variant="outline"
              className="text-10 font-mono uppercase tracking-wider"
            >
              Solvency II · model validation
            </Badge>
            <Badge
              variant="outline"
              className="text-10 font-mono uppercase tracking-wider"
            >
              EU AI Act · audit log
            </Badge>
          </div>
          <p className="text-13 text-text-secondary">
            Temporal leakage detection in XGBoost v3 exploratory iteration ·
            Methodological contribution
          </p>
        </div>
      </div>

      {/* HYPOTHESIS BANNER */}
      <Card className="border-l-4 border-l-risk-medium bg-risk-medium-bg/30">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-risk-medium flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-13 font-semibold text-text-primary mb-1">
                Too good to be true?
              </div>
              <p className="text-12 text-text-secondary leading-relaxed">
                {`An exploratory XGBoost iteration reported AUC ${AUC_SUSPECTED.toFixed(3)} vs Random Forest v2's ${AUC_VERIFIED.toFixed(3)}. Before accepting it as the final model, we ran a formal 4-test audit. Test 2 failed and the model was discarded. This audit is documented as a methodological case study.`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI TILES: SUSPECTED vs VERIFIED */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-risk-high-bg border border-risk-high/30 rounded-md p-4">
          <div className="text-10 font-mono font-semibold text-risk-high uppercase tracking-wider mb-1">
            Suspected (XGBoost v3)
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-24 font-mono font-semibold text-risk-high tabular-nums">
              {AUC_SUSPECTED.toFixed(3)}
            </span>
            <span className="text-11 text-risk-high/70 font-mono">
              discarded
            </span>
          </div>
          <div className="text-11 text-text-secondary mt-1.5">
            contaminated by event scenes
          </div>
        </div>

        <div className="bg-risk-low-bg border border-risk-low/30 rounded-md p-4">
          <div className="text-10 font-mono font-semibold text-risk-low uppercase tracking-wider mb-1">
            Verified (Random Forest v2)
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-24 font-mono font-semibold text-risk-low tabular-nums">
              {AUC_VERIFIED.toFixed(3)}
            </span>
            <span className="text-11 text-risk-low/70 font-mono">
              final model
            </span>
          </div>
          <div className="text-11 text-text-secondary mt-1.5">
            no leakage by construction
          </div>
        </div>
      </div>

      {/* TIMELINE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-14">Audit Timeline</CardTitle>
          <CardDescription className="text-12">
            Four-phase systematic methodology with stop-on-fail rule
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Timeline phases={phases} />
        </CardContent>
      </Card>

      {/* CODE: THE BUG */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-14 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-text-secondary" strokeWidth={1.75} />
            The bug
          </CardTitle>
          <CardDescription className="text-12">
            Path-based filter failed to exclude event date scenes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            code={bugCode}
            caption={bugLocation}
            badge="critical"
          />
          <div className="text-12 text-text-secondary mt-3 leading-relaxed">
            {`October 2024 event scenes (S1_sigma0_20241019.tif and S1_sigma0_20241031.tif) were located directly in data/sentinel1/processed/, not in processed/event/. The path filter missed them. Since October counts as a winter month in the seasonal logic, both scenes leaked into the winter feature stack alongside the 12 baseline winter scenes.`}
          </div>
        </CardContent>
      </Card>

      {/* WINTER FEATURES DIFF TABLE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-14">Winter Features Diff</CardTitle>
          <CardDescription className="text-12">
            Magnitude of leakage measured by regenerating clean features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WinterDiffTable rows={augmentedRows} />
        </CardContent>
      </Card>

      {/* REGULATORY FRAMING — why this audit matters beyond the thesis.
       *  Two-column grid: Solvency II (model validation requirement) and
       *  EU AI Act (audit log + traceability requirement). Frames the
       *  audit as a production-grade governance control, not academic
       *  curiosity. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-14">Regulatory framing</CardTitle>
          <CardDescription className="text-12">
            Why a leakage audit is a production-grade control, not just a
            thesis exercise
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-border-default rounded p-3 bg-bg-subtle/30">
              <div className="flex items-center gap-2 mb-1.5">
                <Landmark
                  className="w-4 h-4 text-brand-700"
                  strokeWidth={1.75}
                />
                <span className="text-12 font-semibold text-text-primary">
                  Solvency II
                </span>
                <span className="text-10 font-mono uppercase tracking-wider text-text-tertiary">
                  Directive 2009/138/EC
                </span>
              </div>
              <p className="text-11 text-text-secondary leading-relaxed">
                {`Insurers using internal models for capital adequacy must demonstrate that those models pass rigorous validation and backtesting. A model that reports a +0.044 AUC jump without methodological explanation would fail validation. This audit is the documented backtesting that justifies the Random Forest v2 choice.`}
              </p>
            </div>
            <div className="border border-border-default rounded p-3 bg-bg-subtle/30">
              <div className="flex items-center gap-2 mb-1.5">
                <Scale
                  className="w-4 h-4 text-brand-700"
                  strokeWidth={1.75}
                />
                <span className="text-12 font-semibold text-text-primary">
                  EU AI Act
                </span>
                <span className="text-10 font-mono uppercase tracking-wider text-text-tertiary">
                  Regulation 2024/1689 · Annex III §5
                </span>
              </div>
              <p className="text-11 text-text-secondary leading-relaxed">
                {`AI systems used for insurance risk scoring are classified high-risk. Providers must keep technical documentation, an audit trail of model decisions, and evidence of human oversight. This page is the audit log: hypothesis, tests run, outcome, and why the suspect model was rejected.`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LESSON LEARNED */}
      <Card className="border-l-4 border-l-brand-500">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <BookOpen className="w-5 h-5 text-brand-700 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-13 font-semibold text-text-primary mb-1">
                Lesson learned
              </div>
              <p className="text-12 text-text-secondary leading-relaxed">
                {`Always filter time series by date, not by path. Path-based filters depend on directory organisation, which is fragile. Date-based filters are explicit about temporal intent. This audit demonstrates that rigorous validation is not optional — significant metric improvements without an underlying methodological change deserve scrutiny. The final TFG model (Random Forest v2) is robust by construction: features are static DEM, baseline-period SAR aggregates, and baseline NDVI. No temporal leakage is possible.`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SOURCES — Evidently AI (audit pattern) + the two regulatory
       *  references (Solvency II + EU AI Act). Makes the legitimacy
       *  chain explicit at the bottom of the page. */}
      <MethodologySources items={SOURCES} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Winter diff table — critical row is row-tinted + badge-tagged so
// the reader's eye lands on `winter_min_sigma0_vv` (16.34 dB) without
// having to scan all the numbers.
// ────────────────────────────────────────────────────────────────
function WinterDiffTable({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-12 text-text-tertiary italic">
        No diff data available.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-12">
        <thead>
          <tr className="border-b border-border-default text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
            <th className="text-left py-2 px-2">Feature</th>
            <th className="text-right py-2 px-2">Median diff · flooded</th>
            <th className="text-right py-2 px-2">Median diff · not-flooded</th>
            <th className="text-right py-2 px-2">Max abs diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className={
                'border-b border-border-default ' +
                (row.critical ? 'bg-risk-high-bg/50' : '')
              }
            >
              <td className="py-2 px-2 font-mono text-text-primary">
                {row.feature}
                {row.critical && (
                  <Badge className="ml-2 text-10 font-mono bg-risk-high-bg text-risk-high hover:bg-risk-high-bg">
                    critical
                  </Badge>
                )}
              </td>
              <td className="py-2 px-2 text-right font-mono text-text-primary tabular-nums">
                {fmtDiff(row.median_diff_flooded)} {row.unit || 'dB'}
              </td>
              <td className="py-2 px-2 text-right font-mono text-text-primary tabular-nums">
                {fmtDiff(row.median_diff_notflooded)} {row.unit || 'dB'}
              </td>
              <td
                className={
                  'py-2 px-2 text-right font-mono tabular-nums ' +
                  (row.critical
                    ? 'text-risk-high font-bold'
                    : 'text-text-primary font-medium')
                }
              >
                {Number(row.max_abs_diff).toFixed(2)} {row.unit || 'dB'}
              </td>
            </tr>
          ))}
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
