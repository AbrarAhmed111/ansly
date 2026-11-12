-- Keep the source parse immutable for review edits; only approved suggestions
-- are rendered into the downloadable copy.
alter table public.resume_tailorings
  add column if not exists source_content jsonb,
  add column if not exists review_changes jsonb not null default '[]'::jsonb;
