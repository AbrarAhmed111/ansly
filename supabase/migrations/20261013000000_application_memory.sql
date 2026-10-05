-- Ansly: Application Memory.
--
-- profile_facts becomes the user's Application Memory: what Ansly learned
-- outside the structured profile, with a scope, provenance and a lifecycle.
--
-- - key: a normalized fact key ('relocation_preference', 'notice_period',
--   'travel_willingness'...) for facts Ansly can answer directly; null for free
--   text the user wrote in answer to an open question (those are evidence).
-- - value_type: how the value is entered and shown (yes/no, a choice, text...).
-- - scope: 'global' (always true), 'category' (a preference that may vary),
--   'company' (only for applications to `company`) or 'job' (only for the job
--   identified by `job_key`, the same hash as usage_events.job_key).
-- - source_type / source_label / source_id: where the fact came from. The
--   label is the company and role it was asked for; never question text.
-- - confirmed: the user gave or confirmed it explicitly. Generated answers never
--   become memory.
-- - status: 'active', 'outdated' (the user marked it) or 'superseded' (the
--   structured profile changed the same fact; see the trigger below).
-- - last_confirmed_at: when the user last said it's still accurate.
-- - usage_events kinds for Ask-and-Learn, memory, rewrites and onboarding (no
--   question or answer text is ever stored).

alter table public.profile_facts
  add column if not exists key text check (key is null or key ~ '^[a-z0-9_:.+#-]{1,120}$'),
  add column if not exists value_type text not null default 'text'
    check (value_type in ('text', 'boolean', 'number', 'choice')),
  add column if not exists scope text not null default 'global'
    check (scope in ('global', 'category', 'company', 'job')),
  add column if not exists company text check (length(company) <= 200),
  add column if not exists job_key text check (length(job_key) <= 64),
  add column if not exists source_type text not null default 'web'
    check (source_type in ('ask_and_learn', 'web', 'onboarding', 'memory_edit')),
  add column if not exists source_label text check (length(source_label) <= 300),
  add column if not exists source_id text check (length(source_id) <= 100),
  add column if not exists confirmed boolean not null default true,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'outdated', 'superseded')),
  add column if not exists last_confirmed_at timestamptz not null default now(),
  add column if not exists last_used_at timestamptz;

-- Facts saved before memory existed: the extension ones came from Ask-and-Learn. The updated_at trigger is off for
-- the backfill so "Last updated" keeps its real date.
alter table public.profile_facts disable trigger profile_facts_set_updated_at;
update public.profile_facts
  set source_type = case when source = 'extension' then 'ask_and_learn' else 'web' end,
      last_confirmed_at = updated_at;
alter table public.profile_facts enable trigger profile_facts_set_updated_at;

-- A scope must name what it's scoped to.
alter table public.profile_facts drop constraint if exists profile_facts_scope_target_check;
alter table public.profile_facts
  add constraint profile_facts_scope_target_check check (
    (scope <> 'company' or company is not null) and (scope <> 'job' or job_key is not null)
  );

-- One active value per key and scope: saving a known fact again updates it.
create unique index if not exists profile_facts_active_key_idx
  on public.profile_facts (user_id, key, scope, company, job_key) nulls not distinct
  where key is not null and status = 'active';

-- When the structured profile changes a preference, older global memory for the same fact stops counting: the
-- profile is the source of truth, and a stale learned value must never answer instead of it. Job and company
-- scoped facts stay: they were given for one application.
create or replace function public.supersede_profile_memory()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed text[] := '{}';
begin
  if new.work_authorization is distinct from old.work_authorization then changed := array_append(changed, 'work_authorization'); end if;
  if new.requires_sponsorship is distinct from old.requires_sponsorship then changed := array_append(changed, 'requires_sponsorship'); end if;
  if new.notice_period is distinct from old.notice_period then changed := array_append(changed, 'notice_period'); end if;
  if new.salary_expectation is distinct from old.salary_expectation then changed := array_append(changed, 'salary_expectation'); end if;
  if new.willing_to_relocate is distinct from old.willing_to_relocate then changed := array_append(changed, 'relocation_preference'); end if;
  if new.preferred_work_mode is distinct from old.preferred_work_mode then changed := array_append(changed, 'work_mode'); end if;
  if array_length(changed, 1) > 0 then
    update public.profile_facts
      set status = 'superseded'
      where user_id = new.id and status = 'active' and scope in ('global', 'category') and key = any (changed);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_supersede_memory on public.profiles;
create trigger profiles_supersede_memory
  after update on public.profiles
  for each row execute function public.supersede_profile_memory();

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
  check (kind in (
    'generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'fill_all',
    'resume_uploaded', 'resume_parse_failed', 'job_detected', 'tailoring_started', 'tailoring_completed',
    'tailoring_failed', 'resume_previewed', 'resume_downloaded', 'tailoring_deleted',
    'job_analyzed', 'adapt_saved_answer',
    -- Application Memory and Ask-and-Learn
    'ask_and_learn_shown', 'ask_and_learn_completed', 'ask_and_learn_skipped', 'memory_fact_saved',
    'memory_fact_edited', 'memory_fact_deleted', 'memory_fact_confirmed', 'memory_used',
    -- Rewrite controls, Fill all and undo
    'rewrite', 'fit_to_limit', 'fill_all_completed', 'undo',
    -- Onboarding
    'onboarding_step', 'extension_connected', 'first_answer'
  ));
