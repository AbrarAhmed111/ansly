"""
Tailored Word Document Integrity.

Runs on the finished file before anything is shown as ready. The file must open,
and everything Ansly didn't mean to change must be exactly as it was:

- every part is still there; every part except the main document is byte-identical
  (styles, numbering, headers, footers, images, theme, settings, fonts)
- every XML part parses
- tables, sections (page setup, columns), header/footer references and images are all still there
- hyperlinks are still there, except inside content the tailoring deliberately left out
- every list and style the document uses is still defined
- every paragraph says either what the original said or what Ansly validated
- every validated change is actually in the document

Any problem means the file isn't offered for download.
"""

from collections import Counter
from typing import Iterable, List, Set

from lxml import etree

from .package import DOCUMENT, DocxError, DocxPackage, parse_xml, w
from .text import norm, paragraphs, visible_text

COUNTED = {
    "tables": (w("tbl"),),
    "sections": (w("sectPr"),),
    "header and footer references": (w("headerReference"), w("footerReference")),
    "images": (w("drawing"), w("pict"), w("object")),
}


def _count(root: etree._Element, tags) -> int:
    return sum(1 for el in root.iter(*tags))


def _vals(root: etree._Element, tag: str, attr: str = "val") -> Set[str]:
    return {el.get(w(attr)) for el in root.iter(w(tag)) if el.get(w(attr))}


def _missing_refs(package: DocxPackage) -> Set[str]:
    """List and style ids the document uses but doesn't define."""
    missing: Set[str] = set()
    doc = package.document
    if "word/numbering.xml" in package.parts:
        defined = _vals(parse_xml(package.parts["word/numbering.xml"]), "num", "numId")
        missing |= {f"list {n}" for n in _vals(doc, "numId") - defined - {"0"}}
    if "word/styles.xml" in package.parts:
        defined = _vals(parse_xml(package.parts["word/styles.xml"]), "style", "styleId")
        used = _vals(doc, "pStyle") | _vals(doc, "rStyle") | _vals(doc, "tblStyle")
        missing |= {f"style {s}" for s in used - defined}
    return missing


def check_docx(original: bytes, tailored: bytes, expected: Iterable[str], required: Iterable[str],
               removed: Counter) -> List[str]:
    """Problems with `tailored` (empty when it's sound). `required` are texts the document must contain."""
    try:
        before = DocxPackage(original)
        after = DocxPackage(tailored)
    except DocxError:
        return ["the tailored file doesn't open as a Word document"]
    problems: List[str] = []

    if set(before.parts) != set(after.parts):
        problems.append(f"parts changed: {sorted(set(before.parts) ^ set(after.parts))}")
    for name, data in before.parts.items():
        if name != DOCUMENT and after.parts.get(name) != data:
            problems.append(f"{name} changed")
    for name, data in after.parts.items():
        if name.endswith((".xml", ".rels")):
            try:
                parse_xml(data)
            except etree.XMLSyntaxError:
                problems.append(f"{name} isn't valid XML")

    for label, tags in COUNTED.items():
        if _count(before.document, tags) != _count(after.document, tags):
            problems.append(f"{label} changed")
    links = _count(before.document, (w("hyperlink"),)) - removed.get("hyperlinks", 0)
    if _count(after.document, (w("hyperlink"),)) != links:
        problems.append("hyperlinks changed")
    if (len(before.body) and before.body[-1].tag == w("sectPr")) != (len(after.body) and after.body[-1].tag == w("sectPr")):
        problems.append("page setup moved")
    new_missing = _missing_refs(after) - _missing_refs(before)
    if new_missing:
        problems.append(f"undefined {', '.join(sorted(new_missing))}")

    original_keys = {norm(visible_text(p)) for p in paragraphs(before.document, text_boxes=True)}
    allowed = original_keys | set(expected)
    keys = [norm(visible_text(p)) for p in paragraphs(after.document, text_boxes=True)]
    unexpected = [k for k in keys if k not in allowed]
    if unexpected:
        problems.append(f"{len(unexpected)} paragraph(s) with text that wasn't validated")
    text = " ".join(keys)
    absent = [r for r in required if norm(r) and norm(r) not in text]
    if absent:
        problems.append(f"{len(absent)} validated change(s) missing from the document")
    return problems
