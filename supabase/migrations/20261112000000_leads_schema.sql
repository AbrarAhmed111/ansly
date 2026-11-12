-- Ansly Leads: user-owned targeting profiles, leads, drafts, and status history.
-- This is a focused v1 schema aligned with the product spec and existing RLS patterns.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Targeting profiles: saved interest definitions used during lead collection.
-- ---------------------------------------------------------------------------

create table if not exists public.targeting_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default false,
  target_roles text[] not null default '{}',
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  industries text[] not null default '{}',
  locations text[] not null default '{}',
  remote_preferences text not null default 'any' check (remote_preferences in ('any', 'remote', 'hybrid', 'onsite')),
  employment_types text[] not null default '{}',
  opportunity_types text[] not null default '{}',
  minimum_requirements text,
  contactability_preferences text,
  qualification_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists targeting_profiles_user_active_idx on public.targeting_profiles (user_id, is_active desc, updated_at desc);
create unique index if not exists targeting_profiles_user_name_key on public.targeting_profiles (user_id, lower(name));
create trigger targeting_profiles_set_updated_at
  before update on public.targeting_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Collection sessions: one run per active lead-collection workflow.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_collection_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  targeting_profile_id uuid references public.targeting_profiles (id) on delete set null,
  source_platform text not null check (source_platform in ('linkedin', 'twitter', 'reddit', 'other')),
  status text not null check (status in ('pending', 'processing', 'completed', 'partially_completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_candidates_reviewed integer not null default 0,
  relevant_candidates integer not null default 0,
  irrelevant_candidates integer not null default 0,
  duplicates_skipped integer not null default 0,
  new_leads_saved integer not null default 0,
  needs_review_count integer not null default 0,
  error_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_collection_sessions_user_created_idx on public.lead_collection_sessions (user_id, created_at desc);
create trigger lead_collection_sessions_set_updated_at
  before update on public.lead_collection_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Leads: canonical row for each qualified opportunity discovered.
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  targeting_profile_id uuid references public.targeting_profiles (id) on delete set null,
  collection_session_id uuid references public.lead_collection_sessions (id) on delete set null,
  source_platform text not null check (source_platform in ('linkedin', 'twitter', 'reddit', 'other')),
  source_name text not null,
  author_name text not null,
  author_profile_url text,
  company_name text not null,
  title text not null,
  opportunity_type text not null check (opportunity_type in ('job', 'contract', 'freelance', 'consulting', 'startup', 'part_time')),
  status text not null check (status in ('new', 'contacted')),
  contactability text not null check (contactability in ('email_available', 'application_link_available', 'dm_only', 'contact_form_available', 'no_contact_information_found', 'unknown')),
  description text not null,
  publication_date timestamptz,
  collected_at timestamptz not null default now(),
  original_post_url text,
  tags text[] not null default '{}',
  profile_snapshot jsonb,
  contact_info jsonb not null default '{}'::jsonb,
  qualification_reason text,
  confidence real,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_user_status_idx on public.leads (user_id, status, collected_at desc);
create index leads_user_platform_idx on public.leads (user_id, source_platform, collected_at desc);
create index leads_user_company_idx on public.leads (user_id, company_name);
create unique index leads_user_source_unique_idx on public.leads (user_id, coalesce(original_post_url, ''), coalesce(author_profile_url, ''));
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Drafts: generated emails for leads; user edits are preserved.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  recipient_email text,
  subject text not null,
  body text not null,
  status text not null check (status in ('draft', 'generated', 'edited', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_drafts_lead_idx on public.lead_drafts (lead_id, updated_at desc);
create trigger lead_drafts_set_updated_at
  before update on public.lead_drafts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Status history: explicit audit trail when a lead status changes.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  old_status text,
  new_status text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index lead_status_events_lead_idx on public.lead_status_events (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: user-owned data only.
-- ---------------------------------------------------------------------------

alter table public.targeting_profiles enable row level security;
alter table public.lead_collection_sessions enable row level security;
alter table public.leads enable row level security;
alter table public.lead_drafts enable row level security;
alter table public.lead_status_events enable row level security;

create policy "Users read own targeting profiles" on public.targeting_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own targeting profiles" on public.targeting_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own targeting profiles" on public.targeting_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own targeting profiles" on public.targeting_profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own collection sessions" on public.lead_collection_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own collection sessions" on public.lead_collection_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own collection sessions" on public.lead_collection_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own collection sessions" on public.lead_collection_sessions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own leads" on public.leads for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own leads" on public.leads for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own leads" on public.leads for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own leads" on public.leads for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own lead drafts" on public.lead_drafts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own lead drafts" on public.lead_drafts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own lead drafts" on public.lead_drafts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own lead drafts" on public.lead_drafts for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own lead status events" on public.lead_status_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own lead status events" on public.lead_status_events for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own lead status events" on public.lead_status_events for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own lead status events" on public.lead_status_events for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.targeting_profiles, public.lead_collection_sessions, public.leads, public.lead_drafts, public.lead_status_events from anon;
grant select, insert, update, delete on public.targeting_profiles, public.lead_collection_sessions, public.leads, public.lead_drafts, public.lead_status_events to authenticated;
