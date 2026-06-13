# DESIGN.md — Flood Risk Framework · Underwriter Console

> AI-readable design system for this codebase. Read this before generating any
> component. Refero convention: **specific context beats taste adjectives.**
> Don't say "premium and clean" — use the exact tokens below.
>
> Source of truth: `src/styles/tokens.css` + `tailwind.config.js`. This file
> documents the *why* and the *patterns*; those two files are the runtime.

---

## 1 · Identity

**Register:** Light fintech data-system × Navy authority chrome.
**Reference peers:** Bloomberg Terminal, Palantir Foundry, Column (banking-as-a-service), Mercury (fintech dashboard).
**Domain:** Insurance catastrophe underwriting — flood risk on Sentinel-1 SAR.

The platform reads as an *instrument*, not a marketing site. Density is a
feature: an underwriter scanning a portfolio wants more signal per pixel, not
whitespace. Three things carry the identity:

1. **Navy authority** (`#0F1B35`) for structural chrome (sidebar, primary CTA, KPI anchors). Reserved, never decorative.
2. **Editorial typography pairing** — sans for UI, mono for numbers, serif for narrative registers. The serif is what separates this from a generic SaaS dashboard.
3. **Mil-spec HUD** in the Underwriter Console (`/tour`) — military jargon as technical shorthand (TARGET, ASSET, MONITORED) with tooltips that translate to underwriter terms.

**Banned:** dark-mode-by-default, neon, glassmorphism blur stacks, uniform
card grids with no hierarchy, gradient hero blobs, emoji in chrome.

---

## 2 · Color

### Surfaces (light base)
```
--bg-base      #F9FAFB   main canvas (neutral-50)
--bg-surface   #FFFFFF   card body (pure white)
--bg-subtle    #F3F4F6   chip / inactive header (neutral-100)
--bg-hover     #F3F4F6   soft hover
```

### Navy authority chrome
```
--sidebar-bg      #0F1B35   Zurich Blue — sidebar, dark HUD panels
--sidebar-hover   #1A2A4A
--sidebar-active  #243759
--brand-500       #0F1B35   primary CTA, nav-active, KPI tier-1 border
--brand-700       #0A1428
--brand-50        #EEF1F8   tinted badge background
```

### Text (neutral ramp)
```
--text-primary    #111827   neutral-900
--text-secondary  #4B5563   neutral-600
--text-tertiary   #9CA3AF   neutral-400 (eyebrows, captions)
```

### Interactive accent — bright blue (NOT navy)
```
--accent-info     #3B82F6   links, focus ring, data-viz series 1
```
> Critical rule: navy is structural, blue is interactive. Charts and links use
> `#3B82F6` so they don't read as "dead navy slabs". Focus rings are always
> blue so the navy primary button doesn't swallow its own focus halo.

### Risk semantics (the domain palette)
```
--risk-low       #10B981   safe / status-live green
--risk-medium    #F39C12   moderate (amber)
--risk-high      #E74C3C   high (flood red)
--risk-critical  #DC2626   very_high
```
Each has a `-bg` tint (e.g. `risk-high-bg #FEF2F2`) for pill backgrounds.

### Data-viz series (ECharts)
```
data-1 #3B82F6  data-2 #10B981  data-3 #F39C12  data-4 #7C3AED
data-5 #DB2777  data-6 #4F46E5  data-7 #15803D  data-8 #E74C3C
```
Series 1 is bright blue (vivid against white), never navy.

### Borders
```
--border-default  #E5E7EB   solid neutral-200 (cards read as delineated tiles)
--border-strong   #D1D5DB
```

---

## 3 · Typography

### Stack
```
sans   Inter, -apple-system, Segoe UI, system-ui      → body + all UI chrome
mono   JetBrains Mono, Menlo                           → numbers, KPIs, eyebrows, code
serif  IBM Plex Serif, Georgia, Cambria                → narrative / editorial registers
```

`font-feature-settings: 'cv11', 'ss01', 'tnum'` on body (Inter humanist
alternates + tabular nums). Mono always `tabular-nums` for column-aligned
figures.

### Scale (px, line-height baked in)
```
10/1.45  11/1.45  12/1.45  13/1.4  14/1.4  16/1.35
18/1.3   20/1.25  22/1.2   24/1.2  28/1.15 32/1.1  40/1.05
```

### Usage rules (the load-bearing ones)
- **Eyebrow:** `text-10 font-mono font-semibold uppercase tracking-[0.16em]–[0.20em] text-text-tertiary`. Every section + widget opens with one. This is the single most identity-defining pattern — see §7.
- **KPI / big number:** `font-mono font-semibold tabular-nums tracking-tight`, size scales with tier (text-32 / text-22 / text-18).
- **Narrative title:** `font-serif text-15–32 tracking-tight`, weight normal (not bold). Serif at title weight is the "editorial brief" tell.
- **Story / caption:** `font-serif italic text-11–13 text-text-secondary leading-snug`. Used for the one-line "what this means" under a chart.
- **Body:** `font-sans text-13 text-text-secondary leading-relaxed`.

> The serif italic caption + mono eyebrow + serif title trio is what makes a
> card read as a magazine brief instead of a SaaS widget. Never drop the
> eyebrow to "save space".

---

## 4 · Spacing, radius, elevation

**Spacing:** 4px base unit. Common: `space-1..16` (4/8/12/16/20/24/32/40/48/64).
Cards pad `space-4` (16px). Don't pad everything uniformly — rhythm over uniformity.

**Radius:**
```
sm 4px   DEFAULT 6px   md 6px   lg 8px   xl 10px
```
Cards/buttons 6px. Bumped from the old 3-4px "ops-terminal" look toward
"enterprise". Pills/chips use `rounded-sm`.

**Shadows (navy-tinted, not cold grey):**
```
sm       0 1px 2px rgba(15,27,53,.05), inset hairline
default  0 4px 6px -1px rgba(15,27,53,.05)
md       0 10px 15px -3px rgba(15,27,53,.08)   ← hover lift target
lg       0 20px 25px -5px rgba(15,27,53,.10)   ← tier-1 hover
```
The rgba uses navy `(15,27,53)` so shadows tint with the brand, not cold grey.

---

## 5 · Motion

```
--transition-fast    150ms cubic-bezier(0.4,0,0.2,1)
--transition-medium  200ms cubic-bezier(0.4,0,0.2,1)
--transition-slow    300ms cubic-bezier(0.4,0,0.2,1)
```

**Vocabulary (Linear/Stripe register, NOT bouncy):**
- Card hover: `hover:shadow-md hover:-translate-y-0.5` over 200ms ease-out.
- Number tickers: `useCountUp` 0→target, ease-out quartic `1-(1-t)^4` (1100–1600ms). "Settles" instead of linear scoreboard.
- Reveal-on-scroll: `useInView` + fade + translateY 16px, 700ms.
- Accent rails grow on hover (20→48px, 28→56px) — a designed micro-state, never decorative.
- **Always respect `prefers-reduced-motion`** via `usePrefersReducedMotion` hook (`src/lib/animations.js`) — fly-throughs jump, crossfades cut.

Hooks live in `src/lib/animations.js`: `useInView`, `useCountUp`,
`usePrefersReducedMotion`. Reuse, don't reimplement.

---

## 6 · Signature components

### KPI tier system (`ExposureKpi`, `src/components/exposure-kpi.jsx`)
Three prominence levels via `data-tier` attribute, styled in `main.css`:
- **TIER 1** — anchor (TIV, PML). `grid-column: span 2`, navy border, white→navy-tint gradient, deep shadow, number text-32. The two numbers the stakeholder checks first.
- **TIER 2** — operational. Standard border + shadow, text-22.
- **TIER 3** — drill-down. Subtle border, opacity 0.92, text-18, no objective line.

Opt-in count-up: pass `numeric` + `format` and it animates 0→target on viewport entry.

### Widget register identity (`src/views/exposure-dashboard.jsx` Widget)
Every dashboard widget belongs to one of 6 **registers** that drive a hairline
accent rail + eyebrow tint. This is the anti-"identical chrome" device:
```
tail          #DC2626   tail analysis, capital risk      (COLA · ESTILO OEP)
attribution   #F39C12   decomposition                    (ATRIBUCIÓN · POR CATEGORÍA)
concentration #E74C3C   ranking, top-N                   (CONCENTRACIÓN · TOP 10)
composition   #3B82F6   structure, mix                   (DENSIDAD · 01)
mix           #7C3AED   portfolio mix                    (DENSIDAD · 02)
context       #0F1B35   map, spatial context             (ESPACIAL · 01)
signal        #22D3EE   SAR / time-series data           (SEÑAL · RETRODISPERSIÓN SAR)
```
Card anatomy: `eyebrow (mono caps) → serif title → italic serif subtitle →
hairline rail (28→56px hover) → content → italic serif annotation`.

### Underwriter Console HUD (`src/components/tour/`)
Mil-spec dark overlay on a deck.gl/MapLibre canvas. Navy 78–82% backdrop +
blur. Components: TargetRegistry (left), TacticalMiniMap (top-right), ModeBank
(F1–F5 with semantic tints), StatusStrip (bottom), CenterReticle (per-mode SVG).
Mode tints: PHOTO cyan, THERMAL red, NIGHT green, ARCHIVE amber, SWEEP gold.

### Return-period selectors (`src/components/return-period-selector.jsx`)
Two variants: `console` (mil-spec compact, navy bg) and `dashboard` (white
card, editorial pills). RP tint ramp T10 cold-blue → T500 critical-red.

### Load/error states (`src/components/load-error-state.jsx`)
Never leave a spinner hanging. Amber icon + serif italic title + Reintentar
button. Banner tone is amber ("config pending"), never red ("error") unless
truly broken.

---

## 7 · The eyebrow + rail recipe (copy this for new sections)

```jsx
<div className="flex items-baseline gap-3 mb-3">
  <div className="text-10 font-mono font-semibold uppercase tracking-[0.14em] text-text-tertiary">
    SECTION LABEL · DETAIL
  </div>
  <div className="h-px flex-1 max-w-[120px]" style={{ background: 'var(--border-default)' }} />
  <div className="text-10 font-mono uppercase tracking-[0.14em] text-text-tertiary">
    secondary hint
  </div>
</div>
```
Mono caps eyebrow + a short hairline rule. This single pattern, applied
consistently, is what reads as "editorial system" instead of "Tailwind default".

---

## 8 · Anti-patterns (what makes it look AI-generated / cheap)

- ❌ Uniform card grid, every card identical chrome → ✅ register system (§6).
- ❌ Serif title in bold → ✅ serif normal weight (bold serif reads as Word).
- ❌ Navy used for charts/links → ✅ bright blue `#3B82F6` for interactive.
- ❌ Cold-grey shadows → ✅ navy-tinted rgba(15,27,53,…).
- ❌ Dropping the mono eyebrow to save space → it's load-bearing identity.
- ❌ Bouncy/spring motion → ✅ ease-out cubic, small magnitudes.
- ❌ Hanging spinner on API failure → ✅ `LoadErrorState`.
- ❌ Pure-grey palette (the old Palantir-grey we migrated away from).

---

## 9 · Notes from peer systems (Column / Mercury)

Validated that this system is **Column-class** (light fintech + mono accent).
Two ideas worth borrowing if a gap appears, neither adopted yet:

- **Column** uses SF Mono for *all* numeric tabular data, even in prose. We
  already do this via JetBrains Mono `tabular-nums` — no change needed.
- **Mercury** uses a single bright accent (Mercury Blue) very sparingly against
  a near-monochrome base. Our `#3B82F6` plays this role; keep it disciplined —
  if everything is blue, nothing is.

Do **not** wholesale-import an external DESIGN.md: the register system, KPI
tiers, RP selectors and HUD are domain-specific (flood underwriting) and don't
exist in any generic style. This system *is* the differentiator.
