/**
 * schema.org JobPosting JSON-LD: many ATSs and career pages ship it, and it's
 * the most reliable source (structured, written by the employer).
 */

import { cleanText, visibleText } from '../detection/question'
import type { DetectedJob } from './types'

export interface JobPostingLd {
  '@type'?: string | string[]
  title?: string
  name?: string
  description?: string
  employmentType?: string | string[]
  hiringOrganization?: { name?: string } | string
  jobLocation?: JobLocationLd | JobLocationLd[]
  jobLocationType?: string
  url?: string
}

interface JobLocationLd {
  address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } } | string
}

const isPosting = (node: unknown): node is JobPostingLd => {
  if (!node || typeof node !== 'object') return false
  const type = (node as JobPostingLd)['@type']
  return Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting'
}

export function findJobPosting(doc: Document): JobPostingLd | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '')
      const nodes: unknown[] = Array.isArray(data) ? data : [data, ...(data?.['@graph'] ?? [])]
      const posting = nodes.find(isPosting)
      if (posting) return posting
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return null
}

export function htmlToText(html: string, doc: Document): string {
  // A <template> parses without running scripts or loading images.
  const template = doc.createElement('template')
  template.innerHTML = html
  const container = doc.createElement('div')
  container.appendChild(template.content.cloneNode(true))
  // Block elements become line breaks so requirements stay one per line.
  container.querySelectorAll('p, li, br, h1, h2, h3, h4, div').forEach((el) => el.append('\n'))
  return (container.textContent ?? '')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n')
}

function location(posting: JobPostingLd): string | null {
  if (posting.jobLocationType === 'TELECOMMUTE') return 'Remote'
  const first = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation
  const address = first?.address
  if (!address) return null
  if (typeof address === 'string') return cleanText(address)
  const country = typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name
  return [address.addressLocality, address.addressRegion, country].filter(Boolean).join(', ') || null
}

export function fromJsonLd(doc: Document, withDescription: boolean): DetectedJob | null {
  const posting = findJobPosting(doc)
  const title = posting?.title ?? posting?.name
  if (!posting || !title) return null
  const company = typeof posting.hiringOrganization === 'string' ? posting.hiringOrganization : posting.hiringOrganization?.name
  const employment = Array.isArray(posting.employmentType) ? posting.employmentType.join(', ') : posting.employmentType
  return {
    title: cleanText(title),
    company: company ? cleanText(company) : '',
    location: location(posting),
    employmentType: employment ? cleanText(employment.replace(/_/g, ' ').toLowerCase()) : null,
    description: withDescription && posting.description ? htmlToText(posting.description, doc) : '',
    source: 'json-ld',
  }
}

/** The largest text block that looks like a job description (not a form). */
export function largestDescriptionBlock(doc: Document, selectors: string): string {
  let best = ''
  doc.querySelectorAll<HTMLElement>(selectors).forEach((el) => {
    if (el.querySelector('form, input, textarea')) return
    const text = visibleText(el)
    if (text.length > best.length) best = text
  })
  return best
}
