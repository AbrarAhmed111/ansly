import { cleanText } from '../detection/question'

const GENERIC_SITES =
  /^(linkedin|indeed|glassdoor|greenhouse|lever|workday|ashby|smartrecruiters|jobvite|icims|bamboohr|workable|work at a startup|careers?|jobs?)$/i

/** Splits titles like "Senior Engineer at Acme", "Acme - Senior Engineer", "Senior Engineer | Acme | LinkedIn". */
export function parseTitle(title: string): { role: string | null; company: string | null } {
  const text = cleanText(title).replace(/^job application for\s+/i, '').replace(/^apply(?: for| to)?\s+/i, '')
  const at = text.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·–—-]\s*.*)?$/i)
  if (at?.[1] && at[2]) return { role: at[1].trim(), company: at[2].trim() }

  const parts = text.split(/\s+[|·–—-]\s+/).map((part) => part.trim()).filter((part) => part && !GENERIC_SITES.test(part) && !/^jobs?\b/i.test(part))
  const [first, second] = parts
  if (first && second) {
    const looksLikeRole = (value: string) => /\b(engineer|developer|manager|designer|analyst|scientist|lead|director|intern|specialist|architect|consultant|associate|officer|administrator|coordinator|head|vp|president)\b/i.test(value)
    if (looksLikeRole(second) && !looksLikeRole(first)) return { role: second, company: first }
    return { role: first, company: second }
  }
  return { role: null, company: null }
}
