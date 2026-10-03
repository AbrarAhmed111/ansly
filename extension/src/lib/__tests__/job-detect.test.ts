import { describe, expect, it } from 'vitest'
import { explainNoJob, extractJob, jobKey, peekJob } from '../job/detect'
import { BLOG_POST, CAREER_PAGE, GREENHOUSE_JSON_LD, INDEED, LINKEDIN_SEARCH, LINKEDIN_VIEW, SHORT_POSTING } from './job-fixtures'

function load(fixture: { html: string }) {
  document.head.innerHTML = ''
  document.body.innerHTML = fixture.html
  document.title = document.querySelector('title')?.textContent ?? ''
  return document
}

describe('peekJob', () => {
  it.each([
    ['LinkedIn job view', LINKEDIN_VIEW, { title: 'Senior Full Stack Engineer', company: 'Company X', source: 'linkedin' }],
    ['LinkedIn search split view', LINKEDIN_SEARCH, { title: 'Product Engineer', company: 'Acme', source: 'linkedin' }],
    ['Indeed split view', INDEED, { title: 'Backend Developer', company: 'Fabrikam', source: 'indeed' }],
    ['JSON-LD career page', GREENHOUSE_JSON_LD, { title: 'Data Engineer', company: 'Example Corp', source: 'json-ld' }],
    ['generic career page', CAREER_PAGE, { title: 'Senior Product Designer', company: 'Litware', source: 'generic' }],
  ])('%s', (_name, fixture, expected) => {
    const job = peekJob(load(fixture), fixture.url)
    expect(job).toMatchObject(expected)
    // Peeking never reads the description.
    expect(job?.description).toBe('')
  })

  it('ignores pages that are not job postings', () => {
    expect(peekJob(load(BLOG_POST), BLOG_POST.url)).toBeNull()
    expect(peekJob(load(LINKEDIN_VIEW), 'https://www.linkedin.com/feed/')).toBeNull()
  })
})

describe('extractJob', () => {
  it('reads the full posting with a canonical job URL', () => {
    const result = extractJob(load(LINKEDIN_SEARCH), LINKEDIN_SEARCH.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.url).toBe('https://www.linkedin.com/jobs/view/4099999999/')
    expect(result.job.description).toContain('5+ years of professional software development experience.')
    expect(result.job.description).not.toContain('Many other jobs')
  })

  it('canonicalizes LinkedIn and Indeed URLs and strips tracking params elsewhere', () => {
    const linkedin = extractJob(load(LINKEDIN_VIEW), LINKEDIN_VIEW.url)
    const indeed = extractJob(load(INDEED), INDEED.url)
    const greenhouse = extractJob(load(GREENHOUSE_JSON_LD), GREENHOUSE_JSON_LD.url)
    expect(linkedin.ok && linkedin.job.url).toBe('https://www.linkedin.com/jobs/view/4012345678/')
    expect(indeed.ok && indeed.job.url).toBe('https://uk.indeed.com/viewjob?jk=abc123def')
    expect(greenhouse.ok && greenhouse.job.url).toBe('https://boards.greenhouse.io/examplecorp/jobs/123')
  })

  it('uses JSON-LD fields and turns its HTML description into lines of text', () => {
    const result = extractJob(load(GREENHOUSE_JSON_LD), GREENHOUSE_JSON_LD.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job).toMatchObject({ location: 'Berlin, DE', employmentType: 'full time', source: 'json-ld' })
    expect(result.job.description).toContain('Responsibilities\n')
    expect(result.job.description).not.toContain('<li>')
  })

  it('refuses a description that is too short, keeping what it found for the paste fallback', () => {
    const result = extractJob(load(SHORT_POSTING), SHORT_POSTING.url)
    expect(result).toMatchObject({ ok: false, reason: 'too_short', partial: { title: 'Engineer', company: 'Example' } })
    expect(extractJob(load(BLOG_POST), BLOG_POST.url)).toMatchObject({ ok: false, reason: 'no_job' })
  })

  it('never sends page HTML', () => {
    const result = extractJob(load(LINKEDIN_VIEW), LINKEDIN_VIEW.url)
    expect(result.ok && JSON.stringify(result.job)).not.toMatch(/<[a-z]/i)
  })
})

describe('jobKey', () => {
  it('changes when a single-page app switches jobs', () => {
    load(LINKEDIN_SEARCH)
    const first = jobKey(document, LINKEDIN_SEARCH.url)
    const second = jobKey(document, LINKEDIN_SEARCH.url.replace('4099999999', '4011111111'))
    expect(first).not.toBe(second)
    expect(jobKey(load(BLOG_POST), BLOG_POST.url)).toBeNull()
  })
})

const LONG = 'You will design, build and ship product features across the stack with a small team. '.repeat(4)

describe('detection matches what answer generation already finds', () => {
  it('LinkedIn with markup the adapter no longer knows: title from the page title, description from #job-details', () => {
    const doc = load({
      html: `<title>Senior AI Engineer | Acme | LinkedIn</title><main><div class="x7Fq"><h2>Senior AI Engineer</h2></div>
        <div id="job-details"><h2>About the job</h2><p>${LONG}</p><h3>Requirements</h3><p>Python, LLMs, RAG.</p></div></main>`,
    })
    const url = 'https://www.linkedin.com/jobs/search/?currentJobId=4100000001'
    expect(peekJob(doc, url)).toMatchObject({ title: 'Senior AI Engineer', company: 'Acme' })
    const extracted = extractJob(doc, url)
    expect(extracted.ok && extracted.job.url).toBe('https://www.linkedin.com/jobs/view/4100000001/')
  })

  it('never treats LinkedIn pages that are not a job (feed, profiles) as postings', () => {
    const doc = load({ html: `<title>Feed | LinkedIn</title><h1>Hiring: Senior Engineer</h1><main><article>Requirements: ${LONG} Benefits.</article></main>` })
    expect(peekJob(doc, 'https://www.linkedin.com/feed/')).toBeNull()
  })

  it('a career page whose title has no usual role word, but reads clearly like a job posting', () => {
    const doc = load({
      html: `<title>Founding Member of Technical Team — Nimbus</title><h1>Founding Member of Technical Team</h1>
        <section class="job-content"><h2>What you'll be doing</h2><p>${LONG}</p><h2>What we're looking for</h2>
        <p>Strong TypeScript.</p><h2>What we offer</h2><p>Equity and remote work.</p></section>`,
    })
    expect(peekJob(doc, 'https://nimbus.example/jobs/42')).toMatchObject({ title: 'Founding Member of Technical Team' })
    expect(extractJob(doc, 'https://nimbus.example/jobs/42').ok).toBe(true)
  })

  it('an application form page that shows the description next to the form', () => {
    const doc = load({
      html: `<title>Job Application for Full Stack Developer at Orbit</title><h1>Full Stack Developer</h1>
        <div class="job__description"><p>${LONG}</p><h3>Qualifications</h3><p>React and Node.js.</p></div>
        <form><label>Cover letter <textarea></textarea></label></form>`,
    })
    expect(peekJob(doc, 'https://job-boards.example.com/orbit/jobs/7')).toMatchObject({ title: 'Full Stack Developer', company: 'Orbit' })
    expect(extractJob(doc, 'https://job-boards.example.com/orbit/jobs/7').ok).toBe(true)
  })
})

describe('explainNoJob', () => {
  it('says why a page gets no tailoring offer', () => {
    expect(explainNoJob(load({ html: '<title>Feed | LinkedIn</title>' }), 'https://www.linkedin.com/feed/')).toMatch(/open a single job/)
    expect(explainNoJob(load({ html: '<title>Senior Engineer — Acme</title><main><p>Short.</p></main>' }), 'https://acme.example/x')).toMatch(
      /no job description block/,
    )
  })
})
