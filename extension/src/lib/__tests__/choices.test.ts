import { afterEach, describe, expect, it } from 'vitest'
import { scanAll } from '../detection/scan'
import { diagnostics } from '../diagnostics'
import { fillChoice, fillField, hasValue, restoreValue, snapshotValue } from '../fill'
import { profileValues } from '../profile-values'
import { GREENHOUSE_NEW, LINKEDIN, LINKEDIN_STEP } from './fixtures'

afterEach(() => {
  document.body.innerHTML = ''
})

const field = (question: RegExp) => {
  const f = scanAll(document).find((x) => question.test(x.question.text))
  if (!f) throw new Error(`No field matching ${question}`)
  return f
}

describe('filling choices', () => {
  it('selects a native option by its text and fires change', async () => {
    document.body.innerHTML = LINKEDIN_STEP
    const f = field(/sponsorship/)
    let changed = 0
    f.controls[0]!.addEventListener('change', () => changed++)
    expect(await fillChoice(f.controls, 'No', f.options)).toBe(true)
    expect((f.controls[0] as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('No')
    expect(changed).toBe(1)
  })

  it('clicks the right radio in a group', async () => {
    document.body.innerHTML = LINKEDIN
    const f = field(/commuting/)
    expect(await fillChoice(f.controls, 'yes', f.options)).toBe(true)
    expect((f.controls as HTMLInputElement[]).map((r) => r.checked)).toEqual([true, false])
  })

  it('checks several boxes in a checkbox group', async () => {
    document.body.innerHTML = GREENHOUSE_NEW
    const f = field(/used in production/)
    expect(await fillChoice(f.controls, 'React | Python', f.options)).toBe(true)
    expect((f.controls as HTMLInputElement[]).map((c) => c.checked)).toEqual([true, false, true])
  })

  it('answers a lone checkbox Yes / No', async () => {
    document.body.innerHTML = '<label><input type="checkbox" id="c"> I am willing to relocate</label>'
    const f = field(/relocate/)
    expect(await fillChoice(f.controls, 'Yes', f.options)).toBe(true)
    expect((document.getElementById('c') as HTMLInputElement).checked).toBe(true)
    expect(await fillChoice(f.controls, 'No', f.options)).toBe(true)
    expect((document.getElementById('c') as HTMLInputElement).checked).toBe(false)
  })

  it('clicks ARIA radios', async () => {
    document.body.innerHTML = `<p id="l">Are you willing to relocate?</p><div role="radiogroup" aria-labelledby="l">
      <div role="radio" aria-checked="false">Yes</div><div role="radio" aria-checked="false">No</div></div>`
    const radios = [...document.querySelectorAll('[role=radio]')] as HTMLElement[]
    radios.forEach((r) => r.addEventListener('click', () => {
      radios.forEach((x) => x.setAttribute('aria-checked', String(x === r)))
    }))
    const f = field(/relocate/)
    expect(await fillChoice(f.controls, 'No', f.options)).toBe(true)
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true')
  })

  it('reports options it cannot find', async () => {
    document.body.innerHTML = LINKEDIN_STEP
    const f = field(/sponsorship/)
    expect(await fillChoice(f.controls, 'Maybe later', f.options)).toBe(false)
  })
})

describe('undo', () => {
  it('restores text, selects, radios and checkboxes exactly', async () => {
    document.body.innerHTML = LINKEDIN + LINKEDIN_STEP + '<label for="t">Why us?</label><textarea id="t">my own draft</textarea>'
    const text = field(/Why us/)
    const select = field(/sponsorship/)
    const radios = field(/commuting/)
    const snapshots = [text, select, radios].map((f) => snapshotValue(f.controls))

    fillField(text.controls[0]!, 'Generated answer')
    await fillChoice(select.controls, 'Yes', select.options)
    await fillChoice(radios.controls, 'No', radios.options)
    expect(hasValue(text.controls) && hasValue(select.controls) && hasValue(radios.controls)).toBe(true)

    expect(snapshots.map(restoreValue)).toEqual([true, true, true])
    expect((text.controls[0] as HTMLTextAreaElement).value).toBe('my own draft')
    expect((select.controls[0] as HTMLSelectElement).selectedIndex).toBe(0)
    expect((radios.controls as HTMLInputElement[]).map((r) => r.checked)).toEqual([false, false])
    expect(hasValue(select.controls) || hasValue(radios.controls)).toBe(false)
  })
})

describe('diagnostics', () => {
  it('describes structure but never values', () => {
    document.body.innerHTML = '<label for="e">Email</label><input id="e" type="email" value="sam@example.com">' +
      '<label for="w">Why us?</label><textarea id="w" name="why">secret draft</textarea>'
    const report = diagnostics(scanAll(document))
    const json = JSON.stringify(report)
    expect(json).not.toContain('sam@example.com')
    expect(json).not.toContain('secret draft')
    expect(report.fields.map((f) => [f.question, f.kind, f.tag])).toEqual([['Email', 'profile', 'input'], ['Why us?', 'open_text', 'textarea']])
    expect(report.fields[1]!.attributes).toEqual({ id: 'w', name: 'why' })
  })
})

describe('profile values', () => {
  it('splits names, picks the current role and links', () => {
    const values = profileValues(
      { full_name: 'Sam Lee Rivera', email: 's@x.com', phone: null, location: 'Berlin, Germany', headline: 'Engineer',
        links: { linkedin: 'https://linkedin.com/in/sam' } } as never,
      [{ company: 'Old', title: 'Dev', is_current: false }, { company: 'Acme', title: 'Engineer II', is_current: true }] as never,
    )
    expect(values).toMatchObject({ first_name: 'Sam Lee', last_name: 'Rivera', city: 'Berlin', current_company: 'Acme', current_title: 'Engineer II', linkedin: 'https://linkedin.com/in/sam' })
    expect(values.phone).toBeUndefined()
  })
})
