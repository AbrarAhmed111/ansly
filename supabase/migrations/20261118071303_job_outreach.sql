-- Job Outreach drafts use the same role-resume library and Gmail connection as Leads.
create table public.job_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_text text not null check (length(job_text) between 1 and 20000),
  job_info jsonb not null default '{}'::jsonb,
  recipient_email text check (recipient_email is null or
    (length(recipient_email) <= 320 and recipient_email !~ '[[:cntrl:]]')),
  subject text not null default '' check (length(subject) <= 200),
  body text not null default '' check (length(body) <= 10000),
  resume_id uuid,
  resume_selection text not null default 'needs_selection'
    check (resume_selection in ('auto', 'user', 'needs_selection')),
  match_confidence text check (match_confidence in ('high', 'medium', 'low', 'none')),
  match_reason text check (match_reason is null or length(match_reason) <= 500),
  status text not null default 'analyzing'
    check (status in ('analyzing', 'analyzed', 'draft', 'needs_review', 'sending', 'sent', 'failed')),
  auto_send_authorized boolean not null default false,
  error_code text check (error_code is null or length(error_code) <= 60),
  error_message text check (error_message is null or length(error_message) <= 1000),
  sending_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_outreach_drafts_user_id_id_key unique (user_id, id),
  constraint job_outreach_drafts_resume_fkey foreign key (user_id, resume_id)
    references public.resumes (user_id, id) on delete set null (resume_id)
);

create trigger job_outreach_drafts_set_updated_at
  before update on public.job_outreach_drafts
  for each row execute function public.set_updated_at();

create or replace function public.job_outreach_drafts_resume_removed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.resume_id is null and old.resume_id is not null and new.status <> 'sent' then
    new.resume_selection := 'needs_selection';
    new.auto_send_authorized := false;
    new.match_reason := 'The recommended resume was removed. Choose another resume before sending.';
  end if;
  return new;
end;
$$;

create trigger job_outreach_drafts_resume_removed
  before update of resume_id on public.job_outreach_drafts
  for each row execute function public.job_outreach_drafts_resume_removed();

alter table public.email_send_attempts
  add column job_outreach_id uuid,
  add constraint email_send_attempts_job_outreach_fkey
    foreign key (user_id, job_outreach_id)
    references public.job_outreach_drafts (user_id, id) on delete set null (job_outreach_id);

create index email_send_attempts_job_outreach_idx on public.email_send_attempts (job_outreach_id)
  where job_outreach_id is not null;

alter table public.job_outreach_drafts enable row level security;

create policy "Users read own Job Outreach drafts" on public.job_outreach_drafts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own Job Outreach drafts" on public.job_outreach_drafts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own Job Outreach drafts" on public.job_outreach_drafts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users delete own Job Outreach drafts" on public.job_outreach_drafts
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.job_outreach_drafts from anon;
grant select, insert, update, delete on public.job_outreach_drafts to authenticated;