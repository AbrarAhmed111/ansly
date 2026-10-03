I want you to update the current Ansly resume-tailoring implementation.

The core product requirement is:

> **Ansly should tailor the user's uploaded Word resume while preserving its original design and formatting, and the user must be able to visually preview the result before downloading it.**

The user's DOCX is the formatting and design master.

Do not generate the tailored resume using Ansly's own resume template.

---

# 1. Supported resume format

For resume tailoring, **DOCX is the only supported format.**

Do not support PDF resume uploads.

The upload UI should clearly say:

> **Upload your resume as a Word (.docx) file.**  
> Ansly preserves your original resume's design and formatting by tailoring the uploaded Word document directly.

Restrict the file picker to `.docx` where possible and validate the file type on both frontend and backend.

Do not create a PDF tailoring pipeline.

Do not convert PDF → DOCX.

Do not convert DOCX → PDF for the user.

The final downloadable tailored resume should remain:

**`.docx`**

---

# 2. Original DOCX is the design master

The uploaded document should remain the source of truth for:

- Layout
- Fonts
- Typography
- Colors
- Headings
- Spacing
- Bullets
- Numbering
- Indentation
- Columns
- Tables
- Headers
- Footers
- Images
- Logos
- Hyperlinks
- Page structure
- Section formatting

The result should look like:

> **My original resume, but tailored for this job.**

Not:

> Ansly's resume template with my information.

---

# 3. In-place DOCX tailoring

The current implementation uses Ansly's own ReportLab/template renderer.

Do not use that for DOCX tailoring.

Instead:

```text
Original DOCX
      ↓
Parse + map document structure
      ↓
Tailoring analysis
      ↓
Generate structured changes
      ↓
Apply changes to COPY of original DOCX
      ↓
Render preview
      ↓
Validate
      ↓
Download tailored DOCX
```

The original uploaded file must never be modified directly.

---

# 4. AI should return structured changes

Do not ask the AI to generate a completely new resume.

The AI should return targeted changes.

Example:

```json
{
  "changes": [
    {
      "elementId": "experience-abc-company-bullet-2",
      "action": "rewrite",
      "newText": "Led development of internal automation tools that reduced manual operational work."
    }
  ]
}
```

Supported operations can include:

- `rewrite`
- `remove`
- `reorder`
- `replace`
- `add`

The AI decides **what should change**.

The DOCX manipulation layer decides **how to apply the change while preserving the document's formatting**.

---

# 5. Preserve run-level formatting

DOCX paragraphs can contain multiple runs with different formatting.

Do not flatten paragraphs into plain text.

When changing content, preserve:

- Font
- Font size
- Bold
- Italics
- Underline
- Text color
- Links
- Highlighting
- Paragraph formatting
- Bullet formatting
- Indentation
- Spacing

Only change the necessary text.

---

# 6. Preserve document structure

Do not rebuild the document.

Preserve:

- Headers
- Footers
- Tables
- Images
- Logos
- Columns
- Section breaks
- Page breaks
- Styles
- Numbering definitions
- Custom formatting
- Hyperlinks
- Text boxes where safely supported

When moving a project/job/bullet, move the original document element instead of recreating it.

When deleting content, delete the original paragraph/block.

When adding a supported bullet, copy formatting from the nearest equivalent existing bullet.

---

# 7. Visual preview is REQUIRED

This is a major product requirement.

After Ansly generates the tailored DOCX, the user should **see exactly how the resulting resume looks before downloading it.**

Do not make the user download the file just to inspect the result.

The frontend should have a clear:

**Preview Resume**

experience.

---

# 8. Preview should look like the actual document

The preview should represent the rendered DOCX as closely as possible.

It should show:

- Page boundaries
- Original page size
- Margins
- Fonts
- Font sizes
- Colors
- Bold/italic formatting
- Bullets
- Tables
- Columns
- Headers
- Footers
- Images
- Spacing
- Page breaks
- Overall layout

The user should be able to visually inspect the resume as if they were looking at the actual Word document.

Do NOT simply display the extracted text in an HTML `<div>` and call that a preview.

The preview needs to represent the **document layout**.

---

# 9. Preview rendering architecture

Because the browser cannot reliably render arbitrary DOCX documents directly with perfect fidelity, inspect the existing infrastructure and choose the most reliable approach available within the current Ansly architecture.

Possible approaches include:

### Option A — Server-side DOCX rendering

If the deployment environment supports a DOCX rendering engine:

```text
DOCX
 ↓
Render
 ↓
PDF/images
 ↓
Frontend preview
```

### Option B — Client-side DOCX rendering

If a reliable browser-compatible DOCX renderer is available:

```text
DOCX
 ↓
Browser renderer
 ↓
Preview
```

### Option C — Preview artifact generated alongside DOCX

If direct DOCX rendering is not reliable in the current deployment environment:

```text
Tailored DOCX
      ↓
Preview renderer
      ↓
PNG/page images
      ↓
Frontend preview
```

Use whichever approach provides the best fidelity while remaining compatible with the current project.

**Do not change the downloadable format just to make preview easier.**

The download remains DOCX.

---

# 10. Preview should support multiple pages

If the resume is two pages, show both pages.

If it is three pages, show all three.

The user should be able to:

- Scroll vertically
- Zoom in/out
- Inspect each page
- Clearly distinguish page boundaries

A useful layout would be:

```text
┌─────────────────────────────────────────────┐
│                                             │
│              PAGE 1                         │
│                                             │
│       Original Resume Design                │
│       + Tailored Content                    │
│                                             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│                                             │
│              PAGE 2                         │
│                                             │
│       Original Resume Design                │
│       + Tailored Content                    │
│                                             │
└─────────────────────────────────────────────┘
```

The preview should feel like viewing a real document, not a webpage containing resume text.

---

# 11. Original vs tailored preview

Where practical, provide a comparison feature.

The user should be able to switch between:

**Original**

and

**Tailored**

For example:

```text
[ Original ] [ Tailored ]
```

The Original view shows the uploaded resume.

The Tailored view shows the modified resume.

This makes it easy for the user to verify that Ansly preserved their design.

An optional enhancement is a side-by-side comparison on larger screens:

```text
┌─────────────────────┐   ┌─────────────────────┐
│ Original            │   │ Tailored            │
│                     │   │                     │
│ Resume page 1       │   │ Resume page 1       │
│                     │   │                     │
└─────────────────────┘   └─────────────────────┘
```

On smaller screens, use tabs instead.

---

# 12. Clear tailoring UI

After tailoring completes, the user should see something similar to:

```text
Your tailored resume is ready

[ Preview Resume ]

Your original formatting has been preserved.

[ Download DOCX ]
```

Do not make the download button the only obvious next step.

The user should naturally be encouraged to preview first.

---

# 13. Preview loading state

Rendering a DOCX preview may take time.

Provide a clear loading state such as:

```text
Preparing your resume preview...
```

Optionally show progress stages:

```text
✓ Resume tailored
✓ Formatting preserved
● Preparing preview
○ Ready to download
```

Do not leave the user looking at a blank page.

---

# 14. Preview error handling

If preview generation fails:

**Do not claim that the document is ready for visual inspection.**

Show something like:

> We couldn't generate the preview right now, but your tailored Word document is available to download.

However, if document validation also fails, do not offer the file as a successful download.

---

# 15. Document integrity validation

Before displaying the "Ready" state, validate the generated DOCX.

Check:

### Content

- No fabricated claims
- No unsupported experience
- No unsupported skills
- No fabricated metrics
- No fabricated companies
- No fabricated responsibilities

### Document

- Valid DOCX
- XML is valid
- File opens successfully
- Headers remain
- Footers remain
- Tables remain
- Images remain
- Hyperlinks remain
- Styles remain
- Bullets remain
- Numbering remains
- Sections remain

### Formatting

Verify that the original formatting survives wherever technically possible.

---

# 16. Preview should help catch formatting problems

The preview is not only a convenience feature.

It should be part of the quality-control flow.

For example, if tailoring makes a bullet significantly longer and it pushes a section onto another page, the user should immediately see that.

The user can then review the result before downloading.

If possible, show a small warning when significant layout changes occur, such as:

> **Layout changed:** Your tailored content caused the resume to expand from 1 page to 2 pages.

Do not prevent the download just because pagination changed.

Text changes naturally affect pagination.

---

# 17. Original file remains untouched

The system should maintain:

```text
Original Resume.docx
```

and create:

```text
Original Resume - Tailored.docx
```

The original should remain available for creating future tailored resumes.

For example:

```text
                    Original Resume
                          │
             ┌────────────┼────────────┐
             ↓            ↓            ↓
          Job A         Job B        Job C
             ↓            ↓            ↓
        Tailored A   Tailored B   Tailored C
```

---

# 18. Complex DOCX layouts

Some documents may contain:

- Text boxes
- Floating shapes
- SmartArt
- Nested tables
- Floating images
- Custom XML
- Complex columns

Do not corrupt the document when encountering unsupported structures.

If an element cannot safely be mapped:

**Leave it untouched.**

If the entire document cannot safely be modified, tell the user clearly.

Never silently replace the resume with an Ansly template.

---

# 19. Upload UX

The resume upload area should make the DOCX requirement obvious.

For example:

**Upload your master resume**

> Word documents (`.docx`) only  
> Your original formatting and design will be preserved while Ansly tailors the content.

The file picker should accept `.docx`.

Server-side validation must also enforce the same rule.

---

# 20. Remove PDF tailoring

Because DOCX provides the structured document format needed for reliable preservation:

**PDF is intentionally out of scope.**

Remove/disable PDF resume tailoring paths where they are only supporting this feature.

Do not maintain unnecessary PDF-specific resume generation code.

Do not implement PDF style matching as an alternative.

Keep unrelated PDF functionality elsewhere in the project if another feature requires it.

---

# 21. Existing AI/safety logic

Reuse the existing Ansly AI tailoring and safety pipeline wherever possible.

Do not duplicate the entire AI system.

The main architectural change should be around:

**structured document mapping → in-place DOCX editing → preview rendering**

not replacing the existing tailoring intelligence.

---

# 22. Tests

Add tests for:

### Content

- Rewrite bullet
- Remove bullet
- Reorder project
- Reorder job
- Rewrite summary
- Modify skills
- Add supported bullet

### Formatting

- Font preserved
- Font size preserved
- Bold preserved
- Italics preserved
- Colors preserved
- Bullet style preserved
- Indentation preserved
- Spacing preserved
- Tables preserved
- Columns preserved
- Headers preserved
- Footers preserved

### Preview

- One-page resume preview
- Two-page resume preview
- Original preview
- Tailored preview
- Preview loading state
- Preview failure state
- Preview reflects the final DOCX
- Page boundaries are visible
- Zoom works
- Original/tailored switching works

### Safety

Ensure unsupported information cannot be introduced.

### Regression

Ensure existing Ansly V1 functionality continues to work.

---

# 23. Desired architecture

The final system should look conceptually like:

```text
                   ┌──────────────────┐
                   │  Upload DOCX     │
                   └────────┬─────────┘
                            ↓
                   ┌──────────────────┐
                   │ Parse + Map      │
                   │ Document         │
                   └────────┬─────────┘
                            ↓
                   ┌──────────────────┐
                   │ AI Tailoring     │
                   │ + Safety Checks  │
                   └────────┬─────────┘
                            ↓
                   ┌──────────────────┐
                   │ Structured       │
                   │ Changes          │
                   └────────┬─────────┘
                            ↓
                   ┌──────────────────┐
                   │ Modify COPY of   │
                   │ Original DOCX    │
                   └────────┬─────────┘
                            ↓
              ┌─────────────┴─────────────┐
              ↓                           ↓
     ┌──────────────────┐        ┌──────────────────┐
     │ Validate DOCX    │        │ Render Preview   │
     └────────┬─────────┘        └────────┬─────────┘
              │                           │
              └─────────────┬─────────────┘
                            ↓
                   ┌──────────────────┐
                   │ Preview +        │
                   │ Download UI      │
                   └──────────────────┘
```

---

# 24. Final acceptance criteria

Consider the feature complete only when:

1. Ansly accepts `.docx` resumes for tailoring.
2. PDF is not accepted for resume tailoring.
3. The upload UI clearly communicates the DOCX requirement.
4. The uploaded DOCX is treated as the design master.
5. AI generates structured content changes.
6. Changes are applied to a copy of the original DOCX.
7. Original formatting is preserved wherever technically possible.
8. Fonts remain.
9. Colors remain.
10. Bullets remain.
11. Spacing remains.
12. Tables remain.
13. Headers and footers remain.
14. Columns remain where supported.
15. Images/logos remain.
16. Hyperlinks remain.
17. Original file remains untouched.
18. Tailored file downloads as `.docx`.
19. No PDF conversion is required.
20. No unsupported claims are introduced.
21. Complex layouts are not silently corrupted.
22. A visual preview is available before download.
23. Preview represents the actual tailored document layout.
24. Multi-page resumes are fully previewable.
25. User can switch between Original and Tailored preview.
26. User can zoom and inspect pages.
27. Preview errors are handled clearly.
28. Existing Ansly V1 functionality continues to work.

Before coding, inspect the existing implementation and give me a concise summary of:

- Current resume upload flow
- Current DOCX parsing
- Current AI tailoring pipeline
- Current renderer
- Current download flow
- Existing frontend resume UI
- Where preview generation should be integrated
- What existing code can be reused
- What should be removed/replaced
- Any deployment limitations affecting DOCX rendering/preview

Then implement the feature.

**Do not ask me whether to support PDF. PDF is intentionally out of scope. DOCX is the required and only supported resume format for tailored resume generation.**

**Do not ask me whether to add preview. Preview is a required part of the feature.**