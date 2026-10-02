'use client'

import type { Job, JobMatch } from '@ansly/types'
import { Bookmark, BookmarkCheck, ExternalLink, ListPlus, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { useJobActions } from '@/components/jobs/use-job-actions'
import { Button, buttonStyles } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'

export function JobActions({ job, match, applicationId }: { job: Job; match: JobMatch | null; applicationId: string | null }) {
  const { busyId, trackJob, prepareJob } = useJobActions()
  const [saved, setSaved] = useState(Boolean(match?.saved))
  const busy = busyId === job.id

  async function toggleSave() {
    const { error } = await createClient().from('job_matches').update({ saved: !saved }).eq('job_id', job.id)
    if (error) return toast.error(error.message)
    setSaved(!saved)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {applicationId ? (
        <Link href={`/applications/${applicationId}`} className={buttonStyles()}>
          Open application
        </Link>
      ) : (
        <>
          <Button icon={Wand2} loading={busy} onClick={() => void prepareJob(job)}>
            Prepare application
          </Button>
          <Button variant="secondary" icon={ListPlus} disabled={busy} onClick={() => void trackJob(job)}>
            Track
          </Button>
        </>
      )}
      <a href={job.apply_url ?? job.url} target="_blank" rel="noreferrer" className={buttonStyles({ variant: 'secondary' })}>
        <ExternalLink className="h-4 w-4" />
        View posting
      </a>
      {match && (
        <Button variant="ghost" icon={saved ? BookmarkCheck : Bookmark} onClick={() => void toggleSave()}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      )}
    </div>
  )
}
