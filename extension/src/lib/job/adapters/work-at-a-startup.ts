import { cleanText, visibleText } from '../../detection/question'
import { visibleJobText } from '../dom'
import { fromGeneric } from '../generic'
import type { DetectedJob } from '../types'

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"], span'

function section(doc: Document, headingPattern: RegExp): { heading: string; content: string } | null {
  const heading = [...doc.querySelectorAll(HEADING_SELECTOR)].find((element) =>
    headingPattern.test(cleanText(visibleText(element))),
  )
  if (!heading) return null

  let current = heading.nextElementSibling
  let parent = heading.parentElement
  while (!current && parent) {
    current = parent.nextElementSibling
    parent = parent.parentElement
  }
  const content = current ? visibleJobText(current) : ''
  return content ? { heading: cleanText(visibleText(heading)), content } : null
}

function roleIdentity(doc: Document): { title: string; company: string } {
  const heading = doc.querySelector('h1')
  const text = heading ? cleanText(visibleText(heading)) : ''
  const companyElement = heading?.querySelector<HTMLAnchorElement>('a[href*="/companies/"]')
  const company = companyElement ? cleanText(visibleText(companyElement)) : ''
  const title = text
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(company ? new RegExp(`\\s+at\\s+${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') : /$/, '')
    .trim()

  return { title, company }
}

export function isWorkAtAStartupJob(url: URL): boolean {
  return /(^|\.)workatastartup\.com$/i.test(url.hostname) && /\/jobs\/\d+\/?$/i.test(url.pathname)
}

export function fromWorkAtAStartup(doc: Document, withDescription: boolean): DetectedJob | null {
  const { title, company } = roleIdentity(doc)
  if (!title) return null

  const role = withDescription ? section(doc, /^about the role$/i) : null
  if (withDescription && !role) {
    const fallback = fromGeneric(doc, true)
    return fallback ? { ...fallback, title, company: company || fallback.company } : null
  }

  const relatedSections = withDescription
    ? [
        section(doc, /^about (?!the role$).+/i),
        section(doc, /^technology$/i),
      ].filter((related): related is NonNullable<typeof related> => related !== null)
    : []
  const description = role
    ? [
        `${role.heading}\n${role.content}`,
        ...relatedSections.map((related) => `${related.heading}\n${related.content}`),
      ].join('\n\n')
    : ''

  return {
    title,
    company,
    location: null,
    employmentType: null,
    description,
    source: 'generic',
  }
}
