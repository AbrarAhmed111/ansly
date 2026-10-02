-- Ansly V1.1: ask-and-learn and fill all.
--
-- - profile_facts: grounding facts the user gives when Ansly asks for missing
--   information (extension) or adds on /profile/additional (web).
-- - skills.level 'none': "I don't have this skill", so the next yes/no
--   question on it is answered "No" instead of asking again.
-- - usage_events kind 'fill_all': one per Fill all click (no text).

create table public.profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text default 'general',
  prompt text not null check (length(prompt) between 1 and 1000),
  answer text not null check (length(answer) between 1 and 5000),
  source text not null default 'web' check (source in ('extension', 'web')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profile_facts_set_updated_at
  before update on public.profile_facts
  for each row execute function public.set_updated_at();

create index profile_facts_user_id_idx on public.profile_facts (user_id);

-- Same row-level security as the other profile sections: own rows only.
alter table public.profile_facts enable row level security;

create policy "Users read own rows" on public.profile_facts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own rows" on public.profile_facts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own rows" on public.profile_facts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own rows" on public.profile_facts
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profile_facts from anon;
grant select, insert, update, delete on public.profile_facts to authenticated;

-- "I don't have this skill" is a real answer.
alter table public.skills drop constraint if exists skills_level_check;
alter table public.skills
  add constraint skills_level_check check (level in ('none', 'beginner', 'intermediate', 'advanced', 'expert'));

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
  check (kind in ('generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'fill_all'));
