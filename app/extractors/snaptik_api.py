"""snaptik.app extract API client (reverse-engineered, undocumented).

Endpoints (found in https://snaptik.app/js/core.min.js):
  POST /api/token              -> {"id", "p"}  (p = base64 AES-256-CBC blob)
  GET  /api/extract?url=<u>    -> {"success":true,"data":{...}}   header X-Verify
  GET  /api/hd?token=<t>       -> {"error":false,"url": "<direct mp4>"}   (needs X-Verify too)

X-Verify = f"{id}:{challenge_answer}:{_e}:{_h}"
key = sha256("sn4pt1k_v3r1fy2026:" + id), iv = first 16 bytes of decoded p
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
from typing import Any, Optional

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

BASE = "https://snaptik.app"
LOCALE_PATH = "/en3"
KEY_SEED = "sn4pt1k_v3r1fy2026"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
AJAX = {"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}{LOCALE_PATH}"}


def _solve(t: dict) -> int:
    kind = t["t"]
    if kind == "b":
        return ((t["a"] ^ t["b"]) >> t["s"]) & 255
    if kind == "r":
        return sum(t["n"]) * 2 + 1
    if kind == "c":
        return ord(t["w"][t["i"]]) * t["m"]
    if kind == "m":
        return ((t["a"] + t["b"]) % 100) * t["c"]
    if kind == "n":
        return t["a"] * t["b"] + t["b"] * t["c"] + t["c"] * t["a"] - t["a"]
    raise ValueError(f"unknown challenge type {kind!r}")


def _decrypt(tid: str, payload_b64: str) -> dict:
    raw = base64.b64decode(payload_b64)
    iv, blob = raw[:16], raw[16:]
    key = hashlib.sha256(f"{KEY_SEED}:{tid}".encode()).digest()
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    plain = dec.update(blob) + dec.finalize()
    return json.loads(plain[:-plain[-1]].decode())


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    s.get(f"{BASE}{LOCALE_PATH}", timeout=30)  # locale + __cflb cookies
    return s


class PermanentError(RuntimeError):
    """The platform says this media does not exist — retrying cannot help."""


# UA desktop: TikTok membalas 302 dengan Location berisi URL video.
# Dengan UA iPhone/curl, TikTok membalas 302 ke /status?status=7 (halaman "link
# tidak valid") — jadi urutan UA ini bukan preferensi, melainkan syarat.
_SHORT_UA = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    UA,
]


def resolve_short(url: str, attempts: int = 3) -> Optional[str]:
    """Follow a vt./vm.tiktok.com redirect to the canonical /@user/video/<id> URL.

    Returns None when the redirect cannot be resolved (dead link, network hiccup).

    Two details matter here, both measured:
    * The canonical URL is read from the ``Location`` header of the first 302, not
      from the final URL after following redirects — the final hop can land on
      ``/status?status=7`` even when the Location was a perfectly good video URL.
    * The response depends on User-Agent (desktop -> video URL, iPhone/curl ->
      status page), so several UAs are tried.

    The URL is validated first: this function performs a server-side request on a
    user-supplied URL, which is an SSRF sink if left unguarded.
    """
    from ..security import UnsafeUrl, assert_public_http

    try:
        assert_public_http(url)
    except UnsafeUrl:
        return None

    def _video_url(candidate: str) -> Optional[str]:
        clean = (candidate or "").split("?")[0]
        if "/video/" in clean or "/photo/" in clean:
            return clean
        return None

    for i in range(attempts):
        for ua in _SHORT_UA:
            try:
                r = requests.get(url, timeout=25, allow_redirects=False,
                                 headers={"User-Agent": ua})
                found = _video_url(r.headers.get("Location", ""))
                if found:
                    return found
                # No usable Location: follow once and inspect the landing URL.
                if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
                    r2 = requests.get(url, timeout=25, allow_redirects=True,
                                      headers={"User-Agent": ua})
                    found = _video_url(r2.url or "")
                    if found:
                        return found
                elif r.status_code == 200:
                    found = _video_url(r.url or "")
                    if found:
                        return found
            except Exception:  # noqa: BLE001 - caller falls back to its own message
                pass
        if i < attempts - 1:
            time.sleep(1.2)
    return None


def make_verify(s: requests.Session) -> str:
    tok = s.post(f"{BASE}/api/token", json={}, headers={**AJAX, "Content-Type": "application/json"}, timeout=30).json()
    tid, payload = tok["id"], tok["p"]
    challenge = _decrypt(tid, payload)
    e, h = challenge.pop("_e"), challenge.pop("_h")
    return f"{tid}:{_solve(challenge)}:{e}:{h}"


def extract(url: str, attempts: int = 10, session: Optional[requests.Session] = None) -> dict[str, Any]:
    """Extract media info. snaptik rejects ~40% of requests with 403 'Verification failed';
    each attempt uses a fresh token (and fresh session when it keeps failing), so retrying
    is the intended path.

    A 404 means the video genuinely does not exist — that is raised immediately as
    ``PermanentError`` instead of burning every attempt (12 attempts used to take ~70s
    before showing the user an error).
    """
    last = ""
    s = session
    for i in range(attempts):
        if s is None or i % 3 == 2:
            s = new_session()
        try:
            verify = make_verify(s)
            r = s.get(f"{BASE}/api/extract", params={"url": url}, headers={**AJAX, "X-Verify": verify}, timeout=45)
        except Exception as exc:  # noqa: BLE001 - network hiccup, retry
            last = f"{type(exc).__name__}: {exc}"
            time.sleep(1.0)
            continue
        if r.status_code == 200:
            body = r.json()
            if body.get("success"):
                body["data"]["_session"] = s
                return body["data"]
            last = json.dumps(body)[:200]
        elif r.status_code == 404:
            raise PermanentError(r.text[:160])
        else:
            last = f"HTTP {r.status_code} {r.text[:160]}"
        time.sleep(1.0)
    raise RuntimeError(f"snaptik extract failed after {attempts} attempts: {last}")


def hd_url(data: dict, verify_session: Optional[requests.Session] = None) -> Optional[str]:
    """Resolve /api/hd (relative token URL) into a direct mp4 URL."""
    rel = data.get("hdDownloadUrl")
    if not rel:
        return None
    s = verify_session or data.get("_session") or new_session()
    for _ in range(5):
        try:
            verify = make_verify(s)
            r = s.get(BASE + rel, headers={**AJAX, "X-Verify": verify, "Accept": "*/*"}, timeout=45)
            if r.status_code == 200 and "json" in (r.headers.get("content-type") or ""):
                body = r.json()
                if body.get("error") is False:
                    return body.get("url")
        except Exception:
            pass
        time.sleep(1.0)
    return None


def download(url: str, dest: str, session: Optional[requests.Session] = None,
             attempts: int = 8) -> int:
    """Stream ``url`` to ``dest``.

    The rapidcdn CDN intermittently answers 400 for a perfectly valid token (same URL
    succeeds on the next try), so a single attempt is not enough. Partial files are
    removed before each retry to avoid returning a truncated mp4.

    A 400 whose body is ``Invalid url`` is different: the token itself has been
    rejected, and retrying the SAME url will keep failing (measured 8/8 failures).
    ``download_hd`` handles that case by asking snaptik for a fresh url.
    """
    s = session or new_session()
    last: Exception | None = None
    for i in range(attempts):
        try:
            with s.get(url, stream=True, timeout=180, headers={"Referer": f"{BASE}/"}) as r:
                if r.status_code == 400 and "invalid url" in (r.text or "").lower():
                    raise InvalidUrl(r.text[:80])
                r.raise_for_status()
                n = 0
                with open(dest, "wb") as fh:
                    for chunk in r.iter_content(1 << 16):
                        fh.write(chunk)
                        n += len(chunk)
            if n == 0:
                raise RuntimeError("empty response")
            return n
        except InvalidUrl:
            # Do not waste the remaining attempts on a dead token.
            try:
                os.remove(dest)
            except OSError:
                pass
            raise
        except Exception as exc:  # noqa: BLE001 - retry transient CDN refusals
            last = exc
            try:
                os.remove(dest)
            except OSError:
                pass
            if i < attempts - 1:
                time.sleep(1.2)
    raise RuntimeError(f"download failed after {attempts} attempts: {last}")


class InvalidUrl(RuntimeError):
    """The CDN rejected the token itself — a new token is required."""


def download_hd(data: dict, dest: str, attempts: int = 3) -> int:
    """Download the HD rendition, re-resolving the token when it gets rejected.

    ``/api/hd`` hands out short-lived tokens. If the CDN answers ``Invalid url``, the
    only fix is a fresh token from ``hd_url``; retrying the old one never works.
    """
    session = data.get("_session")
    last: Exception | None = None
    for i in range(attempts):
        url = hd_url(data, session)
        if not url:
            last = RuntimeError("hd_url returned nothing")
            time.sleep(1.0)
            continue
        try:
            return download(url, dest, session)
        except InvalidUrl as exc:
            last = exc
            time.sleep(1.0)
            continue
    raise RuntimeError(f"hd download failed after {attempts} fresh tokens: {last}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.tiktok.com/@tiktok/video/7106594312292453675"
    d = extract(target)
    d.pop("_session", None)
    print(json.dumps(d, indent=1, ensure_ascii=False))
