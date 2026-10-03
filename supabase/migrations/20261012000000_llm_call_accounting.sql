-- Ansly: provider-reported tokens, cost and latency per LLM call, aggregated per application.
--
-- - llm_calls: one row per provider call (answers, batches, adaptations, job
--   analysis, tailoring steps, review) and per embedding request. Tokens are what
--   the provider reported, split into uncached input, cache reads, cache writes
--   and output (thinking included; thinking_tokens repeats it where the provider
--   reports it separately). cost_usd comes from the API's pricing table when the
--   call was made (null for an unpriced model). Calls whose output failed
--   validation are kept with ok = false: they were billed. No prompt or answer
--   text is stored.
-- - application_usage: per job (job_key), tokens, calls and cost by stage, the
--   usage pattern (tailoring + fill all, single answers...) and the share spent
--   on regenerations. Its total_tokens / total_cost_usd are tokens and cost per
--   application. Embeddings are reported apart from generation.
-- - usage_events.edited: on 'fill' events, whether the user changed the answer
--   before filling it (a quality signal; no text). 'fill' events also carry the
--   user's wait (click to answer shown) in duration_ms.

create table public.llm_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  request_id text check (length(request_id) <= 64),
  job_key text check (length(job_key) <= 64),
  job_context_id uuid,
  stage text not null check (length(stage) <= 40),
  provider text not null check (length(provider) <= 40),
  model text not null check (length(model) <= 100),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  thinking_tokens integer check (thinking_tokens >= 0),
  duration_ms integer check (duration_ms >= 0),
  ttft_ms integer check (ttft_ms >= 0),
  items smallint not null default 1 check (items >= 0),
  ok boolean not null default true,
  cost_usd numeric(14, 8) check (cost_usd >= 0),
  constraint llm_calls_job_context_fkey foreign key (user_id, job_context_id)
    references public.job_contexts (user_id, id) on delete set null (job_context_id)
);

create index llm_calls_user_job_idx on public.llm_calls (user_id, job_key) where job_key is not null;
create index llm_calls_user_created_idx on public.llm_calls (user_id, created_at desc);

alter table public.llm_calls enable row level security;

create policy "Users read own LLM calls" on public.llm_calls
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own LLM calls" on public.llm_calls
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on public.llm_calls from anon;
grant select, insert on public.llm_calls to authenticated;

alter table public.usage_events add column if not exists edited boolean;

create or replace view public.application_usage with (security_invoker = true) as
with calls as (
  select
    *,
    input_tokens + cache_read_tokens + cache_write_tokens + output_tokens as tokens,
    stage in ('embedding_query', 'embedding_profile') as is_embedding
  from public.llm_calls
  where job_key is not null
),
per_job as (
  select
    user_id,
    job_key,
    (array_agg(job_context_id) filter (where job_context_id is not null))[1] as job_context_id,
    -- Generation (every model call but embeddings), by stage.
    coalesce(sum(tokens) filter (where stage = 'job_analysis'), 0) as job_analysis_tokens,
    coalesce(sum(tokens) filter (where stage = 'matching'), 0) as matching_tokens,
    coalesce(sum(tokens) filter (where stage = 'tailoring_plan'), 0) as tailoring_tokens,
    coalesce(sum(tokens) filter (where stage = 'validation_review'), 0) as validation_tokens,
    coalesce(sum(tokens) filter (where stage in ('answer', 'answer_simple', 'answer_complex', 'answer_batch')), 0)
      as answer_tokens,
    coalesce(sum(tokens) filter (where stage = 'answer_regeneration'), 0) as regeneration_tokens,
    coalesce(sum(tokens) filter (where stage = 'answer_adaptation'), 0) as adaptation_tokens,
    coalesce(sum(tokens) filter (where not is_embedding), 0) as total_tokens,
    coalesce(sum(cache_read_tokens) filter (where not is_embedding), 0) as cached_input_tokens,
    coalesce(sum(thinking_tokens) filter (where not is_embedding), 0) as thinking_tokens,
    count(*) filter (where not is_embedding) as llm_calls,
    count(*) filter (where not is_embedding and not ok) as failed_calls,
    count(*) filter (where stage in ('answer', 'answer_simple', 'answer_complex')) as single_answer_calls,
    count(*) filter (where stage = 'answer_batch') as batch_calls,
    count(*) filter (where stage = 'answer_regeneration') as regenerations,
    count(*) filter (where stage in ('matching', 'tailoring_plan')) as tailoring_calls,
    -- Cost by stage (USD). Unpriced calls add nothing; unpriced_calls says how many there were.
    coalesce(sum(cost_usd) filter (where stage = 'job_analysis'), 0) as job_analysis_cost_usd,
    coalesce(sum(cost_usd) filter (where stage = 'matching'), 0) as matching_cost_usd,
    coalesce(sum(cost_usd) filter (where stage = 'tailoring_plan'), 0) as tailoring_cost_usd,
    coalesce(sum(cost_usd) filter (where stage = 'validation_review'), 0) as validation_cost_usd,
    coalesce(sum(cost_usd) filter (where stage in ('answer', 'answer_simple', 'answer_complex', 'answer_batch')), 0)
      as answer_cost_usd,
    coalesce(sum(cost_usd) filter (where stage = 'answer_regeneration'), 0) as regeneration_cost_usd,
    coalesce(sum(cost_usd) filter (where stage = 'answer_adaptation'), 0) as adaptation_cost_usd,
    coalesce(sum(cost_usd) filter (where not is_embedding), 0) as generation_cost_usd,
    count(*) filter (where cost_usd is null) as unpriced_calls,
    -- Embeddings, apart from generation.
    coalesce(sum(tokens) filter (where stage = 'embedding_query'), 0) as query_embedding_tokens,
    coalesce(sum(tokens) filter (where stage = 'embedding_profile'), 0) as profile_embedding_tokens,
    coalesce(sum(cost_usd) filter (where is_embedding), 0) as embedding_cost_usd,
    coalesce(sum(cost_usd), 0) as total_cost_usd,
    coalesce(sum(duration_ms) filter (where not is_embedding), 0) as llm_ms,
    min(created_at) as first_at,
    max(created_at) as last_at
  from calls
  group by user_id, job_key
)
select
  *,
  case
    when tailoring_calls > 0 and batch_calls > 0 then 'tailoring_fill_all'
    when tailoring_calls > 0 and single_answer_calls > 0 then 'tailoring_manual_answers'
    when tailoring_calls > 0 then 'tailoring_only'
    when batch_calls > 0 and batch_calls >= single_answer_calls then 'fill_all_heavy'
    when single_answer_calls > 0 then 'single_answer_heavy'
    else 'other'
  end as usage_pattern
from per_job;

revoke all on public.application_usage from anon;
grant select on public.application_usage to authenticated;
