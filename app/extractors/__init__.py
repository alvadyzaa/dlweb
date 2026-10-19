"""Extractor registry: one URL in, the right backend chosen.

YouTube sengaja TIDAK didaftarkan di sini. Dari IP server ini YouTube selalu menolak
("Sign in to confirm you're not a bot" — blokir reputasi IP datacenter). Kelasnya masih
utuh di ``ytdlp.py`` dan cukup ditambahkan kembali ke ``EXTRACTORS`` untuk mengaktifkan.
"""
from __future__ import annotations

from .base import Extractor, ExtractorError
from .tiktok import TikTokExtractor
from .ytdlp import ThreadsExtractor, YouTubeExtractor  # noqa: F401  (YouTubeExtractor disimpan untuk nanti)

# Platform yang aktif. Tambahkan ``YouTubeExtractor()`` di sini untuk mengaktifkan lagi.
EXTRACTORS: list[Extractor] = [
    TikTokExtractor(),
    ThreadsExtractor(),
]

SUPPORTED = [
    {"name": e.name, "label": e.label, "hosts": list(getattr(e, "hosts", ())) or ["tiktok.com"]}
    for e in EXTRACTORS
]

_AVAILABLE_LABELS = " dan ".join(e.label for e in EXTRACTORS) or "belum ada"


def pick(url: str) -> Extractor:
    for ex in EXTRACTORS:
        if ex.matches(url):
            return ex
    # YouTube dikenal tapi sedang tidak didaftarkan -> pesan yang jujur, bukan "belum didukung".
    if YouTubeExtractor().matches(url):
        raise ExtractorError(
            "YouTube belum tersedia di sini.",
            hint=f"Server ini sedang tidak diizinkan YouTube mengambil video. "
                 f"Saat ini hanya {_AVAILABLE_LABELS}.",
            code="disabled",
        )
    raise ExtractorError(
        "Platform belum didukung.",
        hint=f"Yang tersedia sekarang: {_AVAILABLE_LABELS}.",
        code="unsupported",
    )


__all__ = ["EXTRACTORS", "SUPPORTED", "pick", "Extractor", "ExtractorError"]
