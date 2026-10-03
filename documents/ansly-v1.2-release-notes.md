# Ansly v1.2 — Resume Tailoring: Release Notes

> **Ansly detects the job you're viewing and tailors your own Word resume to it, using only your real experience and keeping your original design. You preview the result page by page, then download a `.docx`.**

Extension version **0.2.0** · Pipeline version **1.2.1** · Migrations `20261004000000_resume_tailoring.sql`, `20261005000000_resume_tailoring_metrics.sql`, `20261006000000_docx_only_resumes.sql`

## Your Word document is the design master

Ansly never rebuilds your resume from a template. It plans and validates changes on structured data, then applies them to a **copy** of the `.docx` you uploaded:

- Only the changed characters are edited, inside your own runs: fonts, sizes, bold/italics, colors, highlighting, bullets, numbering, indentation and spacing stay exactly as they were.
- Jobs and projects are reordered by moving their original paragraphs; removed bullets and left-out projects delete the original paragraphs; a new bullet is a copy of the nearest bullet with new text.
- Every other part of the file (styles, numbering, headers, footers, images, theme, settings) is copied byte for byte.
- Anything that can't be edited safely (text boxes, shapes, layout tables, hyperlink text) is left untouched and listed for you. If nothing can be edited safely, no file is created and you're told why.
- Before "Ready", the file is checked: it opens, every XML part parses, tables, sections/columns, images, header/footer references, hyperlinks, lists and styles are all intact, and every paragraph says either what your original said or what passed validation.
- Your original upload is never modified, so the same master serves every future job. Downloads are named `<your file> - Tailored - <Company>.docx`.

## What's new

**Web app — Resume**
- Upload a master resume as a **Word (.docx)** file (≤ 10 MB); PDF isn't accepted (checked in the picker, the API, the file contents and the storage bucket). Ansly extracts the text (body, text boxes, headers and footers), finds sections with rules, structures them with the LLM (copy-only), and checks the result against the source. Low-confidence parses are marked *Needs review* and can't be tailored until confirmed.
- Edit the parsed resume. Replacing the master keeps every old version; old tailorings keep pointing at theirs.
- Profile ↔ resume differences (titles, companies, dates, skills, education, contact): you pick a side per item. Nothing is overwritten silently.
- Tailor for a pasted job description; progress while it runs; a "Your tailored resume is ready" card that leads with **Preview Resume**; changes by section, word-level diffs with the evidence each rewrite cites, supported/partial/unsupported requirements, warnings and flagged sentences; **Download DOCX**; history with delete (removes the file).
- **Preview** rendered in the browser from the real tailored `.docx`: real pages (size, margins, header and footer) with visible page boundaries, every page of a multi-page resume, zoom (with fit-to-width), **Original / Tailored** tabs and side-by-side on wide screens, page-shaped skeletons while it loads, and a "Layout changed: 1 page → 2 pages" or "over your page limit" warning. If the preview fails, the page says so and still offers the (validated) download.
- Faster pages: cached reads show the last data instantly and refresh in the background; the preview renderer and both documents start downloading the moment a tailoring is ready; route skeletons on navigation; preconnects to the API and storage.
- Dashboard: tailored-resume count and an "Upload master resume" next step. Settings: tailored-resume page limit (1–3, default 2; the preview warns when the tailored document runs past it); export includes resume metadata and tailoring history (resume text only if you tick the box; files never).

**Extension**
- Job-page detection: schema.org JobPosting JSON-LD → LinkedIn / Indeed adapters → generic career-page heuristic → "Paste description" fallback to the web app.
- A small, dismissible **Tailor resume** pill on job postings (enabled sites only; popup toggle *Offer resume tailoring on job pages*). The job is read only when you click **Tailor Resume**, and only title, company, location, employment type, description and URL are sent.
- Card states: no master, needs review, analyzing, matching, tailoring, ready (counts + changes + Preview Resume / Download DOCX), warning, not enough job info, error with retry, not connected. Coexists with the V1 fill-all pill.
- No new permissions.

**API** (`/api/v1`)
- `POST/GET /resumes`, `GET /resumes/master`, `PATCH/DELETE /resumes/{id}`, `POST /resumes/{id}/master`
- `POST /jobs/analyze`
- `POST/GET /tailorings`, `GET/DELETE /tailorings/{id}`, `GET /tailorings/{id}/files` (signed URLs for the preview: tailored + original), `GET /tailorings/{id}/download` (the tailored `.docx`)

## Truthfulness guarantees

The model proposes controlled operations only (reorder, emphasize, rewrite_bullet, add_bullet, select, reduce, align_terms, update_summary); they're applied in code to a copy of the master. Then, before anything is shown:

| Check | What happens |
|---|---|
| Protected fields (titles, companies, dates, URLs, contact, education) | Restored to the master |
| Invented items or bullets | Removed |
| New bullet (`add_bullet`) not backed by evidence about that same job/project | Left out (max 1 per item, 2 overall) |
| Rewrite without real evidence ids | Reverted |
| Number/metric not in the cited evidence or the original | Claim removed (bullet reverted; summary sentence dropped) |
| Technology not in the cited evidence, or one you said you don't have | Claim removed |
| Certification/license not in the evidence | Claim removed |
| Master skill dropped without a reason | Restored |
| LLM truthfulness review | Flags sentences for you to check |
| Change that can't be applied to the Word document safely | Left out of the document *and* the diffs, listed as a warning |
| Tailored document fails an integrity check | Tailoring fails; no file is offered |

Skill and certification requirements are matched deterministically: the model never decides them, so a technology you don't have is always "No evidence".

## Release checklist

- [ ] Apply the migrations (`supabase db push`). They create the tables, RLS policies, the private `resumes` bucket and its storage policies, and restrict new uploads to `.docx` (older PDF versions stay readable).
- [ ] Set `DAILY_TAILORING_LIMIT` in the API's production env (default 10) and confirm the value.
- [ ] Deploy the API with the new dependency (`lxml` is in `requirements.txt`; `reportlab` and `pypdf` were removed). Tailoring runs as a background task after `POST /tailorings`; if Vercel stops it after the response, the next status poll resumes the run one step at a time (each step is a single LLM call). Watch the "stuck" query in `supabase/analytics/tailoring_metrics.sql`; if many runs stall, raise the function's max duration or move the pipeline to a queue.
- [ ] Deploy the web app.
- [ ] Run the evaluation (`llm/evals/README.md`) on 20+ real job descriptions with `--docx`, read every result, and open the tailored `.docx` files in Word.
- [ ] QA the preview with 3+ real resumes (one single-column, one with a table/two-column layout, one with a header/footer or logo) in Chrome, Safari and Firefox: pages, page boundaries, zoom, Original/Tailored, side by side.
- [ ] Live QA with the extension on LinkedIn (job view and search split view), Indeed (viewjob and `?vjk=`), and at least two career pages (one with JSON-LD, e.g. Greenhouse/Lever/Ashby, one without): pill appears, Tailor Resume → progress → result → Preview Resume → Download DOCX.
- [ ] Chrome Web Store listing: update the description and the privacy disclosures — the extension now handles *website content* (job title, company, location and description, read only on click) and the web app stores *uploaded resumes*. Link the updated privacy policy.
- [ ] Zip and submit extension 0.2.0 (`pnpm --filter @ansly/extension zip`).

## Monitoring

- Usage events: `resume_uploaded`, `resume_parse_failed`, `job_detected`, `tailoring_started`, `tailoring_completed` (with `duration_ms`, `tokens`, `provider`), `tailoring_failed`, `resume_previewed`, `resume_downloaded`, `tailoring_deleted`. They never contain resume or job text.
- Dashboard queries: `supabase/analytics/tailoring_metrics.sql` (funnel, completion/failure/download rates, p50/p90 time, tokens and estimated cost, provider mix, failure reasons, stuck runs).
- API logs: each pipeline step logs its duration; failures log the step and error; the gateway logs every provider fallback.

## Known limitations

- Word (.docx) only. PDF resumes, older `.doc` files and scanned (image-only) resumes can't be tailored; users are asked to save as `.docx`. Masters uploaded as PDF before this update must be re-uploaded.
- Text inside text boxes and shapes is never edited (Word stores it twice); designs that put the whole resume in text boxes can't be tailored, and the user is told so.
- The preview is rendered in the browser (docx-preview), so it's very close to Word but not pixel-identical: page breaks are computed from the content, tables aren't split across pages, and multi-column sections aren't paginated. The downloaded file is the real document.
- LinkedIn and Indeed change their markup often; when the adapters miss, JSON-LD or the paste fallback still works.
- The extension only runs on sites you've enabled (LinkedIn, Indeed and career sites need enabling once from the popup).
