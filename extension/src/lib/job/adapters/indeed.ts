/**
 * Indeed job pages: /viewjob?jk= and the split view (?vjk=) on any Indeed country site.
 * Kept small on purpose.
 */

import { cleanText, visibleText } from '../../detection/question'
import { largestDescriptionBlock } from '../json-ld'
import type { DetectedJob } from '../types'

const TITLE = [
  '[data-testid="jobsearch-JobInfoHeader-title"]',
  'h1.jobsearch-JobInfoHeader-title',
  '.jobsearch-JobInfoHeader-title',
]
const COMPANY = [
  '[data-testid="inlineHeader-companyName"]',
  '[data-company-name="true"]',
  '.jobsearch-InlineCompanyRating > div:first-child',
]
const LOCATION = ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '.jobsearch-JobInfoHeader-subtitle > div:last-child']
const DESCRIPTION = '#jobDescriptionText, .jobsearch-jobDescriptionText'

const first = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const el = doc.querySelector<HTMLElement>(selector)
    const text = el ? cleanText(visibleText(el)) : ''
    if (text) return text
  }
  return ''
}

export function isIndeedJob(url: URL): boolean {
  return (
    /(^|\.)indeed\.[a-z.]+$/.test(url.hostname) &&
    (url.pathname.startsWith('/viewjob') || url.searchParams.has('vjk') || url.searchParams.has('jk'))
  )
}

export function indeedJobUrl(url: URL): string {
  const id = url.searchParams.get('vjk') ?? url.searchParams.get('jk')
  return id ? `${url.origin}/viewjob?jk=${encodeURIComponent(id)}` : `${url.origin}${url.pathname}`
}

export function fromIndeed(doc: Document, url: URL, withDescription: boolean): DetectedJob | null {
  if (!isIndeedJob(url)) return null
  // Indeed appends " - job post" to the visible title for screen readers.
  const title = first(doc, TITLE).replace(/\s*-\s*job post$/i, '')
  if (!title) return null
  return {
    title,
    company: first(doc, COMPANY),
    location: first(doc, LOCATION) || null,
    employmentType: null,
    description: withDescription ? largestDescriptionBlock(doc, DESCRIPTION) : '',
    source: 'indeed',
  }
}
