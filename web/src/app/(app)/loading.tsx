import { Card, Skeleton } from '@/components/ui'

/** Shown instantly on navigation while the next page renders on the server. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-2/3 max-w-md" />
      <Skeleton className="mt-2 h-4 w-full max-w-lg" />
      <Card className="mt-8 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </Card>
      <Card className="mt-6 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    </div>
  )
}
