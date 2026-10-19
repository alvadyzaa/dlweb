"""FastAPI app: resolve a URL, then download it in the background with progress."""
from __future__ import annotations

import threading
import time
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .extractors import SUPPORTED, ExtractorError, pick
from .jobs import store
from .security import assert_public_http, UnsafeUrl

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS = BASE_DIR.parent / "downloads"
DOWNLOADS.mkdir(exist_ok=True)

app = FastAPI(title="Multi Downloader", version="0.1.0")

# --- rate limit sederhana (per IP) ------------------------------------------------
# Tanpa ini satu klien bisa menghabiskan kuota snaptik/tikwm dan memenuhi disk.
# Batasnya sengaja longgar: satu pengguna wajar butuh beberapa resolve + unduhan.
RATE_WINDOW = 60.0          # detik
RATE_MAX_RESOLVE = 20       # resolve per menit per IP
RATE_MAX_DOWNLOAD = 10      # unduhan per menit per IP
_rate_buckets: dict[tuple[str, str], list[float]] = {}
_rate_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    # Di belakang reverse proxy, X-Forwarded-For diisi proxy; ambil entri pertama.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request, kind: str = "resolve") -> JSONResponse | None:
    """Return a 429 response when the caller exceeds its per-minute budget."""
    cap = RATE_MAX_DOWNLOAD if kind == "download" else RATE_MAX_RESOLVE
    key = (_client_ip(request), kind)
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_buckets.get(key, []) if now - t < RATE_WINDOW]
        if len(hits) >= cap:
            _rate_buckets[key] = hits
            retry = int(RATE_WINDOW - (now - hits[0])) + 1
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry)},
                content={
                    "error": "Terlalu banyak permintaan.",
                    "hint": f"Coba lagi dalam {retry} detik.",
                    "code": "rate_limited",
                },
            )
        hits.append(now)
        _rate_buckets[key] = hits
    return None


class ResolveIn(BaseModel):
    url: str = Field(min_length=5, max_length=2000)


class DownloadIn(BaseModel):
    token: str
    format_id: str = "nowm"


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "extractors": SUPPORTED}


@app.post("/api/resolve")
def resolve(body: ResolveIn, request: Request):
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL harus diawali http:// atau https://")
    limit = rate_limit(request)
    if limit is not None:
        return limit
    # Tolak lebih awal URL yang mengarah ke jaringan internal. Ini lapisan pertama;
    # setiap fetch keluar (resolve_short, fetch gambar) juga memvalidasi sendiri.
    try:
        assert_public_http(url)
    except UnsafeUrl as exc:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Tautan ini tidak bisa diproses.",
                "hint": "Gunakan tautan publik dari TikTok atau Threads.",
                "code": "unsafe_url",
            },
        )
    try:
        extractor = pick(url)
        media = extractor.resolve(url)
    except ExtractorError as exc:
        return JSONResponse(status_code=422, content={"error": exc.message, "hint": exc.hint, "code": exc.code})
    except (requests.RequestException, OSError) as exc:
        # Jaringan/DNS bermasalah, bukan kesalahan pengguna. Jangan balas 500:
        # UI memakai kode ini untuk menawarkan "Coba lagi".
        return JSONResponse(status_code=503, content={
            "error": "Tidak bisa menghubungi platform.",
            "hint": "Koneksi server sedang bermasalah. Coba lagi sebentar lagi.",
            "code": "network",
        })
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": f"Kesalahan tak terduga: {str(exc)[:200]}", "hint": "", "code": "internal"})

    token = store.add_resolution(media)
    return media.public(token)


@app.post("/api/download")
def start_download(body: DownloadIn, request: Request):
    limit = rate_limit(request, "download")
    if limit is not None:
        return limit
    res = store.get_resolution(body.token)
    if not res:
        raise HTTPException(410, "Sesi kedaluwarsa — paste ulang linknya.")
    media = res.media
    if body.format_id not in {f.id for f in media.formats}:
        raise HTTPException(400, "Format tidak dikenal untuk media ini.")

    extractor = pick(media.raw.get("source_url", ""))
    job = store.create_job(body.token, media.platform, body.format_id)

    def run() -> None:
        store.update(job.id, status="running", message="Mulai…")
        try:
            path = extractor.download(
                media, body.format_id, DOWNLOADS,
                lambda frac, msg: store.update(job.id, progress=frac, message=msg),
            )
            size = path.stat().st_size
            store.update(job.id, status="done", progress=1.0, message="Selesai",
                         file=path, filename=path.name, size=size, finished=time.time())
        except ExtractorError as exc:
            store.update(job.id, status="error", message=exc.message, error=exc.message,
                         hint=exc.hint, finished=time.time())
        except Exception as exc:  # noqa: BLE001
            store.update(job.id, status="error", message="Gagal", error=str(exc)[:300],
                         finished=time.time())

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job.id}


@app.get("/api/job/{job_id}")
def job_status(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job tidak ditemukan")
    return job.public()


@app.get("/api/file/{job_id}")
def get_file(job_id: str):
    job = store.get_job(job_id)
    if not job or job.status != "done" or not job.file or not job.file.exists():
        raise HTTPException(404, "File tidak tersedia atau sudah kedaluwarsa")
    return FileResponse(job.file, filename=job.filename, media_type="application/octet-stream")


@app.on_event("startup")
def _startup() -> None:
    def sweeper() -> None:
        while True:
            for path in store.sweep():
                try:
                    path.unlink()
                except OSError:
                    pass
            time.sleep(300)

    threading.Thread(target=sweeper, daemon=True).start()


app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
