import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fillField, readFieldValue, verifyFilled } from '../fill'

// Tell React this is a test environment so act() works.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ANSWER = 'One project I am proud of is TaskFlow, an open-source task app.'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('plain fields', () => {
  it('fills a textarea and fires input + change', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>'
    const el = document.getElementById('t') as HTMLTextAreaElement
    const events: string[] = []
    el.addEventListener('input', () => events.push('input'))
    el.addEventListener('change', () => events.push('change'))
    const result = fillField(el, ANSWER)
    expect(result).toMatchObject({ ok: true, method: 'native-setter' })
    expect(el.value).toBe(ANSWER)
    expect(events).toEqual(['input', 'change'])
  })

  it('respects maxlength', () => {
    document.body.innerHTML = '<input id="i" type="text" maxlength="10">'
    const el = document.getElementById('i') as HTMLInputElement
    const result = fillField(el, ANSWER)
    expect(el.value).toBe(ANSWER.slice(0, 10))
    expect(result.ok).toBe(true)
  })

  it('verifies with whitespace-insensitive comparison', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>'
    const el = document.getElementById('t') as HTMLTextAreaElement
    el.value = 'Line one\n\nLine   two'
    expect(verifyFilled(el, 'Line one Line two')).toBe(true)
    expect(verifyFilled(el, 'Something else')).toBe(false)
  })
})

describe('React-controlled fields', () => {
  function ControlledForm({ onValue }: { onValue: (v: string) => void }) {
    const [value, setValue] = useState('')
    return (
      <textarea
        id="react-field"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          onValue(e.target.value)
        }}
      />
    )
  }

  it('updates React state, so the value survives a re-render', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onValue = vi.fn()
    const root = createRoot(container)
    await act(async () => root.render(<ControlledForm onValue={onValue} />))

    const el = document.getElementById('react-field') as HTMLTextAreaElement
    await act(async () => {
      fillField(el, ANSWER)
    })
    expect(onValue).toHaveBeenLastCalledWith(ANSWER)
    // A controlled field whose state wasn't updated would be reset to '' here.
    await act(async () => root.render(<ControlledForm onValue={onValue} />))
    expect(el.value).toBe(ANSWER)
    root.unmount()
  })
})

describe('contenteditable fields', () => {
  it('replaces the content and reports the method used', () => {
    document.body.innerHTML = '<div id="ce" contenteditable="true"><p>old text</p></div>'
    const el = document.getElementById('ce') as HTMLElement
    const inputs: Event[] = []
    el.addEventListener('input', (e) => inputs.push(e))
    const result = fillField(el, ANSWER)
    expect(result.ok).toBe(true)
    expect(['exec-command', 'text-content']).toContain(result.method)
    expect(readFieldValue(el).trim()).toBe(ANSWER)
    expect(inputs.length).toBeGreaterThan(0)
  })

  it('falls back when execCommand is unavailable', () => {
    document.body.innerHTML = '<div id="ce" contenteditable="true"></div>'
    const el = document.getElementById('ce') as HTMLElement
    const original = document.execCommand
    document.execCommand = () => false
    try {
      expect(fillField(el, ANSWER)).toMatchObject({ ok: true, method: 'text-content' })
    } finally {
      document.execCommand = original
    }
  })
})
