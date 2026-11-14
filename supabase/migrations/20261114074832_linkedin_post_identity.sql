alter table public.leads
  add column source_post_id text;

drop index public.leads_user_source_unique_idx;

create unique index leads_user_source_unique_idx
  on public.leads (user_id, coalesce(original_post_url, ''), coalesce(author_profile_url, ''))
  where original_post_url is not null;

create unique index leads_user_post_identity_unique_idx
  on public.leads (user_id, source_platform, source_post_id)
  where source_post_id is not null;