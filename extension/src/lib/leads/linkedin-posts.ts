import { cleanText } from '../detection/question'

const POST_CARD_SELECTORS = [
  '[data-urn*="urn:li:activity:"]',
  '[data-id*="urn:li:activity:"]',
  '.feed-shared-update-v2',
  '.search-result__wrapper',
  '[role="listitem"]',
].join(',')
const POST_TEXT_SELECTORS = [
  '.update-components-text',
  '.feed-shared-update-v2__description',
  '.feed-shared-text',
  '[data-testid="expandable-text-box"]',
].join(',')
const AUTHOR_SELECTORS = [
  '.update-components-actor__name',
  '.feed-shared-actor__name',
  '.entity-result__title-text',
]
/**
 * Not a product limit: users scroll as far as they like. Only guards the tab's memory (5,000 posts is far
 * beyond a realistic scroll). The extension sends them in batches.
 */
export const MAX_POSTS = 5000
const MAX_POST_TEXT = 5_000

export interface LinkedInPostCandidate {
  sourcePostId: string | null
  originalPostUrl: string | null
  authorName: string | null
  authorProfileUrl: string | null
  postText: string
  publishedAt: string | null
}

export interface LinkedInPostPreview {
  loadedCount: number
  extractedCount: number
  candidates: LinkedInPostCandidate[]
}

export function isLinkedInPostSearchUrl(value: string | URL): boolean {
  try {
    const url = value instanceof URL ? value : new URL(value)
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/search\/results\/(content|posts)(\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

/** Identifies one search (path, keywords and filters), ignoring tracking params LinkedIn adds as you browse. */
export function postSearchKey(value: string): string {
  try {
    const url = new URL(value)
    const keep = ['keywords', 'datePosted', 'sortBy', 'contentType', 'authorJobTitle']
    const params = keep.map((name) => `${name}=${url.searchParams.get(name) ?? ''}`).join('&')
    return `${url.pathname.replace(/\/+$/, '')}?${params}`
  } catch {
    return value
  }
}

function sourcePostId(card: HTMLElement): string | null {
  const rawId = [card.getAttribute('data-urn'), card.getAttribute('data-id'), ...Array.from(card.querySelectorAll<HTMLElement>('[data-urn], [data-id]'))
    .flatMap((element) => [element.getAttribute('data-urn'), element.getAttribute('data-id')])]
    .find((value) => value?.includes('urn:li:activity:'))
  const fromAttribute = rawId?.match(/urn:li:activity:\d+/)?.[0]
  if (fromAttribute) return fromAttribute

  const link = card.querySelector<HTMLAnchorElement>('a[href*="/feed/update/"], a[href*="/posts/"]')
  return link?.href.match(/urn:li:activity:\d+/)?.[0] ?? null
}

function postUrl(card: HTMLElement, pageUrl: URL): string | null {
  const link = card.querySelector<HTMLAnchorElement>(
    'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="activity:"]',
  )
  if (!link) return null

  try {
    const url = new URL(link.getAttribute('href') ?? '', pageUrl.origin)
    return /(^|\.)linkedin\.com$/i.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

function firstText(card: HTMLElement, selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = card.querySelector<HTMLElement>(selector)
    const text = element ? cleanText(element.textContent ?? '') : ''
    if (text) return text
  }
  return null
}

function contactLinks(textElement: HTMLElement, pageUrl: URL): string[] {
  const links = new Set<string>()
  for (const anchor of textElement.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href') ?? '', pageUrl.origin)
      if (url.protocol === 'mailto:') {
        const email = decodeURIComponent(url.pathname)
        if (email) links.add(email)
        continue
      }

      let destination = url
      if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
        if (url.pathname !== '/safety/go/') continue
        const wrapped = url.searchParams.get('url')
        if (!wrapped) continue
        destination = new URL(wrapped)
      }
      if (destination.protocol === 'http:' || destination.protocol === 'https:') {
        links.add(destination.href)
      }
    } catch {
      continue
    }
  }
  return [...links]
}

function postTextFromElement(textElement: HTMLElement, pageUrl: URL): string {
  const visibleText = cleanText(textElement.innerText || textElement.textContent || '')
  const links = contactLinks(textElement, pageUrl).filter((link) => !visibleText.includes(link))
  if (!links.length) return visibleText.slice(0, MAX_POST_TEXT)

  const suffix = cleanText(links.join(' ')).slice(0, MAX_POST_TEXT)
  const textLimit = Math.max(0, MAX_POST_TEXT - suffix.length - 1)
  return `${visibleText.slice(0, textLimit)} ${suffix}`.trim()
}

function authorName(card: HTMLElement): string | null {
  const selected = firstText(card, AUTHOR_SELECTORS)
  if (selected) return selected

  const profileLink = [...card.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')]
    .find((anchor) => cleanText(anchor.textContent ?? ''))
  const name = profileLink ? cleanText(profileLink.textContent ?? '') : ''
  return name.replace(/\s*[•·]\s*(?:\d+(?:st|nd|rd|th)\+?|following).*$/i, '') || null
}

function candidateFromCard(card: HTMLElement, pageUrl: URL): LinkedInPostCandidate | null {
  const textElement = card.querySelector<HTMLElement>(POST_TEXT_SELECTORS)
  const postText = textElement ? postTextFromElement(textElement, pageUrl) : ''
  if (!postText) return null

  const authorLink = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  const authorProfileUrl = postUrlFromAnchor(authorLink, pageUrl)
  const timestamp = card.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime ?? null

  return {
    sourcePostId: sourcePostId(card),
    originalPostUrl: postUrl(card, pageUrl),
    authorName: authorName(card),
    authorProfileUrl,
    postText,
    publishedAt: timestamp,
  }
}

function postUrlFromAnchor(anchor: HTMLAnchorElement | null, pageUrl: URL): string | null {
  if (!anchor) return null
  try {
    const url = new URL(anchor.getAttribute('href') ?? '', pageUrl.origin)
    return /(^|\.)linkedin\.com$/i.test(url.hostname) && /\/in\//.test(url.pathname) ? url.href : null
  } catch {
    return null
  }
}

function cardKey(card: HTMLElement, pageUrl: URL): string | HTMLElement {
  return sourcePostId(card) ?? postUrl(card, pageUrl) ?? card
}

function candidateKey(candidate: LinkedInPostCandidate): string {
  return candidate.sourcePostId ?? candidate.originalPostUrl ?? `${candidate.authorName ?? ''}
${candidate.postText}`
}

function postCards(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(POST_CARD_SELECTORS)].filter((card) =>
    !card.closest('ansly-root') &&
    (!card.matches('[role="listitem"]') || card.querySelector(POST_TEXT_SELECTORS)),
  )
}

export function extractLinkedInPostPreview(doc: Document, pageUrl: string | URL): LinkedInPostPreview | null {
  const url = pageUrl instanceof URL ? pageUrl : new URL(pageUrl)
  if (!isLinkedInPostSearchUrl(url)) return null

  const seenCards = new Set<string | HTMLElement>()
  const byPost = new Map<string, LinkedInPostCandidate>()
  let loadedCount = 0
  for (const card of postCards(doc)) {
    const key = cardKey(card, url)
    if (seenCards.has(key)) continue
    seenCards.add(key)
    if (loadedCount >= MAX_POSTS) break
    loadedCount++

    const candidate = candidateFromCard(card, url)
    if (!candidate) continue
    const dedupeKey = candidateKey(candidate)
    if (!byPost.has(dedupeKey)) byPost.set(dedupeKey, candidate)
  }

  const candidates = [...byPost.values()]
  return {
    loadedCount,
    extractedCount: candidates.length,
    candidates,
  }
}

/**
 * Remembers the posts seen on one search page while the user scrolls, so a post LinkedIn later removes
 * from the page still counts. It only reads cards already in the page; nothing leaves the browser
 * until the user clicks Collect. A new search (URL) starts over.
 */
export class PostCollector {
  private key = ''
  private posts = new Map<string, LinkedInPostCandidate>()

  /** Reads the cards on the page now; returns the number of posts with text seen on this search. */
  scan(doc: Document, pageUrl: string): number {
    const key = postSearchKey(pageUrl)
    if (key !== this.key) {
      this.key = key
      this.posts.clear()
    }
    const preview = extractLinkedInPostPreview(doc, pageUrl)
    for (const candidate of preview?.candidates ?? []) {
      if (this.posts.size >= MAX_POSTS) break
      const key = candidateKey(candidate)
      if (!this.posts.has(key)) this.posts.set(key, candidate)
    }
    return this.posts.size
  }

  get count(): number {
    return this.posts.size
  }

  preview(): LinkedInPostPreview {
    const candidates = [...this.posts.values()]
    return { loadedCount: candidates.length, extractedCount: candidates.length, candidates }
  }
}
