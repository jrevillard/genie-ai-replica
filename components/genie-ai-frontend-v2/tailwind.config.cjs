/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        // Brand: IEEE blue, sampled from the Figma brand panel.
        ieee: {
          50: '#e6f1f8',
          100: '#cce3f1',
          200: '#99c7e3',
          300: '#66abd5',
          400: '#338fc7',
          500: '#0073b9',
          600: '#00629b',
          700: '#005280',
          800: '#003e62',
          850: '#002855',
          900: '#002b44',
          950: '#001f33',
        },
        // Semantic tokens — prefer these over raw scales in components.
        // Aliasing keeps "what the color means" close to the call site so
        // a future rebrand only touches this file.
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc', // slate-50
          subtle: '#f1f5f9', // slate-100
          inverse: '#003e62', // ieee-800 (dashboard frame)
        },
        border: {
          DEFAULT: '#e5e7eb', // neutral-200
          strong: '#cbd5e1', // slate-300
          subtle: '#f1f5f9', // slate-100
        },
        text: {
          DEFAULT: '#020617', // slate-950
          muted: '#475569', // slate-600
          subtle: '#94a3b8', // slate-400
          inverse: '#ffffff',
        },
        accent: {
          DEFAULT: '#005280', // ieee-700
          hover: '#003e62', // ieee-800
          soft: '#e6f1f8', // ieee-50
        },
        danger: {
          DEFAULT: '#dc2626', // red-600
          hover: '#b91c1c', // red-700
          soft: '#fef2f2', // red-50
        },
        success: {
          DEFAULT: '#16a34a', // green-600
          soft: '#f0fdf4', // green-50
        },
        warning: {
          DEFAULT: '#d97706', // amber-600
          soft: '#fffbeb', // amber-50
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        // Type scale — semantic names paired with the existing visual sizes.
        // Use these in primitives; reach for raw `text-xs/sm/base` only for one-offs.
        caption: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        meta: ['0.75rem', { lineHeight: '1rem' }],
        body: ['0.875rem', { lineHeight: '1.25rem' }],
        lead: ['1rem', { lineHeight: '1.5rem' }],
        title: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        headline: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        display: ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
      },
      borderRadius: {
        // Match what the codebase already uses; codified for consistency.
        pill: '9999px',
      },
      boxShadow: {
        // Semantic elevation scale.
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)',
        elevated: '0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 6px -2px rgba(15, 23, 42, 0.06)',
        popover: '0 12px 32px -8px rgba(15, 23, 42, 0.18), 0 4px 12px -4px rgba(15, 23, 42, 0.12)',
        drawer: '0 30px 80px -20px rgba(15, 23, 42, 0.35)',
        focus: '0 0 0 3px rgba(0, 82, 128, 0.18)',
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
    },
  },
  plugins: [],
};
