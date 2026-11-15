-- Ansly Leads: AI usage from Leads (role detection, resume matching, email writing) counts on the dashboard.
-- One 'lead_email' usage event per Leads request that called the AI, carrying its tokens and call count, so
-- dashboard_summary.token_buckets includes them. Per-call detail goes to llm_calls as for every other stage.

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check
  check (kind in (
    'generate', 'regenerate', 'fill', 'save_answer', 'use_saved_answer', 'fill_all',
    'resume_uploaded', 'resume_parse_failed', 'job_detected', 'tailoring_started', 'tailoring_completed',
    'tailoring_failed', 'resume_previewed', 'resume_downloaded', 'tailoring_deleted',
    'job_analyzed', 'adapt_saved_answer',
    -- Application Memory and Ask-and-Learn
    'ask_and_learn_shown', 'ask_and_learn_completed', 'ask_and_learn_skipped', 'memory_fact_saved',
    'memory_fact_edited', 'memory_fact_deleted', 'memory_fact_confirmed', 'memory_used',
    -- Rewrite controls, Fill all and undo
    'rewrite', 'fit_to_limit', 'fill_all_completed', 'undo',
    -- Onboarding
    'onboarding_step', 'extension_connected', 'first_answer',
    -- Leads: role detection, resume matching and email writing
    'lead_email'
  ));
