"""
Tailored Resume -> Tailored Word Document.

The AI decides what changes (the validated tailored resume); this decides how,
applying each change to a COPY of the user's original .docx in place:

- new title (headline)        -> only the changed characters, inside the original runs
- rewritten summary / bullet  -> only the changed characters, inside the original runs
- added bullet                -> a copy of the nearest bullet paragraph, new text
- removed bullet              -> the original paragraph is deleted
- skills emphasized / reduced -> the list rewritten inside its own paragraph
- jobs / projects reordered   -> the original paragraphs are moved, never recreated
- projects / awards left out  -> their original paragraphs are deleted

A change that can't be applied safely (text in a text box, a layout table, a
hyperlink in the way...) is skipped and reported, and the returned resume says
exactly what the document now says, so the diffs the user reviews match the
file they download. Nothing is ever rebuilt from an Ansly template.
"""

from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from lxml import etree

from src.app.resume.tailoring.apply import ITEM_SECTIONS
from src.app.schemas.resume import ResumeBullet, StructuredResume

from .edit import KEEP_OUT, clone_paragraph, is_removable, remove_paragraph, replace_text
from .mapping import ResumeMap, build_map, word_spans
from .package import DocxError, DocxPackage, w
from .text import locate, norm, visible_text

UNSAFE = ("Ansly couldn't safely edit this Word document's layout (for example, text inside text boxes or shapes), "
          "so no tailored file was created. Your original resume has not been changed.")
BULLET_ITEM_SECTIONS = ("experience", "projects", "education")
SECTION_WORDS = {"experience": "jobs", "projects": "projects", "skills": "skill groups", "education": "education",
                 "achievements": "achievements", "certifications": "certifications"}


@dataclass
class Skipped:
    section: str
    item: Optional[str]
    label: str


@dataclass
class DocxTailoring:
    content: bytes
    resume: StructuredResume                     # what the tailored document now says
    applied: int = 0
    skipped: List[Skipped] = field(default_factory=list)
    expected: Set[str] = field(default_factory=set)        # norm() of every paragraph Ansly wrote
    removed: Counter = field(default_factory=Counter)      # hyperlinks inside deleted paragraphs


def item_label(section: str, item) -> str:
    if section == "experience":
        return f"{item.title} at {item.company}"
    if section == "education":
        return item.institution
    if section == "skills":
        return item.label or "Skills"
    return getattr(item, "name", None) or getattr(item, "title", None) or item.id


def _attached(element: etree._Element, root: etree._Element) -> bool:
    node = element
    while node is not None:
        if node is root:
            return True
        node = node.getparent()
    return False


def _empty(element: etree._Element) -> bool:
    return (element.tag == w("p") and not visible_text(element).strip()
            and not any(el.tag in KEEP_OUT for el in element.iter())
            and element.find(f"{w('pPr')}/{w('sectPr')}") is None)


class _Tailor:
    def __init__(self, package: DocxPackage, rmap: ResumeMap, master: StructuredResume, final: StructuredResume):
        self.doc = package
        self.body = package.body
        self.m = rmap
        self.master = master
        self.final = final
        self.attempted = 0
        self.result = DocxTailoring(content=b"", resume=master)
        self.touched: List[etree._Element] = []
        # Effective state, built up from what actually reached the document.
        self.summary: Optional[str] = master.summary
        self.headline: Optional[str] = master.contact.headline
        self.texts: Dict[str, str] = {}             # bullet id -> new text
        self.added: Dict[str, ResumeBullet] = {}    # bullet id -> added bullet
        self.dropped: Set[str] = set()              # bullet ids removed
        self.skills: Dict[str, Optional[List[str]]] = {}   # group id -> new items (None = group removed)
        self.orders: Dict[str, List[str]] = {}      # section -> item ids, in the new order

    # -- bookkeeping ----------------------------------------------------------------

    def ok(self, *elements: etree._Element) -> None:
        self.result.applied += 1
        self.touched.extend(elements)

    def skip(self, section: str, item: Optional[str], label: str) -> None:
        self.result.skipped.append(Skipped(section, item, label))

    def count_removed(self, elements: List[etree._Element]) -> None:
        for el in elements:
            self.result.removed["hyperlinks"] += sum(1 for _ in el.iter(w("hyperlink")))

    def para(self, index: Optional[int]) -> Optional[etree._Element]:
        if index is None:
            return None
        el = self.m.element(index)
        return el if _attached(el, self.body) else None

    def rewrite(self, element: Optional[etree._Element], old: str, new: str) -> bool:
        if element is None:
            return False
        span = locate(visible_text(element), old)
        return span is not None and replace_text(element, span[0], span[1], new)

    # -- changes --------------------------------------------------------------------

    def apply_headline(self) -> None:
        old, new = self.master.contact.headline or "", self.final.contact.headline or ""
        if old == new:
            return
        self.attempted += 1
        element = self.para(self.m.headline)
        if new and self.rewrite(element, old, new):
            self.headline = new
            self.ok(element)
        else:
            self.skip("headline", None, "your title")

    def apply_summary(self) -> None:
        old, new = self.master.summary or "", self.final.summary or ""
        if old == new:
            return
        self.attempted += 1
        paras = [self.para(i) for i in self.m.summary]
        if not new or not paras or any(p is None for p in paras):
            return self.skip("summary", None, "your summary")
        first, rest = paras[0], paras[1:]
        if rest:
            if not all(is_removable(p) for p in rest):
                return self.skip("summary", None, "your summary")
            whole = visible_text(first)
            if not replace_text(first, *(locate(whole, whole) or (0, len(whole))), new):
                return self.skip("summary", None, "your summary")
            self.count_removed(rest)
            for p in rest:
                remove_paragraph(p)
        elif not self.rewrite(first, old, new):
            return self.skip("summary", None, "your summary")
        self.summary = new
        self.ok(first)

    def _items(self, resume: StructuredResume, section: str) -> Dict[str, object]:
        return {i.id: i for i in getattr(resume, ITEM_SECTIONS[section])}

    def apply_rewrites(self) -> None:
        for section in BULLET_ITEM_SECTIONS:
            masters = self._items(self.master, section)
            for item in getattr(self.final, ITEM_SECTIONS[section]):
                original = masters.get(item.id)
                if original is None:
                    continue
                before = {b.id: b.text for b in original.bullets}
                for b in item.bullets:
                    if b.id not in before or before[b.id] == b.text:
                        continue
                    self.attempted += 1
                    element = self.para(self.m.bullets.get(b.id))
                    if self.rewrite(element, before[b.id], b.text):
                        self.texts[b.id] = b.text
                        self.ok(element)
                    else:
                        self.skip(section, item.id, f"a rewritten bullet ({item_label(section, item)})")

    def apply_additions(self) -> None:
        for section in BULLET_ITEM_SECTIONS:
            masters = self._items(self.master, section)
            for item in getattr(self.final, ITEM_SECTIONS[section]):
                original = masters.get(item.id)
                if original is None:
                    continue
                ids = {b.id: b.text for b in original.bullets}
                templates = [b for b in original.bullets if b.id in self.m.whole and self.para(self.m.bullets.get(b.id)) is not None]
                previous: Optional[etree._Element] = None
                for b in item.bullets:
                    if b.id in ids:
                        element = self.para(self.m.bullets.get(b.id))
                        previous = element if element is not None else previous
                        continue
                    self.attempted += 1
                    label = f"a new bullet ({item_label(section, item)})"
                    # The nearest existing bullet: the one just before, else the item's first.
                    before_ids = [x.id for x in item.bullets[: item.bullets.index(b)] if x.id in ids]
                    template = next((t for t in reversed(templates) if t.id in before_ids), None) or \
                        (templates[0] if templates else None)
                    if template is None:
                        self.skip(section, item.id, label)
                        continue
                    source = self.para(self.m.bullets[template.id])
                    clone = clone_paragraph(source, locate(visible_text(source), ids[template.id]), b.text)
                    if clone is None:
                        self.skip(section, item.id, label)
                        continue
                    if previous is not None:
                        previous.addnext(clone)
                    else:
                        source.addprevious(clone)
                    previous = clone
                    self.added[b.id] = b
                    self.ok(clone)

    def apply_removals(self) -> None:
        for section in BULLET_ITEM_SECTIONS:
            finals = self._items(self.final, section)
            for original in getattr(self.master, ITEM_SECTIONS[section]):
                item = finals.get(original.id)
                if item is None:
                    continue  # The whole item is left out: handled with the section order.
                kept = {b.id for b in item.bullets}
                for b in original.bullets:
                    if b.id in kept:
                        continue
                    self.attempted += 1
                    element = self.para(self.m.bullets.get(b.id)) if b.id in self.m.whole else None
                    if element is not None and is_removable(element):
                        self.count_removed([element])
                        remove_paragraph(element)
                        self.dropped.add(b.id)
                        self.ok()
                    else:
                        self.skip(section, original.id, f"a removed bullet ({item_label(section, original)})")

    def apply_skills(self) -> None:
        finals = {g.id: g for g in self.final.skills}
        for group in self.master.skills:
            target = finals.get(group.id)
            if target is None or target.items == group.items:
                continue  # A group left out entirely is handled with the section order.
            self.attempted += 1
            ref = self.m.skills.get(group.id)
            label = f"the {(group.label or 'skills').lower()} list"
            done = False
            if ref and ref.mode == "inline":
                done = self._inline_skills(self.para(ref.paras[0]), group.items, target.items)
            elif ref and ref.mode == "lines":
                done = self._line_skills([self.para(i) for i in ref.paras], group.items, target.items)
            if done:
                self.skills[group.id] = list(target.items)
            else:
                self.skip("skills", group.id, label)

    def _inline_skills(self, element: Optional[etree._Element], old: List[str], new: List[str]) -> bool:
        if element is None or not new:
            return False
        spans = word_spans(visible_text(element), old)
        if not spans:
            return False
        text = visible_text(element)
        separator = text[spans[0][1]:spans[1][0]] if len(spans) > 1 else ", "
        if not separator.strip(" ") and len(spans) > 1 and "\t" in separator:
            return False
        if replace_text(element, spans[0][0], spans[-1][1], separator.join(new)):
            self.ok(element)
            return True
        return False

    def _line_skills(self, elements: List[Optional[etree._Element]], old: List[str], new: List[str]) -> bool:
        if not new or any(e is None for e in elements):
            return False
        parent = elements[0].getparent()
        if any(e.getparent() is not parent for e in elements) or \
                any(a.getnext() is not b for a, b in zip(elements, elements[1:])):
            return False
        by_key = {norm(s): e for s, e in zip(old, elements)}
        sequence: List[etree._Element] = []
        for skill in new:
            existing = by_key.get(norm(skill))
            if existing is not None:
                sequence.append(existing)
                continue
            clone = clone_paragraph(elements[0], locate(visible_text(elements[0]), old[0]), skill)
            if clone is None:
                return False
            sequence.append(clone)
        dropped = [e for e in elements if e not in sequence]
        if not all(is_removable(e) for e in dropped):
            return False
        position = parent.index(elements[0])
        for e in elements:
            parent.remove(e)
        for offset, e in enumerate(sequence):
            parent.insert(position + offset, e)
        self.count_removed(dropped)
        self.ok(*[e for e in sequence if e not in elements])
        return True

    # -- moving whole items ------------------------------------------------------------

    def _top(self, element: etree._Element) -> Optional[etree._Element]:
        """The body-level paragraph itself; None if it sits inside a table, content control or text box."""
        return element if element.getparent() is self.body else None

    def _item_paras(self, section: str, item) -> List[etree._Element]:
        indexes = [self.m.anchors.get(item.id)]
        if section == "skills":
            ref = self.m.skills.get(item.id)
            indexes += ref.paras if ref else []
        indexes += [self.m.bullets.get(b.id) for b in getattr(item, "bullets", [])]
        return [p for p in (self.para(i) for i in indexes if i is not None) if p is not None]

    def _blocks(self, section: str) -> Optional[Tuple[Dict[str, List[etree._Element]], List[List[etree._Element]]]]:
        """Each item's original top-level elements and the blank paragraphs that separate them."""
        items = getattr(self.master, ITEM_SECTIONS[section])
        children = list(self.body)
        position = {id(el): k for k, el in enumerate(children)}
        starts = []
        for item in items:
            paras = self._item_paras(section, item)
            tops = [self._top(p) for p in paras]
            if not tops or any(t is None for t in tops):
                return None
            starts.append(min(position[id(t)] for t in tops))
        if starts != sorted(starts) or len(set(starts)) != len(starts):
            return None
        # The section ends at the next heading, the next paragraph that belongs elsewhere, or the end of the body.
        boundaries = {id(self.m.element(i)) for i in self.m.headings}
        boundaries |= {id(self.m.element(i)) for i, owner in self.m.owner.items() if owner != section}
        end = len(children)
        for k in range(starts[-1] + 1, len(children)):
            # A section break (page setup, columns) is never moved.
            if id(children[k]) in boundaries or children[k].tag == w("sectPr") or \
                    children[k].find(f"{w('pPr')}/{w('sectPr')}") is not None:
                end = k
                break
        blocks: Dict[str, List[etree._Element]] = {}
        separators: List[List[etree._Element]] = []
        for n, item in enumerate(items):
            block = children[starts[n]:(starts[n + 1] if n + 1 < len(starts) else end)]
            if any(el.tag != w("p") and el.tag != w("tbl") for el in block):
                return None
            if any(el.find(f"{w('pPr')}/{w('sectPr')}") is not None for el in block if el.tag == w("p")):
                return None
            separator: List[etree._Element] = []
            while len(block) > 1 and _empty(block[-1]):
                separator.insert(0, block.pop())
            blocks[item.id] = block
            separators.append(separator)
        return blocks, separators

    def apply_orders(self) -> None:
        for section in ITEM_SECTIONS:
            before = [i.id for i in getattr(self.master, ITEM_SECTIONS[section])]
            after = [i.id for i in getattr(self.final, ITEM_SECTIONS[section]) if i.id in before]
            if after == before or not after:
                continue
            self.attempted += 1
            word = SECTION_WORDS[section]
            left_out = [i for i in before if i not in after]
            masters = self._items(self.master, section)
            label = (f"leaving out {', '.join(item_label(section, masters[i]) for i in left_out)}" if left_out
                     else f"the new order of your {word}")
            found = self._blocks(section)
            if found is None:
                self.skip(section, None, label)
                continue
            blocks, separators = found
            dropped = [el for i in left_out for el in blocks[i]]
            if any(el.tag != w("p") or any(x.tag in KEEP_OUT for x in el.iter()) for el in dropped):
                self.skip(section, None, label)
                continue
            region = [el for i in before for el in blocks[i]] + [el for s in separators for el in s]
            position = min(self.body.index(el) for el in region)
            sequence: List[etree._Element] = []
            for k, item_id in enumerate(after):
                sequence += blocks[item_id]
                sequence += separators[k] if k < len(after) - 1 else separators[-1]
            self.count_removed([el for el in region if el not in sequence])
            for el in region:
                self.body.remove(el)
            for offset, el in enumerate(sequence):
                self.body.insert(position + offset, el)
            self.orders[section] = after
            self.ok()

    # -- result -----------------------------------------------------------------------

    def _bullets(self, original: List[ResumeBullet], final: List[ResumeBullet]) -> List[ResumeBullet]:
        """The item's bullets as the document now has them: original order, applied edits only."""
        out: List[ResumeBullet] = []
        pending = list(original)
        for b in final:
            if b.id in self.added:
                out.append(ResumeBullet(id=b.id, text=b.text))
                continue
            if b.id not in {p.id for p in pending}:
                continue
            while pending and pending[0].id != b.id:
                gone = pending.pop(0)
                if gone.id not in self.dropped:
                    out.append(gone.model_copy())
            if pending:
                kept = pending.pop(0)
                out.append(ResumeBullet(id=kept.id, text=self.texts.get(kept.id, kept.text)))
        out += [b.model_copy() for b in pending if b.id not in self.dropped]
        return out

    def effective(self) -> StructuredResume:
        resume = self.master.model_copy(deep=True)
        resume.summary = self.summary
        resume.contact.headline = self.headline
        for section in BULLET_ITEM_SECTIONS:
            finals = self._items(self.final, section)
            for item in getattr(resume, ITEM_SECTIONS[section]):
                final = finals.get(item.id)
                item.bullets = self._bullets(item.bullets, final.bullets if final is not None else item.bullets)
        for group in resume.skills:
            if group.id in self.skills:
                group.items = list(self.skills[group.id] or [])
        for section, order in self.orders.items():
            items = {i.id: i for i in getattr(resume, ITEM_SECTIONS[section])}
            setattr(resume, ITEM_SECTIONS[section], [items[i] for i in order])
        resume.skills = [g for g in resume.skills if g.items]
        return resume

    def run(self) -> DocxTailoring:
        # Text first (paragraphs still where they were mapped), then deletions, then moves.
        self.apply_headline()
        self.apply_summary()
        self.apply_rewrites()
        self.apply_additions()
        self.apply_skills()
        self.apply_removals()
        self.apply_orders()
        if self.attempted and not self.result.applied:
            raise DocxError(UNSAFE)
        self.result.resume = self.effective()
        self.result.expected = {norm(visible_text(el)) for el in self.touched if _attached(el, self.body)}
        self.result.content = self.doc.to_bytes()
        return self.result


def tailor_docx(original: bytes, master: StructuredResume, final: StructuredResume) -> DocxTailoring:
    """Applies `final`'s differences from `master` to a copy of `original`. `original` itself is never changed."""
    package = DocxPackage(bytes(original))
    return _Tailor(package, build_map(package.body, master), master, final).run()
