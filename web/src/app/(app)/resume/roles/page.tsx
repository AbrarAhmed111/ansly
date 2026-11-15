'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { RoleResumes } from '@/components/resume/role-resumes'
import { PageHeader } from '@/components/ui'

function Library() {
  const params = useSearchParams()
  return <RoleResumes startUpload={params.get('new') === '1'} />
}

export default function RoleResumesPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Resume"
        title="Role resumes"
        description="Keep a resume for each kind of role you apply for. When you write a Leads email, Ansly attaches the one that fits, exactly as you uploaded it, and asks you when it isn’t sure."
      />
      <Suspense>
        <Library />
      </Suspense>
    </div>
  )
}
