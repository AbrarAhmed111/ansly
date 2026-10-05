import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, draftKey, loadDraft, saveDraft } from '../drafts'
import { countFor, detectLimits, parseLimits } from '../limits'

describe('parseLimits', () => {
  it.each([
    ['Maximum 500 characters', { maxLength: 500 }],
    ['Max 250 words', { maxWords: 250 }],
    ['Minimum 100 characters', { minLength: 100 }],
    ['Please keep it under 1,000 characters.', { maxLength: 1000 }],
    ['300 words max', { maxWords: 300 }],
    ['Up to 2000 chars', { maxLength: 2000 }],
    ['0/500', { maxLength: 500 }],
    ['0 / 750 characters', { maxLength: 750 }],
    ['At least 50 words', { minLength: 250 }],
  ])('%s', (text, expected) => {
    expect(parseLimits([text])).toMatchObject(expected)
  })

  it('ignores text without a limit and keeps the tightest one', () => {
    expect(parseLimits(['Tell us about yourself', 'We read every application'])).toEqual({ maxLength: null, maxWords: null, minLength: null })
    expect(parseLimits(['Max 800 characters', 'Maximum 500 characters']).maxLength).toBe(500)
  })
})

describe('detectLimits', () => {
  it('combines maxlength with helper text and counters after the field', () => {
    document.body.innerHTML = '<div><textarea id="a" maxlength="1000"></textarea><small>Max 600 characters</small></div>'
    expect(detectLimits(document.getElementById('a')!).maxLength).toBe(600)
  })

  it("never takes the next field's helper text", () => {
    document.body.innerHTML = '<textarea id="a"></textarea><label for="b">Next</label><p>Max 200 characters</p><textarea id="b"></textarea>'
    expect(detectLimits(document.getElementById('a')!).maxLength).toBeNull()
  })
})

describe('countFor', () => {
  it('shows ok, near and over states', () => {
    expect(countFor('a'.repeat(382), { maxLength: 500 })).toMatchObject({ label: '382 / 500 characters', state: 'ok' })
    expect(countFor('a'.repeat(492), { maxLength: 500 })).toMatchObject({ label: '492 / 500 characters — near limit', state: 'near' })
    expect(countFor('a'.repeat(531), { maxLength: 500 })).toMatchObject({ label: '531 / 500 — 31 over', state: 'over', over: 31 })
  })

  it('counts words for word-limited fields', () => {
    expect(countFor('one two three', { maxWords: 250 })).toMatchObject({ label: '3 / 250 words', unit: 'words' })
    expect(countFor('one two three', { maxWords: 2 })).toMatchObject({ state: 'over', over: 1 })
  })

  it('flags an answer under the minimum', () => {
    expect(countFor('short', { minLength: 100 }).state).toBe('under')
  })
})

describe('drafts', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps a draft per page, field and question, ignoring the query string', () => {
    const key = draftKey('f1', 'Why us?', 'https://jobs.example.com/apply?step=2')
    saveDraft(key, 'my edit')
    expect(loadDraft(draftKey('f1', 'why us?', 'https://jobs.example.com/apply?step=3'))).toBe('my edit')
    expect(loadDraft(draftKey('f2', 'Why us?', 'https://jobs.example.com/apply'))).toBeNull()
    clearDraft(key)
    expect(loadDraft(key)).toBeNull()
  })

  it('forgets old drafts', () => {
    const key = draftKey('f1', 'Why us?', 'https://x.test/a')
    sessionStorage.setItem(key, JSON.stringify({ text: 'old', at: Date.now() - 5 * 60 * 60 * 1000 }))
    expect(loadDraft(key)).toBeNull()
  })
})
