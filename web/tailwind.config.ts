import { fontSize, gradients, light, dark, linearGradient, palette, themeVars, type ThemeToken } from '@ansly/design'
import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

// Semantic tokens resolve to CSS variables so they switch with the theme and keep opacity modifiers.
const semantic = Object.fromEntries(
  (Object.keys(light) as ThemeToken[]).map((name) => [name, `rgb(var(--${name}) / <alpha-value>)`]),
)

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    // Only the type scale from @ansly/design: no text-sm, text-[13px], etc.
    fontSize: fontSize as unknown as NonNullable<Config['theme']>['fontSize'],
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: { ...semantic, ...palette },
      backgroundImage: {
        'gradient-brand': linearGradient(gradients.brand),
        'gradient-deep': linearGradient(gradients.deep, '135deg'),
        'gradient-vivid': linearGradient(gradients.vivid, '135deg'),
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.03)',
        raised: '0 8px 24px -6px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.12), 0 8px 32px -8px rgb(var(--accent) / 0.35)',
      },
      keyframes: {
        'sheet-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'sheet-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'sheet-in': 'sheet-in 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-in-left': 'sheet-in-left 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-up': 'fade-up 320ms cubic-bezier(0.32, 0.72, 0, 1) both',
      },
    },
  },
  plugins: [
    // Theme variables: light by default, dark from the OS unless the user chose light, or when forced.
    plugin(({ addBase }) => {
      addBase({
        ':root': { colorScheme: 'light', ...themeVars(light) },
        '@media (prefers-color-scheme: dark)': {
          ":root:not([data-theme='light'])": { colorScheme: 'dark', ...themeVars(dark) },
        },
        ":root[data-theme='dark']": { colorScheme: 'dark', ...themeVars(dark) },
      })
    }),
  ],
}

export default config
