import { describe, expect, it } from 'vitest'
import { extractLinkedInPostPreview, isLinkedInPostSearchUrl, MAX_POSTS, PostCollector } from '../leads/linkedin-posts'

const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=react&origin=GLOBAL_SEARCH_HEADER'

function load(html: string): Document {
  document.head.innerHTML = ''
  document.body.innerHTML = html
  return document
}

describe('isLinkedInPostSearchUrl', () => {
  it('accepts LinkedIn post search pages and rejects job or feed pages', () => {
    expect(isLinkedInPostSearchUrl(SEARCH_URL)).toBe(true)
    expect(isLinkedInPostSearchUrl('https://www.linkedin.com/jobs/search/?currentJobId=123')).toBe(false)
    expect(isLinkedInPostSearchUrl('https://www.linkedin.com/feed/')).toBe(false)
    expect(isLinkedInPostSearchUrl('https://linkedin.com.attacker.test/search/results/content/')).toBe(false)
    expect(isLinkedInPostSearchUrl('not a url')).toBe(false)
  })
})

describe('extractLinkedInPostPreview', () => {
  it('extracts and deduplicates posts already present on a supported search page', () => {
    const doc = load(`
      <article class="feed-shared-update-v2" data-urn="urn:li:activity:123">
        <div class="update-components-actor__name">Sam Rivera</div>
        <a href="/in/sam-rivera/">Sam's profile</a>
        <time datetime="2026-11-12T10:00:00Z"></time>
        <a href="/feed/update/urn:li:activity:123/">View post</a>
        <div class="update-components-text">Hiring a React developer for a remote product team.</div>
      </article>
      <article class="feed-shared-update-v2" data-urn="urn:li:activity:123">
        <div class="update-components-text">Duplicate markup for the same post.</div>
      </article>
      <article class="feed-shared-update-v2" data-urn="urn:li:activity:456">
        <div class="update-components-text">Looking for a freelance developer to build an MVP.</div>
      </article>
      <article class="feed-shared-update-v2" data-urn="urn:li:activity:789">
        <div class="irrelevant">No post text element.</div>
      </article>
    `)

    const preview = extractLinkedInPostPreview(doc, SEARCH_URL)

    expect(preview).toEqual({
      loadedCount: 3,
      extractedCount: 2,
      candidates: [
        {
          sourcePostId: 'urn:li:activity:123',
          originalPostUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
          authorName: 'Sam Rivera',
          authorProfileUrl: 'https://www.linkedin.com/in/sam-rivera/',
          postText: 'Hiring a React developer for a remote product team.',
          publishedAt: '2026-11-12T10:00:00Z',
        },
        {
          sourcePostId: 'urn:li:activity:456',
          originalPostUrl: null,
          authorName: null,
          authorProfileUrl: null,
          postText: 'Looking for a freelance developer to build an MVP.',
          publishedAt: null,
        },
      ],
    })
  })

  it('extracts posts from LinkedIn search result list items', () => {
    const doc = load(`
      <div role="listitem" componentkey="update-card-focus-randomized">
        <a href="https://www.linkedin.com/in/sam-rivera/">Sam Rivera</a>
        <span data-testid="expandable-text-box">
          Hiring a full stack developer for our team.
          <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjobs.example%2Fapply">Apply</a>
          <a href="mailto:jobs@example.test">Email us</a>
        </span>
      </div>
      <div role="listitem"><span>Not a post</span></div>
    `)

    const preview = extractLinkedInPostPreview(doc, SEARCH_URL)

    expect(preview?.loadedCount).toBe(1)
    expect(preview?.extractedCount).toBe(1)
    expect(preview?.candidates[0]).toMatchObject({
      authorName: 'Sam Rivera',
      authorProfileUrl: 'https://www.linkedin.com/in/sam-rivera/',
      postText: expect.stringContaining('Hiring a full stack developer for our team.'),
    })
    expect(preview?.candidates[0]?.postText).toContain('jobs@example.test')
    expect(preview?.candidates[0]?.postText).toContain('https://jobs.example/apply')
  })

  it('truncates post text without splitting or retaining unpaired Unicode surrogates', () => {
    const text = `${'a'.repeat(4_999)}𝘛 and more text`
    const doc = load(`<article class="feed-shared-update-v2"><div class="update-components-text">${text}</div></article>`)
    const postText = extractLinkedInPostPreview(doc, SEARCH_URL)?.candidates[0]?.postText

    expect(postText).toBe(`${'a'.repeat(4_999)}𝘛`)
    expect(Array.from(postText ?? '')).toHaveLength(5_000)
    expect(postText).not.toMatch(/[\uD800-\uDFFF]/u)
  })

  it('rejects unsupported pages without reading their content', () => {
    const doc = load('<article class="feed-shared-update-v2"><div class="update-components-text">text</div></article>')
    expect(extractLinkedInPostPreview(doc, 'https://www.linkedin.com/feed/')).toBeNull()
  })

  it('caps the number of loaded posts it returns', () => {
    const posts = Array.from({ length: MAX_POSTS + 5 }, (_, index) =>
      `<article class="feed-shared-update-v2" data-urn="urn:li:activity:${index}"><div class="update-components-text">Post ${index}</div></article>`,
    ).join('')
    const preview = extractLinkedInPostPreview(load(posts), SEARCH_URL)

    expect(preview?.loadedCount).toBe(MAX_POSTS)
    expect(preview?.extractedCount).toBe(MAX_POSTS)
  })
})

describe('PostCollector', () => {
  const card = (id: number) =>
    `<article class="feed-shared-update-v2" data-urn="urn:li:activity:${id}"><div class="update-components-text">Post ${id}</div></article>`

  it('keeps counting posts that scrolled out of the page and resets on a new search', () => {
    const collector = new PostCollector()
    expect(collector.scan(load(card(1) + card(2)), SEARCH_URL)).toBe(2)
    // LinkedIn dropped post 1 and loaded 3 and 4.
    expect(collector.scan(load(card(2) + card(3) + card(4)), SEARCH_URL)).toBe(4)
    expect(collector.preview().candidates.map((post) => post.sourcePostId)).toEqual([
      'urn:li:activity:1',
      'urn:li:activity:2',
      'urn:li:activity:3',
      'urn:li:activity:4',
    ])
    // Tracking params don't restart the count; a new keyword does.
    expect(collector.scan(load(card(5)), `${SEARCH_URL}&sid=abc`)).toBe(5)
    expect(collector.scan(load(card(9)), SEARCH_URL.replace('react', 'python'))).toBe(1)
  })

  it('reads nothing outside a post search', () => {
    const collector = new PostCollector()
    expect(collector.scan(load(card(1)), 'https://www.linkedin.com/feed/')).toBe(0)
  })
})
