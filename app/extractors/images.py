"""Image posts and carousels (TikTok photo posts, Threads image/carousel posts).

Why this module exists:
  * snaptik returns HTTP 404 for TikTok ``/photo/`` URLs — it is video-only.
  * the yt-dlp Threads plugin raises "This carousel post contains no videos
    (images are not supported)".

So images are fetched from other sources:
  * TikTok  -> tikwm.com public API (``images`` array, 1368x2048 JPEGs)
  * Threads -> the post's own server-rendered JSON, using a Googlebot User-Agent.
               Meta renders full CDN media data for link-preview crawlers, the same
               trick the yt-dlp plugin uses for videos. Each item exposes
               ``image_versions2.candidates[]``; the largest candidate is taken.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import requests

UA_BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
UA_GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
TIKWM = "https://www.tikwm.com/api/"


@dataclass
class ImageItem:
    index: int          # 1-based, matches what the UI shows
    url: str
    width: int = 0
    height: int = 0
    is_video: bool = False

    @property
    def label(self) -> str:
        kind = "Video" if self.is_video else "Gambar"
        size = f" · {self.width}×{self.height}" if self.width and self.height else ""
        return f"{kind} {self.index}{size}"


@dataclass
class ImagePost:
    platform: str
    title: str
    author: str = ""
    thumbnail: str = ""
    items: list[ImageItem] = field(default_factory=list)
    source_url: str = ""


class ImageError(RuntimeError):
    def __init__(self, message: str, hint: str = "", code: str = "no_images"):
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.code = code


# --------------------------------------------------------------------------- TikTok
def tiktok_photo(url: str, session: Optional[requests.Session] = None) -> ImagePost:
    """Fetch a TikTok photo/slideshow post through tikwm."""
    s = session or requests.Session()
    s.headers["User-Agent"] = UA_BROWSER
    r = s.get(TIKWM, params={"url": url, "hd": 1}, timeout=45)
    try:
        body = r.json()
    except Exception as exc:  # noqa: BLE001
        raise ImageError("Post ini tidak bisa dibaca.", "Coba lagi sebentar lagi.") from exc

    if body.get("code") != 0:
        raise ImageError(
            "Post ini tidak bisa dibaca.",
            hint="Kemungkinan sudah dihapus, privat, atau tautannya bukan post TikTok.",
            code="not_found",
        )

    data = body.get("data") or {}
    images = data.get("images") or []
    if not images:
        raise ImageError("Post ini tidak berisi gambar.", code="no_images")

    author = (data.get("author") or {}).get("unique_id") or ""
    items = [
        ImageItem(index=i, url=u if isinstance(u, str) else u.get("url", ""))
        for i, u in enumerate(images, start=1)
        if (u if isinstance(u, str) else u.get("url"))
    ]

    # tikwm does not report image dimensions; ffprobe can read them from the URL,
    # but that costs a request per image. Leave them blank rather than guessing.
    return ImagePost(
        platform="tiktok",
        title=(data.get("title") or "").strip() or (f"TikTok {author}" if author else "Post TikTok"),
        author=author,
        thumbnail=data.get("cover") or "",
        items=items,
        source_url=url,
    )


# -------------------------------------------------------------------------- Threads
def _script_blocks(html: str) -> list[str]:
    return re.findall(r'<script type="application/json"[^>]*data-sjs>(.*?)</script>', html, re.S)


def _find_media_nodes(node: Any):
    """Yield every dict that carries media (image candidates or carousel items)."""
    if isinstance(node, dict):
        if isinstance(node.get("carousel_media"), list):
            yield node
        elif isinstance(node.get("image_versions2"), dict):
            yield node
        for value in node.values():
            yield from _find_media_nodes(value)
    elif isinstance(node, list):
        for value in node:
            yield from _find_media_nodes(value)


def _best_candidate(media: dict) -> Optional[dict]:
    cands = ((media.get("image_versions2") or {}).get("candidates")) or []
    if not cands:
        return None
    return max(cands, key=lambda c: (c.get("width") or 0) * (c.get("height") or 0))


def threads_photo(url: str, session: Optional[requests.Session] = None) -> ImagePost:
    """Fetch a Threads image / carousel post from its server-rendered JSON."""
    s = session or requests.Session()
    r = s.get(url, timeout=45, headers={"User-Agent": UA_GOOGLEBOT})
    if r.status_code != 200:
        raise ImageError(
            "Post Threads ini tidak bisa dibuka.",
            hint="Kemungkinan sudah dihapus, privat, atau hanya bisa dilihat setelah login.",
            code="not_found",
        )

    media = None
    for block in _script_blocks(r.text):
        try:
            obj = json.loads(block)
        except Exception:  # noqa: BLE001 - some blocks are not valid JSON
            continue
        for node in _find_media_nodes(obj):
            if isinstance(node.get("carousel_media"), list) and node["carousel_media"]:
                media = node
                break
            if _best_candidate(node):
                media = node
                break
        if media:
            break

    if not media:
        raise ImageError(
            "Post ini tidak berisi gambar.",
            hint="Pastikan tautannya mengarah ke post Threads yang ada gambarnya.",
            code="no_images",
        )

    entries = media.get("carousel_media") or [media]
    items: list[ImageItem] = []
    for i, entry in enumerate(entries, start=1):
        best = _best_candidate(entry)
        if not best:
            continue
        items.append(ImageItem(
            index=len(items) + 1,
            url=best.get("url", ""),
            width=int(best.get("width") or 0),
            height=int(best.get("height") or 0),
            is_video=bool(entry.get("video_versions")),
        ))

    if not items:
        raise ImageError("Post ini tidak berisi gambar.", code="no_images")

    user = ((media.get("user") or {}).get("username")) or ""
    caption = ((media.get("caption") or {}).get("text")) or ""
    title = caption.strip().splitlines()[0][:120] if caption.strip() else (
        f"Threads {user}" if user else "Post Threads"
    )
    thumb = _best_candidate(media)
    return ImagePost(
        platform="threads",
        title=title,
        author=user,
        thumbnail=(thumb or {}).get("url", ""),
        items=items,
        source_url=url,
    )


# ------------------------------------------------------------------------ download
def fetch_image(url: str, dest: Path, session: Optional[requests.Session] = None,
                attempts: int = 4) -> Path:
    s = session or requests.Session()
    s.headers.setdefault("User-Agent", UA_BROWSER)
    last: Exception | None = None
    for i in range(attempts):
        try:
            with s.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "wb") as fh:
                    for chunk in r.iter_content(1 << 16):
                        fh.write(chunk)
            if dest.stat().st_size == 0:
                raise RuntimeError("empty file")
            return dest
        except Exception as exc:  # noqa: BLE001 - CDN hiccups
            last = exc
            try:
                dest.unlink()
            except OSError:
                pass
            if i < attempts - 1:
                import time as _t
                _t.sleep(1.0)
    raise ImageError("Gagal mengunduh gambar.", hint="Coba lagi sebentar lagi.") from last


def fetch_bytes(url: str, session: Optional[requests.Session] = None,
                attempts: int = 4) -> bytes:
    s = session or requests.Session()
    s.headers.setdefault("User-Agent", UA_BROWSER)
    last: Exception | None = None
    for i in range(attempts):
        try:
            r = s.get(url, timeout=120)
            r.raise_for_status()
            if not r.content:
                raise RuntimeError("empty body")
            return r.content
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i < attempts - 1:
                import time as _t
                _t.sleep(1.0)
    raise ImageError("Gagal mengunduh gambar.", hint="Coba lagi sebentar lagi.") from last


def make_zip(items: list[tuple[str, bytes]], zip_path: Path, base_name: str) -> Path:
    """Bundle downloaded images into a single .zip (no re-compression of JPEG/WebP)."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, blob in items:
            zf.writestr(f"{base_name}/{name}", blob)
    return zip_path
