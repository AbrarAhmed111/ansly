import { beforeEach, describe, expect, it } from 'vitest'
import { clickAndWaitForIndeedStep, findIndeedNextAction } from '../navigation'

describe('Indeed step navigation', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('finds a clearly labeled non-submit action', () => {
    document.body.innerHTML = '<button>Save &amp; Continue</button>'

    expect(findIndeedNextAction(document)?.textContent).toBe('Save & Continue')
  })

  it('accepts the initial Apply action outside the application form', () => {
    document.body.innerHTML = '<button>Apply now</button>'

    expect(findIndeedNextAction(document)?.textContent).toBe('Apply now')
  })

  it('does not click another Apply action after the application has started', () => {
    document.body.innerHTML = '<button>Apply now</button>'

    expect(findIndeedNextAction(document, false)).toBeNull()
  })

  it('finds step controls inside open shadow roots', () => {
    const host = document.createElement('indeed-step')
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.textContent = 'Continue'
    shadow.append(button)
    document.body.append(host)

    expect(findIndeedNextAction(document)).toBe(button)
  })

  it('does not click final-submit controls', () => {
    document.body.innerHTML = '<form><button type="submit">Submit application</button></form>'

    expect(findIndeedNextAction(document)).toBeNull()
  })

  it('does not mistake an Apply control in the application dialog for navigation', () => {
    document.body.innerHTML = '<div role="dialog"><button>Apply now</button></div>'

    expect(findIndeedNextAction(document)).toBeNull()
  })

  it('rejects ambiguous actions rather than choosing an arbitrary button', () => {
    document.body.innerHTML = '<button>Continue</button><button>Next</button>'

    expect(findIndeedNextAction(document)).toBeNull()
  })

  it('prefers one action inside an application dialog', () => {
    document.body.innerHTML = '<button>Apply now</button><div role="dialog"><button>Continue</button></div>'

    expect(findIndeedNextAction(document)?.textContent).toBe('Continue')
  })

  it('waits for the page to change after clicking a step action', async () => {
    document.body.innerHTML = '<button>Continue</button><main>Step one</main>'
    const button = findIndeedNextAction(document)!
    button.click = () => {
      document.querySelector('main')!.textContent = 'Step two'
    }

    await expect(clickAndWaitForIndeedStep(button, document)).resolves.toBe(true)
  })
})
