"""
Word Document Package: open a .docx, edit word/document.xml, write a copy.

The user's DOCX is the design master. Ansly only ever changes the main
document part; every other part (styles, numbering, headers, footers, media,
theme, settings, fonts) is copied byte for byte, so formatting that tailoring
doesn't touch can't change. The original bytes are never modified.
"""

import io
import zipfile
from typing import Dict, List

from lxml import etree

DOCUMENT = "word/document.xml"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NS = {"w": W, "mc": MC}

# Zip bombs: a resume is a few hundred KB; refuse anything that unpacks to more than this.
MAX_UNPACKED_BYTES = 60 * 1024 * 1024

NOT_DOCX = "This isn't a valid Word (.docx) file. Save your resume as .docx in Word or Google Docs and upload it again."


def w(tag: str) -> str:
    """Clark notation for a WordprocessingML tag: w("p") -> "{...main}p"."""
    return f"{{{W}}}{tag}"


class DocxError(Exception):
    """User-safe reason a Word document can't be read or edited."""


def _parser() -> etree.XMLParser:
    # Uploaded XML is untrusted: no entities, no network, no huge trees.
    return etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_blank_text=False)


def parse_xml(content: bytes) -> etree._Element:
    return etree.fromstring(content, _parser())


class DocxPackage:
    """A .docx in memory. `document` is the parsed main part; everything else stays as bytes."""

    def __init__(self, content: bytes):
        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
            self.infos: List[zipfile.ZipInfo] = archive.infolist()
            if sum(i.file_size for i in self.infos) > MAX_UNPACKED_BYTES:
                raise DocxError(NOT_DOCX)
            self.parts: Dict[str, bytes] = {i.filename: archive.read(i) for i in self.infos}
        except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, ValueError, RuntimeError) as e:
            raise DocxError(NOT_DOCX) from e
        if DOCUMENT not in self.parts:
            raise DocxError(NOT_DOCX)
        try:
            self.document = parse_xml(self.parts[DOCUMENT])
        except etree.XMLSyntaxError as e:
            raise DocxError(NOT_DOCX) from e
        self.body = self.document.find(w("body"))
        if self.body is None:
            raise DocxError(NOT_DOCX)

    def document_xml(self) -> bytes:
        return etree.tostring(self.document, xml_declaration=True, encoding="UTF-8", standalone=True)

    def to_bytes(self) -> bytes:
        """A new .docx: same parts in the same order and compression, with the edited main document."""
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for info in self.infos:
                data = self.document_xml() if info.filename == DOCUMENT else self.parts[info.filename]
                copy = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                copy.compress_type = info.compress_type
                copy.external_attr = info.external_attr
                archive.writestr(copy, data)
        return buffer.getvalue()


def is_docx(content: bytes) -> bool:
    try:
        DocxPackage(content)
    except DocxError:
        return False
    return True
