/**
 * @jest-environment jsdom
 */
import { type Measure, paginate, printCss } from '../docx-preview'

jest.mock('@/lib/api', () => ({ tailoringFiles: jest.fn() }))

/** A docx-preview page: header, article of blocks (each `data-bottom` px from the page top), footer. */
function page(bottoms: number[], options: { columns?: boolean } = {}) {
  const section = document.createElement('section')
  section.className = 'docx-tailored'
  section.style.minHeight = '1056px'
  section.innerHTML =
    `<header>Header</header><article${options.columns ? ' style="column-count: 2"' : ''}>` +
    bottoms.map((b, i) => `<p data-bottom="${b}">Block ${i + 1}</p>`).join('') +
    '</article><footer>Page footer</footer>'
  return section
}

/** Fake layout: content may end 1000px down a page; each block knows its bottom relative to the first block on its page. */
const measure: Measure = {
  limit: () => 1000,
  bottom(block) {
    const first = block.parentElement!.firstElementChild as HTMLElement
    return Number(block.dataset.bottom) - Number(first.dataset.bottom) + 100
  },
}

function wrapper(...pages: HTMLElement[]) {
  const div = document.createElement('div')
  div.className = 'docx-tailored-wrapper'
  pages.forEach((p) => div.appendChild(p))
  return div
}

const sections = (w: HTMLElement) => [...w.querySelectorAll(':scope > section')] as HTMLElement[]
const blocks = (s: HTMLElement) => [...s.querySelectorAll('article > p')].map((p) => p.textContent)

describe('paginate', () => {
  it('leaves a one-page resume as one page, with a visible page label', () => {
    const w = wrapper(page([200, 500, 900]))
    expect(paginate(w, measure)).toBe(1)
    expect(sections(w)[0]!.dataset.page).toBe('Page 1 of 1')
    expect(w.querySelector('.ansly-page-label')?.textContent).toBe('Page 1 of 1')
  })

  it('moves content that runs past the bottom margin onto new pages, repeating header and footer', () => {
    const w = wrapper(page([300, 700, 1000, 1400, 1900, 2400]))
    expect(paginate(w, measure)).toBe(3)
    const [one, two, three] = sections(w)
    expect(blocks(one!)).toEqual(['Block 1', 'Block 2', 'Block 3'])
    expect(blocks(two!)).toEqual(['Block 4', 'Block 5'])
    expect(blocks(three!)).toEqual(['Block 6'])
    for (const s of [one, two, three]) {
      expect(s!.querySelector('header')?.textContent).toBe('Header')
      expect(s!.querySelector('footer')?.textContent).toBe('Page footer')
      expect(s!.className).toBe('docx-tailored')
    }
    expect([...w.querySelectorAll('.ansly-page-label')].map((l) => l.textContent)).toEqual([
      'Page 1 of 3',
      'Page 2 of 3',
      'Page 3 of 3',
    ])
  })

  it('keeps explicit page breaks (already separate pages) and never loops on a block taller than a page', () => {
    const w = wrapper(page([200]), page([5000]), page([100, 2000]))
    expect(paginate(w, measure)).toBe(4)
    expect(sections(w).map(blocks)).toEqual([['Block 1'], ['Block 1'], ['Block 1'], ['Block 2']])
  })

  it('leaves multi-column sections to the browser', () => {
    const w = wrapper(page([300, 1500, 2600], { columns: true }))
    expect(paginate(w, measure)).toBe(1)
  })

  it('relabels when run again', () => {
    const w = wrapper(page([300, 1500]))
    paginate(w, measure)
    paginate(w, measure)
    expect(w.querySelectorAll('.ansly-page-label')).toHaveLength(2)
  })
})

describe('printCss', () => {
  it('prints one sheet per page at the document’s own size, without the preview chrome', () => {
    const css = printCss('docx-pdf', '612pt', '792pt')
    expect(css).toContain('@page { size: 612pt 792pt; margin: 0; }')
    expect(css).toContain('break-after: page')
    expect(css).toContain('.ansly-page-label { display: none !important; }')
  })
})
