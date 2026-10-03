"""
Builds minimal DOCX resume files for tests, plus sample resume layouts.
(tests/docx_files.py builds richly formatted ones.)
"""

import io
import zipfile
from typing import List, Tuple
from xml.sax.saxutils import escape

# Three common layouts: ALL-CAPS headings, "Heading:" with alternative names, and skills-first.
LAYOUTS = {
    "classic": """SAM RIVERA
sam.rivera@example.com | +1 555 010 0100 | Austin, TX | github.com/example-sam

SUMMARY
Full stack engineer building web applications with React and Node.js.

EXPERIENCE
Software Engineer, Northwind Labs — Mar 2022 – Present
• Built web applications using React and Node.js.
• Reduced API response times by 35% by adding PostgreSQL indexes.

Junior Developer, Contoso Digital — Jun 2020 – Feb 2022
• Maintained marketing sites and internal dashboards.

PROJECTS
TaskBoard — open-source collaboration tool (Next.js, Supabase)

SKILLS
TypeScript, JavaScript, Python, React, Node.js, PostgreSQL

EDUCATION
State University — B.S. Computer Science, 2016 – 2020
""",
    "colon_headings": """Alex Chen
alex.chen@example.com
(555) 010-0199
linkedin.com/in/example-alex

Professional Profile:
Backend developer focused on APIs and data pipelines.

Work History:
Data Engineer at Fabrikam (2021 - 2024)
- Built Airflow pipelines loading 2 TB of data daily into Snowflake.
- Wrote dbt models for finance reporting.

Technical Skills:
Python, SQL, Airflow, dbt, Snowflake

Certifications:
AWS Certified Cloud Practitioner, 2022

Languages:
English, Mandarin
""",
    "skills_first": """Priya Patel | Product Designer | priya@example.com | +44 20 7946 0958

Core Competencies
Figma, Prototyping, User Research, Design Systems

Employment
Senior Product Designer — Litware (Jan 2020 – Present)
Led the redesign of the onboarding flow used by 1M users.

Awards
Design Award 2021

Education
Royal College of Art, MA Design
""",
}


def make_docx(paragraphs: List[Tuple[str, bool]]) -> bytes:
    """A minimal valid DOCX: (text, is_list_item) per paragraph."""
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = []
    for text, is_list in paragraphs:
        ppr = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' if is_list else ""
        body.append(f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{"".join(body)}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml",
                         '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                         '<Default Extension="xml" ContentType="application/xml"/></Types>')
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def make_layout_docx(text: str) -> bytes:
    """One paragraph per line; "•"/"-" lines become real list items."""
    out = []
    for line in text.split("\n"):
        stripped = line.lstrip("•- ").strip()
        out.append((stripped, stripped != line.strip() and bool(stripped)))
    return make_docx(out)


# What a well-behaved model returns for LAYOUTS["classic"] (verbatim copies only).
CLASSIC_PARSED = {
    "contact": {"name": "SAM RIVERA", "headline": None, "email": "sam.rivera@example.com", "phone": "+1 555 010 0100",
                "location": "Austin, TX", "links": [{"label": "GitHub", "url": "github.com/example-sam"}]},
    "summary": "Full stack engineer building web applications with React and Node.js.",
    "experience": [
        {"company": "Northwind Labs", "title": "Software Engineer", "location": None, "startDate": "Mar 2022",
         "endDate": "Present", "isCurrent": True,
         "bullets": ["Built web applications using React and Node.js.",
                     "Reduced API response times by 35% by adding PostgreSQL indexes."], "technologies": []},
        {"company": "Contoso Digital", "title": "Junior Developer", "location": None, "startDate": "Jun 2020",
         "endDate": "Feb 2022", "isCurrent": False, "bullets": ["Maintained marketing sites and internal dashboards."],
         "technologies": []},
    ],
    "projects": [{"name": "TaskBoard", "role": None, "url": None, "startDate": None, "endDate": None,
                  "bullets": ["open-source collaboration tool"], "technologies": ["Next.js", "Supabase"]}],
    "skills": [{"label": None, "items": ["TypeScript", "JavaScript", "Python", "React", "Node.js", "PostgreSQL"]}],
    "education": [{"institution": "State University", "degree": "B.S.", "fieldOfStudy": "Computer Science",
                   "startDate": "2016", "endDate": "2020", "grade": None, "bullets": []}],
    "achievements": [], "certifications": [], "customSections": [],
}
