-- Ansly Leads: role-specific resume library, role-matched email drafts, and Gmail sending.
--
-- - resumes: role label/note, replace lineage, archive, file size. Library rows (role_label set) may be
--   PDF or Word; rows without a role label (masters for tailoring) still must be Word.
-- - leads: the advertised role, detected once and cached; (user_id, id) for owner-safe references.
-- - lead_drafts: one draft per lead with the selected resume, approval, and delivery state.
-- - email_connections / email_oauth_states: the user's Gmail connection (encrypted refresh token only).
-- - email_send_attempts: what was sent, per attempt.

-- ---------------------------------------------------------------------------
-- resumes
-- ---------------------------------------------------------------------------

alter table public.resumes
  add column role_label text check (role_label is null or length(role_label) between 1 and 120),
  add column role_note text check (role_note is null or length(role_note) <= 500),
  add column archived_at timestamptz,
  add column replaces_resume_id uuid,
  add column file_size integer check (file_size is null or file_size >= 0),
  add constraint resumes_replaces_fkey foreign key (user_id, replaces_resume_id)
    references public.resumes (user_id, id) on delete set null (replaces_resume_id);

create index resumes_library_idx on public.resumes (user_id, archived_at, updated_at desc)
  where role_label is not null;

create or replace function public.resumes_require_docx()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Library resumes are attached to emails as uploaded, so PDF is fine. Masters are tailored and must be Word.
  if new.role_label is not null
     and ((new.file_type = 'pdf' and lower(new.file_path) like '%.pdf')
       or (new.file_type = 'docx' and lower(new.file_path) like '%.docx')) then
    return new;
  end if;
  if new.file_type <> 'docx' or lower(new.file_path) not like '%.docx' then
    raise exception 'Upload your resume as a Word (.docx) file.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'resumes';

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

alter table public.leads
  add column detected_role jsonb,
  add constraint leads_user_id_id_key unique (user_id, id);

-- ---------------------------------------------------------------------------
-- lead_drafts: one current draft per lead
-- ---------------------------------------------------------------------------

-- Keep the newest draft per lead before enforcing uniqueness.
delete from public.lead_drafts d
using public.lead_drafts newer
where d.lead_id = newer.lead_id
  and (d.updated_at, d.id) < (newer.updated_at, newer.id);

alter table public.lead_drafts
  alter column status set default 'draft',
  add column recipient_source text not null default 'post' check (recipient_source in ('post', 'user')),
  add column resume_id uuid,
  add column resume_selection text not null default 'needs_selection'
    check (resume_selection in ('auto', 'user', 'none_by_user', 'needs_selection')),
  add column match_confidence text check (match_confidence in ('high', 'medium', 'low', 'none')),
  add column match_reason text check (match_reason is null or length(match_reason) <= 500),
  add column detected_role jsonb,
  add column is_user_edited boolean not null default false,
  add column approved_at timestamptz,
  add column approved_version integer,
  add column delivery_status text not null default 'draft'
    check (delivery_status in ('draft', 'sending', 'sent', 'failed')),
  add column sending_started_at timestamptz,
  add column sent_at timestamptz,
  add column last_error_code text check (last_error_code is null or length(last_error_code) <= 60),
  add column version integer not null default 1 check (version >= 1),
  add column generation_version text,
  add constraint lead_drafts_lead_key unique (lead_id),
  add constraint lead_drafts_user_id_id_key unique (user_id, id),
  add constraint lead_drafts_user_lead_fkey foreign key (user_id, lead_id)
    references public.leads (user_id, id) on delete cascade,
  add constraint lead_drafts_resume_fkey foreign key (user_id, resume_id)
    references public.resumes (user_id, id) on delete set null (resume_id),
  add constraint lead_drafts_resume_consistency_check check (
    (resume_selection in ('auto', 'user') and resume_id is not null)
    or (resume_selection in ('none_by_user', 'needs_selection') and resume_id is null)
  ),
  add constraint lead_drafts_recipient_check check (
    recipient_email is null or (length(recipient_email) <= 320 and recipient_email !~ '[[:cntrl:]]')
  ),
  add constraint lead_drafts_subject_length check (length(subject) <= 200),
  add constraint lead_drafts_body_length check (length(body) <= 10000);

-- A deleted resume leaves the draft without an attachment: the user must choose again before sending.
create or replace function public.lead_drafts_resume_removed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.resume_id is null and old.resume_id is not null and new.resume_selection in ('auto', 'user') then
    new.resume_selection := 'needs_selection';
    new.approved_at := null;
    new.approved_version := null;
  end if;
  return new;
end;
$$;

create trigger lead_drafts_resume_removed
  before update of resume_id on public.lead_drafts
  for each row execute function public.lead_drafts_resume_removed();

-- A lead can't be deleted while its email is being sent.
create or replace function public.leads_block_delete_while_sending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.lead_drafts where lead_id = old.id and delivery_status = 'sending') then
    raise exception 'This lead''s email is being sent. Try again in a moment.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger leads_block_delete_while_sending
  before delete on public.leads
  for each row execute function public.leads_block_delete_while_sending();

-- ---------------------------------------------------------------------------
-- email_connections and email_oauth_states
-- ---------------------------------------------------------------------------

create table public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  email_address text not null check (length(email_address) <= 320),
  granted_scopes text[] not null default '{}',
  -- AES-256-GCM ciphertext of the refresh token (nonce || ciphertext || tag), base64. Only the API holds the key.
  refresh_token_ciphertext text not null,
  token_key_id text not null,
  status text not null default 'connected' check (status in ('connected', 'needs_reauth')),
  last_error_code text check (last_error_code is null or length(last_error_code) <= 60),
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger email_connections_set_updated_at
  before update on public.email_connections
  for each row execute function public.set_updated_at();

create table public.email_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  code_verifier_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index email_oauth_states_user_idx on public.email_oauth_states (user_id, expires_at);

-- ---------------------------------------------------------------------------
-- email_send_attempts
-- ---------------------------------------------------------------------------

create table public.email_send_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  draft_id uuid,
  lead_id uuid,
  provider text not null check (provider in ('gmail')),
  from_address text not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  attachment_name text,
  attachment_size integer,
  attachment_sha256 text,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error_code text check (error_code is null or length(error_code) <= 60),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint email_send_attempts_draft_fkey foreign key (user_id, draft_id)
    references public.lead_drafts (user_id, id) on delete set null (draft_id),
  constraint email_send_attempts_lead_fkey foreign key (user_id, lead_id)
    references public.leads (user_id, id) on delete set null (lead_id)
);

create index email_send_attempts_user_idx on public.email_send_attempts (user_id, started_at desc);
create index email_send_attempts_draft_idx on public.email_send_attempts (draft_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-only
-- ---------------------------------------------------------------------------

alter table public.email_connections enable row level security;
alter table public.email_oauth_states enable row level security;
alter table public.email_send_attempts enable row level security;

create policy "Users read own email connections" on public.email_connections for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own email connections" on public.email_connections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own email connections" on public.email_connections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own email connections" on public.email_connections for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own oauth states" on public.email_oauth_states for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own oauth states" on public.email_oauth_states for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete own oauth states" on public.email_oauth_states for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own send attempts" on public.email_send_attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own send attempts" on public.email_send_attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own send attempts" on public.email_send_attempts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.email_connections, public.email_oauth_states, public.email_send_attempts from anon;
grant select, insert, update, delete on public.email_connections to authenticated;
grant select, insert, delete on public.email_oauth_states to authenticated;
grant select, insert, update on public.email_send_attempts to authenticated;
