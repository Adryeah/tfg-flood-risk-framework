/** @type {import('tailwindcss').Config} */
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  // shadcn/ui toggles dark mode via the `.dark` class on <html>. We don't
  // ship a dark UI yet, but configuring this avoids surprises when adding
  // shadcn components that reference `dark:` variants.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // ── shadcn/ui tokens (mapped to OUR HSL vars in tokens.css) ──
        // Every shadcn component reads `bg-background`, `text-foreground`,
        // `bg-primary`, `border-border`, etc. We point them at the HSL
        // variables we set in tokens.css so they match the existing palette.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },

        // ── Project tokens · Flood Risk × Zurich Design System ─────
        // Migrated from the Palantir-grey palette to the Zurich
        // enterprise spec (Authority navy + clean whites). Token
        // names stay identical so JSX doesn't move.
        'bg-base': '#F9FAFB', // main canvas — neutral-50
        'bg-surface': '#FFFFFF', // card body — pure white now
        'bg-subtle': '#F3F4F6', // chip / inactive header — neutral-100
        'bg-hover': '#F3F4F6', // soft hover — neutral-100
        'bg-elevated': '#FFFFFF',
        // Dark sidebar band · Zurich Blue (Authority)
        'sidebar-bg': '#0F1B35',
        'sidebar-hover': '#1A2A4A',
        'sidebar-active': '#243759',
        // Text · neutral-900 / 600 / 400
        'text-primary': '#111827',
        'text-secondary': '#4B5563',
        'text-tertiary': '#9CA3AF',
        'text-muted': '#6B7280',
        'text-inverse': '#F9FAFB',
        // Borders — solid neutral-200 (more delineation than the
        // previous transparent blacks; cards now read as crisp tiles)
        'border-default': '#E5E7EB',
        'border-strong': '#D1D5DB',
        'border-subtle': 'rgba(15,27,53,0.06)',
        'border-focus': '#0F1B35',
        // Brand · Zurich navy primary
        brand: {
          50: '#EEF1F8',
          100: '#D4DCEC',
          500: '#0F1B35', // primary CTA, nav-active, KPI value
          700: '#0A1428',
          900: '#060D1C',
        },
        // Interactive accent — links, focus rings, data-viz series 1.
        // Stays bright so the navy primary doesn't dominate everything.
        accent: {
          info: '#3B82F6',
          live: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
        },
        // Corporate accent aliases (used directly by some views as
        // semantic shortcuts).
        'corporate-navy': '#0F1B35',
        'corporate-navy-light': '#EEF1F8',
        // Risk semantics — Zurich enterprise tones per spec
        risk: {
          low: '#10B981',
          'low-bg': '#ECFDF5',
          'low-soft': '#A8D5BA',
          medium: '#F39C12',
          'medium-bg': '#FFFBEB',
          high: '#E74C3C',
          'high-bg': '#FEF2F2',
          critical: '#DC2626',
          'critical-bg': '#FEE2E2',
        },
        // Data viz palette — series 1 is interactive blue (not navy)
        // so the most frequent series reads as a vivid data point.
        data: {
          1: '#3B82F6',
          2: '#10B981',
          3: '#F39C12',
          4: '#7C3AED',
          5: '#DB2777',
          6: '#4F46E5',
          7: '#15803D',
          8: '#E74C3C',
        },
      },
      fontFamily: {
        // Inter for body + UI. Designed for screen rendering at small
        // sizes; the corporate-default sans for enterprise products.
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
        // IBM Plex Serif for editorial registers (methodology titles,
        // pull-quotes, hero typographic anchors). Replaces Newsreader
        // for a more institutional/enterprise feel per Zurich spec.
        serif: ['IBM Plex Serif', 'Georgia', 'Cambria', 'serif'],
      },
      fontSize: {
        10: ['10px', { lineHeight: '1.45' }],
        11: ['11px', { lineHeight: '1.45' }],
        12: ['12px', { lineHeight: '1.45' }],
        13: ['13px', { lineHeight: '1.4' }],
        14: ['14px', { lineHeight: '1.4' }],
        16: ['16px', { lineHeight: '1.35' }],
        18: ['18px', { lineHeight: '1.3' }],
        20: ['20px', { lineHeight: '1.25' }],
        22: ['22px', { lineHeight: '1.2' }],
        24: ['24px', { lineHeight: '1.2' }],
        28: ['28px', { lineHeight: '1.15' }],
        32: ['32px', { lineHeight: '1.1' }],
        40: ['40px', { lineHeight: '1.05' }],
      },
      spacing: {
        4.5: '18px',
      },
      borderRadius: {
        // Bumped per Zurich spec — cards/buttons read as 6-8 px so
        // the platform feels less "ops-terminal" and more enterprise.
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
      },
      // ── Animations consumed by shadcn primitives (Dialog, Sheet,
      // Tooltip, Tabs). Provided via tailwindcss-animate plugin below;
      // keyframes redeclared here for explicitness so Tailwind sees them
      // even when the plugin order changes. ──────────────────────────
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 200ms cubic-bezier(0.23, 1, 0.32, 1)',
        'accordion-up': 'accordion-up 200ms cubic-bezier(0.23, 1, 0.32, 1)',
      },
      boxShadow: {
        // Zurich spec · more lift than the previous tight pairs. The
        // rgba uses navy (15, 27, 53) so the cast tint integrates with
        // the brand rather than reading as cold grey shadow.
        sm: '0 1px 2px rgba(15,27,53,0.05), 0 0 0 1px rgba(15,27,53,0.04)',
        DEFAULT:
          '0 4px 6px -1px rgba(15,27,53,0.05), 0 0 0 1px rgba(15,27,53,0.04)',
        md: '0 10px 15px -3px rgba(15,27,53,0.08), 0 0 0 1px rgba(15,27,53,0.04)',
        lg: '0 20px 25px -5px rgba(15,27,53,0.10), 0 0 0 1px rgba(15,27,53,0.04)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
