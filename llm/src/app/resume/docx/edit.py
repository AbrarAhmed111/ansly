"""
In-Place Paragraph Edits that keep the document's formatting.

- replace_text: changes only the characters that differ; the runs around them
  keep their font, size, bold, italics, color and highlighting, and the
  paragraph keeps its style, bullets, indentation and spacing.
- remove_paragraph: deletes the original paragraph (never one holding an image,
  a section break or a comment, or the last paragraph of a table cell).
- clone_paragraph: a new bullet copied from the nearest existing bullet, so it
  gets the same list style, indentation, spacing and run formatting.

Every function returns None/False instead of guessing when an edit isn't safe;
the caller then leaves that part of the document untouched.
"""

import copy
from typing import List, Optional, Tuple

from lxml import etree

from .package import w
from .text import XML_SPACE, Segment, segments

# Things a removed or cloned paragraph must not take with it.
KEEP_OUT = {w("drawing"), w("pict"), w("object"), w("commentRangeStart"), w("commentRangeEnd"), w("commentReference")}
BOOKMARKS = {w("bookmarkStart"), w("bookmarkEnd")}
# Per-paragraph ids Word expects to be unique (w14:paraId, w14:textId).
UNIQUE_ATTRS = {"paraId", "textId"}


def _bounds(segs: List[Segment]) -> List[Tuple[int, int]]:
    out, pos = [], 0
    for s in segs:
        out.append((pos, pos + len(s.text)))
        pos += len(s.text)
    return out


def _common_prefix(a: str, b: str) -> int:
    n = 0
    while n < len(a) and n < len(b) and a[n] == b[n]:
        n += 1
    return n


def _drop_empty(node: etree._Element) -> None:
    """Removes an emptied w:t, and its run if nothing but formatting is left."""
    run = node.getparent()
    run.remove(node)
    if run.tag == w("r") and all(c.tag == w("rPr") for c in run if isinstance(c.tag, str)):
        run.getparent().remove(run)


def replace_text(p: etree._Element, start: int, end: int, new: str, minimal: bool = True,
                 host: Optional[etree._Element] = None) -> bool:
    """Replaces visible text [start, end) with `new`. False (and no change) if it would touch locked text."""
    segs = segments(p)
    bounds = _bounds(segs)
    old = "".join(s.text for s in segs)[start:end]
    if old == new:
        return True
    s, e, insert = start, end, new
    if minimal:
        pre = _common_prefix(old, new)
        suf = _common_prefix(old[pre:][::-1], new[pre:][::-1])
        s, e, insert = start + pre, end - suf, new[pre:len(new) - suf]

    for seg, (a, b) in zip(segs, bounds):
        if (seg.locked or seg.node is None) and a < e and s < b:
            return False
        if seg.locked and s == e and a < s < b:
            return False

    editable = [(seg, a, b) for seg, (a, b) in zip(segs, bounds) if not seg.locked and seg.node is not None]
    chosen: Optional[Tuple[Segment, int, int]] = None
    if host is not None:
        chosen = next((x for x in editable if x[0].node is host), None)
    elif e > s:
        # The run holding most of the replaced text: a bold lead-in doesn't make the whole rewrite bold.
        overlaps = [(min(b, e) - max(a, s), x) for x in editable for a, b in [(x[1], x[2])] if a < e and s < b]
        chosen = max(overlaps, key=lambda o: o[0])[1] if overlaps else None
    else:
        chosen = next((x for x in editable if x[1] <= s < x[2]), None) or next((x for x in editable if x[2] == s), None)
    if insert and chosen is None:
        return False

    for seg, a, b in editable:
        text = seg.text
        lo, hi = min(max(s - a, 0), len(text)), min(max(e - a, 0), len(text))
        if chosen is not None and seg is chosen[0]:
            text = text[:lo] + insert + text[hi:]
        elif a < e and s < b:
            text = text[:lo] + text[hi:]
        else:
            continue
        if text:
            seg.node.text = text
            seg.node.set(XML_SPACE, "preserve")
        else:
            _drop_empty(seg.node)
    return True


def _holds(p: etree._Element, tags) -> bool:
    return any(el.tag in tags for el in p.iter())


def is_removable(p: etree._Element) -> bool:
    if p.find(f"{w('pPr')}/{w('sectPr')}") is not None or _holds(p, KEEP_OUT):
        return False
    parent = p.getparent()
    if parent is None:
        return False
    if parent.tag == w("tc") and len(parent.findall(w("p"))) <= 1:
        return False
    return True


def remove_paragraph(p: etree._Element) -> bool:
    if not is_removable(p):
        return False
    marks = [el for el in p.iter() if el.tag in BOOKMARKS]
    if marks:
        # Keep bookmarks (cross-references, Word's own anchors) by moving them to a neighbouring paragraph.
        neighbour = p.getprevious()
        while neighbour is not None and neighbour.tag != w("p"):
            neighbour = neighbour.getprevious()
        if neighbour is None:
            neighbour = p.getnext()
            while neighbour is not None and neighbour.tag != w("p"):
                neighbour = neighbour.getnext()
        if neighbour is None:
            return False
        for mark in marks:
            mark.getparent().remove(mark)
            neighbour.append(mark)
    p.getparent().remove(p)
    return True


def _strip_ids(p: etree._Element) -> None:
    for el in p.iter():
        for name in list(el.attrib):
            if etree.QName(name).localname in UNIQUE_ATTRS:
                del el.attrib[name]
    for el in list(p.iter()):
        if el.tag in BOOKMARKS or el.tag in (w("proofErr"), w("permStart"), w("permEnd")):
            el.getparent().remove(el)


def clone_paragraph(template: etree._Element, span: Optional[Tuple[int, int]], text: str) -> Optional[etree._Element]:
    """A detached copy of `template` whose bullet text (`span`) is `text`. None if the template can't be copied safely."""
    if template.find(f"{w('pPr')}/{w('sectPr')}") is not None:
        return None
    clone = copy.deepcopy(template)
    _strip_ids(clone)
    if span is not None and not _holds(clone, KEEP_OUT):
        segs = segments(clone)
        bounds = _bounds(segs)
        start, end = span
        candidates = [(min(b, end) - max(a, start), seg.node) for seg, (a, b) in zip(segs, bounds)
                      if not seg.locked and seg.node is not None and a < end and start < b]
        if candidates:
            host = max(candidates, key=lambda c: c[0])[1]
            if replace_text(clone, start, end, text, minimal=False, host=host):
                return clone
    # Fallback: the paragraph's own formatting plus one run formatted like its longest run.
    clone = copy.deepcopy(template)
    _strip_ids(clone)
    longest = max((s for s in segments(template) if not s.locked and s.node is not None),
                  key=lambda s: len(s.text), default=None)
    run_props = longest.node.getparent().find(w("rPr")) if longest is not None else None
    for child in list(clone):
        if child.tag != w("pPr"):
            clone.remove(child)
    run = etree.SubElement(clone, w("r"))
    if run_props is not None:
        run.append(copy.deepcopy(run_props))
    t = etree.SubElement(run, w("t"))
    t.text = text
    t.set(XML_SPACE, "preserve")
    return clone
