-- When a worker started the tailoring's current step; null while no step is running.
-- A request that finds the step idle (or its worker gone quiet) runs it, so a tailoring
-- moves on as soon as a step finishes instead of waiting for a stale timeout.

alter table public.resume_tailorings
  add column if not exists step_started_at timestamptz;
