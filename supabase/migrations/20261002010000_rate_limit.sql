-- Per-user burst rate limit, shared by every API instance.
--
-- The API runs serverless (many short-lived instances), so the limit can't
-- live in process memory. public.check_rate_limit records a hit for the
-- calling user and returns 0, or returns the seconds to wait when the user
-- already has max_hits within the window.

create table public.rate_limit_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  hit_at timestamptz not null default now()
);

create index rate_limit_hits_user_hit_idx on public.rate_limit_hits (user_id, hit_at);

-- Only check_rate_limit (security definer) touches the table.
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

create or replace function public.check_rate_limit(max_hits integer, window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  window_length interval;
  hits integer;
  oldest timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if max_hits < 1 or window_seconds not between 1 and 3600 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;
  window_length := make_interval(secs => window_seconds);

  -- Serialise concurrent requests from the same user.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  delete from public.rate_limit_hits where user_id = uid and hit_at <= now() - window_length;

  select count(*), min(hit_at) into hits, oldest from public.rate_limit_hits where user_id = uid;
  if hits >= max_hits then
    return greatest(1, ceil(extract(epoch from oldest + window_length - now()))::integer);
  end if;

  insert into public.rate_limit_hits (user_id) values (uid);
  return 0;
end;
$$;

revoke all on function public.check_rate_limit(integer, integer) from public, anon;
grant execute on function public.check_rate_limit(integer, integer) to authenticated;
