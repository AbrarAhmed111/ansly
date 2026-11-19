-- One shared, recipient-level history for Job Outreach and LinkedIn Leads.
alter table public.email_send_attempts
  add column if not exists cc_email text;

create table public.outreach_contact_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email_send_attempt_id uuid not null references public.email_send_attempts (id) on delete cascade,
  recipient_email text not null check (length(recipient_email) <= 320),
  normalized_email text not null check (length(normalized_email) <= 320),
  role_title text not null default '',
  normalized_role text,
  company_name text,
  normalized_company text,
  source text not null check (source in ('job_outreach', 'linkedin_leads')),
  lead_id uuid,
  job_outreach_id uuid,
  repeat_authorized boolean not null default false,
  status text not null check (status in ('sending', 'sent', 'failed', 'outcome_unknown')),
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (email_send_attempt_id, normalized_email)
);

create index outreach_contact_history_lookup_idx
  on public.outreach_contact_history (user_id, normalized_email, status, sent_at desc);

create or replace function public.outreach_roles_match(first_role text, second_role text, threshold numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with first_tokens as (
    select distinct token
    from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.btrim(coalesce(first_role, '')), ' ')) as t(token)
    where token <> ''
  ),
  second_tokens as (
    select distinct token
    from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.btrim(coalesce(second_role, '')), ' ')) as t(token)
    where token <> ''
  ),
  token_counts as (
    select
      (select count(*) from first_tokens) as first_count,
      (select count(*) from second_tokens) as second_count,
      (select count(*) from first_tokens f join second_tokens s using (token)) as overlap_count,
      (select count(*) from (select token from first_tokens union select token from second_tokens) all_tokens)
        as union_count
  )
  select case
    when first_role is null or second_role is null or first_count = 0 or second_count = 0 then false
    else overlap_count::numeric / nullif(union_count, 0) >= threshold
  end
  from token_counts;
$$;

revoke all on function public.outreach_roles_match(text, text, numeric) from public, anon;
grant execute on function public.outreach_roles_match(text, text, numeric) to authenticated;

create or replace function public.guard_outreach_contact_send()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'sending' or new.normalized_role is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || new.normalized_email, 0)
  );
  if exists (
    select 1
    from public.outreach_contact_history previous
    where previous.user_id = new.user_id
      and previous.normalized_email = new.normalized_email
      and (
        previous.status = 'sending'
        or (previous.status = 'sent' and not new.repeat_authorized)
      )
      and (
        previous.normalized_company is null
        or new.normalized_company is null
        or previous.normalized_company = new.normalized_company
      )
      and public.outreach_roles_match(
        previous.normalized_role,
        new.normalized_role,
        case
          when previous.normalized_company is not null and new.normalized_company is not null then 0.6
          else 0.82
        end
      )
  ) then
    raise exception 'An equivalent outreach email is already being sent.'
      using errcode = '23505', constraint = 'outreach_contact_history_active_send';
  end if;
  return new;
end;
$$;

create trigger outreach_contact_history_guard_send
  before insert on public.outreach_contact_history
  for each row execute function public.guard_outreach_contact_send();

alter table public.outreach_contact_history enable row level security;

create policy "Users read own outreach history" on public.outreach_contact_history
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own outreach history" on public.outreach_contact_history
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own outreach history" on public.outreach_contact_history
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.outreach_contact_history from anon;
grant select, insert, update on public.outreach_contact_history to authenticated;

-- Reconstruct successful contacts from existing send attempts. An accepted multi-recipient Gmail submission
-- becomes one history row per To/CC address; failed and unfinished attempts are intentionally excluded.
with previous_sends as (
  select
    attempt.id as attempt_id,
    attempt.user_id,
    attempt.recipient_email,
    attempt.cc_email,
    attempt.lead_id,
    attempt.job_outreach_id,
    attempt.status,
    attempt.finished_at,
    attempt.started_at,
    attempt.provider_message_id,
    case
      when attempt.job_outreach_id is not null then 'job_outreach'
      else 'linkedin_leads'
    end as source,
    coalesce(
      job.job_info ->> 'title',
      lead_draft.detected_role ->> 'title',
      lead.detected_role ->> 'title',
      lead.title,
      ''
    ) as role_title,
    coalesce(job.job_info ->> 'company', lead_draft.detected_role ->> 'company', lead.company_name) as company_name
  from public.email_send_attempts attempt
  left join public.job_outreach_drafts job
    on job.user_id = attempt.user_id and job.id = attempt.job_outreach_id
  left join public.lead_drafts lead_draft
    on lead_draft.user_id = attempt.user_id and lead_draft.id = attempt.draft_id
  left join public.leads lead
    on lead.user_id = attempt.user_id and lead.id = attempt.lead_id
  where attempt.status = 'sent'
),
all_recipients as (
  select distinct
    previous.attempt_id,
    previous.user_id,
    pg_catalog.lower(pg_catalog.btrim(address)) as normalized_email,
    pg_catalog.btrim(address) as recipient_email,
    previous.role_title,
    previous.company_name,
    previous.source,
    previous.lead_id,
    previous.job_outreach_id,
    coalesce(previous.finished_at, previous.started_at) as sent_at,
    previous.provider_message_id
  from previous_sends previous
  cross join lateral pg_catalog.regexp_split_to_table(
    coalesce(previous.recipient_email, '') || ',' || coalesce(previous.cc_email, ''),
    '[,;\s]+'
  ) as addresses(address)
  where pg_catalog.btrim(address) <> ''
    and pg_catalog.strpos(address, '@') > 1
)
insert into public.outreach_contact_history (
  user_id, email_send_attempt_id, recipient_email, normalized_email, role_title, normalized_role,
  company_name, normalized_company, source, lead_id, job_outreach_id, status, sent_at, provider_message_id
)
select
  recipient.user_id,
  recipient.attempt_id,
  recipient.recipient_email,
  recipient.normalized_email,
  recipient.role_title,
  case
    when pg_catalog.btrim(recipient.role_title) = '' then null
    else coalesce(
      nullif(
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(
                  pg_catalog.regexp_replace(
                    pg_catalog.regexp_replace(
                      pg_catalog.regexp_replace(
                        pg_catalog.lower(recipient.role_title),
                        '\mfull[\s-]*stack\M', 'fullstack', 'g'
                      ),
                      '\mnode[\s.-]*js\M', 'nodejs', 'g'
                    ),
                    '\marchitect[\s-]+level\M', ' ', 'g'
                  ),
                  '\m(senior|sr|junior|jr|lead|principal|staff|mid|middle|associate|developer|development|engineer|engineering|software|level)\M',
                  ' ', 'g'
                ),
                '[^a-z0-9+#]+', ' ', 'g'
              ),
              '\s+', ' ', 'g'
            ),
            '^\s+|\s+$', '', 'g'
          )
        ),
        ''
      ),
      'general'
    )
  end,
  recipient.company_name,
  nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(pg_catalog.lower(coalesce(recipient.company_name, '')),
            '\m(incorporated|inc|limited|ltd|llc|corp|corporation|company|co)\M', ' ', 'g'),
          '[^a-z0-9]+', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  ),
  recipient.source,
  recipient.lead_id,
  recipient.job_outreach_id,
  'sent',
  recipient.sent_at,
  recipient.provider_message_id
from all_recipients recipient
on conflict (email_send_attempt_id, normalized_email) do nothing;