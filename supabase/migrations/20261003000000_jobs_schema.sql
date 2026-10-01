-- Ansly V2, part 1: job ingestion, matching, saved searches and alerts.
--
-- `job_sources` and `jobs` are shared by everyone: signed-in users can read
-- them, and only the ingestion worker (service role, which bypasses RLS)
-- writes them. Matches, searches and alerts belong to one user each.

-- ---------------------------------------------------------------------------
-- job_sources: where jobs come from, with each source's terms recorded
-- ---------------------------------------------------------------------------

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  -- Adapter used to fetch the source (see llm/src/app/jobs/sources).
  kind text not null check (kind in ('greenhouse', 'lever', 'ashby', 'arbeitnow')),
  -- Board token / company slug for ATS boards; '' for whole-feed sources.
  identifier text not null default '',
  name text not null,
  enabled boolean not null default true,
  terms_url text,
  terms_notes text,
  -- Credit shown next to jobs from this source, when the source asks for it.
  attribution text,
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'error')),
  last_error text,
  last_job_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, identifier)
);

-- ---------------------------------------------------------------------------
-- jobs: normalized, deduplicated postings
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.job_sources (id) on delete cascade,
  external_id text not null,
  -- company + title + location, normalized; the same job from two sources shares it.
  dedupe_key text not null,
  url text not null,
  apply_url text,
  title text not null,
  company text not null,
  location text,
  workplace text check (workplace in ('remote', 'hybrid', 'onsite')),
  employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'internship', 'temporary')),
  department text,
  seniority text check (seniority in ('intern', 'junior', 'mid', 'senior', 'lead', 'principal')),
  description text,
  -- Requirements extracted from the posting.
  skills text[] not null default '{}',
  experience_years_min numeric(4, 1) check (experience_years_min >= 0),
  salary_min integer check (salary_min >= 0),
  salary_max integer check (salary_max >= 0),
  salary_currency text,
  salary_period text check (salary_period in ('year', 'month', 'hour')),
  -- Other sources that list the same job: [{"source_id": ..., "url": ...}].
  also_listed_on jsonb not null default '[]'::jsonb,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id),
  unique (dedupe_key)
);

create index jobs_active_first_seen_idx on public.jobs (is_active, first_seen_at desc);
create index jobs_skills_idx on public.jobs using gin (skills);

-- ---------------------------------------------------------------------------
-- job_matches: explainable profile-to-job alignment, per user
-- ---------------------------------------------------------------------------

create table public.job_matches (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  tier text not null check (tier in ('strong', 'good', 'potential', 'low')),
  -- 0-1, only for ordering; the UI shows the reasons, never the number alone.
  score numeric(4, 3) not null check (score between 0 and 1),
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  -- {"required": 4, "profile": 5.5, "fit": "meets" | "close" | "below" | "unknown"}
  experience jsonb not null default '{}'::jsonb,
  workplace_fit text check (workplace_fit in ('match', 'mismatch', 'unknown')),
  location_fit text check (location_fit in ('match', 'remote', 'relocate', 'mismatch', 'unknown')),
  role_fit text check (role_fit in ('match', 'related', 'unrelated')),
  -- Short human-readable reasons, strongest first.
  reasons text[] not null default '{}',
  saved boolean not null default false,
  dismissed boolean not null default false,
  computed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index job_matches_user_tier_idx on public.job_matches (user_id, tier, score desc);

-- ---------------------------------------------------------------------------
-- saved_searches: natural-language searches parsed into filters
-- ---------------------------------------------------------------------------

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  query text not null,
  -- {"roles": [], "skills": [], "workplace": [], "locations": [], "experience_years": n,
  --  "min_salary": n, "keywords": [], "employment_types": []}
  filters jsonb not null default '{}'::jsonb,
  alerts_enabled boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_alerts: new jobs that matched a saved search
-- ---------------------------------------------------------------------------

create table public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  saved_search_id uuid not null references public.saved_searches (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  tier text not null check (tier in ('strong', 'good', 'potential', 'low')),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (saved_search_id, job_id)
);

create index job_alerts_user_unseen_idx on public.job_alerts (user_id, seen_at, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers and per-user indexes
-- ---------------------------------------------------------------------------

create trigger job_sources_set_updated_at before update on public.job_sources
  for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();
create trigger saved_searches_set_updated_at before update on public.saved_searches
  for each row execute function public.set_updated_at();
create index saved_searches_user_id_idx on public.saved_searches (user_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.job_sources enable row level security;
alter table public.jobs enable row level security;

create policy "Signed-in users read job sources" on public.job_sources
  for select to authenticated using (true);
create policy "Signed-in users read jobs" on public.jobs
  for select to authenticated using (true);

do $$
declare
  t text;
begin
  foreach t in array array['job_matches', 'saved_searches', 'job_alerts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Users read own rows" on public.%I for select to authenticated
         using ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "Users insert own rows" on public.%I for insert to authenticated
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "Users update own rows" on public.%I for update to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "Users delete own rows" on public.%I for delete to authenticated
         using ((select auth.uid()) = user_id)', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.job_sources, public.jobs, public.job_matches, public.saved_searches,
  public.job_alerts from anon;

grant select on public.job_sources, public.jobs to authenticated;
grant select, insert, update, delete on public.job_matches, public.saved_searches, public.job_alerts
  to authenticated;

-- ---------------------------------------------------------------------------
-- Initial sources. Public job-board APIs that employers publish for exactly
-- this purpose, plus one aggregator whose terms allow reuse with a link back.
-- LinkedIn and Indeed scraping is deliberately not a source.
-- ---------------------------------------------------------------------------

insert into public.job_sources (kind, identifier, name, terms_url, terms_notes, attribution) values
  ('greenhouse', 'vercel', 'Vercel', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('greenhouse', 'anthropic', 'Anthropic', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('greenhouse', 'stripe', 'Stripe', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('greenhouse', 'figma', 'Figma', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('greenhouse', 'gitlab', 'GitLab', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('greenhouse', 'cloudflare', 'Cloudflare', 'https://developers.greenhouse.io/job-board.html',
   'Public Job Board API published by the employer. Link to the original posting; apply on the employer''s site.', null),
  ('ashby', 'linear', 'Linear', 'https://developers.ashbyhq.com/docs/public-job-posting-api',
   'Public job posting API published by the employer. Link to the original posting.', null),
  ('ashby', 'ramp', 'Ramp', 'https://developers.ashbyhq.com/docs/public-job-posting-api',
   'Public job posting API published by the employer. Link to the original posting.', null),
  ('ashby', 'replit', 'Replit', 'https://developers.ashbyhq.com/docs/public-job-posting-api',
   'Public job posting API published by the employer. Link to the original posting.', null),
  ('ashby', 'supabase', 'Supabase', 'https://developers.ashbyhq.com/docs/public-job-posting-api',
   'Public job posting API published by the employer. Link to the original posting.', null),
  ('lever', 'spotify', 'Spotify', 'https://github.com/lever/postings-api',
   'Public Postings API published by the employer. Link to the original posting.', null),
  ('arbeitnow', '', 'Arbeitnow', 'https://www.arbeitnow.com/blog/job-board-api',
   'Free public API; do not abuse (fetch at most hourly) and link back to Arbeitnow.', 'via Arbeitnow')
on conflict (kind, identifier) do nothing;
