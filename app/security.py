"""URL/host validation shared by every extractor.

Two separate problems this solves:

1. **Wrong host matching.** ``"tiktok.com" in url`` matches
   ``http://169.254.169.254/?tiktok.com`` and ``https://tiktok.com.evil.example/``,
   so any URL could be routed to the TikTok extractor. Matching must compare the
   parsed hostname, not a substring of the whole URL.

2. **SSRF.** ``resolve_short()`` and the image fetchers perform a server-side
   ``requests.get()`` on a URL that came from the user. Without a guard, a request
   for ``http://127.0.0.1:9111/secret?vt.tiktok.com`` makes the server fetch an
   internal address (verified: it did). Every outbound fetch of a user-supplied URL
   must go through ``assert_public_http()``.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Iterable
from urllib.parse import urlparse


class UnsafeUrl(ValueError):
    """The URL is not a public http(s) address we are willing to fetch."""


def _host(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
    except Exception as exc:  # noqa: BLE001
        raise UnsafeUrl("URL tidak valid") from exc
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrl("URL tidak punya host")
    return host


def host_matches(url: str, domains: Iterable[str]) -> bool:
    """True when the URL's hostname IS one of ``domains`` or a subdomain of one.

    ``https://tiktok.com.evil.example/`` -> False (that host is evil.example).
    ``https://www.tiktok.com/@x/video/1`` -> True.
    """
    try:
        host = _host(url)
    except UnsafeUrl:
        return False
    return any(host == d or host.endswith("." + d) for d in domains)


def _is_private_address(ip: ipaddress._BaseAddress) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_public_http(url: str) -> str:
    """Raise ``UnsafeUrl`` unless ``url`` is http(s) pointing at a public address.

    Hostnames are resolved so a DNS name that points at 127.0.0.1 or 169.254.169.254
    is rejected too, not just literal IPs.
    """
    try:
        parsed = urlparse(url.strip())
    except Exception as exc:  # noqa: BLE001
        raise UnsafeUrl("URL tidak valid") from exc

    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrl(f"Skema tidak diizinkan: {parsed.scheme or '(kosong)'}")

    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrl("URL tidak punya host")

    # Literal IP?
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        if _is_private_address(ip):
            raise UnsafeUrl("Alamat IP internal tidak diizinkan")
        return url

    # Hostname: resolve and check every address it points at.
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise UnsafeUrl(f"Host tidak bisa di-resolve: {host}") from exc
    for info in infos:
        addr = info[4][0]
        try:
            resolved = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if _is_private_address(resolved):
            raise UnsafeUrl("Host mengarah ke alamat internal")

    return url


def safe_filename(value: str, fallback: str = "media") -> str:
    """Strip anything that could escape the downloads directory.

    Post ids come from the URL (e.g. ``/video/..%2F..%2Fetc``), so they must never be
    concatenated into a path as-is.
    """
    cleaned = "".join(ch for ch in value if ch.isalnum() or ch in "-_")
    return cleaned[:64] or fallback
