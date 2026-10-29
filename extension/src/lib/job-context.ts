/**
 * Job context extraction: company and role from the application page, and
 * (only when the user opts in) the job description. Generic signals only:
 * JSON-LD JobPosting, Open Graph tags, the document title, and headings.
 */

import type { JobContext } from '@ansly/types'
import { cleanText, visibleText } from './detection/question'
import { findJobPosting } from './job/json-ld'
import { JOB_DESCRIPTION_SELECTORS, largestJobDescriptionBlock } from './job/dom'
import { pageJobTitle } from './job/generic'

export { parseTitle } from './job/title'

const DESCRIPTION_MAX = 6000

/** Cover/motivation letters are written for a job, so they always get its description (same rule as the API). */
const COVER_LETTER = /\bcover(?:ing)?\s*letter\b|\bmotivation(?:al)? letter\b|\bletter of motivation\b/i

export const isCoverLetter = (question: string | null | undefined) => COVER_LETTER.test(question ?? '')

function htmlToText(html: string, doc: Document): string {
  const container = doc.createElement('div')
  container.innerHTML = html
  return visibleText(container)
}

const NOT_A_ROLE = /^(apply|application|job application|careers?|jobs?|home|sign in|log in|submit your application|easy apply)$/i

export function extractJobContext(doc: Document, options: { includeDescription: boolean }): JobContext {
  const posting = findJobPosting(doc)
  let role = posting?.title ?? posting?.name ?? null
  let company =
    (typeof posting?.hiringOrganization === 'string' ? posting.hiringOrganization : posting?.hiringOrganization?.name) ?? null

  const page = pageJobTitle(doc)
  if (!role || (page.title && page.title !== role)) role = page.title || role
  if (!company || (page.company && page.company !== company)) company = page.company || company
  if (role && NOT_A_ROLE.test(role)) role = null

  let description: string | null = null
  if (options.includeDescription) {
    description = posting?.description
      ? htmlToText(posting.description, doc)
      : largestJobDescriptionBlock(doc, JOB_DESCRIPTION_SELECTORS)
    description = description ? description.slice(0, DESCRIPTION_MAX) : null
  }

  const url = doc.defaultView?.location ? `${doc.defaultView.location.origin}${doc.defaultView.location.pathname}` : null
  return {
    company: company ? cleanText(company).slice(0, 200) : null,
    role: role ? cleanText(role).slice(0, 200) : null,
    description,
    url,
  }
}
