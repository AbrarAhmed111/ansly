-- Ansly V1 schema: structured profile, saved answers, and usage events.
-- Every row belongs to one auth user and is protected by row-level security.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per user (personal info, summary, links, preferences)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  headline text,
  email text,
  phone text,
  location text,
  summary text,
  links jsonb not null default '{}'::jsonb,
  -- Application preferences. Answers about these are only given when filled in.
  work_authorization text,
  requires_sponsorship boolean,
  notice_period text,
  salary_expectation text,
  willing_to_relocate boolean,
  preferred_work_mode text check (preferred_work_mode in ('remote', 'hybrid', 'onsite', 'flexible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Profile sections
-- ---------------------------------------------------------------------------

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null,
  title text not null,
  location text,
  employment_type text,
  start_date date,
  end_date date,
  is_current boolean not null default false,
  description text,
  highlights text[] not null default '{}',
  technologies text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  role text,
  url text,
  repo_url text,
  description text,
  highlights text[] not null default '{}',
  technologies text[] not null default '{}',
  start_date date,
  end_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  category text check (category in ('language', 'framework', 'database', 'cloud', 'tool', 'ai', 'soft', 'other')),
  level text check (level in ('beginner', 'intermediate', 'advanced', 'expert')),
  years numeric(4, 1) check (years >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index skills_user_name_key on public.skills (user_id, lower(name));

create table public.education (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  institution text not null,
  degree text,
  field_of_study text,
  start_date date,
  end_date date,
  grade text,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  date date,
  url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Saved (preferred) answers
-- ---------------------------------------------------------------------------

create table public.saved_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question text not null,
  answer text not null,
  category text,
  company text,
  role text,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usage events: rate limiting, usage limits, and product analytics.
-- Never stores question or answer text.
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer')),
  category text,
  provider text,
  created_at timestamptz not null default now()
);

create index usage_events_user_created_idx on public.usage_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers and per-user indexes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['experiences', 'projects', 'skills', 'education', 'achievements', 'saved_answers']
  loop
    execute format(
      'create trigger %1$s_set_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
    execute format('create index %1$s_user_id_idx on public.%1$I (user_id)', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Users read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users insert own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare
  t text;
begin
  foreach t in array array['experiences', 'projects', 'skills', 'education', 'achievements', 'saved_answers']
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

-- Usage events are append-only for users.
alter table public.usage_events enable row level security;

create policy "Users read own events" on public.usage_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own events" on public.usage_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only; anonymous visitors get nothing.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.experiences, public.projects, public.skills,
  public.education, public.achievements, public.saved_answers, public.usage_events from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.experiences, public.projects, public.skills,
  public.education, public.achievements, public.saved_answers to authenticated;
grant select, insert on public.usage_events to authenticated;
