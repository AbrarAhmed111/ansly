"""
Builds realistic Word resumes for tests: custom fonts, sizes and colors, mixed
bold/italic runs, real numbered bullets, a header and footer, a logo image,
hyperlinks, a skills table and a two-column section. Optionally the summary
sits in a text box (stored twice, like Word does).
"""

import io
import zipfile
from typing import List, Optional
from xml.sax.saxutils import escape

from src.app.schemas.resume import StructuredResume

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NAMESPACES = (
    f'xmlns:w="{W_NS}" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
    'mc:Ignorable="w14"'
)

# A 1x1 transparent PNG.
LOGO = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)

BODY_FONT = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:color w:val="1F2937"/><w:sz w:val="21"/>'
BULLET_PPR = ('<w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
              '<w:spacing w:after="40" w:line="264" w:lineRule="auto"/><w:ind w:left="360" w:hanging="216"/></w:pPr>')


def run(text: str, props: str = BODY_FONT) -> str:
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def para(content: str, ppr: str = "", para_id: Optional[str] = None) -> str:
    attrs = f' w14:paraId="{para_id}"' if para_id else ""
    return f"<w:p{attrs}>{ppr}{content}</w:p>"


def heading(text: str) -> str:
    return para(run(text.upper(), '<w:b/><w:color w:val="2E5597"/><w:sz w:val="24"/>'),
                '<w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="200" w:after="60"/></w:pPr>')


def link(text: str, rid: str) -> str:
    return (f'<w:hyperlink r:id="{rid}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>{BODY_FONT}</w:rPr>'
            f'<w:t>{escape(text)}</w:t></w:r></w:hyperlink>')


def bullet(text: str, n: int) -> str:
    """Bullet 2 of every item has a bold metric; bullet 3 is italic; the rest are plain."""
    if n == 2 and "35%" in text:
        head, _, tail = text.partition("35%")
        content = run(head) + run("35%", f"<w:b/>{BODY_FONT}") + run(tail)
    elif n == 3:
        content = run(text, f"<w:i/>{BODY_FONT}")
    else:
        content = run(text)
    return para(content, BULLET_PPR, para_id=f"{abs(hash(text)) % 0xFFFFFFF:08X}")


def blank() -> str:
    return para("", '<w:pPr><w:spacing w:after="0"/></w:pPr>')


def logo() -> str:
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="457200" cy="457200"/>'
        '<wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )


def text_box(paragraph: str) -> str:
    """A paragraph anchoring a text box: the modern copy and the VML fallback, as Word saves it."""
    return para(
        '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:extent cx="5000000" cy="600000"/>'
        '<wp:docPr id="2" name="Summary box"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        f'<wps:wsp><wps:txbx><w:txbxContent>{paragraph}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp>'
        '</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>'
        f'<mc:Fallback><w:pict><v:rect><v:textbox><w:txbxContent>{paragraph}</w:txbxContent></v:textbox></v:rect></w:pict>'
        '</mc:Fallback></mc:AlternateContent></w:r>'
    )


def dates(start: Optional[str], end: Optional[str]) -> str:
    return " – ".join(x for x in [start, end] if x)


def document(resume: StructuredResume, summary_in_text_box: bool = False) -> str:
    c = resume.contact
    out: List[str] = [
        para(logo() + run(c.name, '<w:b/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:color w:val="2E5597"/><w:sz w:val="40"/>'),
             '<w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr>'),
        *([para(run(c.headline, f"<w:i/>{BODY_FONT}"), '<w:pPr><w:jc w:val="center"/></w:pPr>')] if c.headline else []),
        para(run(" | ".join(x for x in [c.email, c.phone, c.location] if x) + " | ") + link("github.com/example-sam", "rIdGitHub"),
             '<w:pPr><w:jc w:val="center"/></w:pPr>'),
    ]
    if resume.summary:
        out.append(heading("Summary"))
        summary = para(run(resume.summary), '<w:pPr><w:spacing w:after="120"/></w:pPr>')
        out.append(text_box(summary) if summary_in_text_box else summary)
    if resume.experience:
        out.append(heading("Experience"))
        for k, job in enumerate(resume.experience):
            if k:
                out.append(blank())
            out.append(para(run(f"{job.title}, {job.company}", f"<w:b/>{BODY_FONT}") + '<w:r><w:tab/></w:r>'
                            + run(dates(job.start_date, job.end_date), f"<w:i/>{BODY_FONT}"),
                            '<w:pPr><w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs><w:keepNext/></w:pPr>'))
            out += [bullet(b.text, n) for n, b in enumerate(job.bullets, start=1)]
    if resume.projects:
        out.append(heading("Projects"))
        for k, project in enumerate(resume.projects):
            if k:
                out.append(blank())
            line = run(project.name + (f" — {project.role}" if project.role else ""), f"<w:b/>{BODY_FONT}")
            if project.url:
                line += run(" · ") + link(project.url.removeprefix("https://"), "rIdProject")
            out.append(para(line))
            out += [bullet(b.text, n) for n, b in enumerate(project.bullets, start=1)]
    # A continuous section break: the skills section below is laid out in two columns.
    out.append(para("", '<w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>'
                        '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/>'
                        '<w:cols w:space="720"/></w:sectPr></w:pPr>'))
    if resume.skills:
        out.append(heading("Skills"))
        rows = "".join(
            f'<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>'
            f'{para(run((g.label or "Skills") + ": ", f"<w:b/>{BODY_FONT}") + run(", ".join(g.items)))}</w:tc></w:tr>'
            for g in resume.skills
        )
        out.append(f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>'
                   f'<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>{rows}</w:tbl>')
    if resume.education:
        out.append(heading("Education"))
        for edu in resume.education:
            degree = ", ".join(x for x in [edu.degree, edu.field_of_study] if x)
            out.append(para(run(f"{edu.institution} — {degree}", f"<w:b/>{BODY_FONT}") + '<w:r><w:tab/></w:r>'
                            + run(dates(edu.start_date, edu.end_date), f"<w:i/>{BODY_FONT}")))
    if resume.achievements:
        out.append(heading("Achievements"))
        for ach in resume.achievements:
            out.append(para(run(ach.title + (f" ({ach.date})" if ach.date else ""), f"<w:b/>{BODY_FONT}")
                            + (run(f": {ach.description}") if ach.description else "")))
    for section in resume.custom_sections:
        out.append(heading(section.heading))
        out += [bullet(b.text, 1) for b in section.bullets]
    out.append(
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>'
        '<w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/>'
        '<w:cols w:num="2" w:space="720"/></w:sectPr>'
    )
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {NAMESPACES}><w:body>'
            f'{"".join(out)}</w:body></w:document>')


STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="2E5597"/></w:pBdr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>"""

NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{W_NS}">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/>
<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="216"/></w:pPr><w:rPr><w:color w:val="2E5597"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"""

HEADER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="{W_NS}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="808080"/><w:sz w:val="16"/></w:rPr><w:t>Confidential resume</w:t></w:r></w:p></w:hdr>"""

FOOTER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="{W_NS}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r>
<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>"""

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>
<Relationship Id="rIdGitHub" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/example-sam" TargetMode="External"/>
<Relationship Id="rIdProject" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/example-sam/taskboard" TargetMode="External"/>
</Relationships>"""


def resume_docx(resume: StructuredResume, summary_in_text_box: bool = False) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", ROOT_RELS)
        archive.writestr("word/document.xml", document(resume, summary_in_text_box))
        archive.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        archive.writestr("word/styles.xml", STYLES)
        archive.writestr("word/numbering.xml", NUMBERING)
        archive.writestr("word/header1.xml", HEADER)
        archive.writestr("word/footer1.xml", FOOTER)
        archive.writestr("word/media/logo.png", LOGO)
    return buffer.getvalue()
