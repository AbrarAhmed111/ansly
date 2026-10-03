import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { firstTailorOffer, tailorOffersItem } from '../settings'

describe('firstTailorOffer', () => {
  beforeEach(() => fakeBrowser.reset())

  it('is true once per job, remembered across page loads', async () => {
    expect(await firstTailorOffer('linkedin:123')).toBe(true)
    expect(await firstTailorOffer('linkedin:123')).toBe(false)
    expect(await firstTailorOffer('indeed:abc')).toBe(true)
    expect(await tailorOffersItem.getValue()).toEqual(['linkedin:123', 'indeed:abc'])
  })

  it('keeps only the most recent jobs', async () => {
    await tailorOffersItem.setValue(Array.from({ length: 300 }, (_, i) => `job:${i}`))
    expect(await firstTailorOffer('job:new')).toBe(true)
    const seen = await tailorOffersItem.getValue()
    expect(seen).toHaveLength(300)
    expect(seen[0]).toBe('job:1')
    expect(seen.at(-1)).toBe('job:new')
  })
})
