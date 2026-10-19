"""In-memory job store: media resolutions + downloads, with TTL cleanup."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .extractors.base import Media

TTL_SECONDS = 60 * 60          # an hour to grab your file
MAX_AGE_RESOLUTION = 60 * 30   # resolve tokens expire sooner

# Plafon jumlah entri. TTL saja tidak cukup: 3600 detik TTL berarti ribuan job bisa
# menumpuk dalam satu jam sebelum sweeper menyentuhnya, dan semuanya ditahan di RAM.
MAX_JOBS = 200
MAX_RESOLUTIONS = 500


@dataclass
class Resolution:
    token: str
    media: Media
    created: float = field(default_factory=time.time)


@dataclass
class Job:
    id: str
    token: str
    platform: str
    format_id: str
    status: str = "queued"      # queued | running | done | error
    progress: float = 0.0
    message: str = "Menunggu…"
    file: Optional[Path] = None
    filename: str = ""
    size: int = 0
    error: str = ""
    hint: str = ""
    created: float = field(default_factory=time.time)
    finished: Optional[float] = None

    def public(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "message": self.message,
            "platform": self.platform,
            "filename": self.filename,
            "size": self.size,
            "error": self.error,
            "hint": self.hint,
            "download_url": f"/api/file/{self.id}" if self.status == "done" else None,
        }


class Store:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._resolutions: dict[str, Resolution] = {}
        self._jobs: dict[str, Job] = {}

    # -- resolutions -------------------------------------------------------
    def add_resolution(self, media: Media) -> str:
        token = uuid.uuid4().hex[:16]
        with self._lock:
            # Buang yang paling tua kalau sudah mentok, supaya RAM tidak tumbuh terus.
            if len(self._resolutions) >= MAX_RESOLUTIONS:
                oldest = sorted(self._resolutions.items(), key=lambda kv: kv[1].created)
                for tok, _ in oldest[: max(1, MAX_RESOLUTIONS // 10)]:
                    self._resolutions.pop(tok, None)
            self._resolutions[token] = Resolution(token=token, media=media)
        return token

    def get_resolution(self, token: str) -> Optional[Resolution]:
        with self._lock:
            res = self._resolutions.get(token)
        if res and time.time() - res.created > MAX_AGE_RESOLUTION:
            return None
        return res

    # -- jobs --------------------------------------------------------------
    def create_job(self, token: str, platform: str, format_id: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], token=token, platform=platform, format_id=format_id)
        with self._lock:
            if len(self._jobs) >= MAX_JOBS:
                oldest = sorted(self._jobs.items(), key=lambda kv: kv[1].created)
                for jid, old in oldest[: max(1, MAX_JOBS // 10)]:
                    if old.file and old.file.exists():
                        try:
                            old.file.unlink()
                        except OSError:
                            pass
                    self._jobs.pop(jid, None)
            self._jobs[job.id] = job
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **kw) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for k, v in kw.items():
                setattr(job, k, v)

    # -- housekeeping ------------------------------------------------------
    def sweep(self) -> list[Path]:
        """Drop expired entries; return files that are now orphaned."""
        now = time.time()
        doomed_files: list[Path] = []
        with self._lock:
            for tok, res in list(self._resolutions.items()):
                if now - res.created > MAX_AGE_RESOLUTION:
                    self._resolutions.pop(tok, None)
            for jid, job in list(self._jobs.items()):
                age = now - (job.finished or job.created)
                if age > TTL_SECONDS:
                    if job.file and job.file.exists():
                        doomed_files.append(job.file)
                    self._jobs.pop(jid, None)
        return doomed_files


store = Store()
