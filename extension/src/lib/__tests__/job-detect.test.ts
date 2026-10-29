import { describe, expect, it } from 'vitest'
import { explainNoJob, extractJob, jobKey, peekJob } from '../job/detect'
import {
  BLOG_POST,
  CAREER_PAGE,
  GREENHOUSE_JSON_LD,
  INDEED,
  LINKEDIN_SEARCH,
  LINKEDIN_VIEW,
  SHORT_POSTING,
  UNUSUAL_CLASS_JOB,
  WORK_AT_A_STARTUP,
  WORK_AT_A_STARTUP_ACTUAL,
} from './job-fixtures'

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
    ['Work at a Startup', WORK_AT_A_STARTUP, { title: 'Forward Deployed Engineer', company: 'Aktoria Robotics', source: 'generic' }],
    ['Work at a Startup listing markup', WORK_AT_A_STARTUP_ACTUAL, { title: 'Forward Deployed Engineer', company: 'Aktoria Robotics', source: 'generic' }],
    ['unusual job markup', UNUSUAL_CLASS_JOB, { title: 'Platform Engineer', company: 'Northstar', source: 'generic' }],
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

  it('extracts nested Work at a Startup content and labeled job details without navigation text', () => {
    const result = extractJob(load(WORK_AT_A_STARTUP), WORK_AT_A_STARTUP.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job).toMatchObject({
      company: 'Aktoria Robotics',
      title: 'Forward Deployed Engineer',
      location: 'Noida, India',
      employmentType: 'Full-time',
    })
    expect(result.job.description).toContain('₹12–20 LPA')
    expect(result.job.description).toContain('Lead customer calls and product demos.')
    expect(result.job.description).toContain('Python and Linux.')
    expect(result.job.description).not.toContain('Companies')
    expect(result.job.description).not.toContain('irrelevant decoration')
    expect(result.job.description).not.toContain('Apply')
  })

  it('extracts the role section and keeps company and technology context separate on Work at a Startup', () => {
    const result = extractJob(load(WORK_AT_A_STARTUP_ACTUAL), WORK_AT_A_STARTUP_ACTUAL.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job).toMatchObject({
      company: 'Aktoria Robotics',
      title: 'Forward Deployed Engineer',
    })
    expect(result.job.description).toContain('About the role')
    expect(result.job.description).toContain('Take customer calls and run demos')
    expect(result.job.description).toContain('Set up and support customer deployments')
    expect(result.job.description).toContain('Strong Python and Linux skills')
    expect(result.job.description).toContain('Ownership from first call to resolution')
    expect(result.job.description).toContain('About Aktoria Robotics')
    expect(result.job.description).toContain('Aktoria builds remote teleoperation software for robots')
    expect(result.job.description).toContain('Technology')
    expect(result.job.description).toContain('Low-latency, high-fidelity data streaming')
    expect(result.job.description).not.toContain('(S26)')
    expect(result.job.description).not.toContain('US citizenship/visa not required')
  })

  it('falls back to generic extraction when the Work at a Startup role section is missing', () => {
    const fixture = {
      ...WORK_AT_A_STARTUP_ACTUAL,
      html: WORK_AT_A_STARTUP_ACTUAL.html.replace('About the role', 'Responsibilities'),
    }
    const result = extractJob(load(fixture), fixture.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.title).toBe('Forward Deployed Engineer')
    expect(result.job.company).toBe('Aktoria Robotics')
    expect(result.job.description).toContain('Take customer calls and run demos')
  })

  it('uses semantic containers when classes do not identify the job description', () => {
    const result = extractJob(load(UNUSUAL_CLASS_JOB), UNUSUAL_CLASS_JOB.url)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.company).toBe('Northstar')
    expect(result.job.description).toContain('incident response experience')
  })

  it('refreshes a listing when its description is populated after initial render', () => {
    const doc = load(UNUSUAL_CLASS_JOB)
    const key = jobKey(doc, UNUSUAL_CLASS_JOB.url)
    const first = extractJob(doc, UNUSUAL_CLASS_JOB.url)
    doc.querySelector('main article section')!.innerHTML =
      `<h2>Responsibilities</h2><p>${'Build platform services for product teams. '.repeat(6)}</p><h2>Requirements</h2><p>Python and Linux.</p>`
    const second = extractJob(doc, UNUSUAL_CLASS_JOB.url)
    expect(first.ok && first.job.description).toContain('internal services')
    expect(second.ok && second.job.description).toContain('platform services')
    expect(jobKey(doc, UNUSUAL_CLASS_JOB.url)).toBe(key)
  })

  it('does not reuse stale JSON-LD when the visible single-page listing changes', () => {
    const doc = load({
      html: `<title>Old Engineer - Old Company</title>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'JobPosting',
          title: 'Old Engineer',
          hiringOrganization: { name: 'Old Company' },
          description: `Responsibilities: ${'Build services and support customers. '.repeat(8)}`,
        })}</script>
        <h1>Data Engineer</h1><div data-testid="company-name">New Company</div>
        <main><article><h2>Responsibilities</h2><p>${'Build data pipelines and maintain analytics services. '.repeat(8)}</p>
        <h2>Requirements</h2><p>SQL and Python.</p></article></main>`,
    })
    expect(peekJob(doc, 'https://jobs.example.com/123')).toMatchObject({
      title: 'Data Engineer',
      company: 'New Company',
      source: 'generic',
    })
    const extracted = extractJob(doc, 'https://jobs.example.com/123')
    expect(extracted.ok && extracted.job.description).toContain('data pipelines')
    expect(extracted.ok && extracted.job.description).not.toContain('support customers')
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
