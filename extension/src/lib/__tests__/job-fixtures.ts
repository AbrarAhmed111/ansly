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

const STARTUP_DESCRIPTION = `
  <h2>About the role</h2>
  <p>As a Forward Deployed Engineer, you will work directly with customers from discovery through deployment.</p>
  <h3>Responsibilities</h3>
  <ul><li>Lead customer calls and product demos.</li><li>Deploy, debug, and support production systems.</li></ul>
  <h3>Requirements</h3>
  <ul><li>Build with Python and Linux.</li><li>Communicate clearly in English and own work end to end.</li></ul>
  <p>Compensation: ₹12–20 LPA. We build robotics software for warehouse operations.</p>`

export const WORK_AT_A_STARTUP = {
  url: 'https://workatastartup.com/companies/aktoria/jobs/forward-deployed-engineer',
  html: `
<title>Forward Deployed Engineer at Aktoria Robotics | Work at a Startup</title>
<meta property="og:site_name" content="Work at a Startup">
<nav><a>Jobs</a><a>Companies</a><button>Apply</button></nav>
<main><article>
  <h1>Forward Deployed Engineer</h1>
  <div data-testid="company-name"><span>Aktoria Robotics</span></div>
  <dl><dt>Location</dt><dd>Noida, India</dd><dt>Employment type</dt><dd>Full-time</dd></dl>
  <section class="f3a1"><div><div>${STARTUP_DESCRIPTION}</div></div></section>
  <svg aria-hidden="true"><text>irrelevant decoration</text></svg>
</article></main>`,
}

export const WORK_AT_A_STARTUP_ACTUAL = {
  url: 'https://www.workatastartup.com/jobs/110498',
  html: `
<title>Forward Deployed Engineer at Aktoria Robotics | Work at a Startup</title>
<main>
  <div class="my-3 rounded-md border border-gray-300 bg-beige-lighter p-3 sm:pr-5">
    <h1>Forward Deployed Engineer at <a href="/companies/aktoria-robotics">Aktoria Robotics</a><span>(S26)</span></h1>
    <div><span>₹1.2M - ₹2M INR</span></div>
    <div>Noida, UP, IN / Noida, Uttar Pradesh, IN</div>
    <div><span>Full-time</span><span>US citizenship/visa not required</span></div>
    <div class="mt-5 border-t border-gray-300 pt-4">
      <span class="text-xl">About Aktoria Robotics</span>
      <div class="prose prose-p:mb-2 mt-2 max-w-none">
        <p>Aktoria builds remote teleoperation software for robots. A remote operator can run a robot anywhere in the world as if standing right next to it. Our product is what makes deployed robots useful today.</p>
      </div>
    </div>
    <div class="mt-3 border-t border-gray-300 pt-4">
      <span class="text-xl">About the role</span>
      <div class="prose prose-p:mb-2 mt-2 max-w-none">
        <p>We're hiring an engineer who enjoys working with customers.</p>
        <p><strong>What you'll do</strong></p>
        <p>- Take customer calls and run demos</p>
        <p>- Set up and support customer deployments</p>
        <p>- Debug technical issues end to end</p>
        <p>- Follow up with customers and keep things moving</p>
        <p><strong>What you need</strong></p>
        <p>- 1-3 years in an engineering role</p>
        <p>- Strong Python and Linux skills</p>
        <p>- Clear, confident communication in English</p>
        <p>- Ownership from first call to resolution</p>
        <p><strong>Nice to have</strong></p>
        <p>- Robotics experience</p>
        <p>- Customer-facing or startup experience</p>
        <p><strong>Details</strong></p>
        <p>- Noida, on-site, full-time</p>
        <p>- Some evening overlap with US time zones</p>
        <p>- ₹12-20 LPA</p>
      </div>
    </div>
    <div class="mt-3 border-t border-gray-300 pt-4">
      <span class="text-xl">Technology</span>
      <div class="prose prose-p:mb-2 mt-2 max-w-none">
        <p>Remote teleoperation of robots over the public internet. Core problems:</p>
        <ul>
          <li>Remote operations over unreliable networks.</li>
          <li>Low-latency, high-fidelity data streaming for high telepresence.</li>
          <li>A custom transport and networking stack built for real-time control.</li>
          <li>Supporting different robots and hardware in the field, over varying connections.</li>
        </ul>
      </div>
    </div>
  </div>
</main>`,
}

export const UNUSUAL_CLASS_JOB = {
  url: 'https://careers.example.com/openings/17',
  html: `
<title>Platform Engineer - Northstar</title>
<main><article><h1>Platform Engineer</h1>
  <section><h2>What you'll do</h2>
    <p>${'Build and operate reliable internal services for product teams. '.repeat(5)}</p>
    <h2>What we're looking for</h2><p>Python, Linux, and incident response experience.</p>
  </section>
</article></main>`,
}
