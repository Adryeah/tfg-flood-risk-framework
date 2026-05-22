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

        // ── Project tokens (existing) ──────────────────────────────
        // Workspace surfaces — Palantir / Bloomberg / Datadog feel.
        // Layered greys rather than pure white dominance.
        'bg-base': '#F3F5F7', // main canvas
        'bg-surface': '#FAFBFC', // card body
        'bg-subtle': '#E9EDF2', // secondary surface / chip / inactive header
        'bg-hover': '#EEF1F5', // soft hover
        // Dark sidebar band (institutional ops console)
        'sidebar-bg': '#1E2B4A',
        'sidebar-hover': '#27365A',
        'sidebar-active': '#2F4170',
        // Text
        'text-primary': '#1F2937',
        'text-secondary': '#667085',
        'text-tertiary': '#98A2B3',
        'text-inverse': '#F8FAFC',
        // Borders — soft, mostly-transparent so cards "integrate" rather than float
        'border-default': 'rgba(0,0,0,0.06)',
        'border-strong': 'rgba(0,0,0,0.10)',
        'border-focus': '#1F2937',
        // Brand — institutional analytical blue
        brand: {
          50: '#EFF4FB',
          100: '#DCE6F5',
          500: '#2563EB',
          700: '#1D4ED8',
          900: '#1E2B4A',
        },
        // Risk semantics — muted enterprise tones (no neon)
        risk: {
          low: '#16A34A',
          'low-bg': '#ECFDF5',
          medium: '#D97706',
          'medium-bg': '#FFFBEB',
          high: '#DC2626',
          'high-bg': '#FEF2F2',
          critical: '#991B1B',
        },
        // Data viz palette
        data: {
          1: '#2563EB',
          2: '#0E9F8E',
          3: '#D97706',
          4: '#7C3AED',
          5: '#DB2777',
          6: '#4F46E5',
          7: '#15803D',
          8: '#E11D48',
        },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'Menlo', 'monospace'],
        // Editorial serif — used on Methodology section titles + pull
        // quotes to distinguish the academic register from the ops
        // dashboard register. See frontend-design skill on type pairing.
        serif: ['Newsreader', 'Georgia', 'Cambria', 'serif'],
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
        sm: '3px',
        DEFAULT: '4px',
        md: '5px',
        lg: '6px',
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
        // Tighter, layered shadows so cards sit on the surface, not float above
        sm: '0 1px 1px rgba(15,23,42,0.04), 0 0 0 1px rgba(15,23,42,0.04)',
        DEFAULT:
          '0 1px 2px rgba(15,23,42,0.06), 0 0 0 1px rgba(15,23,42,0.05)',
        md: '0 2px 4px rgba(15,23,42,0.08), 0 0 0 1px rgba(15,23,42,0.05)',
        lg: '0 6px 16px rgba(15,23,42,0.10), 0 0 0 1px rgba(15,23,42,0.04)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
