/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PREVIEW_ERROR, ResumePreview } from '../resume-preview'
import { TailoredReadyCard } from '../tailored-ready'
import { previewDocuments, renderDocx } from '@/lib/docx-preview'

jest.mock('@/lib/docx-preview', () => ({
  previewDocuments: jest.fn(),
  renderDocx: jest.fn(),
  pageWidth: () => 816,
}))

const mockedDocs = previewDocuments as jest.MockedFunction<typeof previewDocuments>
const mockedRender = renderDocx as jest.MockedFunction<typeof renderDocx>

const ORIGINAL = new ArrayBuffer(8)
const TAILORED = new ArrayBuffer(16)
const DOCS = { format: 'docx' as const, tailored: TAILORED, tailoredName: 'R - Tailored.docx', original: ORIGINAL, originalName: 'R.docx' }

/** Fake renderer: `pages` page sections, like docx-preview + pagination would leave them. */
function renderPages(pages: { original: number; tailored: number }) {
  mockedRender.mockImplementation(async (data, container, className) => {
    const side = data === TAILORED ? 'tailored' : 'original'
    container.innerHTML = Array.from(
      { length: pages[side] },
      (_, i) => `<section class="${className}" data-page="Page ${i + 1} of ${pages[side]}">${side} page ${i + 1}</section>`,
    ).join('')
    return pages[side]
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ResumePreview', () => {
  it('shows page-shaped skeletons and a loading message while the documents load', async () => {
    mockedDocs.mockReturnValue(new Promise(() => undefined))
    const onStatus = jest.fn()
    render(<ResumePreview tailoringId="t1" onStatus={onStatus} />)
    expect(screen.getByTestId('page-skeleton')).toBeTruthy()
    expect(screen.getByText(/Preparing your resume preview/)).toBeTruthy()
    expect(onStatus).toHaveBeenLastCalledWith('loading')
  })

  it('previews a one-page resume from the final tailored DOCX', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 1, tailored: 1 })
    const onStatus = jest.fn()
    render(<ResumePreview tailoringId="t1" onStatus={onStatus} />)
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith('ready'))
    // The tailored document's own bytes are what's rendered.
    expect(mockedRender).toHaveBeenCalledWith(TAILORED, expect.any(HTMLElement), 'docx-tailored')
    expect(mockedRender).toHaveBeenCalledWith(ORIGINAL, expect.any(HTMLElement), 'docx-original')
    expect(screen.getByText('1 page')).toBeTruthy()
    expect(within(screen.getByTestId('pages-tailored')).getAllByText(/tailored page/)).toHaveLength(1)
    expect(screen.queryByText('Layout changed')).toBeNull()
  })

  it('shows every page of a two-page resume, with page boundaries, and warns that the layout changed', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 1, tailored: 2 })
    render(<ResumePreview tailoringId="t1" />)
    await screen.findByText('Layout changed')
    expect(screen.getByText(/expand from 1 page to 2 pages/)).toBeTruthy()
    const pages = screen.getByTestId('pages-tailored').querySelectorAll('section[data-page]')
    expect([...pages].map((p) => p.getAttribute('data-page'))).toEqual(['Page 1 of 2', 'Page 2 of 2'])
    expect(screen.getByText('2 pages')).toBeTruthy()
  })

  it('switches between the original and the tailored resume', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 1, tailored: 2 })
    render(<ResumePreview tailoringId="t1" />)
    await screen.findByText('2 pages')
    expect(screen.getByTestId('pane-tailored').getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByTestId('pane-original').getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
    expect(screen.getByRole('tab', { name: 'Original' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('pane-original').getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByTestId('pane-tailored').getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('1 page')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /Side by side/ }))
    expect(screen.getByTestId('pane-original').getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByTestId('pane-tailored').getAttribute('aria-hidden')).toBe('false')
  })

  it('zooms in and out', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 1, tailored: 1 })
    render(<ResumePreview tailoringId="t1" />)
    await screen.findByText('1 page')
    expect(screen.getByTestId('zoom-level').textContent).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByTestId('zoom-level').textContent).toBe('120%')
    expect(screen.getByTestId('pages-tailored').style.zoom).toBe('1.2')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(screen.getByTestId('zoom-level').textContent).toBe('110%')
  })

  it('explains a preview failure, still offers the download, and can retry', async () => {
    mockedDocs.mockRejectedValueOnce(new Error('network'))
    const onDownload = jest.fn()
    const onStatus = jest.fn()
    render(<ResumePreview tailoringId="t1" onDownload={onDownload} onStatus={onStatus} />)
    await screen.findByText(PREVIEW_ERROR)
    expect(onStatus).toHaveBeenLastCalledWith('error')
    expect(screen.queryByText(/ready for visual inspection/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Download DOCX/ }))
    expect(onDownload).toHaveBeenCalled()

    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 1, tailored: 1 })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Try again/ })))
    await screen.findByText('1 page')
  })

  it('treats a document that fails to render as a preview failure', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    mockedRender.mockRejectedValue(new Error('bad document'))
    render(<ResumePreview tailoringId="t1" />)
    await screen.findByText(PREVIEW_ERROR)
  })

  it('shows only the tailored resume when the original was deleted', async () => {
    mockedDocs.mockResolvedValue({ ...DOCS, original: null, originalName: null })
    renderPages({ original: 1, tailored: 1 })
    render(<ResumePreview tailoringId="t1" />)
    await screen.findByText('1 page')
    expect((screen.getByRole('tab', { name: 'Original' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/original version this was tailored from was deleted/)).toBeTruthy()
  })
})

describe('TailoredReadyCard', () => {
  const props = {
    previewOpen: false, leftOut: 0, downloading: false, savingPdf: false,
    onPreview: jest.fn(), onDownload: jest.fn(), onPdf: jest.fn(),
  }

  it('leads with the preview and says the formatting was preserved', () => {
    render(<TailoredReadyCard {...props} preview="loading" />)
    expect(screen.getByText('Your tailored resume is ready')).toBeTruthy()
    expect(screen.getByText(/Your original formatting has been preserved/)).toBeTruthy()
    expect(screen.getByText('Preparing preview')).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Preview Resume', 'Download DOCX', 'Download PDF'])
    fireEvent.click(screen.getByRole('button', { name: 'Preview Resume' }))
    expect(props.onPreview).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(props.onPdf).toHaveBeenCalled()
  })

  it('reports the preview as ready or unavailable, and changes left out', () => {
    const { rerender } = render(<TailoredReadyCard {...props} preview="ready" leftOut={2} />)
    expect(screen.getByText('Preview ready')).toBeTruthy()
    expect(screen.getByText(/2 changes were left out to protect your layout/)).toBeTruthy()
    rerender(<TailoredReadyCard {...props} preview="error" />)
    expect(screen.getByText('Preview unavailable')).toBeTruthy()
    expect(screen.getByText('Ready to download')).toBeTruthy()
  })
})

describe('ResumePreview page limit', () => {
  it('warns when the tailored resume runs past the page limit, without blocking anything', async () => {
    mockedDocs.mockResolvedValue(DOCS)
    renderPages({ original: 2, tailored: 2 })
    render(<ResumePreview tailoringId="t1" pageLimit={1} />)
    await screen.findByText('Over your page limit')
    expect(screen.getByText(/your limit is 1 page/)).toBeTruthy()
    expect(screen.queryByText('Layout changed')).toBeNull()
  })
})
