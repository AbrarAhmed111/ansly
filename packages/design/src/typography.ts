/**
 * Typography. Text sizes come only from this scale (Tailwind's default
 * text-xs … text-9xl are disabled in the web app). Each step carries its own
 * line height, tracking and weight, so `text-h2` alone is a complete heading.
 * See the package README for when to use each step.
 */

type Step = readonly [size: string, options: { lineHeight: string; letterSpacing?: string; fontWeight?: string }]

export const fontSize = {
  display: ['clamp(2.5rem, 1.6rem + 3.6vw, 3.625rem)', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '600' }],
  h1: ['clamp(1.875rem, 1.5rem + 1.5vw, 2.25rem)', { lineHeight: '1.15', letterSpacing: '-0.025em', fontWeight: '600' }],
  h2: ['1.625rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
  h3: ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.015em', fontWeight: '600' }],
  title: ['0.9375rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],
  lead: ['1.125rem', { lineHeight: '1.65' }],
  'body-lg': ['0.9375rem', { lineHeight: '1.6' }],
  body: ['0.875rem', { lineHeight: '1.5' }],
  'body-sm': ['0.8125rem', { lineHeight: '1.45' }],
  caption: ['0.75rem', { lineHeight: '1.4' }],
  overline: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em', fontWeight: '600' }],
} as const satisfies Record<string, Step>

export type FontSizeToken = keyof typeof fontSize

/** px values of the fixed steps, for plain-CSS consumers (the extension). */
export const fontSizePx = {
  h3: 18,
  title: 15,
  body: 14,
  'body-sm': 13,
  caption: 12,
  overline: 11,
} as const

export const fontFamily = {
  sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
  mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const

export const fontStack = (family: keyof typeof fontFamily) => fontFamily[family].join(', ')
