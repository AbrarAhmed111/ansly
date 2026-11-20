import { beforeEach, describe, expect, it } from 'vitest'
import { attachedResumeNames, findResumeInputs } from '../resume'

describe('resume application controls', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('finds supported file inputs inside open shadow roots', () => {
    const host = document.createElement('resume-upload')
    const shadow = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,.doc,.docx'
    shadow.append(input)
    document.body.append(host)

    expect(findResumeInputs(document)).toEqual([input])
  })

  it('preserves an existing attachment surfaced in an open shadow root', () => {
    const host = document.createElement('resume-upload')
    const shadow = host.attachShadow({ mode: 'open' })
    const file = document.createElement('span')
    file.dataset.fileName = 'selected-resume.pdf'
    shadow.append(file)
    document.body.append(host)

    expect(attachedResumeNames(document)).toContain('selected-resume.pdf')
  })
})
