import { describe, expect, it } from 'vitest'
import { extractJobContext, isCoverLetter, parseTitle } from '../job-context'

function page(head: string, body = '') {
  document.head.innerHTML = head
  document.body.innerHTML = body
  const title = document.head.querySelector('title')
  document.title = title?.textContent ?? ''
}

describe('parseTitle', () => {
  it.each([
    ['Job Application for Senior Software Engineer at Acme', 'Senior Software Engineer', 'Acme'],
    ['Acme - Senior Product Engineer', 'Senior Product Engineer', 'Acme'],
    ['(3) Senior Frontend Engineer | Acme | LinkedIn', '(3) Senior Frontend Engineer', 'Acme'],
    ['Software Engineer - Acme - Indeed.com', 'Software Engineer', 'Acme'],
    ['Product Designer @ Example AI', 'Product Designer', 'Example AI'],
  ])('%s', (title, role, company) => {
    const parsed = parseTitle(title)
    expect(parsed.role?.replace(/^\(\d+\)\s*/, '')).toBe(role.replace(/^\(\d+\)\s*/, ''))
    expect(parsed.company).toBe(company)
  })

  it('returns nothing for titles without a role', () => {
    expect(parseTitle('Careers')).toEqual({ role: null, company: null })
  })
})

describe('extractJobContext', () => {
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Senior Product Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Example AI' },
    description: '<p>We build <b>AI tools</b>.</p><ul><li>Next.js</li><li>Python</li></ul>',
  }

  it('prefers JSON-LD JobPosting', () => {
    page(`<title>Apply</title><script type="application/ld+json">${JSON.stringify(posting)}</script>`)
    expect(extractJobContext(document, { includeDescription: false })).toMatchObject({
      role: 'Senior Product Engineer',
      company: 'Example AI',
      description: null,
    })
  })

  it('finds JobPosting inside @graph and ignores malformed blocks', () => {
    page(
      `<script type="application/ld+json">{not json</script>` +
        `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, posting] })}</script>`,
    )
    expect(extractJobContext(document, { includeDescription: false }).company).toBe('Example AI')
  })

  it('only includes the description when opted in', () => {
    page(`<script type="application/ld+json">${JSON.stringify(posting)}</script>`)
    const ctx = extractJobContext(document, { includeDescription: true })
    expect(ctx.description).toContain('We build AI tools')
    expect(ctx.description).toContain('Next.js')
  })

  it('falls back to the page title, og:site_name and h1', () => {
    page(`<title>Acme - Senior Product Engineer</title>`)
    expect(extractJobContext(document, { includeDescription: false })).toMatchObject({
      company: 'Acme',
      role: 'Senior Product Engineer',
    })
    page(`<title>Apply</title><meta property="og:site_name" content="Globex">`, '<h1>Data Engineer</h1>')
    expect(extractJobContext(document, { includeDescription: false })).toMatchObject({ company: 'Globex', role: 'Data Engineer' })
  })

  it('takes the description from the largest description block, never from the form', () => {
    const long = 'Responsibilities include building things. '.repeat(10)
    page('<title>Acme - Engineer</title>', `<div class="job-description">${long}</div><form class="description"><textarea></textarea></form>`)
    expect(extractJobContext(document, { includeDescription: true }).description?.trim()).toBe(long.trim())
  })

  it('url drops the query string', () => {
    page('<title>x</title>')
    const ctx = extractJobContext(document, { includeDescription: false })
    expect(ctx.url).not.toContain('?')
  })
})

describe('isCoverLetter', () => {
  it('spots cover and motivation letter fields, so they always get the job description', () => {
    for (const q of ['Cover letter', 'Covering Letter (optional)', 'Upload or paste your coverletter', 'Motivation letter', 'Letter of motivation']) {
      expect(isCoverLetter(q), q).toBe(true)
    }
    for (const q of ['Why do you want to work here?', 'Tell us about yourself', '', null]) {
      expect(isCoverLetter(q), String(q)).toBe(false)
    }
  })
})
