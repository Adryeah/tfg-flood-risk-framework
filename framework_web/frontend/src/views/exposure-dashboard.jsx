import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { Loader2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Map, MapClusterLayer, MapControls, useMap } from '@/components/Map.tsx';
import { ExposureKpi } from '@/components/exposure-kpi.jsx';
import { InfoHint } from '@/components/info-hint.jsx';
import { api } from '@/lib/api.js';
import { ZONES } from '@/lib/constants.js';
import { t, useLang } from '@/lib/i18n.js';
import {
  useReturnPeriod,
  scaleLoss,
  rpLabel,
  getLossMultiplier,
  getRPVisualFilter,
  SOURCE_NOTE,
} from '@/lib/return-period.js';
import {
  ReturnPeriodSelector,
  BackboneSourceSelector,
} from '@/components/return-period-selector.jsx';
import { SnczNoticeBar } from '@/components/sncz-notice.jsx';

const RISK_COLORS = {
  low: '#16A34A',
  moderate: '#D97706',
  high: '#DC2626',
  very_high: '#991B1B',
};

export function ExposureDashboard() {
  const [portfolios, setPortfolios] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1) Portfolio list
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.portfolio.getPredefined();
        if (!mounted) return;
        const list = res?.portfolios || [];
        setPortfolios(list);
        // Default to wide_distribution for demo consistency with the other
        // portfolio views (1000 clients, full product mix).
        const preferred =
          list.find((p) => p.id === 'wide_distribution') || list[0];
        if (preferred) setSelectedId(preferred.id);
      } catch (err) {
        console.error('Portfolios index failed', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 2) Load selected portfolio + exposure
  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const [p, e] = await Promise.all([
          api.portfolio.getById(selectedId),
          api.portfolio.getExposure(selectedId),
        ]);
        if (!mounted) return;
        setPortfolio(p);
        setExposure(e);
      } catch (err) {
        console.error('Exposure load failed', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  return (
    <div className="p-3 sm:p-5 space-y-3">
      {/* Header — stack vertical en mobile para que el selector de cartera
       *  no compita por ancho con el título cuando los nombres son largos
       *  ("Premium Residential Valencia", "Wide Distribution Mix"). */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-20 font-semibold text-text-primary tracking-tight">
              Exposure Dashboard
            </h1>
            <InfoHint side="bottom" size={14}>
              Vista agregada de una cartera concreta: 4 KPIs hero arriba
              (TIV · EAL · PML · pólizas afectadas) y 6 widgets debajo que
              cruzan la cartera con la superficie de riesgo del Random Forest
              v2. Pensado para un underwriter que necesita ver concentración,
              cola de pérdida y prioridades de revisión en una sola pantalla.
            </InfoHint>
            {portfolio && (
              <Badge
                variant="secondary"
                className="bg-brand-50 text-brand-700 hover:bg-brand-50 text-10 font-mono uppercase tracking-wider"
              >
                {portfolio.name}
              </Badge>
            )}
          </div>
          <p className="text-12 text-text-secondary">
            Aggregate risk metrics and loss projections for the selected portfolio
          </p>
        </div>

        <Select
          value={selectedId || ''}
          onValueChange={(v) => v && setSelectedId(v)}
        >
          <SelectTrigger className="w-full sm:w-[260px] h-8 text-12">
            <SelectValue placeholder="Select portfolio" />
          </SelectTrigger>
          <SelectContent>
            {portfolios.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-12">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading || !portfolio || !exposure ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
        </div>
      ) : (
        <>
          {/* Return Period selector + methodology note ─────────────────
           *  Encima de los Hero KPIs porque el RP define el escenario
           *  bajo el cual se leen las cifras. Sin él, los KPIs no
           *  tienen contexto regulatorio (Munich Re NATHAN / Swiss Re
           *  CatNet siempre cotizan por RP). El RP se persiste global
           *  en localStorage — si el user lo cambia aquí, también
           *  cambia en /tour. */}
          <ReturnPeriodScenarioBar />

          {/* Banner SNCZI · solo aparece cuando el operador ha
           *  activado el toggle 'snczi' Y el backend responde que la
           *  integración está pendiente. Mientras seguimos con RF v2
           *  como fallback. */}
          <SnczNoticeBar variant="inline" />

          {/* Hero KPI strip — True Flood Risk Map Intelligence Dashboard
           *  pattern: the top of the screen is dominated by the 4 numbers
           *  an underwriter checks first (TIV / EAL / PML / Affected). */}
          <HeroKpis portfolio={portfolio} exposure={exposure} />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Concentration map spans 2 columns — CARTO Portfolio
             *  Screening emphasises spatial accumulation as the primary
             *  visual; clustering reveals where the portfolio piles up. */}
            <Widget
              eyebrow="ESPACIAL · 01"
              register="context"
              title="Geographic concentration"
              subtitle="Dónde se agrupa la cartera sobre la superficie de riesgo del modelo."
              badge="clustered · 2 study areas"
              hint={
                <>
                  Burbujas agrupando las pólizas que caen en el mismo bloque
                  geográfico, superpuestas sobre la superficie de riesgo del
                  RF (tiles raster píxel-perfect). Un cluster grande sobre
                  zona roja = concentración de riesgo a vigilar (Solvencia II
                  pide diversificar la exposición espacial).
                </>
              }
              cite="CARTO Portfolio Screening pattern"
              className="lg:col-span-2 lg:row-span-2"
              annotation="Manchas rojas dominantes en l'Horta Sud · Catarroja · Paiporta. Lo que el modelo había marcado antes de la DANA coincide con lo que pasó."
            >
              <GeographicMap clients={portfolio.clients} />
            </Widget>

            <Widget
              eyebrow="DENSIDAD · 01"
              register="composition"
              title="Risk distribution"
              subtitle="Reparto de pólizas por bucket de riesgo del Random Forest."
              badge={`${portfolio.n_clients} policies`}
              hint={
                <>
                  Reparto de las pólizas por categoría de riesgo derivada de
                  la probabilidad del Random Forest: <b>low</b> (p&lt;0.25),
                  <b> moderate</b> (0.25–0.50), <b>high</b> (0.50–0.75) y
                  <b> very_high</b> (≥0.75). Cuanto más volumen en rojo,
                  mayor base esperada de siniestralidad anual.
                </>
              }
              annotation="Más volumen rojo = más siniestralidad anual esperada en cartera."
            >
              <RiskDonut distribution={exposure.distribution_by_category || {}} />
            </Widget>

            <Widget
              eyebrow="DENSIDAD · 02"
              register="mix"
              title="Exposure by product"
              subtitle="Capital asegurado por línea de negocio, sin aplicar probabilidad."
              badge="€ insured value"
              hint={
                <>
                  Suma del valor asegurado por producto (Particulares ·
                  Pymes · Autos). Permite ver cuánto capital está expuesto
                  por línea de negocio antes de aplicar probabilidad de
                  inundación — útil para underwriting de prima técnica
                  por ramo.
                </>
              }
              annotation="Particulares concentra el mayor TIV; PYMES segunda línea de exposición."
            >
              <ExposureByTypeChart clients={portfolio.clients} />
            </Widget>

            {/* Oasis LMF-inspired exceedance curve (OEP-like single-event
             *  approximation): for each policy, plot Σ losses ≥ x as x
             *  varies. The shape tells the underwriter what fraction of
             *  total loss concentrates in the worst tail. */}
            <Widget
              eyebrow="COLA · ESTILO OEP"
              register="tail"
              title="Loss exceedance curve"
              subtitle="Capital acumulado por encima de cada umbral de pérdida — donde vive el riesgo de cola."
              badge="Oasis OEP-style"
              hint={
                <>
                  Curva de excedencia tipo OEP (Occurrence Exceedance
                  Probability): para cada umbral de pérdida <i>L</i> en el
                  eje X, suma del € total de pólizas con pérdida estimada
                  ≥ <i>L</i>. Una caída brusca indica que pocas pólizas
                  concentran la mayor parte de la pérdida — la "cola del
                  portfolio" donde el capital está más vulnerable.
                </>
              }
              cite="Oasis LMF · single-event PML approximation"
              annotation="Caída pronunciada al inicio: unas pocas pólizas concentran la mayor parte de la pérdida potencial."
            >
              <LossExceedanceCurve clients={portfolio.clients} />
            </Widget>

            <Widget
              eyebrow="ATRIBUCIÓN · POR CATEGORÍA"
              register="attribution"
              title="Loss breakdown"
              subtitle="Descomposición de la PML del escenario DANA en sus 4 buckets."
              badge="DANA scenario"
              hint={
                <>
                  Descomposición de la pérdida esperada total por categoría
                  de riesgo en el escenario DANA single-event. Cada barra
                  agrega: Σ (valor_asegurado × P(flood) × damage_ratio)
                  para las pólizas de esa categoría. Identifica de un
                  vistazo qué bucket de riesgo aporta más € a la PML.
                </>
              }
              annotation="High + Very High aportan la mayor parte del DANA loss — candidatos prioritarios a re-tarificar."
            >
              <LossBreakdownChart clients={portfolio.clients} />
            </Widget>

            <Widget
              eyebrow="CONCENTRACIÓN · TOP 10"
              register="concentration"
              title="Top 10 highest risk"
              subtitle="Pólizas que cargan más € sobre el PML — los nombres del review pile."
              badge="sorted by est. loss"
              hint={
                <>
                  Las 10 pólizas con mayor pérdida estimada en escenario
                  DANA. Son los candidatos prioritarios para revisión
                  manual: re-tarificar, renegociar deductibles, exigir
                  medidas físicas (rejillas anti-retorno, planta no
                  habitable en cota inundable, garaje en alto) antes
                  de renovar.
                </>
              }
              annotation="Re-tarificar, renegociar deductibles o exigir medidas físicas antes de la próxima renovación."
            >
              <TopRiskClientsTable clients={portfolio.clients} />
            </Widget>
          </div>

          <MethodologyFooter />
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hero KPI strip — 4 large headline numbers above the widget grid.
// Mirrors the Portfolio Explorer KpiBar so the two views feel like
// one product. Variants drive the left-edge accent rail colour.
// ────────────────────────────────────────────────────────────────
function HeroKpis({ portfolio, exposure }) {
  // Suscribe a cambios de idioma para que los t() de abajo se
  // re-evalúen cuando el usuario hace toggle EN ⇄ ES.
  useLang();
  // RP global escala PML y EAL al escenario seleccionado.
  // baseline = T100 (DANA observada ≈ T75-100 por AEMET reanalysis).
  const [rp] = useReturnPeriod();
  const mult = getLossMultiplier(rp);
  const tiv = portfolio.total_insured_value || 0;
  const eal = (exposure.expected_total_loss || 0) * mult;
  const pml = (exposure.estimated_total_loss_dana || 0) * mult;
  const totalCount = portfolio.n_clients || portfolio.clients?.length || 0;
  const highCount =
    (exposure.distribution_by_category?.high || 0) +
    (exposure.distribution_by_category?.very_high || 0);
  const vaR = exposure.value_at_risk || 0;
  const highValue = useMemo(() => {
    return (portfolio.clients || []).reduce(
      (sum, c) =>
        c.risk_category === 'high' || c.risk_category === 'very_high'
          ? sum + (c.insured_value || 0)
          : sum,
      0
    );
  }, [portfolio]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
      <ExposureKpi
        tier={1}
        label="Total insured value"
        numeric={tiv / 1e6}
        format={(v) => `€${v.toFixed(1)}`}
        unit="M"
        sub={`${totalCount.toLocaleString()} ${t('policies in scope')}`}
        variant="info"
        objective="Contexto — capital total bajo análisis."
        animationDelay={0}
      />
      <ExposureKpi
        tier={2}
        label={`EAL · ${rpLabel(rp)}`}
        numeric={eal / 1000}
        format={(v) => `€${v.toFixed(0)}`}
        unit="K"
        sub={`${t('Probability-weighted')} · escalado AEP a ${rpLabel(rp)}`}
        variant="warning"
        objective="Minimizar — base de prima técnica anual."
        animationDelay={80}
      />
      <ExposureKpi
        tier={1}
        label={`PML · ${rpLabel(rp)} scenario`}
        numeric={pml / 1e6}
        format={(v) => `€${v.toFixed(1)}`}
        unit="M"
        sub={`Single-event loss at ${rpLabel(rp)} (Dottori 2018 elasticidad)`}
        variant="risk"
        objective="Vigilar — capital requerido por Solvencia II."
        animationDelay={160}
      />
      <ExposureKpi
        tier={3}
        label="Affected policies"
        numeric={highCount}
        format={(v) => Math.round(v).toLocaleString()}
        unit={`/ ${totalCount.toLocaleString()}`}
        sub={`€${(highValue / 1e6).toFixed(1)}M ${t('high-risk exposure')}`}
        variant="risk"
        animationDelay={240}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Methodology footer — surfaces the Oasis LMF lineage of the metrics
// (PML, EAL) so the project tribunal can verify the calc chain isn't
// hand-waved. Compact, low-attention, lives below the widget grid.
// ────────────────────────────────────────────────────────────────
function MethodologyFooter() {
  return (
    <div className="border border-border-default rounded bg-bg-subtle/40 px-4 py-3 text-11 text-text-secondary space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
          Methodology
        </span>
      </div>
      <p>
        <span className="font-mono text-text-primary">PML</span> = Σ
        <code className="px-1">insured_value × P(flood) × damage_ratio</code>
        over all policies, computed per the Oasis LMF Probable Maximum Loss
        convention (single-event loss given hazard footprint). <span className="font-mono text-text-primary">EAL</span> = PML ×{' '}
        <code className="px-1">prob_event_year</code> (5% — return period ≈ 20y for DANA-class events).
      </p>
      <p>
        Hazard layer: <span className="font-mono text-text-primary">P(flood)</span> from
        Random Forest v2 (14 features, GroupKFold 5×1km, operational threshold 0.614)
        trained on Sentinel-1 SAR backscatter pre/post DANA Valencia 2024 and validated
        against Copernicus EMS EMSR773.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Generic widget card — same chrome for all 6 widgets.
//   - `hint` (opcional): texto que aparece en tooltip al pasar por el ⓘ
//     a la derecha del título. Útil para que un no-experto entienda qué
//     muestra cada gráfica sin tener que leer la metodología.
//   - `cite` (opcional): chip de referencia bajo el cuerpo del tooltip
//     (e.g., "Oasis LMF · Brier 1950").
// ────────────────────────────────────────────────────────────────
// ─── Widget identity system ──────────────────────────────────────
// Cada widget del dashboard pertenece a uno de 6 "registers" — el
// register define el accent color del hairline rail, el eyebrow de
// arriba a la izquierda, y el tono de la card. Sin esto, los widgets
// son chrome idéntico que lee como "default AI dashboard".
//
//   tail          rojo crítico  · análisis de cola, capital risk
//   attribution   ámbar         · descomposición, segregación
//   concentration rojo flood    · ranking, top-N, concentración
//   composition   azul info     · estructura, reparto, mix
//   mix           violeta       · portfolio mix, producto, semantic
//   context       navy autoridad· mapa, contexto espacial
//
// Tipográficamente: eyebrow mono extreme tracked text-9 + título
// serif text-15 sin semibold + hairline rail debajo del header +
// optional subtitle italic serif + optional annotation italic serif
// al pie. Lee como brief editorial, no como card SaaS.
const REGISTER_ACCENT = {
  tail: '#DC2626',
  attribution: '#F39C12',
  concentration: '#E74C3C',
  composition: '#3B82F6',
  mix: '#7C3AED',
  context: '#0F1B35',
};

function Widget({
  title,
  badge,
  hint,
  cite,
  children,
  className = '',
  /** Eyebrow text rendered above the serif title (mono caps tracked). */
  eyebrow = null,
  /** Semantic register — drives hairline accent color + eyebrow tint. */
  register = 'context',
  /** Optional italic serif "story" below the title. */
  subtitle = null,
  /** Optional italic serif insight at the bottom of the card. */
  annotation = null,
}) {
  const accent = REGISTER_ACCENT[register] || REGISTER_ACCENT.context;
  return (
    <Card
      className={
        'group overflow-visible flex flex-col transition-all duration-200 ease-out hover:shadow-md hover:-translate-y-0.5 ' +
        className
      }
    >
      <CardHeader className="pt-2.5 pb-3 px-4 border-b border-border-default relative">
        {/* Eyebrow row · mono caps tracked + badge a la derecha.
         *  Solo se renderiza si hay al menos uno de los dos — evita
         *  spacing vertical fantasma cuando un widget no usa ninguno. */}
        {(eyebrow || badge) && (
          <div className="flex items-center justify-between gap-2 mb-1">
            {eyebrow ? (
              <span
                className="text-9 font-mono font-semibold uppercase tracking-[0.20em]"
                style={{ color: accent }}
              >
                {eyebrow}
              </span>
            ) : (
              <span />
            )}
            {badge && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-bg-subtle text-text-secondary text-10 font-mono uppercase tracking-wider shrink-0">
                {badge}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <CardTitle className="font-serif text-15 font-normal tracking-tight leading-tight">
            {title}
          </CardTitle>
          {hint && <InfoHint cite={cite}>{hint}</InfoHint>}
        </div>
        {subtitle && (
          <p className="font-serif italic text-11 text-text-tertiary leading-snug mt-1 max-w-[44ch]">
            {subtitle}
          </p>
        )}
        {/* Hairline accent rail · 28 px width en register color.
         *  Crece a 56 px al hover del Card (semánticamente "este
         *  widget está activo"). Lee como anotación a margen, no
         *  como rail de severidad SaaS. width via Tailwind para que
         *  group-hover funcione (inline style sobreescribiría). */}
        <div
          className="absolute left-4 bottom-0 h-[2px] w-7 transition-all duration-300 ease-out group-hover:w-14"
          style={{
            background: accent,
            transform: 'translateY(1px)',
          }}
          aria-hidden="true"
        />
      </CardHeader>
      <CardContent className="p-3 flex-1">{children}</CardContent>
      {annotation && (
        <div className="px-4 pb-3 pt-1 border-t border-border-default">
          <p className="font-serif italic text-11 text-text-tertiary leading-snug">
            {annotation}
          </p>
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Widget — Risk distribution donut (4 categories)
// ────────────────────────────────────────────────────────────────
function RiskDonut({ distribution }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: true,
      animationDuration: 250,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1e2022',
        borderColor: 'rgba(255,255,255,0.10)',
        textStyle: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
          color: '#f7f8f8',
        },
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 11,
          color: '#52525B',
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 3,
            borderColor: '#1e2022',
            borderWidth: 2,
          },
          label: { show: false },
          labelLine: { show: false },
          data: [
            { value: distribution.low || 0, name: 'Low', itemStyle: { color: RISK_COLORS.low } },
            { value: distribution.moderate || 0, name: 'Moderate', itemStyle: { color: RISK_COLORS.moderate } },
            { value: distribution.high || 0, name: 'High', itemStyle: { color: RISK_COLORS.high } },
            { value: distribution.very_high || 0, name: 'Very high', itemStyle: { color: RISK_COLORS.very_high } },
          ],
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [distribution]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 3 — Exposure by client type (€ insured value, horizontal bar)
// ────────────────────────────────────────────────────────────────
function ExposureByTypeChart({ clients }) {
  const ref = useRef(null);

  // Aggregate by PRODUCT (particulares/pymes/autos) — falls back to legacy
  // `type` for backwards compat with pre-C1 client records.
  const buckets = useMemo(() => {
    const acc = {};
    (clients || []).forEach((c) => {
      const p = c.product || c.type || 'unknown';
      acc[p] = (acc[p] || 0) + (c.insured_value || 0);
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [clients]);

  const PRODUCT_LABEL = {
    particulares: 'Particulares',
    pymes: 'Pymes',
    autos: 'Autos',
    // Legacy fallback labels for old clients that still have `type`
    residential: 'Residential',
    commercial: 'Commercial',
    industrial: 'Industrial',
    auto: 'Autos',
  };
  const PRODUCT_COLOR = {
    particulares: '#3B82F6',
    pymes: '#D97706',
    autos: '#7C3AED',
    residential: '#3B82F6',
    commercial: '#D97706',
    industrial: '#475467',
    auto: '#7C3AED',
  };

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: true,
      animationDuration: 250,
      animationEasing: 'cubicOut',
      grid: { left: 100, right: 16, top: 6, bottom: 22, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#1e2022',
        borderColor: 'rgba(255,255,255,0.10)',
        textStyle: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, color: '#f7f8f8' },
        valueFormatter: (v) => `€${(v / 1e6).toFixed(1)}M`,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: (v) => `${(v / 1e6).toFixed(0)}M`,
        },
      },
      yAxis: {
        type: 'category',
        data: buckets.map(([k]) => PRODUCT_LABEL[k] || k).reverse(),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#475467',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
        },
      },
      series: [
        {
          type: 'bar',
          // Each bar takes its product's brand colour — visual link with
          // the Policy Map points + the Portfolio Explorer filter dots.
          data: buckets.map(([k, v]) => ({
            value: v,
            itemStyle: {
              color: PRODUCT_COLOR[k] || '#94A3B8',
              borderRadius: [0, 2, 2, 0],
            },
          })).reverse(),
          barWidth: '58%',
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [buckets]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 4 — Geographic concentration (mini MapLibre with clustered points)
// ────────────────────────────────────────────────────────────────
function GeographicMap({ clients }) {
  const clientsGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: (clients || []).map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { id: c.id, risk_category: c.risk_category },
      })),
    }),
    [clients]
  );

  // Filtro CSS por Return Period — modula intensidad visual del mapa
  // según el escenario activo. T100 baseline = none.
  const [rp] = useReturnPeriod();
  const rpFilter = getRPVisualFilter(rp);

  // Centered on the union of both study areas (Valencia + Algemesí) so
  // both clusters are visible at the default zoom.
  return (
    <div
      className="h-full min-h-[420px] rounded overflow-hidden"
      style={{
        filter: rpFilter,
        transition: 'filter 400ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <Map
        center={[
          (Math.min(ZONES.valencia.bbox[0], ZONES.algemesi.bbox[0]) +
            Math.max(ZONES.valencia.bbox[2], ZONES.algemesi.bbox[2])) /
            2,
          (Math.min(ZONES.valencia.bbox[1], ZONES.algemesi.bbox[1]) +
            Math.max(ZONES.valencia.bbox[3], ZONES.algemesi.bbox[3])) /
            2,
        ]}
        zoom={10}
        minZoom={8}
        maxZoom={14}
        className="h-full w-full"
      >
        <MapControls />
        <ConcentrationRiskBackdrop />
        <MapClusterLayer
          data={clientsGeoJSON}
          clusterRadius={40}
          clusterMaxZoom={13}
          clusterColors={['#3B82F6', '#1D4ED8', '#1E3A8A']}
          clusterThresholds={[20, 100]}
          pointColor="#3B82F6"
        />
      </Map>
    </div>
  );
}

/** Loads both study-area risk surfaces underneath the cluster bubbles
 *  so the underwriter sees concentration vs hazard intensity in one
 *  glance. Usa raster tiles del RF (píxel-perfect) en vez del geojson
 *  binado, opacidad baja para no competir con los cluster markers. */
function ConcentrationRiskBackdrop() {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const zones = ['valencia', 'algemesi'];
    for (const zone of zones) {
      const id = `exposure-risk-${zone}`;
      if (map.getSource(id)) continue;
      map.addSource(id, {
        type: 'raster',
        tiles: [api.risk.tilesUrl(zone)],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 15,
        attribution: 'Random Forest v2 · TFG Vargas (UAB)',
      });
      map.addLayer({
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': 0.4,
          'raster-resampling': 'linear',
        },
      });
    }
  }, [map, isLoaded]);
  return null;
}

// ────────────────────────────────────────────────────────────────
// Widget — Loss Exceedance Curve (Oasis LMF-style OEP approximation)
// X axis: loss threshold L · Y axis: total € of policies with loss ≥ L
// Lets the underwriter see how concentrated the tail is — the steeper
// the descent, the more dependent the portfolio is on a few outliers.
// ────────────────────────────────────────────────────────────────
function LossExceedanceCurve({ clients }) {
  const ref = useRef(null);

  const points = useMemo(() => {
    const losses = (clients || [])
      .map((c) => c.estimated_loss_dana || 0)
      .filter((x) => x > 0)
      .sort((a, b) => b - a);
    if (!losses.length) return [];
    // Cumulative sum of losses ≥ each threshold (in increasing index order).
    let cum = 0;
    return losses.map((loss, i) => {
      cum += loss;
      return [loss, cum];
    });
  }, [clients]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      // Long, eased entry animation — the curve "draws itself" from
      // (0, 0) along its full length over 1.4 s. cubicOut feels
      // natural (fast then settling). Reinforces "cumulative" feel.
      animation: true,
      animationDuration: 1400,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 16, top: 12, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: '#DC2626', width: 1, type: 'dashed' },
        },
        backgroundColor: '#1e2022',
        borderColor: 'rgba(255,255,255,0.10)',
        textStyle: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
          color: '#f7f8f8',
        },
        formatter: (p) => {
          const [loss, cum] = p[0].data;
          const totalLoss = points[points.length - 1]?.[1] || 1;
          const pctOfTotal = ((cum / totalLoss) * 100).toFixed(1);
          return (
            `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#475467;line-height:1.6;">` +
            `Threshold ≥ <strong style="color:#1F2937;">€${(loss / 1000).toFixed(1)}K</strong><br/>` +
            `Cumulative <strong style="color:#DC2626;">€${(cum / 1e6).toFixed(2)}M</strong><br/>` +
            `<span style="color:#98A2B3;">${pctOfTotal} % of total PML</span>` +
            `</div>`
          );
        },
      },
      xAxis: {
        type: 'value',
        name: 'Loss threshold (€)',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: {
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          color: '#98A2B3',
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (v) => `${(v / 1000).toFixed(0)}K`,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (v) => `${(v / 1e6).toFixed(1)}M`,
        },
      },
      series: [
        {
          type: 'line',
          data: points,
          symbol: 'circle',
          showSymbol: false,
          // Hovering the line shows a single highlighted symbol at the
          // current data point — same visual cue as Bloomberg / Datadog
          // line charts. Adds tactile feedback to a long static curve.
          emphasis: {
            scale: 1.6,
            itemStyle: {
              color: '#DC2626',
              borderColor: '#1e2022',
              borderWidth: 2,
              shadowColor: 'rgba(220,38,38,0.5)',
              shadowBlur: 8,
            },
          },
          symbolSize: 6,
          lineStyle: {
            color: '#DC2626',
            width: 2,
            shadowColor: 'rgba(220,38,38,0.35)',
            shadowBlur: 6,
            shadowOffsetY: 1,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(220,38,38,0.30)' },
                { offset: 1, color: 'rgba(220,38,38,0.02)' },
              ],
            },
          },
          smooth: true,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [points]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 5 — Loss breakdown stacked bar by risk category
// ────────────────────────────────────────────────────────────────
function LossBreakdownChart({ clients }) {
  const ref = useRef(null);

  const data = useMemo(() => {
    const acc = { low: 0, moderate: 0, high: 0, very_high: 0 };
    (clients || []).forEach((c) => {
      const k = c.risk_category || 'low';
      if (k in acc) acc[k] += c.estimated_loss_dana || 0;
    });
    return acc;
  }, [clients]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      // Stagger the 4 stacks: Low slides in first, then Moderate,
      // then High, then Very-high. 280 ms gap per layer → the stacked
      // bar literally "builds up" left-to-right by severity, matching
      // the legend reading order. Total reveal: ~1.4 s.
      animation: true,
      animationDuration: 700,
      animationDurationUpdate: 360,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 16, top: 8, bottom: 32, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#1e2022',
        borderColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        padding: [8, 10],
        textStyle: {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 12,
          color: '#f7f8f8',
        },
        valueFormatter: (v) =>
          v >= 1_000_000
            ? `€${(v / 1_000_000).toFixed(2)}M`
            : `€${(v / 1000).toFixed(0)}K`,
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, color: '#52525B' },
        data: ['Low', 'Moderate', 'High', 'Very high'],
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E5E8EE', type: 'dashed' } },
        axisLabel: {
          color: '#98A2B3',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: (v) => `${(v / 1e6).toFixed(1)}M`,
        },
      },
      yAxis: {
        type: 'category',
        data: ['DANA loss'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#475467', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      },
      series: [
        {
          name: 'Low',
          type: 'bar',
          stack: 'loss',
          data: [data.low],
          itemStyle: { color: RISK_COLORS.low },
          barWidth: 28,
          animationDelay: 0,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(22,163,74,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'Moderate',
          type: 'bar',
          stack: 'loss',
          data: [data.moderate],
          itemStyle: { color: RISK_COLORS.moderate },
          animationDelay: 280,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(217,119,6,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'High',
          type: 'bar',
          stack: 'loss',
          data: [data.high],
          itemStyle: { color: RISK_COLORS.high },
          animationDelay: 560,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(220,38,38,0.45)',
              shadowBlur: 8,
            },
          },
        },
        {
          name: 'Very high',
          type: 'bar',
          stack: 'loss',
          data: [data.very_high],
          itemStyle: { color: RISK_COLORS.very_high },
          animationDelay: 840,
          emphasis: {
            itemStyle: {
              shadowColor: 'rgba(153,27,27,0.45)',
              shadowBlur: 8,
            },
          },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={ref} style={{ height: 220 }} />;
}

// ────────────────────────────────────────────────────────────────
// Widget 6 — Top 10 highest-risk clients table (sorted by est. loss DANA)
// ────────────────────────────────────────────────────────────────
function TopRiskClientsTable({ clients }) {
  const top = useMemo(() => {
    return [...(clients || [])]
      .sort(
        (a, b) =>
          (b.estimated_loss_dana || 0) - (a.estimated_loss_dana || 0)
      )
      .slice(0, 10);
  }, [clients]);

  // Max est. loss in the top-10 — drives the inline bar normalisation
  // so the #1 row renders a 100 % bar and everyone else scales down.
  const maxLoss = top[0]?.estimated_loss_dana || 1;

  // Local money formatter (M for ≥ 1M, K below). Same convention as
  // Portfolio Explorer's fmtMoney — keeps the two views aligned.
  const fmt = (v) => {
    if (v == null) return '—';
    if (Math.abs(v) >= 1_000_000) {
      const m = v / 1_000_000;
      const fixed = m.toFixed(1);
      return `€${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}M`;
    }
    return `€${(v / 1000).toFixed(0)}K`;
  };

  return (
    <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
      <table className="w-full text-11">
        <thead className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-default sticky top-0 bg-bg-surface z-[1]">
          <tr>
            <th className="text-left py-1.5 pr-2 font-semibold w-6">#</th>
            <th className="text-left py-1.5 pr-2 font-semibold">Policy</th>
            <th className="text-left py-1.5 pr-2 font-semibold">Type</th>
            <th className="text-right py-1.5 pr-2 font-semibold">P</th>
            <th className="text-right py-1.5 font-semibold">Est. loss</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {top.map((c, idx) => {
            const cat = c.risk_category || 'low';
            const fg = RISK_COLORS[cat] || '#52525B';
            const loss = c.estimated_loss_dana || 0;
            const pct = Math.min(100, (loss / maxLoss) * 100);
            // Sequential entry animation — each row fades + slides in
            // 60ms after the previous. Total: top-10 fully visible in
            // 600 ms. Gives the table a "loading data" feel without
            // adding any spinner UI.
            const animationDelay = `${idx * 60}ms`;
            return (
              <tr
                key={c.id}
                className="hover:bg-bg-hover transition-colors group animate-in fade-in slide-in-from-bottom-1"
                style={{ animationDelay, animationDuration: '320ms' }}
              >
                <td className="py-1.5 pr-2 font-mono text-text-tertiary tabular-nums">
                  {idx + 1}
                </td>
                <td className="py-1.5 pr-2 font-mono text-text-primary truncate">
                  {c.id}
                </td>
                <td className="py-1.5 pr-2 text-text-secondary capitalize">
                  {c.type}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-text-primary tabular-nums">
                  {c.risk_probability?.toFixed(3) ?? '—'}
                </td>
                <td className="py-1.5 text-right relative">
                  {/* Inline value bar — width = loss / max. Drawn behind
                   *  the text via absolute positioning so the cell stays
                   *  numeric-readable. */}
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-4 rounded-sm pointer-events-none transition-[width] duration-700 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: `${fg}1A`,
                      borderRight: `2px solid ${fg}`,
                    }}
                  />
                  <span
                    className="relative font-mono font-medium tabular-nums pr-1"
                    style={{ color: fg }}
                  >
                    {fmt(loss)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Return Period scenario bar ──────────────────────────────────
// Strip de configuración del escenario: periodo de retorno +
// fuente backbone + multiplicador AEP visible + cita Dottori.
// Reads como "este escenario es lo que estamos cotizando".
function ReturnPeriodScenarioBar() {
  const [rp] = useReturnPeriod();
  const mult = getLossMultiplier(rp);
  return (
    <div className="bg-bg-surface border border-border-default rounded-md shadow-sm px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5 flex-wrap">
      <ReturnPeriodSelector variant="dashboard" />
      <BackboneSourceSelector variant="dashboard" />
      <div className="flex items-baseline gap-2 lg:ml-auto">
        <span className="text-10 font-mono uppercase tracking-[0.16em] text-text-tertiary">
          Multiplicador AEP
        </span>
        <span className="font-mono font-semibold tabular-nums text-text-primary text-14">
          ×{mult.toFixed(2)}
        </span>
        <span
          className="text-10 font-serif italic text-text-tertiary truncate"
          title={SOURCE_NOTE}
        >
          baseline T100 · {SOURCE_NOTE}
        </span>
      </div>
    </div>
  );
}
