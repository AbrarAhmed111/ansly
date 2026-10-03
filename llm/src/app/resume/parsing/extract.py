"""
Resume Text Extraction (Word .docx only).

Tailoring edits the user's own Word document in place, so DOCX is the only
resume format: it carries the structure needed to keep the original design.
The AI never sees the file: we pull plain text out here (body, text boxes,
headers and footers, in reading order), then the structuring step turns it into
Structured Resume JSON.
"""

import re
from typing import List

from lxml import etree

from src.app.resume.docx.package import NOT_DOCX, DocxError, DocxPackage, parse_xml, w
from src.app.resume.docx.text import paragraphs, visible_text

# Fewer characters than this almost always means a scanned (image-only) resume.
MIN_TEXT_CHARS = 150
MAX_TEXT_CHARS = 40_000

NOT_WORD = "Upload your resume as a Word (.docx) file. PDF and other formats aren't supported for tailoring."


class ResumeReadError(Exception):
    """User-safe reason the file couldn't be read."""


def _clean(text: str) -> str:
    text = text.replace(" ", " ").replace("​", "").replace("\r", "\n")
    text = re.sub(r"^[ \t]*[•●▪◦‣⁃∙➢►*][ \t]*", "• ", text, flags=re.M)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    out: List[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def _lines(root: etree._Element) -> List[str]:
    out = []
    for p in paragraphs(root, text_boxes=True):
        text = visible_text(p)
        is_list = p.find(f"{w('pPr')}/{w('numPr')}") is not None
        out.append(f"• {text}" if is_list and text.strip() else text)
    return out


def docx_text(content: bytes) -> str:
    try:
        package = DocxPackage(content)
    except DocxError as e:
        raise ResumeReadError(NOT_DOCX) from e
    seen = set()
    header: List[str] = []
    footer: List[str] = []
    for name in sorted(package.parts):
        target = header if re.fullmatch(r"word/header\d*\.xml", name) else \
            footer if re.fullmatch(r"word/footer\d*\.xml", name) else None
        if target is None:
            continue
        try:
            root = parse_xml(package.parts[name])
        except etree.XMLSyntaxError:
            continue
        for line in _lines(root):
            # Page numbers and repeated first/even-page headers add nothing.
            if line.strip() and line not in seen and not re.fullmatch(r"(page\s*)?\d+(\s*of\s*\d+)?", line.strip(), re.I):
                seen.add(line)
                target.append(line)
    return "\n".join(header + _lines(package.document) + footer)


def extract_text(content: bytes) -> str:
    if not content.startswith(b"PK"):
        raise ResumeReadError(NOT_WORD)
    text = _clean(docx_text(content))
    if len(text) < MIN_TEXT_CHARS:
        raise ResumeReadError(
            "We couldn't find text in this resume. Make sure it's a Word document with real text (not a scanned image) "
            "and upload it again."
        )
    return text[:MAX_TEXT_CHARS]
