/** Status colouring shared by badges, icon tiles, alerts and dots. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/** Tinted fill + border + text for small status surfaces. */
export const TONE_SURFACE: Record<Tone, string> = {
  neutral: 'border-border bg-surface-muted text-muted',
  accent: 'border-accent/20 bg-accent-soft text-accent',
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
}

/** Solid fill, for dots and indicators. */
export const TONE_FILL: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}
