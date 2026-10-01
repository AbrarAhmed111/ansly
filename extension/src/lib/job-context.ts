/**
 * Job context extraction: company and role from the application page, and
 * (only when the user opts in) the job description. Generic signals only:
 * JSON-LD JobPosting, Open Graph tags, the document title, and headings.
 */

import type { JobContext } from '@ansly/types'
import { cleanText, visibleText } from './detection/question'

const DESCRIPTION_MAX = 6000

interface JobPostingLd {
  '@type'?: string | string[]
  title?: string
  name?: string
  description?: string
  hiringOrganization?: { name?: string } | string
}

function htmlToText(html: string, doc: Document): string {
  const container = doc.createElement('div')
  container.innerHTML = html
  return visibleText(container)
}

function findJobPosting(doc: Document): JobPostingLd | null {
  const isPosting = (node: unknown): node is JobPostingLd => {
    if (!node || typeof node !== 'object') return false
    const type = (node as JobPostingLd)['@type']
    return Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting'
  }
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

const meta = (doc: Document, name: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || null

const GENERIC_SITES = /^(linkedin|indeed|glassdoor|greenhouse|lever|workday|ashby|smartrecruiters|jobvite|icims|bamboohr|workable|careers?|jobs?)$/i
const NOT_A_ROLE = /^(apply|application|job application|careers?|jobs?|home|sign in|log in|submit your application|easy apply)$/i

/** Splits titles like "Senior Engineer at Acme", "Acme - Senior Engineer", "Senior Engineer | Acme | LinkedIn". */
export function parseTitle(title: string): { role: string | null; company: string | null } {
  const t = cleanText(title).replace(/^job application for\s+/i, '').replace(/^apply(?: for| to)?\s+/i, '')
  const at = t.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·–—-]\s*.*)?$/i)
  if (at?.[1] && at[2]) return { role: at[1].trim(), company: at[2].trim() }

  const parts = t.split(/\s+[|·–—-]\s+/).map((p) => p.trim()).filter((p) => p && !GENERIC_SITES.test(p) && !/^jobs?\b/i.test(p))
  const [first, second] = parts
  if (first && second) {
    // Lever: "Acme - Senior Engineer"; LinkedIn/most boards: "Senior Engineer | Acme".
    const looksLikeRole = (s: string) => /\b(engineer|developer|manager|designer|analyst|scientist|lead|director|intern|specialist|architect|consultant|associate|officer|administrator|coordinator|head|vp|president)\b/i.test(s)
    if (looksLikeRole(second) && !looksLikeRole(first)) return { role: second, company: first }
    return { role: first, company: second }
  }
  return { role: null, company: null }
}

function largestDescriptionBlock(doc: Document): string | null {
  const candidates = doc.querySelectorAll<HTMLElement>(
    '[id*="description" i], [class*="description" i], [data-testid*="description" i], [class*="job-details" i], [id*="job-details" i], article',
  )
  let best = ''
  candidates.forEach((el) => {
    if (el.querySelector('form, input, textarea')) return
    const text = visibleText(el)
    if (text.length > best.length) best = text
  })
  return best.length > 200 ? best : null
}

export function extractJobContext(doc: Document, options: { includeDescription: boolean }): JobContext {
  const posting = findJobPosting(doc)
  let role = posting?.title ?? posting?.name ?? null
  let company =
    (typeof posting?.hiringOrganization === 'string' ? posting.hiringOrganization : posting?.hiringOrganization?.name) ?? null

  if (!role || !company) {
    for (const title of [meta(doc, 'og:title'), doc.title]) {
      if (!title) continue
      const parsed = parseTitle(title)
      role ??= parsed.role
      company ??= parsed.company
      if (role && company) break
    }
  }
  if (!company) {
    const site = meta(doc, 'og:site_name')
    if (site && !GENERIC_SITES.test(site)) company = site
  }
  if (!role) {
    const h1 = doc.querySelector('h1')
    const text = h1 ? cleanText(visibleText(h1)) : ''
    if (text && text.length < 120 && !NOT_A_ROLE.test(text)) role = text
  }

  let description: string | null = null
  if (options.includeDescription) {
    description = posting?.description ? htmlToText(posting.description, doc) : largestDescriptionBlock(doc)
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
