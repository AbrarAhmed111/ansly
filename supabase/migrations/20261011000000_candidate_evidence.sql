-- Ansly: embeddings of candidate evidence for semantic retrieval.
--
-- Semantic retrieval is a fallback: answers use keyword + metadata retrieval
-- first and only search embeddings when that finds too little. Rows are
-- embedded lazily and incrementally: one row per profile record
-- (experience, project, achievement, saved fact), re-embedded only when its
-- content_hash changes. The text itself is not stored here; it stays in the
-- source rows, so this table holds no profile content beyond the vectors.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
-- Supabase already grants this; stated so the vector type and operators resolve for signed-in users anywhere.
grant usage on schema extensions to authenticated;

create table public.candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('experience', 'project', 'achievement', 'fact')),
  source_id uuid not null,
  content_hash text not null check (length(content_hash) <= 128),
  embedding extensions.vector(768) not null,
  embedding_model text not null check (length(embedding_model) <= 100),
  embedding_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create trigger candidate_evidence_set_updated_at before update on public.candidate_evidence
  for each row execute function public.set_updated_at();

alter table public.candidate_evidence enable row level security;

create policy "Users read own evidence" on public.candidate_evidence
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own evidence" on public.candidate_evidence
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own evidence" on public.candidate_evidence
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own evidence" on public.candidate_evidence
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.candidate_evidence from anon;
grant select, insert, update, delete on public.candidate_evidence to authenticated;

-- The caller's evidence most similar to a query embedding. Security invoker, so RLS applies, and the explicit
-- user filter keeps the scan to the caller's rows (a few hundred at most: no ANN index needed).
create or replace function public.match_candidate_evidence(
  query_embedding extensions.vector(768),
  model text,
  match_count integer default 6
)
returns table (source_type text, source_id uuid, similarity double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.source_type, e.source_id, 1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.candidate_evidence e
  where e.user_id = (select auth.uid()) and e.embedding_model = model
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_candidate_evidence(extensions.vector, text, integer) from public, anon;
grant execute on function public.match_candidate_evidence(extensions.vector, text, integer) to authenticated;
