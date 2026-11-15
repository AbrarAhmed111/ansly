-- Ansly Leads: Ansly Cleanup hides leads instead of deleting them.
--
-- A removed lead stays in the table with when, why and by whom it was removed, so removals can be reviewed and
-- compared later. Because the row stays, the unique post indexes keep the extension from collecting the same post
-- again: a re-collected post counts as a duplicate. The API leaves removed leads out of every list.

alter table public.leads
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by text check (removed_by in ('cleanup', 'user')),
  add column if not exists removed_category text
    check (removed_category in ('job_seeker', 'stack_mismatch', 'not_hiring', 'match', 'unclear')),
  add column if not exists removed_reason text check (removed_reason is null or length(removed_reason) <= 500);

create index if not exists leads_user_visible_idx
  on public.leads (user_id, collected_at desc)
  where removed_at is null;
