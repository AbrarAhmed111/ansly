-- Ansly v1.2 follow-up: columns added after 20261004000000_resume_tailoring.sql.
-- Idempotent, so it applies whether or not that migration already ran.
--
-- - resumes.dismissed_discrepancies: profile <-> resume differences the user chose to keep.
-- - usage_events.duration_ms / tokens: generation time and token cost per tailoring.
-- - profiles.resume_page_limit: the rendered resume's page limit (default 2).

alter table public.resumes
  add column if not exists dismissed_discrepancies text[] not null default '{}';

alter table public.usage_events
  add column if not exists duration_ms integer check (duration_ms >= 0),
  add column if not exists tokens integer check (tokens >= 0);

alter table public.profiles
  add column if not exists resume_page_limit smallint not null default 2
    check (resume_page_limit between 1 and 3);
