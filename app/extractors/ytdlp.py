"""YouTube and Threads, both through yt-dlp.

Threads needs the community extractor plugin (yt-dlp has no built-in Threads support):
  ~/.config/yt-dlp/plugins/yt-dlp-threads  (tribixbite/yt-dlp-threads)

YouTube from a datacenter IP hits "Sign in to confirm you're not a bot". The fix is a
cookies file; point YTDLP_COOKIES at a Netscape cookies.txt and it is picked up here.
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from .base import Extractor, ExtractorError, Format, Media, ProgressCb
from . import images
from ..security import host_matches, safe_filename

try:
    import yt_dlp
except Exception as exc:  # pragma: no cover - import guard
    yt_dlp = None
    _IMPORT_ERROR = exc


def _slug(value: str) -> str:
    """Filesystem-safe fragment for format ids like ``bv*+ba/b``."""
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "fmt"


def _download_images(platform: str, media: Media, format_id: str, dest_dir: Path,
                     progress: ProgressCb) -> Path:
    """Download one image (``imgN``) or every image as a .zip.

    Shared by every platform that supports image posts, so TikTok and Threads behave
    identically and there is one place to fix naming/zip issues.
    """
    items: list[images.ImageItem] = media.raw["images"]
    # post_id berasal dari URL yang dikirim pengguna ("/video/..%2F..%2Fetc"), jadi
    # harus dibersihkan — kalau tidak, nama file bisa keluar dari folder downloads.
    raw_id = (media.raw.get("source_url", "").rstrip("/").split("/")[-1].split("?")[0]
              or "post")
    post_id = safe_filename(raw_id, "post")

    if format_id == "zip":
        total = len(items)
        blobs: list[tuple[str, bytes]] = []
        for i, item in enumerate(items, start=1):
            progress(0.05 + 0.9 * (i - 1) / total, f"Mengunduh gambar {i}/{total}…")
            try:
                blobs.append((f"{i:02d}.jpg", images.fetch_bytes(item.url)))
            except images.ImageError as exc:
                raise ExtractorError(exc.message, hint=exc.hint, code=exc.code) from exc
        progress(0.97, "Membuat file zip…")
        dest = dest_dir / f"{platform}-{post_id}-{total}gambar.zip"
        images.make_zip(blobs, dest, base_name=f"{platform}-{post_id}")
        progress(1.0, "Selesai")
        return dest

    try:
        index = int(format_id.removeprefix("img"))
    except ValueError as exc:
        raise ExtractorError("Format gambar tidak dikenal.", code="no_url") from exc
    chosen = next((it for it in items if it.index == index), None)
    if not chosen:
        raise ExtractorError("Gambar itu tidak ada di post ini.", code="no_url")

    progress(0.3, f"Mengunduh gambar {index}…")
    dest = dest_dir / f"{platform}-{post_id}-gambar{index}.jpg"
    try:
        images.fetch_image(chosen.url, dest)
    except images.ImageError as exc:
        raise ExtractorError(exc.message, hint=exc.hint, code=exc.code) from exc
    progress(1.0, "Selesai")
    return dest


class _QuietLogger:
    """Swallow yt-dlp's own console output.

    Even with ``quiet``/``no_warnings``, yt-dlp prints ``ERROR: [threads] ...`` to stderr
    when an extractor raises. We translate every failure into our own user-facing
    message, so the raw line is just noise in the server log.
    """

    def debug(self, msg: str) -> None:  # noqa: D102 - yt-dlp interface
        pass

    def info(self, msg: str) -> None:  # noqa: D102
        pass

    def warning(self, msg: str) -> None:  # noqa: D102
        pass

    def error(self, msg: str) -> None:  # noqa: D102
        pass


def _base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 3,
        "ffmpeg_location": "/usr/bin/ffmpeg",
        "logger": _QuietLogger(),
    }
    cookies = os.environ.get("YTDLP_COOKIES", "").strip()
    if cookies and Path(cookies).is_file():
        opts["cookiefile"] = cookies
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    if proxy:
        opts["proxy"] = proxy
    return opts


class _YtDlpExtractor(Extractor):
    """Shared yt-dlp plumbing; subclasses only declare hosts."""

    hosts: tuple[str, ...] = ()
    # Pesan untuk pengguna: jelaskan tindakan berikutnya, bukan detail internal (§15 design.md).
    # Detail teknis (YTDLP_COOKIES / proxy) ada di README untuk pemilik server.
    bot_check_hint = (
        "Server ini sedang tidak diizinkan mengambil video dari platform tersebut. "
        "Coba lagi nanti, atau minta pemilik server memasang kredensial yang sesuai."
    )

    def matches(self, url: str) -> bool:
        # Hostname yang tepat, bukan substring: "https://threads.com.evil.example/x"
        # tidak boleh dianggap post Threads.
        return host_matches(url, self.hosts)

    def resolve(self, url: str) -> Media:
        if yt_dlp is None:  # pragma: no cover
            raise ExtractorError(f"yt-dlp tidak terpasang: {_IMPORT_ERROR}")
        opts = {**_base_opts(), "skip_download": True}
        last: Exception | None = None
        info = None
        for attempt in range(3):
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                break
            except Exception as exc:  # noqa: BLE001
                last = exc
                msg = str(exc)
                if "Sign in to confirm" in msg or "not a bot" in msg:
                    raise ExtractorError("Platform menolak permintaan dari server ini.", hint=self.bot_check_hint, code="bot_check") from exc
                human = getattr(self, "_humanize", None)
                if human:
                    err = human(msg)
                    # Image posts / carousels: the plugin refuses them outright, so fall
                    # back to the image scraper instead of failing.
                    if err.code in ("image_post", "no_video") and self.name == "threads":
                        return self._resolve_images(url, err)
                    # Only network hiccups are worth retrying; "post deleted" is not.
                    if err.code == "network" and attempt < 2:
                        time.sleep(2 * (attempt + 1))
                        continue
                    raise err from exc
                raise ExtractorError(f"{self.label} gagal: {msg[:200]}", hint=self.bot_check_hint if self.name == "youtube" else "") from exc
        if info is None:
            raise ExtractorError(f"{self.label} gagal dihubungi.", hint="Coba lagi sebentar lagi.") from last

        if info.get("_type") == "playlist":
            entries = [e for e in (info.get("entries") or []) if e]
            if not entries:
                raise ExtractorError("Playlist kosong.")
            info = entries[0]

        formats = self._formats(info)
        if not formats:
            raise ExtractorError("Tidak ada format yang bisa diunduh (post ini mungkin hanya teks/gambar).")

        return Media(
            platform=self.name,
            title=info.get("title") or f"{self.label} media",
            author=info.get("uploader") or info.get("channel") or info.get("uploader_id") or "",
            thumbnail=info.get("thumbnail") or "",
            duration=int(info["duration"]) if info.get("duration") else None,
            formats=formats,
            raw={"info": info, "source_url": url},
        )

    def _formats(self, info: dict) -> list[Format]:
        raise NotImplementedError

    # ------------------------------------------------------------------ images
    def _resolve_images(self, url: str, original: ExtractorError) -> Media:
        """Image / carousel fallback (Threads only)."""
        try:
            post = images.threads_photo(url)
        except images.ImageError as exc:
            # Keep the original, more specific message when scraping finds nothing.
            raise original from exc
        except Exception as exc:  # noqa: BLE001 - jaringan/DNS, bukan kesalahan pengguna
            raise ExtractorError(
                "Tidak bisa menghubungi Threads.",
                hint="Koneksi sedang bermasalah. Coba lagi sebentar lagi.",
                code="network",
            ) from exc

        formats = [
            Format(id=f"img{item.index}",
                   label=f"Gambar {item.index}" + (f" · {item.width}×{item.height}" if item.width else ""),
                   ext="jpg", kind="image", thumb=item.url)
            for item in post.items
        ]
        if len(formats) > 1:
            formats.append(Format(
                id="zip", label=f"Semua gambar (.zip · {len(post.items)} file)",
                ext="zip", kind="image", note="satu file",
            ))

        return Media(
            platform=self.name,
            title=post.title,
            author=post.author,
            thumbnail=post.thumbnail,
            duration=None,
            formats=formats,
            raw={"images": post.items, "source_url": url, "kind": "photo"},
        )

    def download(self, media: Media, format_id: str, dest_dir: Path, progress: ProgressCb) -> Path:
        if media.raw.get("kind") == "photo":
            return _download_images(self.name, media, format_id, dest_dir, progress)

        info = media.raw["info"]
        source_url = media.raw["source_url"]

        def hook(d: dict) -> None:
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                frac = (done / total) if total else 0.0
                speed = d.get("speed") or 0
                msg = f"Mengunduh {frac * 100:.0f}%"
                if speed:
                    msg += f" · {speed / 1048576:.1f} MB/s"
                progress(min(0.95, 0.1 + frac * 0.85), msg)
            elif d.get("status") == "finished":
                progress(0.97, "Memproses file…")

        opts = {
            **_base_opts(),
            "format": format_id,
            # Two different formats of the same post used to write the exact same
            # filename, so the second download silently overwrote the first and an
            # already-shown download link started serving different bytes. The format
            # id is sanitised because it can contain '*', '+' and '/'.
            "outtmpl": str(dest_dir / f"{self.name}-%(id)s-{_slug(format_id)}.%(ext)s"),
            "progress_hooks": [hook],
            "merge_output_format": "mp4",
        }
        progress(0.05, "Menyiapkan…")
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                result = ydl.extract_info(source_url, download=True)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "Sign in to confirm" in msg or "not a bot" in msg:
                raise ExtractorError("Platform menolak unduhan dari server ini.", hint=self.bot_check_hint, code="bot_check") from exc
            raise ExtractorError(f"Unduhan gagal: {msg[:200]}") from exc

        path = Path(result["requested_downloads"][0]["filepath"]) if result.get("requested_downloads") else None
        if not path or not path.exists():
            matches = sorted(dest_dir.glob(f"{self.name}-{info.get('id')}-{_slug(format_id)}.*"),
                             key=lambda p: p.stat().st_mtime)
            if not matches:
                raise ExtractorError("File hasil unduhan tidak ditemukan.")
            path = matches[-1]
        progress(1.0, "Selesai")
        return path


class YouTubeExtractor(_YtDlpExtractor):
    name = "youtube"
    label = "YouTube"
    hosts = ("youtube.com", "youtu.be")

    def _formats(self, info: dict) -> list[Format]:
        out: list[Format] = []
        heights: set[int] = set()
        for f in info.get("formats") or []:
            if f.get("ext") == "mhtml":
                continue
            if f.get("vcodec") in (None, "none"):
                continue
            h = f.get("height") or 0
            if not h or h in heights:
                continue
            heights.add(h)
            size = f.get("filesize") or f.get("filesize_approx")
            note = "HDR" if "hdr" in (f.get("format_note") or "").lower() else ""
            out.append(Format(
                id=f"bv*[height<={h}]+ba/b[height<={h}]",
                label=f"{h}p" + (f" {note}" if note else ""),
                ext="mp4",
                kind="video",
                size=size,
                note=str(h),
            ))
        out.sort(key=lambda x: -int(x.note or 0))
        for f in out:
            f.note = ""
        audio = next(
            (f for f in (info.get("formats") or [])
             if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")),
            None,
        )
        out.append(Format(id="ba/b", label="Audio saja (m4a)", ext="m4a", kind="audio",
                          size=(audio or {}).get("filesize")))
        return out


class ThreadsExtractor(_YtDlpExtractor):
    name = "threads"
    label = "Threads"
    hosts = ("threads.com", "threads.net")
    bot_check_hint = (
        "Post ini tidak bisa dibaca tanpa login, atau sudah dihapus. "
        "Pastikan post-nya publik dan berisi video."
    )

    # yt-dlp/plugin errors are English + internal ("[threads] ... page data").
    # Map them to something a normal user can act on (§15 design.md).
    def _humanize(self, msg: str) -> ExtractorError:
        low = msg.lower()
        # The plugin says "This carousel post contains no videos (images are not
        # supported)" — note there is no "no downloadable video" phrasing here.
        if "no downloadable video" in low or "contains no videos" in low or "images are not supported" in low:
            if "image" in low or "carousel" in low:
                return ExtractorError(
                    "Post ini berisi gambar, bukan video.",
                    hint="Post gambar bisa diunduh lewat pilihan gambar di bawah.",
                    code="image_post",
                )
            return ExtractorError(
                "Post ini tidak berisi video.",
                hint="Pastikan tautannya mengarah ke post yang ada videonya.",
                code="no_video",
            )
        if "not found in the page data" in low or "404" in low:
            return ExtractorError(
                "Post Threads ini tidak bisa dibuka.",
                hint="Kemungkinan sudah dihapus, privat, atau hanya bisa dilihat setelah login.",
                code="not_found",
            )
        if any(s in low for s in ("timed out", "timeout", "connection", "network is unreachable",
                                  "temporary failure", "unable to download webpage")):
            # Transient: the caller should offer "Coba lagi".
            return ExtractorError(
                "Tidak bisa menghubungi Threads.",
                hint="Koneksi ke Threads sedang bermasalah. Coba lagi sebentar lagi.",
                code="network",
            )
        return ExtractorError(
            "Video Threads ini gagal diambil.",
            hint="Coba lagi sebentar lagi.",
        )

    def _formats(self, info: dict) -> list[Format]:
        """Threads exposes one progressive muxed mp4 (format_id ``101``) plus a DASH pair.

        Two measured surprises, which is why the labels carry no resolution number:
          * The plugin's metadata reports half the real size — a post listed as 360x546
            downloads as 720x1092, and one listed as 608x360 downloads as 1216x720.
            A label built from ``height`` would therefore be wrong.
          * The progressive file is already the best rendition (and already has audio).
            The DASH merge produced 360x546 / 802 KB where progressive gave
            720x1092 / 2.2 MB, so it is only offered when metadata says it is bigger.
        """
        out: list[Format] = []
        allf = info.get("formats") or []
        progressive = next((f for f in allf if str(f.get("format_id")) == "101"), None)
        vids = [f for f in allf if f.get("vcodec") not in (None, "none")]
        best_dash = max(vids, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0)) if vids else None

        prog_h = (progressive or {}).get("height") or 0
        dash_h = (best_dash or {}).get("height") or 0

        if progressive:
            out.append(Format(
                id="101",
                label="Video (audio+video)",
                ext="mp4", kind="video", size=progressive.get("filesize"),
            ))

        # Only advertise the merge when it is genuinely a higher resolution.
        if best_dash and dash_h > prog_h:
            out.append(Format(
                id="bv*+ba/b",
                label="Video (audio digabung)",
                ext="mp4", kind="video", note="perlu proses tambahan",
            ))

        if not out:
            out.append(Format(id="b", label="Video", ext="mp4", kind="video"))
        return out

