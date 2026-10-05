-- UX success metrics for Ask-and-Learn, Application Memory, rewrites, Fill all and onboarding, from
-- public.usage_events. Run in the Supabase SQL editor as the project owner (it reads every user's rows; the app
-- itself only ever sees a user's own). Events carry a kind and a short category only: no question, answer,
-- memory value or job text is ever stored.

-- 1. Answers resolved without generation, and learned facts reused (last 30 days). A "generate" event with no
-- model call is an instant answer from the profile, Application Memory or a saved answer.
select
  count(*) filter (where kind = 'generate') as answers,
  count(*) filter (where kind = 'generate' and coalesce(llm_calls, 0) = 0) as instant_answers,
  round(count(*) filter (where kind = 'generate' and coalesce(llm_calls, 0) = 0)::numeric
        / nullif(count(*) filter (where kind = 'generate'), 0), 3) as zero_token_rate,
  count(*) filter (where kind = 'memory_used') as memory_reuses,
  count(*) filter (where kind = 'memory_fact_saved') as facts_learned
from public.usage_events
where created_at > now() - interval '30 days';

-- 2. Ask-and-Learn: shown, completed, skipped (abandoned = shown but neither).
select
  count(*) filter (where kind = 'ask_and_learn_shown') as shown,
  count(*) filter (where kind = 'ask_and_learn_completed') as completed,
  count(*) filter (where kind = 'ask_and_learn_skipped') as skipped,
  round(count(*) filter (where kind = 'ask_and_learn_completed')::numeric
        / nullif(count(*) filter (where kind = 'ask_and_learn_shown'), 0), 3) as completion_rate
from public.usage_events
where created_at > now() - interval '30 days';

-- 3. Rewrites vs regenerations: the regeneration rate should fall as rewrite controls take over.
select
  date_trunc('week', created_at) as week,
  count(*) filter (where kind = 'rewrite') as rewrites,
  count(*) filter (where kind = 'fit_to_limit') as fit_to_limit,
  count(*) filter (where kind = 'regenerate') as regenerations,
  round(count(*) filter (where kind = 'regenerate')::numeric
        / nullif(count(*) filter (where kind in ('rewrite', 'fit_to_limit', 'regenerate')), 0), 3) as regeneration_share
from public.usage_events
where created_at > now() - interval '90 days'
group by 1
order by 1 desc;

-- 4. Filling: answers filled with and without edits, Fill all completion and undo rate.
select
  count(*) filter (where kind = 'fill') as fills,
  round(count(*) filter (where kind = 'fill' and edited is false)::numeric / nullif(count(*) filter (where kind = 'fill'), 0), 3)
    as filled_without_edit,
  round(count(*) filter (where kind = 'fill' and edited)::numeric / nullif(count(*) filter (where kind = 'fill'), 0), 3)
    as edited_before_fill,
  count(*) filter (where kind = 'fill_all') as fill_all_started,
  round(count(*) filter (where kind = 'fill_all_completed')::numeric / nullif(count(*) filter (where kind = 'fill_all'), 0), 3)
    as fill_all_completion,
  round(count(*) filter (where kind = 'undo')::numeric
        / nullif(count(*) filter (where kind in ('fill', 'fill_all_completed')), 0), 3) as undo_rate
from public.usage_events
where created_at > now() - interval '30 days';

-- 5. Onboarding funnel: signups in the window, and how many reached each step (ever). Drop-off, not just signups.
with signups as (
  select id as user_id, created_at from auth.users where created_at > now() - interval '30 days'
),
reached as (
  select
    s.user_id,
    bool_or(e.kind = 'resume_uploaded') as resume_uploaded,
    bool_or(e.kind = 'onboarding_step' and e.category in ('profile', 'preferences')) as profile_ready,
    bool_or(e.kind = 'extension_connected') as extension_connected,
    bool_or(e.kind in ('generate', 'fill', 'first_answer')) as first_answer,
    bool_or(e.kind = 'fill_all_completed') as first_fill_all
  from signups s
  left join public.usage_events e on e.user_id = s.user_id
  group by s.user_id
)
select
  count(*) as signups,
  count(*) filter (where resume_uploaded) as resume_uploaded,
  count(*) filter (where profile_ready) as profile_ready,
  count(*) filter (where extension_connected) as extension_connected,
  count(*) filter (where first_answer) as first_answer,
  count(*) filter (where first_fill_all) as first_fill_all
from reached;

-- 6. Which setup steps people skip (Ask-and-Learn collects those later).
select category as step, count(*) as skips
from public.usage_events
where kind = 'onboarding_step' and category like '%\_skipped' escape '\'
  and created_at > now() - interval '30 days'
group by 1
order by 2 desc;
