-- Ansly v1.2 update: resume tailoring edits the user's own Word document, so
-- new master resumes must be Word (.docx) files.
--
-- - Storage: the `resumes` bucket only accepts .docx uploads (tailored files are
--   .docx too). PDFs already stored stay readable.
-- - resumes: new rows must be 'docx'. Versions uploaded earlier as 'pdf' keep
--   working (they can still be listed, renamed, demoted or deleted), which a
--   CHECK constraint couldn't allow, so this is an insert trigger.

update storage.buckets
set allowed_mime_types = array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'resumes';

create or replace function public.resumes_require_docx()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.file_type <> 'docx' or lower(new.file_path) not like '%.docx' then
    raise exception 'Upload your resume as a Word (.docx) file.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists resumes_require_docx on public.resumes;
create trigger resumes_require_docx
  before insert on public.resumes
  for each row execute function public.resumes_require_docx();
