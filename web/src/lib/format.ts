/** A readable message from anything thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** "1 item", "3 items". */
export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`
}

/** "favorite_project" -> "favorite project". */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}
