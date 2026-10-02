'use client'

import type { Job } from '@ansly/types'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { prepareApplication } from '@/lib/api'
import { trackJob } from '@/lib/applications'
import { errorMessage } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

/** Track a job as an application, optionally preparing it, then open the application. */
export function useJobActions() {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function track(job: Job, prepare: boolean) {
    setBusyId(job.id)
    const pending = prepare ? toast.loading('Preparing your application… this takes about a minute.') : undefined
    try {
      const id = await trackJob(createClient(), job)
      if (prepare) {
        const result = await prepareApplication(id)
        toast.success(result.llm_available ? 'Application prepared' : 'Prepared without AI text: providers were busy', { id: pending })
      } else {
        toast.success('Added to your applications')
      }
      router.push(`/applications/${id}`)
    } catch (err) {
      toast.error(errorMessage(err), { id: pending })
    } finally {
      setBusyId(null)
    }
  }

  return {
    busyId,
    trackJob: (job: Job) => track(job, false),
    prepareJob: (job: Job) => track(job, true),
  }
}
