/**
 * Job-page detection for resume tailoring.
 *
 *   1. schema.org JobPosting JSON-LD
 *   2. Site adapters: LinkedIn, Indeed, Work at a Startup
 *   3. Generic heuristic (role title + long description block)
 *   4. Manual fallback: paste the description in the web app
 *
 * `peekJob` reads only the local title and company. `extractJob` reads the
 * description locally to check the offer and when the user clicks Tailor
 * Resume; nothing is sent until the user asks to tailor. There is no crawling.
 */

import type { JobPosting } from '@ansly/types'
import { indeedJobUrl, fromIndeed, isIndeedJob } from './adapters/indeed'
import { fromLinkedIn, isLinkedInJob, linkedInJobUrl } from './adapters/linkedin'
import { fromWorkAtAStartup, isWorkAtAStartupJob } from './adapters/work-at-a-startup'
import { DESCRIPTION_SELECTORS, MIN_DESCRIPTION_CHARS, fromGeneric, jobSignals, pageJobTitle } from './generic'
import { fromJsonLd, largestDescriptionBlock } from './json-ld'
import type { DetectedJob } from './types'

export { DESCRIPTION_SELECTORS, MIN_DESCRIPTION_CHARS }
export type { DetectedJob }

const DESCRIPTION_MAX = 20_000

/** Job boards with their own adapter: the adapter (or JSON-LD) decides there; the generic heuristic only backs it up on job URLs. */
const ADAPTER_SITES = /(^|\.)(linkedin\.com|indeed\.[a-z.]+)$/
const BOARD_DESCRIPTIONS =
  '#job-details, [class*="jobs-description" i], [class*="job-details" i], #jobDescriptionText, [id*="jobDescription" i], [class*="jobsearch-jobDescription" i], [class*="description" i]'

function detect(doc: Document, url: URL, withDescription: boolean): DetectedJob | null {
  const siteJob =
    fromLinkedIn(doc, url, withDescription) ??
    fromIndeed(doc, url, withDescription) ??
    (isWorkAtAStartupJob(url) ? fromWorkAtAStartup(doc, withDescription) : null)
  const ld = fromJsonLd(doc, withDescription)
  if (ld) {
    // JSON-LD can be stale in single-page apps; a site adapter wins if it names a different job.
    if (
      siteJob &&
      (siteJob.title !== ld.title || (siteJob.company && ld.company && siteJob.company !== ld.company))
    ) return siteJob
    const page = pageJobTitle(doc)
    if (
      (!siteJob || (siteJob.title === ld.title && siteJob.company === ld.company)) &&
      ((page.title && page.title !== ld.title) || (page.company && ld.company && page.company !== ld.company))
    ) {
      return fromGeneric(doc, withDescription) ?? null
    }
    if (withDescription && !ld.description && siteJob?.description) return { ...ld, description: siteJob.description }
    return {
      ...ld,
      company: ld.company || siteJob?.company || page.company,
      location: ld.location ?? siteJob?.location ?? null,
      employmentType: ld.employmentType ?? siteJob?.employmentType ?? null,
    }
  }
  if (siteJob) return siteJob
  if (ADAPTER_SITES.test(url.hostname)) {
    // The boards change their markup often. On an actual job URL (never the feed or search list alone),
    // fall back to the page title and the board's description containers.
    if (!isLinkedInJob(url) && !isIndeedJob(url)) return null
    return fromGeneric(doc, withDescription, BOARD_DESCRIPTIONS)
  }
  return fromGeneric(doc, withDescription)
}

function jobUrl(url: URL): string {
  if (isLinkedInJob(url)) return linkedInJobUrl(url)
  if (isIndeedJob(url)) return indeedJobUrl(url)
  return `${url.origin}${url.pathname}`
}

/** Is this a job posting? Title and company only, for the card. */
export function peekJob(doc: Document, href = doc.defaultView?.location.href ?? ''): DetectedJob | null {
  try {
    return detect(doc, new URL(href), false)
  } catch {
    return null
  }
}

export type ExtractResult = { ok: true; job: JobPosting } | { ok: false; reason: 'no_job' | 'too_short'; partial: DetectedJob | null }

/** The full JobPosting, read only when the user asks to tailor. */
export function extractJob(doc: Document, href = doc.defaultView?.location.href ?? ''): ExtractResult {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { ok: false, reason: 'no_job', partial: null }
  }
  const found = detect(doc, url, true)
  if (!found) return { ok: false, reason: 'no_job', partial: null }
  const description = found.description.trim().slice(0, DESCRIPTION_MAX)
  if (description.length < MIN_DESCRIPTION_CHARS) return { ok: false, reason: 'too_short', partial: found }
  return {
    ok: true,
    job: {
      title: found.title.slice(0, 300),
      company: found.company.slice(0, 300),
      location: found.location?.slice(0, 300) ?? null,
      employmentType: found.employmentType?.slice(0, 100) ?? null,
      description,
      url: jobUrl(url),
      source: found.source,
    },
  }
}

/** A stable key for "this job", so the card resets when an SPA switches jobs. */
export function jobKey(doc: Document, href = doc.defaultView?.location.href ?? ''): string | null {
  const job = peekJob(doc, href)
  if (!job) return null
  try {
    return JSON.stringify([jobUrl(new URL(href)), job.title, job.company, job.location])
  } catch {
    return JSON.stringify([job.title, job.company, job.location])
  }
}

/** Why the tailoring offer isn't shown on this page (for the detection debug setting). */
export function explainNoJob(doc: Document, href = doc.defaultView?.location.href ?? ''): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return 'not a web page'
  }
  if (ADAPTER_SITES.test(url.hostname) && !isLinkedInJob(url) && !isIndeedJob(url)) {
    return 'on LinkedIn/Indeed, open a single job (its own page, or one selected in the search list)'
  }
  const { title } = pageJobTitle(doc)
  if (!title) return 'no job title found (no usable <h1> or page title)'
  const description = largestDescriptionBlock(doc, DESCRIPTION_SELECTORS)
  if (description.length < MIN_DESCRIPTION_CHARS) {
    return `no job description block found (largest candidate: ${description.length} characters, needs ${MIN_DESCRIPTION_CHARS})`
  }
  return `"${title}" and its ${description.length}-character description don't read like a job posting (${jobSignals(description)} posting phrases)`
}
