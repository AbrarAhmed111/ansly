-- Ansly Apply Agent foundation: persistent runs, real activity events, and recovery checkpoints.

alter table public.profiles
  add column if not exists application_agent_mode text not null default 'normal'
  check (application_agent_mode in ('normal', 'aggressive'));

create table public.application_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_key text not null check (length(job_key) between 1 and 128),
  job_context_id uuid,
  job_outreach_id uuid,
  title text not null check (length(title) between 1 and 300),
  company text check (company is null or length(company) <= 300),
  job_url text check (job_url is null or length(job_url) <= 2000),
  platform text not null default 'unknown'
    check (platform in (
      'indeed', 'linkedin', 'greenhouse', 'lever', 'workday', 'ashby',
      'smartrecruiters', 'workable', 'bamboohr', 'company', 'unknown'
    )),
  route text not null check (route in ('email', 'website')),
  behavior_mode text not null check (behavior_mode in ('normal', 'aggressive')),
  resume_id uuid,
  status text not null
    check (status in (
      'detected', 'awaiting_authorization', 'authorized', 'analyzing_job',
      'email_route_check', 'email_drafting', 'email_sending', 'email_sent',
      'matching_resume', 'inspecting_application', 'filling_application',
      'uploading_resume', 'generating_cover_letter', 'answering_questions',
      'navigating_steps', 'human_intervention', 'captcha_paused',
      'ready_to_submit', 'submitting', 'verifying_submission',
      'submitted', 'failed', 'cancelled'
    )),
  authorization_data jsonb not null default '{}'::jsonb,
  submission_evidence jsonb,
  selected_resume_name text check (selected_resume_name is null or length(selected_resume_name) <= 300),
  recipient_email text check (recipient_email is null or length(recipient_email) <= 1000),
  email_subject text check (email_subject is null or length(email_subject) <= 200),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint application_runs_job_context_fkey
    foreign key (user_id, job_context_id)
    references public.job_contexts (user_id, id) on delete set null (job_context_id),
  constraint application_runs_job_outreach_fkey
    foreign key (user_id, job_outreach_id)
    references public.job_outreach_drafts (user_id, id) on delete set null (job_outreach_id),
  constraint application_runs_resume_fkey
    foreign key (user_id, resume_id)
    references public.resumes (user_id, id) on delete set null (resume_id)
);

create trigger application_runs_set_updated_at
  before update on public.application_runs
  for each row execute function public.set_updated_at();

create index application_runs_user_job_status_idx
  on public.application_runs (user_id, job_key, status);

create unique index application_runs_one_active_per_job_idx
  on public.application_runs (user_id, job_key)
  where status not in ('email_sent', 'submitted', 'failed', 'cancelled');

create table public.application_run_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null,
  type text not null check (type in ('activity', 'checkpoint', 'intervention', 'error')),
  activity text not null check (length(activity) between 1 and 500),
  status text not null
    check (status in ('pending', 'running', 'completed', 'needs_attention', 'paused', 'failed', 'cancelled')),
  detail text check (detail is null or length(detail) <= 2000),
  checkpoint_id uuid,
  occurred_at timestamptz not null default now(),
  constraint application_run_events_run_fkey
    foreign key (user_id, run_id)
    references public.application_runs (user_id, id) on delete cascade
);

create index application_run_events_run_occurred_idx
  on public.application_run_events (run_id, occurred_at);

create table public.application_run_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null,
  name text not null check (length(name) between 1 and 100),
  status text not null check (status in ('pending', 'completed', 'failed')),
  page_fingerprint text check (page_fingerprint is null or length(page_fingerprint) <= 128),
  page_url text check (page_url is null or length(page_url) <= 2000),
  action_id uuid,
  action_kind text check (action_kind is null or length(action_kind) <= 100),
  before_fingerprint text check (before_fingerprint is null or length(before_fingerprint) <= 128),
  after_fingerprint text check (after_fingerprint is null or length(after_fingerprint) <= 128),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, name),
  constraint application_run_checkpoints_run_fkey
    foreign key (user_id, run_id)
    references public.application_runs (user_id, id) on delete cascade
);

create trigger application_run_checkpoints_set_updated_at
  before update on public.application_run_checkpoints
  for each row execute function public.set_updated_at();

create index application_run_checkpoints_run_created_idx
  on public.application_run_checkpoints (run_id, created_at);

alter table public.application_runs enable row level security;
alter table public.application_run_events enable row level security;
alter table public.application_run_checkpoints enable row level security;

create policy "Users read own application runs"
  on public.application_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert own application runs"
  on public.application_runs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own application runs"
  on public.application_runs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read own application run events"
  on public.application_run_events
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert own application run events"
  on public.application_run_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users read own application checkpoints"
  on public.application_run_checkpoints
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert own application checkpoints"
  on public.application_run_checkpoints
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update own application checkpoints"
  on public.application_run_checkpoints
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.application_runs from anon;
revoke all on public.application_run_events from anon;
revoke all on public.application_run_checkpoints from anon;
grant select, insert, update on public.application_runs to authenticated;
grant select, insert on public.application_run_events to authenticated;
grant select, insert, update on public.application_run_checkpoints to authenticated;