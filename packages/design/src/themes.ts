import { palette } from './palette'

const { brand, neutral, green, amber, red } = palette

/**
 * Semantic colour tokens. Every UI colour comes from one of these, so a
 * component looks right in both themes without per-theme classes.
 * See the package README for what each token is for.
 */
export interface Theme {
  bg: string
  surface: string
  'surface-muted': string
  border: string
  'border-strong': string
  fg: string
  muted: string
  subtle: string
  accent: string
  'accent-fg': string
  'accent-soft': string
  success: string
  'success-soft': string
  warning: string
  'warning-soft': string
  danger: string
  'danger-soft': string
}

export type ThemeToken = keyof Theme

export const light: Theme = {
  bg: neutral[25],
  surface: neutral[0],
  'surface-muted': neutral[50],
  border: neutral[100],
  'border-strong': neutral[200],
  fg: neutral[900],
  muted: neutral[600],
  subtle: neutral[400],
  accent: brand[500],
  'accent-fg': neutral[0],
  'accent-soft': brand[50],
  success: green[600],
  'success-soft': green[50],
  warning: amber[600],
  'warning-soft': amber[50],
  danger: red[600],
  'danger-soft': red[50],
}

export const dark: Theme = {
  bg: neutral[950],
  surface: neutral[900],
  'surface-muted': neutral[850],
  border: neutral[800],
  'border-strong': neutral[700],
  fg: neutral[50],
  muted: neutral[300],
  subtle: neutral[500],
  accent: brand[400],
  'accent-fg': neutral[0],
  'accent-soft': brand[950],
  success: green[400],
  'success-soft': green[950],
  warning: amber[400],
  'warning-soft': amber[950],
  danger: red[400],
  'danger-soft': red[950],
}

export const themes = { light, dark } as const

/** Brand gradients, as ordered colour stops. */
export const gradients = {
  /** Light and airy: highlighted words, the sparkle button, avatars. */
  brand: [brand[500], palette.orchid[400], palette.blush[400]],
  /** Deep and saturated: large panels with white text. */
  deep: [brand[950], brand[700], palette.magenta[800]],
  /** Vivid: call-to-action blocks with white text. */
  vivid: [brand[600], palette.orchid[600], palette.magenta[600]],
} as const

export const linearGradient = (stops: readonly string[], angle = '120deg') =>
  `linear-gradient(${angle}, ${stops.join(', ')})`
