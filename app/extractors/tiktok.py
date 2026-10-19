"""TikTok via snaptik.app's internal API, with tikwm as the photo/carousel source.

yt-dlp's TikTok extractor is currently broken ("Unable to extract universal data for
rehydration") and snaptik is the more reliable path for videos, so videos do NOT go
through yt-dlp. snaptik is video-only (HTTP 404 on /photo/), so photo posts and
carousels are fetched from tikwm instead.
"""
from __future__ import annotations

from pathlib import Path

from .base import Extractor, ExtractorError, Format, Media, ProgressCb
from . import images, snaptik_api
from .ytdlp import _download_images
from ..security import host_matches, safe_filename

_HOSTS = ("tiktok.com", "douyin.com")

# Domain pemendek tautan. Selain vt./vm. milik TikTok sendiri, ada juga domain
# pihak ketiga yang dipakai aplikasi modifikasi TikTok (mis. tt.site) — semuanya
# hanya berfungsi sebagai 301 ke tiktok.com/<user>/video/<id>.
_SHORT_HOSTS = (
    "vt.tiktok.com",
    "vm.tiktok.com",
    "t.tiktok.com",
    "vt.tiktokv.com",
    "tt.site",
)


class TikTokExtractor(Extractor):
    name = "tiktok"
    label = "TikTok"

    def matches(self, url: str) -> bool:
        # Cocokkan hostname, bukan substring seluruh URL: substring membuat
        # "http://169.254.169.254/?tiktok.com" dianggap URL TikTok.
        return host_matches(url, _HOSTS) or host_matches(url, _SHORT_HOSTS)

    def resolve(self, url: str) -> Media:
        target = url.strip()

        # Link pendek (vt./vm.tiktok.com, tt.site, ...) adalah 301 ke URL penuh.
        # Follow dulu, jangan tolak — pengguna tidak selalu bisa menyalin URL panjang.
        if host_matches(target, _SHORT_HOSTS):
            resolved = snaptik_api.resolve_short(target)
            if not resolved:
                raise ExtractorError(
                    "Link pendek TikTok tidak bisa dibuka.",
                    hint="Buka link pendeknya di browser sampai videonya terbuka, lalu salin URL "
                         "penuh dari address bar (bentuknya https://www.tiktok.com/@user/video/angka).",
                    code="short_link",
                )
            # Setelah redirect, pastikan hasilnya benar-benar tiktok.com. Tanpa ini,
            # domain pemendek mana pun bisa mengarahkan kita ke host sembarang.
            if not host_matches(resolved, _HOSTS):
                raise ExtractorError(
                    "Link pendek ini tidak mengarah ke TikTok.",
                    hint="Pastikan tautannya berasal dari aplikasi TikTok.",
                    code="short_link",
                )
            target = resolved

        # Photo posts and carousels never work through snaptik, so go straight to tikwm.
        if "/photo/" in target:
            return self._resolve_photo(target)

        try:
            data = snaptik_api.extract(target, attempts=12)
        except snaptik_api.PermanentError as exc:
            raise ExtractorError(
                "Video ini tidak tersedia.",
                hint="Post-nya mungkin sudah dihapus atau dibuat privat oleh pemiliknya.",
                code="not_found",
            ) from exc
        except Exception as exc:  # noqa: BLE001 - surfaced to the user verbatim
            raise ExtractorError(
                "Video ini gagal diambil.",
                hint="Kemungkinan video privat, atau server sedang ditolak platform. "
                     "Coba lagi sebentar lagi.",
            ) from exc

        author = (data.get("author") or {}).get("username") or ""
        kind = data.get("type") or "video"
        formats: list[Format] = []

        if data.get("downloadUrl"):
            formats.append(Format(id="nowm", label="Video (no watermark)", ext="mp4", kind="video"))
        if data.get("hdDownloadUrl"):
            # Measured on 6 videos: /api/hd always returns the *highest resolution*
            # rendition (576x1024 -> 1080x1920, 720x1280 -> 1080x1920), but TikTok
            # encodes it in HEVC at a lower bitrate, so the file is often SMALLER.
            # For 3 of 6 videos it was byte-identical to the no-watermark file.
            # The label must therefore promise resolution, never quality or size.
            formats.append(Format(id="hd", label="Video resolusi tertinggi", ext="mp4", kind="video",
                                  note="ukuran file bisa lebih kecil"))

        if not formats:
            raise ExtractorError("Tidak ada media yang bisa diunduh di post ini.")

        # snaptik sometimes echoes the URL back as the title (seen with short links),
        # which looks broken in the UI. Fall back to something readable instead.
        title = (data.get("title") or "").strip()
        if not title or title.startswith(("http://", "https://")):
            title = f"TikTok {author}" if author else "Video TikTok"

        return Media(
            platform=self.name,
            title=title,
            author=author,
            thumbnail=data.get("thumbnail") or "",
            duration=data.get("videoDuration"),
            formats=formats,
            raw={"data": data, "source_url": target, "kind": kind},
        )

    # ------------------------------------------------------------------ photos
    def _resolve_photo(self, target: str) -> Media:
        try:
            post = images.tiktok_photo(target)
        except images.ImageError as exc:
            raise ExtractorError(exc.message, hint=exc.hint, code=exc.code) from exc

        formats = [
            Format(id=f"img{item.index}", label=f"Gambar {item.index}", ext="jpg", kind="image",
                   thumb=item.url)
            for item in post.items
        ]
        if len(formats) > 1:
            # One click instead of N downloads; the UI also lets you pick singles.
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
            raw={"images": post.items, "source_url": target, "kind": "photo"},
        )

    # ---------------------------------------------------------------- download
    def download(self, media: Media, format_id: str, dest_dir: Path, progress: ProgressCb) -> Path:
        if media.raw.get("kind") == "photo":
            return self._download_photo(media, format_id, dest_dir, progress)

        data = media.raw["data"]
        session = data.get("_session")
        progress(0.05, "Menyiapkan link unduhan…")

        if format_id == "hd":
            target = snaptik_api.hd_url(data, session)
            if not target:
                raise ExtractorError(
                    "Versi resolusi tertinggi tidak bisa diambil untuk video ini.",
                    hint="Coba pilih “Video (no watermark)”; isinya biasanya sama.",
                    code="hd_failed",
                )
        else:
            target = data.get("downloadUrl")

        if not target:
            raise ExtractorError("Link unduhan tidak tersedia.", code="no_url")

        progress(0.25, "Mengunduh…")
        dest = dest_dir / f"{self.name}-{safe_filename(str(data.get('id', '')), 'media')}-{format_id}.mp4"
        try:
            if format_id == "hd":
                # HD tokens expire: download_hd re-resolves instead of retrying a dead URL.
                snaptik_api.download_hd(data, str(dest))
            else:
                snaptik_api.download(target, str(dest), session)
        except Exception as exc:  # noqa: BLE001
            raise ExtractorError(
                "Unduhan gagal.",
                hint="Koneksi ke server penyimpanan terputus. Coba lagi.",
            ) from exc
        progress(1.0, "Selesai")
        return dest

    def _download_photo(self, media: Media, format_id: str, dest_dir: Path,
                        progress: ProgressCb) -> Path:
        return _download_images(self.name, media, format_id, dest_dir, progress)
