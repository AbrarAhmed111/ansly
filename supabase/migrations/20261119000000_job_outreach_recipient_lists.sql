-- Job Outreach supports multiple To recipients and explicit CC recipients.
alter table public.job_outreach_drafts
  add column if not exists cc_email text;

alter table public.job_outreach_drafts
  alter column recipient_email type text;

alter table public.job_outreach_drafts
  drop constraint if exists job_outreach_drafts_recipient_email_check;

alter table public.job_outreach_drafts
  drop constraint if exists job_outreach_drafts_recipient_check;

alter table public.job_outreach_drafts
  add constraint job_outreach_drafts_recipient_email_check
  check (
    recipient_email is null
    or (length(recipient_email) <= 1000 and recipient_email !~ '[[:cntrl:]]')
  );

alter table public.job_outreach_drafts
  add constraint job_outreach_drafts_cc_email_check
  check (
    cc_email is null
    or (length(cc_email) <= 1000 and cc_email !~ '[[:cntrl:]]')
  );
