-- Everything the dashboard shows, in one call.
--
-- The dashboard used to read every profile table in full plus four more
-- queries (about a dozen round trips) and count rows in JavaScript. This
-- function aggregates inside Postgres and returns only what is displayed.
--
-- security invoker: it runs as the calling user, so row-level security still
-- applies; the explicit user_id filters let the planner use the per-user indexes.
--
-- token_buckets: token use per 15-minute window, so the browser can still add
-- it up by the viewer's local day in any time zone without downloading each event.

create or replace function public.dashboard_summary(token_window_days integer default 31)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select auth.uid() as uid)
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'full_name', p.full_name, 'headline', p.headline, 'location', p.location,
        'summary', p.summary, 'links', p.links
      )
      from public.profiles p where p.id = (select uid from me)
    ),
    'experiences', (select count(*) from public.experiences where user_id = (select uid from me)),
    'experiences_described', (
      select coalesce(bool_and(coalesce(btrim(description), '') <> '' or cardinality(highlights) > 0), false)
      from public.experiences where user_id = (select uid from me)
    ),
    'projects', (select count(*) from public.projects where user_id = (select uid from me)),
    'projects_described', exists (
      select 1 from public.projects where user_id = (select uid from me) and coalesce(btrim(description), '') <> ''
    ),
    'skills', (select count(*) from public.skills where user_id = (select uid from me)),
    'known_skills', (
      select count(*) from public.skills where user_id = (select uid from me) and level is distinct from 'none'
    ),
    'education', (select count(*) from public.education where user_id = (select uid from me)),
    'achievements', (select count(*) from public.achievements where user_id = (select uid from me)),
    'profile_facts', (select count(*) from public.profile_facts where user_id = (select uid from me)),
    'saved_answers', (select count(*) from public.saved_answers where user_id = (select uid from me)),
    'usage_7d', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (
        select kind, count(*) as n from public.usage_events
        where user_id = (select uid from me) and created_at >= now() - interval '7 days'
        group by kind
      ) k
    ),
    'token_buckets', (
      select coalesce(jsonb_agg(jsonb_build_array(bucket, tokens) order by bucket), '[]'::jsonb)
      from (
        select date_bin('15 minutes', created_at, timestamptz '2000-01-01') as bucket, sum(tokens) as tokens
        from public.usage_events
        where user_id = (select uid from me) and tokens > 0
          and created_at >= now() - make_interval(days => least(greatest(token_window_days, 1), 366))
        group by 1
      ) t
    ),
    'master_resume', exists (
      select 1 from public.resumes where user_id = (select uid from me) and is_master
    ),
    'ready_tailorings', (
      select count(*) from public.resume_tailorings where user_id = (select uid from me) and status = 'ready'
    )
  )
$$;

revoke all on function public.dashboard_summary(integer) from public, anon;
grant execute on function public.dashboard_summary(integer) to authenticated;
