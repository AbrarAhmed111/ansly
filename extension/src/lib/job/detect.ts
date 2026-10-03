/**
 * Job-page detection for resume tailoring.
 *
 *   1. schema.org JobPosting JSON-LD
 *   2. Site adapters: LinkedIn, Indeed
 *   3. Generic heuristic (role title + long description block)
 *   4. Manual fallback: paste the description in the web app
 *
 * `peekJob` runs locally to decide whether to offer the card (title and company
 * only; nothing is sent). `extractJob` reads the description and runs only
 * after the user clicks Tailor Resume. There is no crawling.
 */

import type { JobPosting } from '@ansly/types'
import { indeedJobUrl, fromIndeed, isIndeedJob } from './adapters/indeed'
import { fromLinkedIn, isLinkedInJob, linkedInJobUrl } from './adapters/linkedin'
import { MIN_DESCRIPTION_CHARS, fromGeneric } from './generic'
import { fromJsonLd } from './json-ld'
import type { DetectedJob } from './types'

export { MIN_DESCRIPTION_CHARS }
export type { DetectedJob }

const DESCRIPTION_MAX = 20_000

/** Job boards with their own adapter: only the adapter (or JSON-LD) decides there, never the generic heuristic. */
const ADAPTER_SITES = /(^|\.)(linkedin\.com|indeed\.[a-z.]+)$/

function detect(doc: Document, url: URL, withDescription: boolean): DetectedJob | null {
  const siteJob = fromLinkedIn(doc, url, withDescription) ?? fromIndeed(doc, url, withDescription)
  const ld = fromJsonLd(doc, withDescription)
  if (ld) {
    // JSON-LD can be stale in single-page apps; the site adapter wins if it names a different job.
    if (siteJob && siteJob.title !== ld.title) return siteJob
    if (withDescription && !ld.description && siteJob?.description) return { ...ld, description: siteJob.description }
    return ld
  }
  if (siteJob || ADAPTER_SITES.test(url.hostname)) return siteJob
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
    return `${jobUrl(new URL(href))}|${job.title}`
  } catch {
    return job.title
  }
}
