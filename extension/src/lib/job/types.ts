import type { JobSource } from '@ansly/types'

/** What a detector reads from the page. `description` is only filled when extracting (after the user clicks). */
export interface DetectedJob {
  title: string
  company: string
  location: string | null
  employmentType: string | null
  description: string
  source: JobSource
}
