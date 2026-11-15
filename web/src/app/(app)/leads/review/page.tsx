'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { EmailReview } from '@/components/leads/email-review'

function Review() {
  const params = useSearchParams()
  const raw = params.get('leads')
  const leadIds = useMemo(
    () => (raw ? raw.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : null),
    [raw],
  )
  return <EmailReview leadIds={leadIds?.length ? leadIds : null} />
}

export default function ReviewEmailsPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  )
}
