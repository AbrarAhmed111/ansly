-- Ansly: tokens per job application.
--
-- - usage_events.job_key: identifies the posting an event belongs to (a hash of
--   its URL, or of company + role), so answers for a job that was never tailored
--   still group together. No job text is stored.
-- - usage_events.job_context_id: the stored job, when the event has one. The
--   composite key keeps an event from pointing at another user's job.
-- - usage_events.llm_calls: model calls the event cost.
-- - kinds 'job_analyzed' (POST /jobs/analyze) and 'adapt_saved_answer'.
-- - job_token_usage: per job, tailoring tokens (analysis + tailoring), answer
--   tokens, total and calls. Tokens per complete application is its total_tokens.

alter table public.usage_events
  add column if not exists job_key text check (length(job_key) <= 64),
  add column if not exists job_context_id uuid,
  add column if not exists llm_calls smallint check (llm_calls >= 0);

alter table public.usage_events drop constraint if exists usage_events_job_context_fkey;
alter table public.usage_events
  add constraint usage_events_job_context_fkey foreign key (user_id, job_context_id)
    references public.job_contexts (user_id, id) on delete set null (job_context_id);

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
  check (kind in (
    'generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'fill_all',
    'resume_uploaded', 'resume_parse_failed', 'job_detected', 'tailoring_started', 'tailoring_completed',
    'tailoring_failed', 'resume_previewed', 'resume_downloaded', 'tailoring_deleted',
    'job_analyzed', 'adapt_saved_answer'
  ));

-- A tailoring's steps can run in different requests (status polls drive them on serverless hosts), so each step
-- adds its own tokens and model calls to the run; the completion event reports the whole run.
alter table public.resume_tailorings
  add column if not exists tokens integer not null default 0 check (tokens >= 0),
  add column if not exists llm_calls smallint not null default 0 check (llm_calls >= 0);

create index if not exists usage_events_user_job_idx on public.usage_events (user_id, job_key)
  where job_key is not null;

create or replace view public.job_token_usage with (security_invoker = true) as
select
  user_id,
  job_key,
  (array_agg(job_context_id) filter (where job_context_id is not null))[1] as job_context_id,
  coalesce(sum(tokens) filter (where kind in ('job_analyzed', 'tailoring_completed', 'tailoring_failed')), 0)
    as tailoring_tokens,
  coalesce(sum(tokens) filter (where kind in ('generate', 'regenerate', 'adapt_saved_answer')), 0) as answer_tokens,
  coalesce(sum(tokens), 0) as total_tokens,
  coalesce(sum(llm_calls), 0) as llm_calls,
  min(created_at) as first_at,
  max(created_at) as last_at
from public.usage_events
where job_key is not null
group by user_id, job_key;

revoke all on public.job_token_usage from anon;
grant select on public.job_token_usage to authenticated;
