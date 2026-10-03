-- Reuse a job's analysis when the same posting is tailored again.
--
-- content_hash identifies a posting's content (title, company, description) and
-- the analysis version that read it. POST /jobs/analyze looks it up first and,
-- if this user already has that posting analyzed, reuses it instead of storing
-- a duplicate and calling the model again.

alter table public.job_contexts add column if not exists content_hash text check (length(content_hash) <= 128);

create index if not exists job_contexts_user_hash_idx on public.job_contexts (user_id, content_hash)
  where content_hash is not null;
