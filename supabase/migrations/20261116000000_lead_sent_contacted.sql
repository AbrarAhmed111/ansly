-- Ansly Leads: a lead whose email was sent is Contacted, always.
--
-- The API marks the lead Contacted after a successful send, but as a separate request after the draft update: a
-- timeout or crash between the two left sent leads as New (and their drafts in "To review"). This moves the rule
-- into the database, next to the data it protects, and repairs rows that drifted.
--
-- 1. lead_drafts: a send attempt Gmail accepted (status 'sent' or a provider message id) means the draft was sent.
-- 2. Trigger: when a draft becomes 'sent', its lead becomes 'contacted' (if it was 'new'), with a status event.
-- 3. Backfill: leads with a sent draft or a sent attempt become 'contacted'.

-- ---------------------------------------------------------------------------
-- 1. Drafts whose attempt was accepted by Gmail are sent.
-- ---------------------------------------------------------------------------

update public.lead_drafts d
set delivery_status = 'sent',
    sent_at = coalesce(d.sent_at, a.finished_at, a.started_at),
    last_error_code = null,
    version = d.version + 1,
    -- Approval carries over, as after any send.
    approved_version = case when d.approved_at is not null then d.version + 1 else d.approved_version end
from (
  select distinct on (draft_id) draft_id, finished_at, started_at
  from public.email_send_attempts
  where draft_id is not null and (status = 'sent' or provider_message_id is not null)
  order by draft_id, started_at desc
) a
where a.draft_id = d.id
  and d.delivery_status <> 'sent';

-- ---------------------------------------------------------------------------
-- 2. Trigger: a sent draft marks its lead Contacted.
-- ---------------------------------------------------------------------------

create or replace function public.lead_drafts_mark_lead_contacted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_status = 'sent' and (tg_op = 'INSERT' or old.delivery_status is distinct from 'sent') then
    with changed as (
      update public.leads
      set status = 'contacted'
      where id = new.lead_id and user_id = new.user_id and status = 'new'
      returning id, user_id
    )
    insert into public.lead_status_events (user_id, lead_id, old_status, new_status, reason)
    select user_id, id, 'new', 'contacted', 'email_sent' from changed;
  end if;
  return null;
end;
$$;

drop trigger if exists lead_drafts_mark_lead_contacted on public.lead_drafts;
create trigger lead_drafts_mark_lead_contacted
  after insert or update of delivery_status on public.lead_drafts
  for each row execute function public.lead_drafts_mark_lead_contacted();

-- ---------------------------------------------------------------------------
-- 3. Backfill: leads already emailed become Contacted.
-- ---------------------------------------------------------------------------

with emailed as (
  select lead_id, user_id from public.lead_drafts where delivery_status = 'sent'
  union
  select lead_id, user_id from public.email_send_attempts
  where lead_id is not null and (status = 'sent' or provider_message_id is not null)
),
changed as (
  update public.leads l
  set status = 'contacted'
  from emailed e
  where l.id = e.lead_id and l.user_id = e.user_id and l.status = 'new'
  returning l.id, l.user_id
)
insert into public.lead_status_events (user_id, lead_id, old_status, new_status, reason)
select user_id, id, 'new', 'contacted', 'email_sent_backfill' from changed;
