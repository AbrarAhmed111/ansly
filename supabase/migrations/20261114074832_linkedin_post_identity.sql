-- Idempotent: this was first applied by hand on some deployments, so every step tolerates having run before.
alter table public.leads
  add column if not exists source_post_id text;

drop index if exists public.leads_user_source_unique_idx;

create unique index if not exists leads_user_source_unique_idx
  on public.leads (user_id, coalesce(original_post_url, ''), coalesce(author_profile_url, ''))
  where original_post_url is not null;

create unique index if not exists leads_user_post_identity_unique_idx
  on public.leads (user_id, source_platform, source_post_id)
  where source_post_id is not null;
