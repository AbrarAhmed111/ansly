-- Ansly V2, part 2: resumes, the application workspace, and per-application answers.

-- ---------------------------------------------------------------------------
-- resumes: uploaded resume files (stored in the private "resumes" bucket)
-- ---------------------------------------------------------------------------

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  -- Object path in the "resumes" bucket: "<user_id>/<file>".
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes integer check (size_bytes >= 0),
  is_default boolean not null default false,
  -- Roles this version is written for; used to pick a resume for a job.
  target_roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one default resume per user.
create unique index resumes_one_default_idx on public.resumes (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- applications: one tracked application per job (or external posting)
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  company text not null,
  role text not null,
  job_url text,
  location text,
  description text,
  status text not null default 'interested'
    check (status in ('interested', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')),
  applied_at timestamptz,
  resume_id uuid references public.resumes (id) on delete set null,
  cover_letter text,
  notes text,
  -- Output of "Prepare application": relevant experience and projects,
  -- resume suggestion, interview questions (see llm/src/app/applications).
  prep jsonb,
  prepared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index applications_user_job_key on public.applications (user_id, job_id) where job_id is not null;
create index applications_user_status_idx on public.applications (user_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- application_events: timeline (status changes, notes, interviews)
-- ---------------------------------------------------------------------------

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  kind text not null check (kind in ('created', 'status_change', 'note', 'interview', 'prepared', 'answer')),
  from_status text,
  to_status text,
  title text,
  details text,
  -- When the event happens (interviews are often in the future).
  occurs_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index application_events_app_idx on public.application_events (application_id, occurs_at desc);

-- ---------------------------------------------------------------------------
-- application_answers: answers prepared for or given in an application
-- ---------------------------------------------------------------------------

create table public.application_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  question text not null,
  question_key text generated always as (lower(btrim(question))) stored,
  answer text not null,
  category text,
  source text not null default 'manual' check (source in ('prepared', 'extension', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, question_key)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['resumes', 'applications', 'application_answers']
  loop
    execute format(
      'create trigger %1$s_set_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
    execute format('create index %1$s_user_id_idx on public.%1$I (user_id)', t);
  end loop;
end;
$$;

-- Stamp applied_at the first time an application reaches "applied".
create or replace function public.applications_stamp_applied()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'applied' and new.applied_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
    new.applied_at = now();
  end if;
  return new;
end;
$$;

create trigger applications_stamp_applied
  before insert or update of status on public.applications
  for each row execute function public.applications_stamp_applied();

-- Record creation and every status change on the timeline.
create or replace function public.applications_log_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_events (user_id, application_id, kind, to_status, title)
    values (new.user_id, new.id, 'created', new.status, 'Added to applications');
  elsif new.status is distinct from old.status then
    insert into public.application_events (user_id, application_id, kind, from_status, to_status, title)
    values (new.user_id, new.id, 'status_change', old.status, new.status, null);
  end if;
  return new;
end;
$$;

create trigger applications_log_event
  after insert or update of status on public.applications
  for each row execute function public.applications_log_event();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['resumes', 'applications', 'application_events', 'application_answers']
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

revoke all on public.resumes, public.applications, public.application_events, public.application_answers from anon;
grant select, insert, update, delete on public.resumes, public.applications, public.application_events,
  public.application_answers to authenticated;

-- ---------------------------------------------------------------------------
-- Usage events for the new AI actions
-- ---------------------------------------------------------------------------

alter table public.usage_events drop constraint usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'prepare', 'autofill'));

-- ---------------------------------------------------------------------------
-- Resume files: private bucket, one folder per user ("<user_id>/...")
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "Users read own resume files" on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own resume files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own resume files" on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own resume files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
