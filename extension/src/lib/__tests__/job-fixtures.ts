/**
 * Simplified copies of real job posting pages. They keep the parts detection
 * relies on: JSON-LD, the sites' own class names / test ids, and page text.
 */

const REQUIREMENTS = `
  <h3>Responsibilities</h3>
  <ul><li>Build product features end to end across our React front end and Node.js services.</li>
  <li>Own performance, reliability and observability of the services you build.</li></ul>
  <h3>Requirements</h3>
  <ul><li>5+ years of professional software development experience.</li>
  <li>Strong TypeScript, React and PostgreSQL skills.</li>
  <li>Experience building SaaS platforms.</li></ul>
  <h3>Nice to have</h3>
  <ul><li>Kubernetes and AWS EKS.</li></ul>`

export const LINKEDIN_VIEW = {
  url: 'https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=xyz',
  html: `
<title>Senior Full Stack Engineer | Company X | LinkedIn</title>
<div class="job-details-jobs-unified-top-card__company-name"><a href="/company/x">Company X</a></div>
<div class="job-details-jobs-unified-top-card__job-title"><h1 class="t-24">Senior Full Stack Engineer</h1></div>
<div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">Remote</span></div>
<input type="text" aria-label="Search">
<div class="jobs-description__content"><div id="job-details"><h2>About the job</h2>${REQUIREMENTS}</div></div>`,
}

export const LINKEDIN_SEARCH = {
  url: 'https://www.linkedin.com/jobs/search/?currentJobId=4099999999&keywords=engineer',
  html: `
<title>(12) Engineer Jobs | LinkedIn</title>
<ul class="jobs-search-results-list"><li>Many other jobs…</li></ul>
<div class="jobs-unified-top-card__company-name">Acme</div>
<h1 class="jobs-unified-top-card__job-title">Product Engineer</h1>
<div class="jobs-box__html-content">${REQUIREMENTS}</div>`,
}

export const INDEED = {
  url: 'https://uk.indeed.com/jobs?q=engineer&vjk=abc123def',
  html: `
<title>Engineer jobs | Indeed</title>
<h1 class="jobsearch-JobInfoHeader-title" data-testid="jobsearch-JobInfoHeader-title"><span>Backend Developer - job post</span></h1>
<div data-testid="inlineHeader-companyName"><a>Fabrikam</a></div>
<div data-testid="inlineHeader-companyLocation">London</div>
<div id="jobDescriptionText">${REQUIREMENTS}</div>`,
}

export const GREENHOUSE_JSON_LD = {
  url: 'https://boards.greenhouse.io/examplecorp/jobs/123?gh_src=x',
  html: `
<title>Job Application for Data Engineer at Example Corp</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Data Engineer',
    hiringOrganization: { '@type': 'Organization', name: 'Example Corp' },
    employmentType: 'FULL_TIME',
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: 'DE' } },
    description: `<p>We move data.</p>${REQUIREMENTS}`,
  })}</script>
<div id="content"><h1>Data Engineer</h1><p>We move data.</p></div>
<form><label for="q">Why us?</label><textarea id="q"></textarea></form>`,
}

export const CAREER_PAGE = {
  url: 'https://careers.litware.com/positions/senior-designer',
  html: `
<title>Senior Product Designer - Litware Careers</title>
<meta property="og:site_name" content="Litware">
<main><h1>Senior Product Designer</h1>
<div class="posting-content"><p>Litware is hiring a product designer to lead our design system.</p>
${REQUIREMENTS.replace(/React/g, 'Figma')}</div></main>`,
}

export const BLOG_POST = {
  url: 'https://blog.example.com/how-we-hire-engineers',
  html: `
<title>How we hire engineers - Example Blog</title>
<main><h1>How we hire engineers</h1>
<article><p>${'We talk a lot about hiring and teams. '.repeat(30)}</p></article></main>`,
}

export const SHORT_POSTING = {
  url: 'https://jobs.example.com/123',
  html: `
<title>Engineer - Example</title>
<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title: 'Engineer',
    hiringOrganization: 'Example',
    description: 'Apply now.',
  })}</script>`,
}
