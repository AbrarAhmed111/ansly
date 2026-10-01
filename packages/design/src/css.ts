import type { Theme } from './themes'

/** "#635bff" -> "99 91 255", the form `rgb(var(--x) / <alpha>)` needs. */
export function hexToChannels(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/**
 * CSS custom properties for a theme, as space-separated RGB channels
 * (`--accent: 99 91 255`). Use as `rgb(var(--accent))` or
 * `rgb(var(--accent) / 0.2)`. `prefix` namespaces them ("a" -> `--a-accent`).
 */
export function themeVars(theme: Theme, prefix = ''): Record<string, string> {
  const p = prefix ? `--${prefix}-` : '--'
  return Object.fromEntries(Object.entries(theme).map(([k, v]) => [`${p}${k}`, hexToChannels(v)]))
}

/** The same variables as a declaration list, for plain CSS strings. */
export function themeDeclarations(theme: Theme, prefix = ''): string {
  return Object.entries(themeVars(theme, prefix))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}
