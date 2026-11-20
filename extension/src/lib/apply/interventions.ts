export type InterventionKind =
  | 'captcha'
  | 'login'
  | 'two_factor'
  | 'unknown_required_field'
  | 'unsupported_upload'
  | 'session_expired'

export interface Intervention {
  kind: InterventionKind
  title: string
  detail: string
}

const CHALLENGE_TEXT =
  /\b(captcha|recaptcha|hcaptcha|turnstile|verify (that )?you'?re human|complete the security check|security challenge)\b/i

export function detectCaptcha(doc: Document): Intervention | null {
  const html = doc.documentElement.innerHTML
  const visible = doc.body?.innerText ?? ''
  const provider =
    doc.querySelector(
      'iframe[src*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], ' +
      '[data-sitekey], [class*="captcha" i], [id*="captcha" i]',
    )
  if (provider || CHALLENGE_TEXT.test(visible) || CHALLENGE_TEXT.test(html.slice(0, 100_000))) {
    return {
      kind: 'captcha',
      title: 'Complete CAPTCHA verification',
      detail: 'Ansly paused before any further interaction. Complete the challenge manually, then press Resume.',
    }
  }
  return null
}

export function detectLoginOrSession(doc: Document): Intervention | null {
  const text = `${doc.title} ${doc.body?.innerText ?? ''}`.toLowerCase()
  if (/\b(two[- ]factor|2fa|verification code|enter the code)\b/.test(text)) {
    return {
      kind: 'two_factor',
      title: 'Verification required',
      detail: 'Complete the login or two-factor verification in the browser, then press Resume.',
    }
  }
  if (/\b(sign in|log in|login|required to continue)\b/.test(text) && !/\b(job|application|employee)\b/.test(text)) {
    return {
      kind: 'login',
      title: 'Sign in required',
      detail: 'Ansly cannot continue until the application session is valid. Sign in, then press Resume.',
    }
  }
  return null
}

export function fingerprintPage(doc: Document): string {
  const text = `${doc.title}|${doc.body?.innerText ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 4000)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`
}
