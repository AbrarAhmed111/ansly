/**
 * LinkedIn job pages: /jobs/view/{id} and the split view (/jobs/search, /jobs/collections) with ?currentJobId=.
 * Selectors cover the signed-in app and the public (guest) page. Kept small on purpose.
 */

import { cleanText, visibleText } from '../../detection/question'
import { largestDescriptionBlock } from '../json-ld'
import type { DetectedJob } from '../types'

const TITLE = [
  '.job-details-jobs-unified-top-card__job-title h1',
  '.job-details-jobs-unified-top-card__job-title',
  '.jobs-unified-top-card__job-title',
  '.top-card-layout__title',
  'h1.t-24',
]
const COMPANY = [
  '.job-details-jobs-unified-top-card__company-name a',
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name',
  '.topcard__org-name-link',
  '.top-card-layout__card .topcard__flavor a',
]
const LOCATION = [
  '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
  '.job-details-jobs-unified-top-card__bullet',
  '.jobs-unified-top-card__bullet',
  '.topcard__flavor--bullet',
]
const DESCRIPTION = '#job-details, .jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, .description__text'

const first = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const el = doc.querySelector<HTMLElement>(selector)
    const text = el ? cleanText(visibleText(el)) : ''
    if (text) return text
  }
  return ''
}

export function isLinkedInJob(url: URL): boolean {
  return /(^|\.)linkedin\.com$/.test(url.hostname) && (/^\/jobs\/view\/\d+/.test(url.pathname) || url.searchParams.has('currentJobId'))
}

/** The job's own URL, not the search page it's shown in. */
export function linkedInJobUrl(url: URL): string {
  const id = url.searchParams.get('currentJobId') ?? url.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1]
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : `${url.origin}${url.pathname}`
}

export function fromLinkedIn(doc: Document, url: URL, withDescription: boolean): DetectedJob | null {
  if (!isLinkedInJob(url)) return null
  const title = first(doc, TITLE)
  if (!title) return null
  return {
    title,
    company: first(doc, COMPANY),
    location: first(doc, LOCATION) || null,
    employmentType: null,
    description: withDescription ? largestDescriptionBlock(doc, DESCRIPTION).replace(/^About the job\s*/i, '') : '',
    source: 'linkedin',
  }
}
