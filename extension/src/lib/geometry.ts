/** Placement math for the ✨ button and the popover (viewport coordinates). */

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export const SPARKLE_SIZE = 24
const GAP = 6
const MARGIN = 8

/** Inside the field's top-right corner (multi-line) or vertically centred (single-line). */
export function sparklePosition(field: Box, multiline: boolean): { top: number; left: number } {
  const left = field.left + field.width - SPARKLE_SIZE - 4
  const top = multiline ? field.top + 4 : field.top + (field.height - SPARKLE_SIZE) / 2
  return { top, left }
}

export function isOnScreen(field: Box, viewport: Viewport): boolean {
  return (
    field.width > 0 &&
    field.height > 0 &&
    field.top + field.height > 0 &&
    field.left + field.width > 0 &&
    field.top < viewport.height &&
    field.left < viewport.width
  )
}

/** Below the field when it fits, otherwise above; always kept inside the viewport. */
export function popoverPosition(
  field: Box,
  size: { width: number; height: number },
  viewport: Viewport,
): { top: number; left: number; placement: 'below' | 'above' } {
  const below = field.top + field.height + GAP
  const above = field.top - GAP - size.height
  const fitsBelow = below + size.height <= viewport.height - MARGIN
  const placement = fitsBelow || above < MARGIN ? 'below' : 'above'
  let top = placement === 'below' ? below : above
  top = Math.max(MARGIN, Math.min(top, viewport.height - size.height - MARGIN))
  const left = Math.max(MARGIN, Math.min(field.left, viewport.width - size.width - MARGIN))
  return { top, left, placement }
}

export function popoverWidth(field: Box, viewport: Viewport): number {
  return Math.min(Math.max(field.width, 380), 520, viewport.width - 2 * MARGIN)
}
