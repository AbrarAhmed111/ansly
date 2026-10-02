'use client'

import type { Application, Resume } from '@ansly/types'
import { Briefcase, FolderGit2, MessageCircleQuestion, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { SkillChips } from '@/components/jobs/match'
import { Alert, Button, CopyButton, EmptyState, IconTile, Overline } from '@/components/ui'
import { timeAgo } from '@/lib/jobs'

export function PrepPanel({
  application,
  resumes,
  preparing,
  onPrepare,
}: {
  application: Application
  resumes: Resume[]
  preparing: boolean
  onPrepare: () => void
}) {
  const prep = application.prep
  if (!prep) {
    return (
      <EmptyState
        icon={Wand2}
        title="Prepare this application"
        description="Ansly picks your most relevant experience and resume, drafts a cover letter and answers to common questions, and lists likely interview questions. Everything comes from your profile."
        action={
          <Button icon={Wand2} loading={preparing} onClick={onPrepare}>
            Prepare application
          </Button>
        }
      />
    )
  }

  const resume = prep.resume ? resumes.find((r) => r.id === prep.resume?.resume_id) : null
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-subtle">Prepared {timeAgo(prep.generated_at)}</p>
        <Button variant="secondary" size="sm" icon={Wand2} loading={preparing} onClick={onPrepare}>
          Prepare again
        </Button>
      </div>

      {!prep.tailored_summary && (
        <Alert tone="warning">
          AI providers were busy, so there&apos;s no summary or cover letter this time. Prepare again in a minute.
        </Alert>
      )}

      {prep.tailored_summary && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <Overline as="h3">Tailored summary</Overline>
            <CopyButton text={prep.tailored_summary} />
          </div>
          <p className="rounded-lg border border-border bg-surface-muted/50 px-4 py-3 leading-relaxed">{prep.tailored_summary}</p>
        </section>
      )}

      <section>
        <Overline as="h3" className="mb-2">
          Skills the posting asks for
        </Overline>
        {prep.matched_skills.length + prep.missing_skills.length ? (
          <SkillChips matched={prep.matched_skills} missing={prep.missing_skills} limit={30} />
        ) : (
          <p className="text-muted">No specific skills found in the posting.</p>
        )}
      </section>

      <section>
        <Overline as="h3" className="mb-2">
          Highlight these
        </Overline>
        {prep.relevant.length ? (
          <ul className="space-y-2">
            {prep.relevant.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-start gap-3">
                <IconTile icon={item.type === 'project' ? FolderGit2 : Briefcase} size="sm" tone="accent" />
                <div>
                  <Link href={`/profile/${item.type === 'project' ? 'projects' : 'experience'}`} className="font-medium hover:text-accent">
                    {item.label}
                  </Link>
                  {item.why && <p className="text-body-sm text-muted">{item.why}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing in your profile stands out for this posting yet.</p>
        )}
      </section>

      <section>
        <Overline as="h3" className="mb-2">
          Resume
        </Overline>
        {prep.resume ? (
          <p>
            <span className="font-medium">{resume?.name ?? 'Selected resume'}</span>
            <span className="text-muted">: {prep.resume.reason}</span>
          </p>
        ) : (
          <p className="text-muted">
            No resumes uploaded. <Link href="/resumes?new=1" className="text-accent hover:underline">Upload one</Link> so Ansly
            can pick and attach it.
          </p>
        )}
      </section>

      <section>
        <Overline as="h3" className="mb-2">
          Likely interview questions
        </Overline>
        <ul className="space-y-3">
          {prep.interview_questions.map((q) => (
            <li key={q.question} className="flex gap-3">
              <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <div>
                <p className="font-medium">{q.question}</p>
                {q.why && <p className="text-body-sm text-muted">{q.why}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
