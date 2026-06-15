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

        // ── Project tokens · HYBRID LINEAR × BASEDASH (dark) ───────
        // Structural tokens point at the CSS vars in tokens.css so the
        // single source of truth is one file. Flipping the theme =
        // editing tokens.css only. Token NAMES stay identical so JSX
        // doesn't move; their values now resolve to the dark surfaces.
        'bg-base': 'var(--surface-canvas)',
        'bg-surface': 'var(--surface-card)',
        'bg-subtle': 'var(--surface-elevated)',
        'bg-hover': 'rgba(255,255,255,0.04)',
        'bg-elevated': 'var(--surface-elevated)',
        // Nav surface (sidebar + topbar)
        'sidebar-bg': 'var(--surface-nav)',
        'sidebar-hover': 'rgba(255,255,255,0.04)',
        'sidebar-active': 'rgba(255,255,255,0.06)',
        // Text · Linear ramp
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-muted)',
        'text-muted': 'var(--text-muted)',
        'text-inverse': 'var(--surface-canvas)',
        // Borders · Linear inset system
        'border-default': 'var(--border-hairline)',
        'border-strong': 'var(--border-strong)',
        'border-subtle': 'rgba(255,255,255,0.04)',
        'border-focus': 'var(--accent-sar)',
        // New spec surface aliases (usable directly as bg-surface-card etc.)
        'surface-canvas': 'var(--surface-canvas)',
        'surface-nav': 'var(--surface-nav)',
        'surface-card': 'var(--surface-card)',
        'surface-elevated': 'var(--surface-elevated)',
        'surface-input': 'var(--surface-input)',
        'border-hairline': 'var(--border-hairline)',
        'border-medium': 'var(--border-medium)',
        // Brand → SAR accent (the interactive primary is now SAR blue)
        brand: {
          50: 'var(--accent-sar-glow)',
          100: 'rgba(29,111,168,0.22)',
          500: 'var(--accent-sar)',
          700: '#155A86',
          900: '#0C3B59',
        },
        // Semantic accents · color = meaning (flood-risk specific)
        accent: {
          info: 'var(--accent-sar)',
          sar: 'var(--accent-sar)',
          risk: 'var(--accent-risk)',
          valid: 'var(--accent-valid)',
          warn: 'var(--accent-warn)',
          purple: 'var(--accent-purple)',
          live: 'var(--accent-valid)',
          warning: 'var(--accent-warn)',
          error: 'var(--accent-risk)',
        },
        'corporate-navy': 'var(--surface-nav)',
        'corporate-navy-light': 'var(--accent-sar-glow)',
        // Risk semantics → dark accents. bg variants are the glow tints.
        risk: {
          low: '#0F6E56',
          'low-bg': 'rgba(15,110,86,0.12)',
          'low-soft': '#5DCAA5',
          medium: '#854F0B',
          'medium-bg': 'rgba(133,79,11,0.12)',
          high: '#C0392B',
          'high-bg': 'rgba(192,57,43,0.12)',
          critical: '#C0392B',
          'critical-bg': 'rgba(192,57,43,0.16)',
        },
        // Data viz palette · semantic accents (dark)
        data: {
          1: '#1D6FA8', // SAR
          2: '#0F6E56', // valid
          3: '#854F0B', // warn
          4: '#534AB7', // purple
          5: '#C0392B', // risk
          6: '#1D6FA8',
          7: '#0F6E56',
          8: '#C0392B',
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
        // Basedash split: badge 2px · btn 6px · card 12px · modal 16px.
        sm: '2px', // badge / status pill / tag
        DEFAULT: '6px', // button / input
        md: '8px',
        lg: '12px', // card / panel
        xl: '16px', // modal / overlay
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
        // Linear inset-border elevation system. On dark, depth comes
        // from a 1px inset hairline, not a cast shadow. Raised/overlay
        // add a real drop only where it lifts off the canvas.
        sm: 'inset 0 0 0 1px #23252a',
        DEFAULT: 'inset 0 0 0 1px #23252a',
        md: 'inset 0 0 0 1px #23252a, 0 2px 4px rgba(0,0,0,0.4)',
        lg: '0 4px 32px rgba(8,9,10,0.6)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
