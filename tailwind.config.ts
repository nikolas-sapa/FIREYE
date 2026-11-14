import type { Config } from 'tailwindcss';

/**
 * Tailwind is wired to the CSS custom properties in
 * src/design-system/tokens/tokens.css. Never hardcode hex values in components;
 * use these utility names (e.g. bg-ink-900, text-bone, border-line, text-signal).
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: v('void'),
        ink: {
          950: v('ink-950'), 900: v('ink-900'), 850: v('ink-850'), 800: v('ink-800'),
          700: v('ink-700'), 600: v('ink-600'), 500: v('ink-500'), 400: v('ink-400'),
          300: v('ink-300'), 200: v('ink-200'), 100: v('ink-100'),
        },
        bone: { DEFAULT: v('bone'), dim: v('bone-dim'), mute: v('bone-mute') },
        line: { DEFAULT: v('line'), strong: v('line-strong'), faint: v('line-faint') },
        signal: { DEFAULT: v('signal'), hot: v('signal-hot'), deep: v('signal-deep'), wash: v('signal-wash') },
        ember: v('ember'),
        amber: v('amber'),
        phosphor: v('phosphor'),
        ice: v('ice'),
        violet: v('violet'),
      },
      fontFamily: {
        // Stacks live in tokens.css (--font-sans / --font-mono) so data-theme can swap them.
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        // micro scale — micrographic labels
        'micro': ['9px', { lineHeight: '12px', letterSpacing: '0.14em' }],
        'nano': ['10px', { lineHeight: '14px', letterSpacing: '0.12em' }],
        'tiny': ['11px', { lineHeight: '16px', letterSpacing: '0.06em' }],
        'xs': ['12px', { lineHeight: '16px' }],
        'sm': ['13px', { lineHeight: '20px' }],
        'base': ['15px', { lineHeight: '24px' }],
        'lg': ['18px', { lineHeight: '26px', letterSpacing: '-0.01em' }],
        'xl': ['22px', { lineHeight: '30px', letterSpacing: '-0.015em' }],
        '2xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.02em' }],
        '3xl': ['40px', { lineHeight: '44px', letterSpacing: '-0.025em' }],
        '4xl': ['56px', { lineHeight: '58px', letterSpacing: '-0.03em' }],
        '5xl': ['80px', { lineHeight: '80px', letterSpacing: '-0.035em' }],
        '6xl': ['120px', { lineHeight: '112px', letterSpacing: '-0.045em' }],
      },
      borderRadius: { none: '0', hair: '1px', xs: '2px', sm: '3px', DEFAULT: '4px', md: '6px', lg: '10px', pill: '999px' },
      spacing: { 'px2': '2px', '4.5': '18px', '13': '52px', '15': '60px', '18': '72px', '30': '120px' },
      transitionTimingFunction: {
        servo: 'cubic-bezier(0.2, 0.0, 0.0, 1.0)',
        snap: 'cubic-bezier(0.7, 0.0, 0.2, 1.0)',
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: { instant: '80ms', quick: '140ms', base: '220ms', slow: '420ms', drift: '900ms' },
      boxShadow: {
        panel: '0 0 0 1px rgb(var(--line) / 1), 0 24px 48px -24px rgb(0 0 0 / 0.8)',
        lift: '0 0 0 1px rgb(var(--line-strong) / 1), 0 32px 64px -24px rgb(0 0 0 / 0.9)',
        signal: '0 0 0 1px rgb(var(--signal) / 0.6), 0 0 24px -4px rgb(var(--signal) / 0.45)',
        inset: 'inset 0 0 0 1px rgb(var(--line) / 1)',
      },
      zIndex: { base: '0', raised: '10', overlay: '40', hud: '50', modal: '80', toast: '90' },
      keyframes: {
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        blink: { '0%,49%': { opacity: '1' }, '50%,100%': { opacity: '0' } },
        pulseRing: { '0%': { transform: 'scale(0.6)', opacity: '0.9' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
        rise: { '0%': { transform: 'translateY(6px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        sweep: 'sweep 2.4s cubic-bezier(0.7,0,0.2,1) infinite',
        blink: 'blink 1.1s steps(1) infinite',
        'pulse-ring': 'pulseRing 1.8s cubic-bezier(0.16,1,0.3,1) infinite',
        rise: 'rise 420ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;
