-- Free-form context the user wants Ansly to know about them (career goals,
-- context behind their experience, things that don't fit a structured section).
-- Treated as true, like the rest of the profile: answers and tailoring may use it.

alter table public.profiles
  add column if not exists additional_context text
    check (additional_context is null or length(additional_context) <= 6000);
