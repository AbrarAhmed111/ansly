"""
Master resume ingestion: text extraction, section identification, structuring
confidence, and profile <-> resume discrepancies.
"""

import copy

import pytest

from src.app.resume.parsing.discrepancies import find_discrepancies, resume_month
from src.app.resume.parsing.extract import ResumeReadError, extract_text
from src.app.resume.parsing.sections import contact_hints, detected_kinds, heading_kind, split_sections
from src.app.resume.parsing.structure import assess, parse_resume, to_structured
from tests.docx_files import resume_docx
from tests.fakes import SAMPLE_PROFILE, FakeGateway
from tests.resume_files import CLASSIC_PARSED, LAYOUTS, make_docx, make_layout_docx
from tests.tailoring_data import master

# -- extraction ---------------------------------------------------------------


@pytest.mark.parametrize("layout", sorted(LAYOUTS))
def test_docx_text_extraction_keeps_every_line(layout):
    text = extract_text(make_layout_docx(LAYOUTS[layout]))
    for line in LAYOUTS[layout].split("\n"):
        words = line.replace("•", "").split()
        assert all(w in text for w in words[:3]), line


def test_docx_extraction_marks_list_items():
    content = make_docx([("Sam Rivera", False), ("sam@example.com", False), ("EXPERIENCE", False),
                         ("Software Engineer, Northwind Labs", False), ("Built web apps with React.", True),
                         ("Shipped a design system used across " + "four product teams. " * 8, True)])
    text = extract_text(content)
    assert "• Built web apps with React." in text
    assert text.startswith("Sam Rivera")


def test_rich_docx_extraction_reads_headers_and_text_boxes_once():
    text = extract_text(resume_docx(master(), summary_in_text_box=True))
    summary = master().summary
    assert text.count(summary) == 1  # Word stores text boxes twice; they're read once.
    assert text.startswith("Confidential resume")  # Header text comes first.
    assert "Page 1" not in text  # Page-number footers are noise.
    assert "• Built web applications using React and Node.js." in text
    assert "Languages: TypeScript, JavaScript, Python, SQL" in text


def test_unreadable_empty_and_non_word_files_fail_with_a_user_safe_message():
    with pytest.raises(ResumeReadError, match=r"Word \(\.docx\)"):
        extract_text(b"%PDF-1.7 a pdf resume")
    with pytest.raises(ResumeReadError, match="isn't a valid Word"):
        extract_text(b"PK not a zip")
    with pytest.raises(ResumeReadError, match="scanned image"):
        extract_text(make_docx([("Sam Rivera", False)]))


# -- sections -----------------------------------------------------------------


@pytest.mark.parametrize("layout, expected", [
    ("classic", ["summary", "experience", "projects", "skills", "education"]),
    ("colon_headings", ["summary", "experience", "skills", "certifications", "custom"]),
    ("skills_first", ["skills", "experience", "achievements", "education"]),
])
def test_sections_are_found_across_layouts(layout, expected):
    assert detected_kinds(LAYOUTS[layout]) == expected


def test_heading_detection_ignores_sentences():
    assert heading_kind("WORK EXPERIENCE") == "experience"
    assert heading_kind("Technical Skills:") == "skills"
    assert heading_kind("I have experience with React and Node.js") is None


@pytest.mark.parametrize("layout, name, email, phone", [
    ("classic", "SAM RIVERA", "sam.rivera@example.com", "+1 555 010 0100"),
    ("colon_headings", "Alex Chen", "alex.chen@example.com", "(555) 010-0199"),
    ("skills_first", "Priya Patel", "priya@example.com", "+44 20 7946 0958"),
])
def test_contact_details_come_from_rules(layout, name, email, phone):
    hints = contact_hints(LAYOUTS[layout])
    assert (hints.name, hints.email, hints.phone) == (name, email, phone)


def test_header_is_split_from_sections():
    sections = split_sections(LAYOUTS["classic"])
    assert sections[0].kind == "header" and "sam.rivera@example.com" in sections[0].text


# -- structuring ----------------------------------------------------------------


def test_structuring_assigns_ids_and_keeps_rule_contact_details():
    parsed = copy.deepcopy(CLASSIC_PARSED)
    parsed["contact"]["email"] = "typo@example.com"
    resume = to_structured(parsed, contact_hints(LAYOUTS["classic"]))
    assert resume.contact.email == "sam.rivera@example.com"
    assert [e.id for e in resume.experience] == ["exp_1", "exp_2"]
    assert [b.id for b in resume.experience[0].bullets] == ["exp_1_b1", "exp_1_b2"]
    assert resume.experience[0].is_current is True


def test_faithful_parse_is_marked_parsed():
    resume = to_structured(CLASSIC_PARSED, contact_hints(LAYOUTS["classic"]))
    result = assess(LAYOUTS["classic"], resume)
    assert result.status == "parsed", result.notes
    assert result.coverage > 0.9


def test_invented_or_missing_content_needs_review():
    invented = copy.deepcopy(CLASSIC_PARSED)
    invented["experience"][0]["bullets"].append("Led a team of twelve engineers delivering Kubernetes migrations.")
    assert assess(LAYOUTS["classic"], to_structured(invented, contact_hints(LAYOUTS["classic"]))).status == "needs_review"

    missing = copy.deepcopy(CLASSIC_PARSED)
    missing["education"] = []
    result = assess(LAYOUTS["classic"], to_structured(missing, contact_hints(LAYOUTS["classic"])))
    assert result.status == "needs_review"
    assert any("education" in n for n in result.notes)


@pytest.mark.asyncio
async def test_parse_resume_uses_the_model_and_rejects_bad_output():
    gateway = FakeGateway({"You convert the text of a resume": lambda user: CLASSIC_PARSED})
    result = await parse_resume(gateway, LAYOUTS["classic"])
    assert result.status == "parsed"
    assert result.resume.skills[0].items[0] == "TypeScript"

    # No name anywhere: the output is rejected (the real gateway then tries the next provider).
    bad = FakeGateway({"You convert the text of a resume": lambda user: {"contact": {}, "experience": "nope"}})
    with pytest.raises(ValueError, match="no candidate name"):
        await parse_resume(bad, "12345 67890")


# -- discrepancies ------------------------------------------------------------------


def test_dates_normalize_from_resume_formats():
    assert resume_month("Mar 2022") == "2022-03"
    assert resume_month("03/2022") == "2022-03"
    assert resume_month("2021") == "2021"
    assert resume_month("Present") is None


def test_discrepancies_are_flagged_not_resolved():
    resume = to_structured(CLASSIC_PARSED, contact_hints(LAYOUTS["classic"]))
    data = copy.deepcopy(SAMPLE_PROFILE)
    data["profile"] = data.pop("profiles")[0]
    data["experiences"] = [
        {"company": "Northwind Labs LLC", "title": "Senior Software Engineer", "start_date": "2022-03-01",
         "end_date": None, "is_current": True},
        {"company": "Contoso Digital", "title": "Junior Developer", "start_date": "2020-01-01",
         "end_date": "2022-02-01", "is_current": False},
        {"company": "Nizam LLC", "title": "Engineer", "start_date": None, "end_date": None, "is_current": False},
    ]
    data["skills"].append({"name": "PostgreSQL", "level": "none"})
    found = {d.key: d for d in find_discrepancies(resume, data)}
    assert found["title:northwindlabs"].resume_value == "Software Engineer"
    assert found["title:northwindlabs"].profile_value == "Senior Software Engineer"
    assert "dates:contosodigital" in found
    assert "dates:northwindlabs" not in found
    assert found["company:nizam"].resume_value is None
    assert "don't have it" in found["skill:postgresql"].label
    assert "skill:react" not in found  # React is in the profile.

    dismissed = find_discrepancies(resume, data, {"title:northwindlabs"})
    assert "title:northwindlabs" not in {d.key for d in dismissed}
