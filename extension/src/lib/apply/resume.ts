export function findResumeInputs(doc: Document): HTMLInputElement[] {
  return [...doc.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter((input) => {
    const accept = (input.accept ?? '').toLowerCase()
    return accept === '' || accept.includes('pdf') || accept.includes('doc') || accept.includes('word')
  })
}

export function attachedResumeNames(doc: Document): string[] {
  const names = new Set<string>()
  doc.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
    for (const file of Array.from(input.files ?? [])) names.add(file.name)
  })
  doc.querySelectorAll<HTMLElement>('a[href], [data-file-name], [title]').forEach((element) => {
    const text =
      element.getAttribute('data-file-name') ??
      element.getAttribute('title') ??
      element.textContent?.trim() ??
      ''
    if (/\.pdf\b|\.docx?\b/i.test(text)) names.add(text.trim())
  })
  return [...names]
}

export async function uploadResumeToInput(input: HTMLInputElement, url: string, name: string): Promise<boolean> {
  if (!input.isConnected) return false
  const response = await fetch(url)
  if (!response.ok) return false
  const blob = await response.blob()
  const mime =
    blob.type ||
    (name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const file = new File([blob], name, { type: mime, lastModified: Date.now() })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 300))
  return Array.from(input.files ?? []).some((candidate) => candidate.name === name)
}
