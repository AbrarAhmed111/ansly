-- Ansly v1.2: resume tailoring.
--
-- - resumes: uploaded master resumes and their parsed Structured Resume JSON.
--   Replacing the master inserts a new version; old versions are kept.
-- - job_contexts: the job a tailoring is for (description text only, never page HTML).
-- - resume_tailorings: one tailoring run, every pipeline artifact, and the rendered PDF.
-- - Storage bucket `resumes` (private): {user_id}/masters/... and {user_id}/tailored/...
-- - usage_events kinds for the tailoring funnel (no resume or job text).

-- ---------------------------------------------------------------------------
-- resumes
-- ---------------------------------------------------------------------------

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  -- Storage path of the original upload, always under the owner's prefix.
  file_path text not null check (split_part(file_path, '/', 1) = user_id::text),
  file_type text not null check (file_type in ('pdf', 'docx')),
  parsed_content jsonb,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'needs_review', 'failed')),
  -- User-safe reason when parse_status is 'failed'.
  parse_error text,
  version integer not null default 1 check (version >= 1),
  is_master boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version),
  -- Lets resume_tailorings reference (user_id, id) so a tailoring can't point at someone else's resume.
  unique (user_id, id)
);

-- One active master per user.
create unique index resumes_one_master_per_user on public.resumes (user_id) where is_master;

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- job_contexts
-- ---------------------------------------------------------------------------

create table public.job_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  company text check (length(company) <= 300),
  location text check (length(location) <= 300),
  employment_type text check (length(employment_type) <= 100),
  url text check (length(url) <= 2000),
  -- Job description text only; never page HTML.
  description text not null check (length(description) between 1 and 50000),
  source text not null check (source in ('json-ld', 'linkedin', 'indeed', 'generic', 'manual')),
  -- JobAnalysis JSON, filled in by the analysis step.
  analysis jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create index job_contexts_user_created_idx on public.job_contexts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- resume_tailorings
-- ---------------------------------------------------------------------------

create table public.resume_tailorings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The master used. Deleting an old resume version keeps its tailorings (and their PDFs).
  resume_id uuid,
  resume_version integer not null check (resume_version >= 1),
  job_context_id uuid not null,
  match_analysis jsonb,
  tailoring_plan jsonb,
  tailored_content jsonb,
  validation_report jsonb,
  output_file_path text check (split_part(output_file_path, '/', 1) = user_id::text),
  pipeline_version text not null,
  status text not null default 'queued' check (status in (
    'queued', 'analyzing', 'matching', 'tailoring', 'validating', 'rendering', 'ready', 'failed'
  )),
  -- User-safe failure reason.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, resume_id) references public.resumes (user_id, id) on delete set null (resume_id),
  foreign key (user_id, job_context_id) references public.job_contexts (user_id, id) on delete cascade
);

create index resume_tailorings_user_created_idx on public.resume_tailorings (user_id, created_at desc);
create index resume_tailorings_resume_idx on public.resume_tailorings (resume_id);
create index resume_tailorings_job_context_idx on public.resume_tailorings (job_context_id);

create trigger resume_tailorings_set_updated_at
  before update on public.resume_tailorings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: owner-only CRUD, anon gets nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['resumes', 'job_contexts', 'resume_tailorings']
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

revoke all on public.resumes, public.job_contexts, public.resume_tailorings from anon;
grant select, insert, update, delete on public.resumes, public.job_contexts, public.resume_tailorings
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `resumes` bucket, each user limited to their own prefix.
-- Downloads go through short-lived signed URLs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy "Users read own resume files" on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own resume files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own resume files" on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own resume files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- usage_events: tailoring funnel kinds (no resume or job text is stored).
-- ---------------------------------------------------------------------------

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
  check (kind in (
    'generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'fill_all',
    'resume_uploaded', 'resume_parse_failed', 'job_detected', 'tailoring_started', 'tailoring_completed',
    'tailoring_failed', 'resume_previewed', 'resume_downloaded', 'tailoring_deleted'
  ));
