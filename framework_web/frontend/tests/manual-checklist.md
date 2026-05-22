# Manual QA — Frontend Session A

Carry out these checks after `npm run dev` from `framework_web/frontend/`.

## Setup

- [ ] Backend up at `http://localhost:8000/api/health` returns `model_loaded: true`.
- [ ] `npm install` finished with no fatal errors.
- [ ] `npm run dev` boots Vite on `http://localhost:5173` without errors.

## Layout

- [ ] Sidebar visible at 240 px, with the **Flood Risk** brand badge.
- [ ] Three sections: ANALYSIS, PORTFOLIO, METHODOLOGY.
- [ ] Nine navigation items in total.
- [ ] Top bar visible (56 px), with breadcrumbs that update on hash change.
- [ ] Search box visible but disabled (placeholder for Session B).

## Routing

- [ ] Loading `/` shows the **Overview** view.
- [ ] Clicking each sidebar item updates the hash.
- [ ] Active state visible on the matching sidebar item (left border + blue text).
- [ ] All non-Overview routes show the **Coming in next session** placeholder.
- [ ] The browser back button restores prior route.

## Overview view

- [ ] 4 KPI cards render with real data from the backend:
  - AUC Valencia ≈ 0.922 ± 0.019
  - AUC Algemesí ≈ 0.817
  - Recall @ 100 m buffer ≈ 95.8 %
  - Pixels analysed ≈ 26.1 M
- [ ] Numbers use the monospace font and tabular numerals.
- [ ] Two badges in the header: "Random Forest v2" and "14 features".
- [ ] Valencia map renders with the CartoDB Positron base layer.
- [ ] Risk polygons coloured by bin (green / amber / red / dark red).
- [ ] Map shows a legend with the four probability ranges.
- [ ] Hover over a polygon shows a tooltip with bin label + range.
- [ ] Side panel shows: About / Confusion matrix / Quick links.
- [ ] Confusion matrix values match the backend (TP≈467,050).
- [ ] Quick links navigate to the corresponding (stub) routes.

## Visual review — anti AI-look

- [ ] No purple/pink gradients anywhere.
- [ ] No `shadow-2xl` or pulsing animations.
- [ ] No rounded-3xl / rounded-full (except the avatar).
- [ ] No emojis in headings.
- [ ] Looks closer to Linear / Datadog than to a SaaS template.

## DevTools

- [ ] 0 errors and 0 warnings in console.
- [ ] All `/api/*` requests respond HTTP 200.
- [ ] Lighthouse Performance ≥ 80, Accessibility ≥ 95 (run on `localhost:5173/`).
