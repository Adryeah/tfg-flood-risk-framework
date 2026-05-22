# Flood Risk Framework — Frontend

Vanilla JS + Vite + Tailwind. Visualiza el framework predictivo de riesgo
de inundación (TFG DANA Valencia 2024). Consume el backend FastAPI en
http://localhost:8000 vía proxy `/api/*` configurado en `vite.config.js`.

## Stack

- **Build:** Vite 5 (ES2020, manual chunks por librería)
- **Styling:** Tailwind 3 con tokens custom (sin frameworks UI)
- **Mapas:** Leaflet 1.9 + tiles CartoDB Positron
- **Charts:** ECharts 5 (Sesiones B y C)
- **Iconos:** Lucide (tree-shaken)
- **Estado / routing:** Vanilla — Proxy pub/sub + hash router

NO React, NO Vue, NO jQuery, NO Bootstrap. Vanilla estricto.

## Requisitos

1. Backend FastAPI corriendo en `http://localhost:8000`:
   ```bash
   cd ../  # framework_web/
   ../.venv/Scripts/python.exe -m uvicorn backend.main:app
   ```
2. Node 18+ y npm.

## Setup

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` arranca Vite con proxy: cualquier request a `/api/*` se
reenvía al backend.

## Comandos

| Comando | Acción |
|---|---|
| `npm run dev` | Servidor de desarrollo con HMR |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Servir `dist/` para verificación |
| `npm run lint` | ESLint sobre `src/` |
| `npm run format` | Prettier sobre `src/` |

## Estructura

```
frontend/
├── index.html
├── public/         (favicon, logo)
├── src/
│   ├── main.js                  # bootstrap
│   ├── styles/                  # tokens.css, base.css, main.css
│   ├── lib/                     # api, router, state, format, constants
│   ├── components/              # icon, button, card, kpi-card, badge,
│   │                              loading, error-state, sidebar, topbar,
│   │                              layout
│   └── views/
│       └── overview.js          # única vista funcional en Sesión A
└── tests/
    └── manual-checklist.md
```

## Estado actual — Sesión A

- ✅ Layout con sidebar (9 items) + topbar
- ✅ Hash router con cleanup de vistas
- ✅ Cliente API con manejo de errores y timeouts
- ✅ Componentes base (Card, KpiCard, Badge, Button, Loading, ErrorState)
- ✅ Vista **Overview** funcional: 4 KPI cards + mapa Valencia con
       Leaflet + side panel (about, confusion matrix, quick links)
- ⏳ Las 8 vistas restantes muestran placeholder "Coming in next session"

## Diseño

Tokens definidos en `tailwind.config.js` y `styles/tokens.css`. **No usar
fuera de estos colores** sin discutirlo: la paleta está cerrada para
evitar el "AI look":

- Sin gradientes saturados (no `from-purple-500 to-pink-500`)
- Sin sombras exageradas (max `shadow-md`)
- Sin esquinas excesivamente redondeadas (max `rounded-lg` = 8 px)
- Sin emojis en headings
- Sin animaciones gratuitas (solo `animate-spin` para loading)

Inspiración: Linear, Datadog, Vercel.
