"""
Paragraph Text in a Word Document, run by run.

A paragraph's visible text is a list of segments: one per w:t, plus fixed
one-character segments for tabs and line breaks. Edits change segment text in
place, so every run keeps its own formatting (font, size, bold, color...).
Text inside hyperlinks and fields is locked: an edit that would touch it is
refused rather than risk breaking the link.

Text boxes are left out on purpose: Word stores them twice (a modern copy and
a VML fallback), and editing one copy silently desyncs the other.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional, Tuple

from lxml import etree

from .package import MC, w

TEXT_BOX = w("txbxContent")
FALLBACK = f"{{{MC}}}Fallback"
# Never part of the visible text: formatting, deleted (tracked) text, field codes, nested text boxes.
SKIPPED = {TEXT_BOX, FALLBACK, w("rPr"), w("pPr"), w("del"), w("delText"), w("instrText"), w("moveFrom")}
LOCKED_CONTAINERS = {w("hyperlink"), w("fldSimple")}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

_CHARS = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‐": "-",
          "‑": "-", "−": "-", " ": " ", " ": " ", " ": " ", "​": "", "﻿": "",
          "­": "", "\t": " ", "\n": " "}
_LEADING_BULLET = re.compile(r"^(?:[•●▪◦‣⁃∙➢►■□✓✔·]\s*|[*\-]\s+)")


@dataclass
class Segment:
    text: str
    node: Optional[etree._Element]   # the w:t; None for a tab or break
    locked: bool


def segments(p: etree._Element) -> List[Segment]:
    out: List[Segment] = []
    fields: List[bool] = []   # open complex fields (w:fldChar begin ... end); their result text is locked

    def visit(element: etree._Element, locked: bool) -> None:
        for child in element:
            tag = child.tag
            if not isinstance(tag, str) or tag in SKIPPED:
                continue
            if tag in LOCKED_CONTAINERS:
                visit(child, True)
            elif tag == w("fldChar"):
                kind = child.get(w("fldCharType"))
                if kind == "begin":
                    fields.append(True)
                elif kind == "end" and fields:
                    fields.pop()
            elif tag == w("t"):
                out.append(Segment(child.text or "", child, locked or bool(fields)))
            elif tag == w("tab"):
                out.append(Segment("\t", None, True))
            elif tag in (w("br"), w("cr")):
                out.append(Segment("\n", None, True))
            elif tag == w("noBreakHyphen"):
                out.append(Segment("-", None, True))
            else:
                visit(child, locked)

    visit(p, False)
    return out


def visible_text(p: etree._Element) -> str:
    return "".join(s.text for s in segments(p))


def in_text_box(element: etree._Element) -> bool:
    return any(a.tag in (TEXT_BOX, FALLBACK) for a in element.iterancestors())


def paragraphs(root: etree._Element, text_boxes: bool = False) -> List[etree._Element]:
    """Paragraphs in reading order. Fallback copies are always skipped; text boxes only if `text_boxes` is False."""
    out = []
    for p in root.iter(w("p")):
        ancestors = {a.tag for a in p.iterancestors()}
        if FALLBACK in ancestors or (not text_boxes and TEXT_BOX in ancestors):
            continue
        out.append(p)
    return out


def _norm_char(ch: str) -> str:
    return unicodedata.normalize("NFKC", _CHARS.get(ch, ch)).lower()


def norm(text: Optional[str]) -> str:
    """Comparison key: case, quotes, dashes, spacing and a leading bullet glyph don't matter."""
    s = re.sub(r"\s+", " ", "".join(_norm_char(c) for c in text or "")).strip()
    return _LEADING_BULLET.sub("", s).strip()


def locate(text: str, target: str, start_at: int = 0) -> Optional[Tuple[int, int]]:
    """(start, end) of `target` in `text`, compared by `norm`; offsets are into `text` itself."""
    chars: List[str] = []
    index: List[int] = []
    space = True
    for i, ch in enumerate(text):
        for c in _norm_char(ch):
            if c.isspace():
                if space:
                    continue
                c, space = " ", True
            else:
                space = False
            chars.append(c)
            index.append(i)
    needle = norm(target)
    if not needle:
        return None
    hay = "".join(chars)
    begin = next((k for k, i in enumerate(index) if i >= start_at), len(index))
    pos = hay.find(needle, begin)
    if pos < 0:
        return None
    return index[pos], index[pos + len(needle) - 1] + 1
