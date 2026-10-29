/**
 * Generic job-page heuristic for career pages without JSON-LD (and the fallback
 * on job boards whose markup changed): a title plus one long block that reads
 * like a job description. It finds descriptions the same way answer generation
 * does (lib/job-context.ts), so a page whose description helps a cover letter
 * also gets the tailoring offer.
 */

import { cleanText, visibleText } from '../detection/question'
import { largestJobDescriptionBlock, JOB_DESCRIPTION_SELECTORS, visibleJobText } from './dom'
import { parseTitle } from './title'
import type { DetectedJob } from './types'

export const DESCRIPTION_SELECTORS = JOB_DESCRIPTION_SELECTORS

/** Phrases a job description almost always has. */
const JOB_SIGNALS =
  /\b(responsibilities|requirements|qualifications|what you'?ll (?:do|be doing|bring|need)|what we'?re looking for|what we offer|about the (?:role|job|position|team)|about you|you will|you'?ll|you have|you bring|nice to have|nice-to-have|preferred|benefits|perks|who you are|minimum qualifications|must have|must-have|key skills|skills required|job description|job summary|role overview|the role|your role|duties|experience with|years of experience|we'?re hiring|apply now|equal opportunity|salary|compensation)\b/gi

export const ROLE_WORDS =
  /\b(engineer|engineering|developer|programmer|sde|swe|devops|sre|manager|designer|analyst|scientist|lead|director|intern|internship|trainee|apprentice|graduate|specialist|architect|consultant|associate|officer|administrator|coordinator|head|representative|researcher|writer|editor|marketer|recruiter|accountant|technician|executive|assistant|advisor|strategist|owner|full[- ]?stack|front[- ]?end|back[- ]?end|staff|principal|fellow|operator|agent|nurse|teacher|tutor|vp|president|cto|ceo|cfo)\b/i

const NOT_A_ROLE = /^(apply|application|job application|careers?|jobs?|home|sign in|log in|submit your application|easy apply|open positions|search jobs|job search)$/i

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || null

function pageCompany(doc: Document): string {
  const selectors = [
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    '[itemprop="hiringOrganization"]',
    '[data-testid*="company" i]',
    '[data-automation-id*="company" i]',
    '[class*="company-name" i]',
    '[class*="companyName" i]',
    '[class*="employer-name" i]',
  ]
  for (const selector of selectors) {
    const element = doc.querySelector<HTMLElement>(selector)
    const text = element ? cleanText(visibleText(element)) : ''
    if (text && text.length <= 200) return text
  }
  return ''
}

function pageField(doc: Document, selectors: string[], label: RegExp): string | null {
  for (const selector of selectors) {
    const element = doc.querySelector<HTMLElement>(selector)
    const text = element ? cleanText(visibleJobText(element)) : ''
    if (text && text.length <= 300) return text
  }
  for (const term of doc.querySelectorAll('dt, th')) {
    if (!label.test(cleanText(visibleText(term)))) continue
    const value = term.nextElementSibling
    const text = value ? cleanText(visibleJobText(value)) : ''
    if (text && text.length <= 300) return text
  }
  return null
}

export const MIN_DESCRIPTION_CHARS = 200

/** How many different job-posting phrases `text` has. */
export function jobSignals(text: string): number {
  return new Set((text.match(JOB_SIGNALS) ?? []).map((s) => s.toLowerCase().replace(/[’']/g, ''))).size
}

export function looksLikeJobText(text: string): boolean {
  return jobSignals(text) >= 2
}

/** The page's job title: its main heading, else the role in og:title / the document title. */
export function pageJobTitle(doc: Document): { title: string; company: string } {
  const h1 = doc.querySelector('h1')
  const heading = h1 ? cleanText(visibleText(h1)) : ''
  const headingCompanyElement = h1?.querySelector<HTMLAnchorElement>('a[href*="/companies/"]')
  const headingCompany = headingCompanyElement ? cleanText(visibleText(headingCompanyElement)) : ''
  const headingTitle = headingCompany
    ? heading.replace(new RegExp(`\\s+at\\s+${headingCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\([^)]*\\))?$`, 'i'), '')
    : heading
  const parsed = parseTitle(meta(doc, 'og:title') ?? doc.title)
  const usableHeading = headingTitle && headingTitle.length < 120 && !NOT_A_ROLE.test(headingTitle)
  const title = usableHeading ? headingTitle : (parsed.role ?? '')
  const site = meta(doc, 'og:site_name')
  const company =
    pageCompany(doc) ||
    headingCompany ||
    parsed.company ||
    (site && !/^(careers?|jobs?|work at a startup)$/i.test(site) ? site : '')
  return { title: cleanText(title), company: cleanText(company).replace(/\s+(careers?|jobs?|hiring)$/i, '') }
}

/**
 * A job posting if it has a substantial description block and either a role-like
 * title or text that clearly reads like a job description (3+ posting phrases).
 */
export function fromGeneric(doc: Document, withDescription: boolean, selectors = DESCRIPTION_SELECTORS): DetectedJob | null {
  const { title, company } = pageJobTitle(doc)
  if (!title) return null
  const description = largestJobDescriptionBlock(doc, selectors)
  if (description.length < MIN_DESCRIPTION_CHARS) return null
  const signals = jobSignals(description)
  if (!(signals >= 3 || (signals >= 1 && ROLE_WORDS.test(title)))) return null
  return {
    title: title.slice(0, 300),
    company,
    location: pageField(
      doc,
      ['[itemprop="jobLocation"]', '[data-testid*="location" i]', '[class*="job-location" i]', '[class*="location" i]'],
      /\b(location|workplace|office)\b/i,
    ),
    employmentType: pageField(
      doc,
      ['[itemprop="employmentType"]', '[data-testid*="employment" i]', '[class*="employment-type" i]', '[class*="employmentType" i]'],
      /\b(employment|job) type\b/i,
    ),
    description: withDescription ? description : '',
    source: 'generic',
  }
}
