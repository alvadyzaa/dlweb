"""Core types shared by every extractor."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional


class ExtractorError(Exception):
    """Raised when a URL cannot be handled. ``hint`` is shown to the user as-is."""

    def __init__(self, message: str, hint: str = "", code: str = "extract_failed"):
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.code = code


@dataclass
class Format:
    id: str
    label: str
    ext: str
    kind: str = "video"          # video | audio | image
    size: Optional[int] = None
    note: str = ""
    # Untuk post gambar/carousel: URL gambar itu sendiri, supaya UI bisa menampilkan
    # thumbnail dan pengguna memilih secara visual (bukan deretan teks "Gambar 7").
    thumb: str = ""


@dataclass
class Media:
    """Everything the UI needs, plus whatever the extractor needs to fetch the file."""
    platform: str
    title: str
    author: str = ""
    thumbnail: str = ""
    duration: Optional[int] = None
    formats: list[Format] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    def public(self, token: str) -> dict:
        return {
            "token": token,
            "platform": self.platform,
            "title": self.title,
            "author": self.author,
            "thumbnail": self.thumbnail,
            "duration": self.duration,
            "formats": [
                {"id": f.id, "label": f.label, "ext": f.ext, "kind": f.kind,
                 "size": f.size, "note": f.note, "thumb": f.thumb}
                for f in self.formats
            ],
        }


ProgressCb = Callable[[float, str], None]   # (0..1, human message)


class Extractor:
    name = "base"
    label = "Base"

    def matches(self, url: str) -> bool:
        raise NotImplementedError

    def resolve(self, url: str) -> Media:
        raise NotImplementedError

    def download(self, media: Media, format_id: str, dest_dir: Path,
                 progress: ProgressCb) -> Path:
        raise NotImplementedError
