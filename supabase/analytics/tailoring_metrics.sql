-- Resume tailoring (v1.2) metrics: completion, failure, download rate, time, and
-- token cost. Run in the Supabase SQL editor as the project owner (it reads every
-- user's usage_events; the app itself only ever sees a user's own rows).
-- usage_events never contain resume or job text.

-- Daily funnel for the last 30 days.
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where kind = 'job_detected') as jobs_detected,
  count(*) filter (where kind = 'tailoring_started') as started,
  count(*) filter (where kind = 'tailoring_completed') as completed,
  count(*) filter (where kind = 'tailoring_failed') as failed,
  count(*) filter (where kind = 'resume_previewed') as previewed,
  count(*) filter (where kind = 'resume_downloaded') as downloaded,
  round(100.0 * count(*) filter (where kind = 'tailoring_completed')
        / nullif(count(*) filter (where kind = 'tailoring_started'), 0), 1) as completion_pct,
  round(100.0 * count(*) filter (where kind = 'tailoring_failed')
        / nullif(count(*) filter (where kind = 'tailoring_started'), 0), 1) as failure_pct,
  round(100.0 * count(*) filter (where kind = 'resume_downloaded')
        / nullif(count(*) filter (where kind = 'tailoring_completed'), 0), 1) as download_pct
from public.usage_events
where created_at > now() - interval '30 days'
group by 1
order by 1 desc;

-- Generation time and tokens per completed tailoring (last 30 days).
-- Estimated cost: set the blended price per 1M tokens for your provider mix.
with params as (select 0.40::numeric as usd_per_million_tokens)
select
  count(*) as completed,
  round(avg(duration_ms) / 1000.0, 1) as avg_seconds,
  round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as p50_seconds,
  round((percentile_cont(0.9) within group (order by duration_ms) / 1000.0)::numeric, 1) as p90_seconds,
  round(avg(tokens)) as avg_tokens,
  round(avg(tokens) * (select usd_per_million_tokens from params) / 1e6, 4) as est_usd_per_tailoring
from public.usage_events
where kind = 'tailoring_completed' and created_at > now() - interval '30 days';

-- Which providers end up serving tailorings (a high share on fallbacks = primary provider trouble).
select provider, count(*) as tailorings
from public.usage_events
where kind = 'tailoring_completed' and created_at > now() - interval '30 days'
group by 1
order by 2 desc;

-- Failure reasons (user-safe messages) and where the pipeline stopped, last 7 days.
select error, count(*) as failures
from public.resume_tailorings
where status = 'failed' and updated_at > now() - interval '7 days'
group by 1
order by 2 desc;

-- Runs stuck mid-pipeline (the next status poll resumes them; many here = hosting stops background work).
select status, count(*) as stuck
from public.resume_tailorings
where status not in ('ready', 'failed') and updated_at < now() - interval '5 minutes'
group by 1;
