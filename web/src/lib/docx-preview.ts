'use client'

import { tailoringFiles } from '@/lib/api'
import { load } from '@/lib/cache'

/**
 * Word document preview, rendered in the browser from the real .docx bytes.
 *
 * The API runs on serverless hosts with no Word/LibreOffice renderer, so the
 * preview uses docx-preview: page size, margins, fonts, colors, bullets,
 * tables, columns, headers, footers and images come from the document itself.
 * docx-preview only starts a new page at explicit page/section breaks, so
 * `paginate` then moves content that overflows a page onto the next one, the
 * way Word would, which is what makes "your resume is now 2 pages" visible.
 *
 * The renderer (~100 KB) is loaded on demand, and the documents are fetched
 * once per tailoring and kept in memory, so reopening the preview is instant.
 */

export interface PreviewDocuments {
  format: 'docx' | 'pdf'
  tailored: ArrayBuffer
  tailoredName: string
  /** null when the original version was deleted (or couldn't be fetched). */
  original: ArrayBuffer | null
  originalName: string | null
}

let renderer: Promise<typeof import('docx-preview')> | null = null

/** Starts downloading the renderer; safe to call often. */
export function loadRenderer() {
  renderer ??= import('docx-preview').catch((e) => {
    renderer = null
    throw e
  })
  return renderer
}

async function bytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download the document (HTTP ${res.status})`)
  return res.arrayBuffer()
}

/** Both documents for a tailoring, fetched in parallel and cached for the session. */
export function previewDocuments(tailoringId: string): Promise<PreviewDocuments> {
  return load(`preview:${tailoringId}`, async () => {
    const files = await tailoringFiles(tailoringId)
    const [tailored, original] = await Promise.all([
      bytes(files.tailored.url),
      files.original ? bytes(files.original.url).catch(() => null) : Promise.resolve(null),
    ])
    return {
      format: files.format,
      tailored,
      tailoredName: files.tailored.fileName,
      original,
      originalName: files.original?.fileName ?? null,
    }
  })
}

/** Warms everything the preview needs, so opening it doesn't wait. Errors surface when the preview opens. */
export function prefetchPreview(tailoringId: string) {
  void loadRenderer().catch(() => undefined)
  void previewDocuments(tailoringId).catch(() => undefined)
}

// -- pagination -----------------------------------------------------------------

export interface Measure {
  /** Where content must stop on this page, in px from the page's top edge. */
  limit(page: HTMLElement): number
  /** Bottom edge of a block, in px from its page's top edge. */
  bottom(block: HTMLElement): number
}

const px = (value: string | null | undefined) => parseFloat(value ?? '') || 0

export const domMeasure: Measure = {
  limit(page) {
    const style = getComputedStyle(page)
    const height = px(style.minHeight) || page.offsetHeight
    const footer = page.querySelector<HTMLElement>(':scope > footer')
    let footerSpace = 0
    if (footer) {
      const f = getComputedStyle(footer)
      footerSpace = Math.max(0, footer.offsetHeight + px(f.marginTop) + px(f.marginBottom))
    }
    return height - px(style.paddingBottom) - footerSpace
  },
  bottom(block) {
    return block.offsetTop + block.offsetHeight
  },
}

const MAX_PAGES = 60

/**
 * Splits every page whose content runs past its bottom margin into as many pages
 * as it needs, repeating the page's header and footer. Multi-column sections are
 * left alone (the browser balances their columns). Returns the page count.
 */
export function paginate(wrapper: HTMLElement, measure: Measure = domMeasure): number {
  const pages = () => Array.from(wrapper.children).filter((el): el is HTMLElement => el.tagName === 'SECTION')
  const queue = pages()
  let created = 0
  while (queue.length && created < MAX_PAGES) {
    const page = queue.shift()!
    const article = page.querySelector<HTMLElement>(':scope > article')
    if (!article || article.style.columnCount) continue
    const blocks = Array.from(article.children) as HTMLElement[]
    const limit = measure.limit(page)
    const split = blocks.findIndex((block, i) => i > 0 && measure.bottom(block) > limit)
    if (split < 0) continue
    const next = page.cloneNode(false) as HTMLElement
    const header = page.querySelector(':scope > header')
    const footer = page.querySelector(':scope > footer')
    if (header) next.appendChild(header.cloneNode(true))
    const nextArticle = article.cloneNode(false) as HTMLElement
    next.appendChild(nextArticle)
    for (const block of blocks.slice(split)) nextArticle.appendChild(block)
    if (footer) next.appendChild(footer.cloneNode(true))
    page.after(next)
    queue.unshift(next)
    created++
  }
  const all = pages()
  wrapper.querySelectorAll(':scope > .ansly-page-label').forEach((label) => label.remove())
  all.forEach((page, i) => {
    const text = `Page ${i + 1} of ${all.length}`
    page.dataset.page = text
    page.setAttribute('role', 'region')
    page.setAttribute('aria-label', text)
    // A visible boundary under every page.
    const label = document.createElement('div')
    label.className = 'ansly-page-label'
    label.textContent = text
    page.after(label)
  })
  return all.length
}

/** Width of the first page in CSS px (for "fit to width"). */
export function pageWidth(container: HTMLElement): number {
  const page = container.querySelector<HTMLElement>('section')
  return page?.offsetWidth || 816
}

// -- PDF ---------------------------------------------------------------------------

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Print styles for the rendered pages: one sheet per page, the page's own size, no screen chrome.
 * Exported for tests.
 */
export function printCss(className: string, width: string, height: string): string {
  return `
@page { size: ${width} ${height}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.${className}-wrapper { display: block !important; background: transparent !important; padding: 0 !important; }
.${className}-wrapper > section.${className} {
  margin: 0 !important; box-shadow: none !important; border-radius: 0 !important;
  width: ${width} !important; min-height: 0 !important; height: calc(${height} - 1px) !important; overflow: hidden;
  break-after: page; page-break-after: always;
}
.${className}-wrapper > section.${className}:last-of-type { break-after: auto; page-break-after: auto; }
.ansly-page-label { display: none !important; }
`
}

/**
 * Saves the tailored resume as a PDF: lays it out exactly like the preview, then opens the browser's
 * print dialog on just those pages, named after the file ("Save as PDF" is the default destination).
 * There's no Word renderer on the server, so this is the PDF the preview shows, page for page, with
 * real (selectable, ATS-readable) text.
 */
export async function saveAsPdf(tailoringId: string): Promise<void> {
  const docs = await previewDocuments(tailoringId)
  const name = docs.tailoredName.replace(/\.(docx|pdf)$/i, '')
  if (docs.format === 'pdf') {
    const url = URL.createObjectURL(new Blob([docs.tailored], { type: 'application/pdf' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.pdf` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return
  }

  const className = 'docx-pdf'
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;'
  document.body.appendChild(host)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  try {
    await renderDocx(docs.tailored, host, className)
    const page = host.querySelector<HTMLElement>(`section.${className}`)
    if (!page) throw new Error('The document could not be laid out')
    const width = page.style.width || `${page.offsetWidth}px`
    const height = page.style.minHeight || page.style.height || `${page.offsetHeight}px`

    document.body.appendChild(frame)
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) throw new Error('Could not prepare the PDF')
    doc.open()
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>` +
        `<style>${printCss(className, width, height)}</style></head><body>${host.innerHTML}</body></html>`,
    )
    doc.close()
    await doc.fonts?.ready
    await Promise.all(
      Array.from(doc.images, (img) => (img.complete ? null : new Promise((done) => (img.onload = img.onerror = done)))),
    )
    // Chrome names the PDF after the top document's title.
    const title = document.title
    document.title = name
    try {
      win.focus()
      win.print()
    } finally {
      document.title = title
    }
  } finally {
    host.remove()
    // print() returns when the dialog closes in most browsers; Safari returns at once, so give it time.
    setTimeout(() => frame.remove(), 60_000)
  }
}

/** Renders `data` into `container` (cleared first) and paginates it. Returns the page count. */
export async function renderDocx(data: ArrayBuffer, container: HTMLElement, className: string): Promise<number> {
  const { renderAsync } = await loadRenderer()
  container.innerHTML = ''
  await renderAsync(data.slice(0), container, container, {
    className,
    inWrapper: true,
    breakPages: true,
    // Word's saved page-break markers are stale after tailoring; pages are worked out from the content instead.
    ignoreLastRenderedPageBreak: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    experimental: true,
    useBase64URL: true,
  })
  // Fonts change line heights: lay out with the real fonts before measuring pages.
  await document.fonts?.ready
  const wrapper = container.querySelector<HTMLElement>(`.${className}-wrapper`)
  if (!wrapper) throw new Error('The document could not be laid out')
  return paginate(wrapper)
}
