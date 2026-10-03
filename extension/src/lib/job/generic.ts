/**
 * Generic job-page heuristic for career pages without JSON-LD: a role-like
 * title plus one long block that reads like a job description.
 */

import { cleanText, visibleText } from '../detection/question'
import { parseTitle } from '../job-context'
import { largestDescriptionBlock } from './json-ld'
import type { DetectedJob } from './types'

const DESCRIPTION =
  '[id*="description" i], [class*="description" i], [data-testid*="description" i], [class*="job-details" i], [id*="job-details" i], [class*="posting" i], article, main'

/** Headings a job description almost always has. Two or more = a job posting. */
const JOB_SIGNALS =
  /\b(responsibilities|requirements|qualifications|what you'?ll do|what we'?re looking for|about the role|about you|you will|you have|nice to have|preferred|benefits|who you are|minimum qualifications)\b/gi

const ROLE_WORDS =
  /\b(engineer|developer|manager|designer|analyst|scientist|lead|director|intern|specialist|architect|consultant|associate|officer|administrator|coordinator|head|representative|researcher|writer|marketer|recruiter|accountant)\b/i

const NOT_A_ROLE = /^(apply|application|job application|careers?|jobs?|home|sign in|log in|submit your application|easy apply|open positions)$/i

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || null

export const MIN_DESCRIPTION_CHARS = 200

export function looksLikeJobText(text: string): boolean {
  return new Set((text.match(JOB_SIGNALS) ?? []).map((s) => s.toLowerCase())).size >= 2
}

export function fromGeneric(doc: Document, withDescription: boolean): DetectedJob | null {
  const h1 = doc.querySelector('h1')
  const heading = h1 ? cleanText(visibleText(h1)) : ''
  const parsed = parseTitle(meta(doc, 'og:title') ?? doc.title)
  const title = heading && heading.length < 120 && !NOT_A_ROLE.test(heading) && ROLE_WORDS.test(heading) ? heading : parsed.role
  if (!title || !ROLE_WORDS.test(title)) return null

  const description = largestDescriptionBlock(doc, DESCRIPTION)
  if (description.length < MIN_DESCRIPTION_CHARS || !looksLikeJobText(description)) return null

  const site = meta(doc, 'og:site_name')
  const company = site && !/^(careers?|jobs?)$/i.test(site) ? site : (parsed.company ?? '')
  return {
    title: cleanText(title),
    // "Litware Careers" -> "Litware"
    company: cleanText(company).replace(/\s+(careers?|jobs?|hiring)$/i, ''),
    location: null,
    employmentType: null,
    description: withDescription ? description : '',
    source: 'generic',
  }
}
