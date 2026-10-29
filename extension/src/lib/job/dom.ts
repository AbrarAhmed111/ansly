export const JOB_DESCRIPTION_CONTENT_SELECTORS =
  '[itemprop="description"], [data-job-description], [id*="description" i], [class*="description" i], [data-testid*="description" i], [class*="job-details" i], [id*="job-details" i], [class*="jobDetails" i], [class*="posting" i], [class*="job-content" i], [class*="jobcontent" i]'
export const JOB_DESCRIPTION_SELECTORS = `${JOB_DESCRIPTION_CONTENT_SELECTORS}, article, main, [role="main"]`

const IGNORED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM',
])
const BLOCK_TAGS = /^(ADDRESS|ARTICLE|BLOCKQUOTE|DD|DIV|DL|DT|H[1-6]|LI|OL|P|SECTION|TABLE|TR|UL)$/
const DEDICATED_DESCRIPTION = /(description|job[-_ ]?details|job[-_ ]?content|posting|overview)/i

function isHidden(element: Element): boolean {
  if (
    element.hasAttribute('hidden') ||
    element.hasAttribute('inert') ||
    element.getAttribute('aria-hidden') === 'true' ||
    ['button', 'navigation', 'menu', 'menubar', 'toolbar'].includes(element.getAttribute('role') ?? '')
  ) {
    return true
  }
  const view = element.ownerDocument.defaultView
  if (view && element instanceof view.HTMLElement) {
    const style = view.getComputedStyle(element)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0' ||
      style.contentVisibility === 'hidden'
    ) return true
  }
  return false
}

/** Visible job text with UI regions removed and repeated rendered lines collapsed. */
export function visibleJobText(root: Element): string {
  const lines: string[] = []
  let current = ''
  const flush = () => {
    const line = current.replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
    current = ''
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (IGNORED_TAGS.has(element.tagName) || element.tagName === 'ANSLY-ROOT' || isHidden(element)) return
    const block = BLOCK_TAGS.test(element.tagName)
    if (block) flush()
    element.childNodes.forEach(walk)
    if (block) flush()
  }

  walk(root)
  flush()
  const seen = new Set<string>()
  return lines.filter((line) => {
    const key = line.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join('\n')
}

/** Chooses a description container before a broad article/main fallback. */
export function largestJobDescriptionBlock(doc: Document, selectors = JOB_DESCRIPTION_SELECTORS): string {
  const candidates = [...doc.querySelectorAll<HTMLElement>(selectors)]
  const specific = candidates.filter((element) =>
    DEDICATED_DESCRIPTION.test([
      element.id,
      element.className,
      element.getAttribute('data-testid'),
      element.getAttribute('aria-label'),
      element.getAttribute('itemprop'),
    ].join(' ')),
  )
  const bestText = (elements: HTMLElement[]) => {
    let best = ''
    for (const element of elements) {
      const text = visibleJobText(element)
      if (text.length > best.length) best = text
    }
    return best.length >= 200 ? best : ''
  }
  return bestText(specific) || bestText(candidates)
}
