# Tailoring evaluation

The v1.2 release gate: run real job descriptions through the real pipeline and
read every result by hand for truthfulness and usefulness.

1. Save 20+ real job descriptions for roles you're targeting in `evals/jobs/`,
   one `.txt` each: line 1 = title, line 2 = company, then the description.
   (`evals/jobs/` is git-ignored: job postings are copyrighted text.)
2. Export your master resume's parsed JSON (the `parsedContent` of
   `GET /api/v1/resumes/master`) to e.g. `evals/resume.json`, and optionally your
   profile export from the web app (Settings → Export profile). Keep the Word
   file it was parsed from next to it, e.g. `evals/resume.docx`.
3. Run, with provider keys in `llm/.env`:

   ```
   uv run python -m scripts.eval_tailoring --jobs evals/jobs --resume evals/resume.json --docx evals/resume.docx --profile evals/profile.json
   ```

4. Read `evals/out/report.md` and open the tailored `.docx` files next to it in
   Word. The script exits non-zero if its automatic checks find a number,
   technology or protected-field change that isn't backed by your evidence, or a
   tailored document that fails the integrity checks. Those are bugs; report
   them with the job.

Hand review checklist per job: every rewrite says only what you did; nothing
unsupported is implied; the supported/unsupported split matches reality; the
tailored document looks exactly like your original (fonts, colors, bullets,
spacing, header and footer) apart from the changed text, and still fits on the
pages you want.
