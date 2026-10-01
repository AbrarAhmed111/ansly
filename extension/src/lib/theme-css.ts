import { dark, light, themeDeclarations } from '@ansly/design'

/**
 * Theme variables from @ansly/design for plain-CSS surfaces (popup and the
 * in-page UI). Values are RGB channels: use `rgb(var(--a-accent))`, or
 * `rgb(var(--a-accent) / 0.2)` for transparency.
 *
 * `selector` gets the light theme; dark applies when `forcedDark` matches, or
 * under the OS dark preference when `systemDark` matches.
 */
export function themeCss({
  selector,
  forcedDark,
  systemDark,
  prefix = 'a',
}: {
  selector: string
  forcedDark?: string
  systemDark: string
  prefix?: string
}): string {
  const lightVars = themeDeclarations(light, prefix)
  const darkVars = themeDeclarations(dark, prefix)
  return [
    `${selector} { ${lightVars} }`,
    forcedDark ? `${forcedDark} { ${darkVars} }` : '',
    `@media (prefers-color-scheme: dark) { ${systemDark} { ${darkVars} } }`,
  ].join('\n')
}
