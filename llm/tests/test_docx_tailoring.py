"""
Tailoring the user's own Word document in place: content changes, formatting
and structure preservation, unsupported layouts, integrity checks, and the
guarantee that unvalidated text never reaches the file.
"""

import hashlib
import re

import pytest
from lxml import etree

from src.app.resume.docx.edit import clone_paragraph, replace_text
from src.app.resume.docx.integrity import check_docx
from src.app.resume.docx.package import DOCUMENT, DocxError, DocxPackage, w
from src.app.resume.docx.tailor import UNSAFE, tailor_docx
from src.app.resume.docx.text import locate, norm, paragraphs, visible_text
from src.app.resume.matching.evidence import build_corpus
from src.app.resume.tailoring.apply import apply_plan
from src.app.resume.tailoring.plan import parse_plan
from src.app.resume.validation.validate import validate
from src.app.schemas.resume import ResumeBullet, ResumeProject
from tests.docx_files import resume_docx
from tests.tailoring_data import ADVERSARIAL_PLAN, HONEST_PLAN, analysis, master, profile_rows


def two_projects():
    resume = master()
    resume.projects.append(ResumeProject(
        id="proj_2", name="Budget Bot", role="Creator", url=None, start_date="2021", end_date=None,
        bullets=[ResumeBullet(id="proj_2_b1", text="Slack bot that posts weekly spending summaries for the team.")],
        technologies=["Python"]))
    return resume


def tailor(changes, resume=None, **docx_options):
    """Plan -> validated resume -> tailored copy of the resume's Word document."""
    source = resume or master()
    corpus = build_corpus(profile_rows(), source)
    applied = apply_plan(source, parse_plan({"changes": changes}), corpus)
    validated = validate(source, applied.resume, applied.applied, corpus, analysis(), applied.rejected)
    original = resume_docx(source, **docx_options)
    result = tailor_docx(original, source, validated.resume)
    return original, result


def texts(content: bytes):
    return [visible_text(p) for p in paragraphs(DocxPackage(content).body) if visible_text(p).strip()]


def para_with(content: bytes, fragment: str) -> etree._Element:
    return next(p for p in paragraphs(DocxPackage(content).body) if fragment in visible_text(p))


def runs(p: etree._Element):
    """(text, run properties XML) for every text run."""
    out = []
    for r in p.iter(w("r")):
        t = "".join(x.text or "" for x in r.iter(w("t")))
        if t:
            props = r.find(w("rPr"))
            out.append((t, etree.tostring(props) if props is not None else b""))
    return out


def ppr(p: etree._Element) -> bytes:
    """Paragraph properties, ignoring where namespaces happen to be declared."""
    return re.sub(rb' xmlns:\w+="[^"]*"', b"", etree.tostring(p.find(w("pPr"))))


def sound(original: bytes, result) -> list:
    final = result.resume
    required = [final.summary or ""] + [b.text for i in final.experience + final.projects for b in i.bullets]
    return check_docx(original, result.content, result.expected, required, result.removed)


REWRITE = {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b1",
           "text": "Built SaaS web applications using React, TypeScript and Node.js.", "evidenceIds": ["E1", "R:exp_1"],
           "reason": "SaaS"}


# -- content ---------------------------------------------------------------------------------


def test_rewrite_bullet():
    original, result = tailor([REWRITE])
    lines = texts(result.content)
    assert "Built SaaS web applications using React, TypeScript and Node.js." in lines
    assert "Built web applications using React and Node.js." not in lines
    assert result.applied == 1 and not result.skipped and sound(original, result) == []
    assert result.resume.experience[0].bullets[0].text == REWRITE["text"]


def test_remove_bullet():
    original, result = tailor([{"section": "experience", "item": "exp_1", "action": "reduce", "bulletId": "exp_1_b3",
                                "reason": "Least relevant"}])
    assert "Improved page load performance." not in texts(result.content)
    assert [b.id for b in result.resume.experience[0].bullets] == ["exp_1_b1", "exp_1_b2"]
    assert sound(original, result) == []


def test_reorder_job_moves_the_original_paragraphs():
    original, result = tailor([{"section": "experience", "item": "exp_2", "action": "reorder", "position": 0,
                                "reason": "Most relevant"}])
    lines = texts(result.content)
    contoso = lines.index("Junior Developer, Contoso Digital\tJun 2020 – Feb 2022")
    northwind = lines.index("Software Engineer, Northwind Labs\tMar 2022 – Present")
    assert lines.index("EXPERIENCE") < contoso < northwind < lines.index("PROJECTS")
    assert lines[contoso + 1:contoso + 3] == ["Maintained marketing sites and internal dashboards.",
                                              "Wrote Python scripts to automate weekly reporting."]
    # Moved, not recreated: the paragraphs keep their exact XML (ids, formatting, runs).
    before = etree.tostring(para_with(original, "Wrote Python scripts"))
    assert etree.tostring(para_with(result.content, "Wrote Python scripts")) == before
    # The blank separator stays between the jobs, and the section still ends where it did.
    body = [visible_text(p) for p in paragraphs(DocxPackage(result.content).body)]
    assert body[body.index("Wrote Python scripts to automate weekly reporting.") + 1] == ""
    assert [e.id for e in result.resume.experience] == ["exp_2", "exp_1"]
    assert sound(original, result) == []


def test_reorder_project():
    original, result = tailor([{"section": "projects", "item": "proj_2", "action": "reorder", "position": 0,
                                "reason": "Python"}], resume=two_projects())
    lines = texts(result.content)
    assert lines.index("Budget Bot — Creator") < lines.index("TaskBoard — Creator · github.com/example-sam/taskboard")
    assert [p.id for p in result.resume.projects] == ["proj_2", "proj_1"]
    assert sound(original, result) == []


def test_leave_out_project_deletes_its_paragraphs_and_keeps_its_link_accounted_for():
    original, result = tailor([{"section": "projects", "action": "select", "values": ["proj_2"],
                                "reason": "Focus"}], resume=two_projects())
    lines = texts(result.content)
    assert not any("TaskBoard" in line or "collaboration tool" in line for line in lines)
    assert "Budget Bot — Creator" in lines
    assert result.removed["hyperlinks"] == 1 and sound(original, result) == []


def test_rewrite_summary():
    original, result = tailor([HONEST_PLAN["changes"][3]])
    assert "Full stack engineer building SaaS web applications with React, TypeScript and Node.js." in texts(result.content)
    assert sound(original, result) == []


def test_modify_skills_inside_their_table_cell():
    original, result = tailor([
        {"section": "skills", "action": "emphasize", "values": ["Docker"], "reason": "Required"},
        {"section": "skills", "action": "reduce", "values": ["FastAPI"], "reason": "Not relevant to a frontend role"},
    ])
    lines = texts(result.content)
    assert "Data & Cloud: Docker, PostgreSQL, Supabase, AWS" in lines
    assert "Frameworks: React, Next.js, Node.js" in lines
    # The bold label run is untouched.
    label = runs(para_with(result.content, "Data & Cloud"))[0]
    assert label[0] == "Data & Cloud: " and b"<w:b/>" in label[1]
    assert sound(original, result) == []


def test_add_supported_bullet_copies_the_nearest_bullets_formatting():
    text = "Built the SaaS billing dashboard and REST APIs for 200 business customers."
    original, result = tailor([{"section": "experience", "item": "exp_1", "action": "add_bullet", "text": text,
                                "evidenceIds": ["E1"], "reason": "SaaS"}])
    lines = texts(result.content)
    assert lines[lines.index("Improved page load performance.") + 1] == text
    new, neighbour = para_with(result.content, text), para_with(original, "Improved page load performance.")
    assert ppr(new) == ppr(neighbour)  # Same list, indentation and spacing.
    assert runs(new)[0][1] == runs(neighbour)[0][1]
    assert new.get("{http://schemas.microsoft.com/office/word/2010/wordml}paraId") is None
    assert result.resume.experience[0].bullets[-1].id == "exp_1_added"
    assert sound(original, result) == []


# -- formatting --------------------------------------------------------------------------


def test_run_formatting_is_kept_and_only_changed_text_moves():
    change = {"section": "experience", "item": "exp_1", "action": "rewrite_bullet", "bulletId": "exp_1_b2",
              "text": "Cut API response times by 35% by adding PostgreSQL indexes and query caching.",
              "evidenceIds": ["R:exp_1_b2"], "reason": "Performance"}
    original, result = tailor([change])
    before, after = runs(para_with(original, "35%")), runs(para_with(result.content, "35%"))
    assert [r[1] for r in after] == [r[1] for r in before]  # font, size, color, bold: run by run
    assert after[1] == ("35%", before[1][1]) and b"<w:b/>" in after[1][1]
    assert after[0][0] == "Cut API response times by "
    for _, props in after:
        assert b'w:ascii="Georgia"' in props and b'w:val="21"' in props and b'w:val="1F2937"' in props
    assert ppr(para_with(result.content, "35%")) == ppr(para_with(original, "35%"))


def test_italics_kept_on_rewrite():
    change = {"section": "experience", "item": "exp_1", "action": "align_terms", "bulletId": "exp_1_b3",
              "text": "Improved web performance.", "evidenceIds": ["R:exp_1_b3"], "reason": "Wording"}
    _, result = tailor([change])
    (text, props), = runs(para_with(result.content, "Improved web performance."))
    assert b"<w:i/>" in props


def test_document_structure_survives_every_change():
    plan = HONEST_PLAN["changes"] + [
        {"section": "experience", "item": "exp_2", "action": "reorder", "position": 0, "reason": "x"},
        {"section": "experience", "item": "exp_1", "action": "reduce", "bulletId": "exp_1_b3", "reason": "x"},
    ]
    original, result = tailor(plan)
    before, after = DocxPackage(original), DocxPackage(result.content)
    # Headers, footers, styles, numbering, images: byte-identical parts.
    for part in ("word/header1.xml", "word/footer1.xml", "word/styles.xml", "word/numbering.xml", "word/media/logo.png",
                 "word/_rels/document.xml.rels", "[Content_Types].xml"):
        assert after.parts[part] == before.parts[part], part
    count = lambda pkg, tag: sum(1 for _ in pkg.document.iter(w(tag)))  # noqa: E731
    for tag in ("tbl", "sectPr", "drawing", "hyperlink", "headerReference", "footerReference", "cols", "numPr"):
        if tag != "numPr":
            assert count(after, tag) == count(before, tag), tag
    # Columns: the two-column section is still there.
    assert after.body[-1].find(w("cols")).get(w("num")) == "2"
    assert count(after, "numPr") == count(before, "numPr") - 1  # one bullet removed
    assert sound(original, result) == []


def test_original_file_is_never_modified():
    source = master()
    original = resume_docx(source)
    digest = hashlib.sha256(original).hexdigest()
    corpus = build_corpus(profile_rows(), source)
    applied = apply_plan(source, parse_plan(HONEST_PLAN), corpus)
    tailor_docx(original, source, validate(source, applied.resume, applied.applied, corpus).resume)
    assert hashlib.sha256(original).hexdigest() == digest


def test_no_changes_gives_an_equivalent_copy():
    original, result = tailor([])
    assert texts(result.content) == texts(original) and result.applied == 0 and sound(original, result) == []


# -- safety ---------------------------------------------------------------------------------


def test_adversarial_plan_never_reaches_the_document():
    original, result = tailor(ADVERSARIAL_PLAN["changes"])
    document = "\n".join(texts(result.content))
    for fabricated in ["40%", "Kubernetes", "EKS", "Certified", "12 engineers", "8 years", "Owned the data platform",
                       "high-traffic", "Senior Software Engineer"]:
        assert fabricated not in document, fabricated
    assert sound(original, result) == []


def test_integrity_check_catches_unvalidated_text_and_lost_structure():
    original, result = tailor([REWRITE])
    package = DocxPackage(result.content)
    p = para_with(result.content, "Maintained marketing")
    p = next(x for x in paragraphs(package.body) if visible_text(x) == visible_text(p))
    replace_text(p, 0, len(visible_text(p)), "Led a team of 40 engineers.")
    package.body.remove(next(package.body.iter(w("tbl"))))
    problems = check_docx(original, package.to_bytes(), result.expected, [], result.removed)
    assert any("wasn't validated" in x for x in problems)
    assert "tables changed" in problems
    assert check_docx(original, b"not a zip", set(), [], result.removed) == ["the tailored file doesn't open as a Word document"]


def test_integrity_check_catches_changed_parts():
    original, result = tailor([REWRITE])
    package = DocxPackage(result.content)
    package.parts["word/header1.xml"] = package.parts["word/header1.xml"].replace(b"Confidential", b"Public")
    assert "word/header1.xml changed" in check_docx(original, package.to_bytes(), result.expected, [], result.removed)


# -- complex layouts --------------------------------------------------------------------------


def test_text_box_content_is_left_untouched_and_reported():
    original, result = tailor([HONEST_PLAN["changes"][3], REWRITE], summary_in_text_box=True)
    assert [s.label for s in result.skipped] == ["your summary"]
    assert result.resume.summary == master().summary  # The diff shows what the document says.
    xml = DocxPackage(result.content).document_xml().decode()
    assert xml.count(master().summary) == 2  # both copies of the text box, unchanged
    assert "Built SaaS web applications" in xml and sound(original, result) == []


def test_a_document_that_cant_be_edited_safely_is_refused():
    source = master()
    corpus = build_corpus(profile_rows(), source)
    applied = apply_plan(source, parse_plan({"changes": [HONEST_PLAN["changes"][3]]}), corpus)
    final = validate(source, applied.resume, applied.applied, corpus).resume
    with pytest.raises(DocxError, match="couldn't safely edit"):
        tailor_docx(resume_docx(source, summary_in_text_box=True), source, final)
    assert "Your original resume has not been changed." in UNSAFE


def test_not_a_word_document():
    with pytest.raises(DocxError, match="isn't a valid Word"):
        DocxPackage(b"%PDF-1.7")
    with pytest.raises(DocxError):
        DocxPackage(resume_docx(master()).replace(b"word/document.xml", b"word/documenX.xml"))


# -- edit primitives ---------------------------------------------------------------------------


def test_hyperlink_text_is_never_edited():
    p = para_with(resume_docx(master()), "github.com/example-sam")
    text = visible_text(p)
    start, end = locate(text, "github.com/example-sam")
    assert replace_text(p, start - 3, end, "gitlab.com/someone-else") is False
    assert visible_text(p) == text


def test_rewrite_text_goes_into_the_main_run_not_a_bold_lead_in():
    p = etree.fromstring(
        f'<w:p xmlns:w="{w("x")[1:-2]}"><w:r><w:rPr><w:b/></w:rPr><w:t>Led </w:t></w:r>'
        '<w:r><w:t>the migration of the billing service.</w:t></w:r></w:p>')
    assert replace_text(p, 0, len(visible_text(p)), "Migrated the billing service to new APIs.")
    assert runs(p) == [("Migrated the billing service to new APIs.", b"")] or \
        [r[0] for r in runs(p)] == ["Migrated the billing service to new APIs."]


def test_clone_without_a_span_keeps_the_paragraph_and_run_formatting():
    template = para_with(resume_docx(master()), "Improved page load")
    clone = clone_paragraph(template, None, "New bullet.")
    assert visible_text(clone) == "New bullet." and ppr(clone) == ppr(template)


def test_norm_ignores_quotes_dashes_bullets_and_spacing():
    assert norm("•  Led “Project X” – end to end") == norm('Led "project x" - end to end')
    assert locate("• Built  apps", "Built apps") == (2, 13)


def test_document_part_is_the_only_rewritten_part():
    original, result = tailor([REWRITE])
    before, after = DocxPackage(original), DocxPackage(result.content)
    assert [n for n in before.parts if before.parts[n] != after.parts[n]] == [DOCUMENT]
