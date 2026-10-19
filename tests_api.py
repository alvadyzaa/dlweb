#!/usr/bin/env python3
"""End-to-end test suite for the TikThreads API (TikTok + Threads).

Run against a live server:  .venv/bin/python tests_api.py [base_url]

Every case prints PASS/FAIL with the measured value, so a broken expectation is
visible instead of silently "green".
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
TT_VIDEO = "https://www.tiktok.com/@tiktok/video/7106594312292453675"
TT_VIDEO2 = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
TT_SHORT = "https://vm.tiktok.com/ZSrjTVXjN"
# Domain pemendek yang dipakai aplikasi TikTok modifikasi (301 -> tiktok.com).
TT_SHORT_MOD = "https://www.tt.site/t/ZSgjaoquH/"
TT_DEAD = "https://www.tiktok.com/@tiktok/video/1234567890123456789"
TH_VIDEO = "https://www.threads.com/@alvinfoo/post/DJULD4lpPsY"
TH_VIDEO2 = "https://www.threads.com/@choi.openai/post/DHageWxOrMW"
TH_IMAGE = "https://www.threads.com/@mosseri/post/DDupwppSjcp"
TH_CAROUSEL = "https://www.threads.com/@vibe.digitals/post/DRMmBJSEyAk"
TT_PHOTO = "https://www.tiktok.com/@kawnueng_studio/photo/7538831223041314068"
YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height",
         "-show_entries", "format=size,duration", "-of", "json", str(path)],
        capture_output=True, text=True,
    ).stdout
    d = json.loads(out)
    v = [s for s in d["streams"] if s.get("codec_type") == "video"]
    a = [s for s in d["streams"] if s.get("codec_type") == "audio"]
    return {
        "size": int(d["format"]["size"]),
        "duration": float(d["format"]["duration"]),
        "w": v[0]["width"] if v else 0,
        "h": v[0]["height"] if v else 0,
        "vcodec": v[0]["codec_name"] if v else "",
        "has_audio": bool(a),
    }


def resolve(url: str) -> tuple[int, dict]:
    r = requests.post(f"{BASE}/api/resolve", json={"url": url}, timeout=180)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"raw": r.text[:200]}


def download(token: str, format_id: str, timeout: int = 240) -> tuple[bool, dict]:
    r = requests.post(f"{BASE}/api/download", json={"token": token, "format_id": format_id}, timeout=60)
    if r.status_code != 200:
        return False, {"error": r.text[:150]}
    job_id = r.json()["job_id"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = requests.get(f"{BASE}/api/job/{job_id}", timeout=30).json()
        if j["status"] in ("done", "error"):
            return j["status"] == "done", j
        time.sleep(1)
    return False, {"error": "timeout"}


def fetch_file(job: dict, dest: Path) -> Path:
    r = requests.get(BASE + job["download_url"], timeout=180)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def main() -> int:
    tmp = Path("/tmp/tikthreads-tests")
    tmp.mkdir(exist_ok=True)
    print(f"base: {BASE}\n")

    # ---------------------------------------------------------------- health
    print("[health]")
    h = requests.get(f"{BASE}/api/health", timeout=30).json()
    labels = [e["label"] for e in h["extractors"]]
    check("health: hanya TikTok & Threads", labels == ["TikTok", "Threads"], str(labels))

    # ---------------------------------------------------------------- tiktok
    print("\n[TikTok: video biasa]")
    code, body = resolve(TT_VIDEO)
    check("resolve 200", code == 200, f"HTTP {code}")
    if code == 200:
        ids = [f["id"] for f in body["formats"]]
        check("format nowm ada", "nowm" in ids, str(ids))
        check("format hd ada", "hd" in ids, str(ids))
        hd = next(f for f in body["formats"] if f["id"] == "hd")
        check("label HD tidak janji kualitas", "terbaik" not in hd["label"].lower(), hd["label"])
        check("catatan HD tidak jargon", "request" not in hd["note"].lower(), hd["note"])
        check("catatan HD jujur soal ukuran", "kecil" in hd["note"].lower(), hd["note"])
        check("judul bukan URL", not body["title"].startswith("http"), body["title"][:40])

        ok, job = download(body["token"], "nowm")
        check("unduh nowm sukses", ok, job.get("error", job.get("message", "")))
        if ok:
            p = fetch_file(job, tmp / "tt-nowm.mp4")
            info = probe(p)
            check("nowm ada audio", info["has_audio"], str(info))
            check("nowm file wajar (>100KB)", info["size"] > 100_000, f"{info['size']}B")
            check("nama file memuat format", "nowm" in job["filename"], job["filename"])

        ok, job = download(body["token"], "hd")
        check("unduh HD sukses", ok, job.get("error", job.get("message", "")))
        if ok:
            p = fetch_file(job, tmp / "tt-hd.mp4")
            info = probe(p)
            check("HD ada audio", info["has_audio"], str(info))
            check("nama file HD beda dari nowm", "hd" in job["filename"], job["filename"])

    print("\n[TikTok: link pendek]")
    code, body = resolve(TT_SHORT)
    check("link pendek resolve 200", code == 200, f"HTTP {code} {body.get('error','')}")
    if code == 200:
        check("judul link pendek bukan URL", not body["title"].startswith("http"), body["title"][:40])
        ok, job = download(body["token"], "nowm")
        check("link pendek bisa diunduh", ok, job.get("error", ""))

    print("\n[TikTok: link pendek dari app mod (tt.site)]")
    code, body = resolve(TT_SHORT_MOD)
    check("tt.site resolve 200", code == 200, f"HTTP {code} {body.get('error','')}")
    if code == 200:
        check("tt.site dikenali sebagai tiktok", body.get("platform") == "tiktok", str(body.get("platform")))
        check("tt.site judul bukan URL", not body["title"].startswith("http"), body["title"][:40])
        ok, job = download(body["token"], "nowm")
        check("tt.site bisa diunduh", ok, job.get("error", ""))

    print("\n[Host menyerupai tt.site harus ditolak]")
    for bad in ("https://tt.site.evil.example/t/ZSgjaoquH/",
                "https://nottt.site/t/ZSgjaoquH/"):
        code, body = resolve(bad)
        check(f"tolak {bad[:34]}", code == 400, f"HTTP {code} {body.get('code')}")

    print("\n[TikTok: video dihapus]")
    t0 = time.time()
    code, body = resolve(TT_DEAD)
    elapsed = time.time() - t0
    check("status 422", code == 422, f"HTTP {code}")
    check("code=not_found", body.get("code") == "not_found", str(body.get("code")))
    check("gagal cepat (<15s)", elapsed < 15, f"{elapsed:.1f}s")
    check("pesan bahasa Indonesia", "tidak tersedia" in body.get("error", "").lower(), body.get("error", ""))

    # ---------------------------------------------------------------- threads
    print("\n[Threads: video]")
    for url, tag in ((TH_VIDEO, "A"), (TH_VIDEO2, "B")):
        code, body = resolve(url)
        check(f"{tag}: resolve 200", code == 200, f"HTTP {code} {body.get('error','')}")
        if code != 200:
            continue
        labels = [f["label"] for f in body["formats"]]
        check(f"{tag}: tidak ada label 'kualitas terbaik' menyesatkan",
              not any("terbaik" in l.lower() for l in labels), str(labels))
        check(f"{tag}: tidak ada label resolusi (metadata plugin salah)",
              not any("p (" in l for l in labels), str(labels))
        ok, job = download(body["token"], body["formats"][0]["id"])
        check(f"{tag}: unduh sukses", ok, job.get("error", ""))
        if ok:
            p = fetch_file(job, tmp / f"th-{tag}.mp4")
            info = probe(p)
            check(f"{tag}: ada audio", info["has_audio"], str(info))
            check(f"{tag}: ada video", info["w"] > 0, f"{info['w']}x{info['h']}")
            check(f"{tag}: nama file unik per format", "-101" in job["filename"], job["filename"])

    print("\n[Threads: bukan video]")
    code, body = resolve(TH_IMAGE)
    check("post 1 gambar -> 200 (fallback gambar)", code == 200, f"HTTP {code} {body.get('error','')}")
    if code == 200:
        kinds = {f["kind"] for f in body["formats"]}
        check("post gambar: format kind=image", kinds == {"image"}, str(kinds))
        check("post 1 gambar: tanpa zip", not any(f["id"] == "zip" for f in body["formats"]),
              str([f["id"] for f in body["formats"]]))

    print("\n[Threads: carousel]")
    code, body = resolve(TH_CAROUSEL)
    check("carousel resolve 200", code == 200, f"HTTP {code} {body.get('error','')}")
    if code == 200:
        imgs = [f for f in body["formats"] if f["kind"] == "image" and f["id"] != "zip"]
        has_zip = any(f["id"] == "zip" for f in body["formats"])
        check("carousel >1 gambar", len(imgs) > 1, f"{len(imgs)} gambar")
        check("carousel ada opsi zip", has_zip, str([f["id"] for f in body["formats"]]))
        check("tiap gambar punya thumb", all(f.get("thumb") for f in imgs), "thumb kosong")
        ok, job = download(body["token"], imgs[0]["id"])
        check("unduh 1 gambar sukses", ok, job.get("error", ""))
        if ok:
            p = fetch_file(job, tmp / "th-img1.jpg")
            check("file gambar >1KB", p.stat().st_size > 1024, f"{p.stat().st_size}B")
        if has_zip:
            ok, job = download(body["token"], "zip")
            check("unduh zip sukses", ok, job.get("error", ""))
            if ok:
                p = fetch_file(job, tmp / "th-carousel.zip")
                import zipfile
                names = zipfile.ZipFile(p).namelist()
                check("zip berisi semua gambar", len(names) == len(imgs), f"{len(names)} vs {len(imgs)}")
                check("zip valid", zipfile.ZipFile(p).testzip() is None, "corrupt")

    print("\n[TikTok: post foto]")
    code, body = resolve(TT_PHOTO)
    check("foto TikTok resolve 200", code == 200, f"HTTP {code} {body.get('error','')}")
    if code == 200:
        imgs = [f for f in body["formats"] if f["kind"] == "image" and f["id"] != "zip"]
        check("foto TikTok banyak gambar", len(imgs) > 1, f"{len(imgs)} gambar")
        check("foto TikTok ada zip", any(f["id"] == "zip" for f in body["formats"]), "")
        ok, job = download(body["token"], "img1")
        check("unduh gambar 1 sukses", ok, job.get("error", ""))
        if ok:
            p = fetch_file(job, tmp / "tt-img1.jpg")
            check("gambar 1 >1KB", p.stat().st_size > 1024, f"{p.stat().st_size}B")
        ok, job = download(body["token"], "zip")
        check("unduh zip TikTok sukses", ok, job.get("error", ""))
        if ok:
            p = fetch_file(job, tmp / "tt-photo.zip")
            import zipfile
            names = zipfile.ZipFile(p).namelist()
            check("zip TikTok berisi semua gambar", len(names) == len(imgs), f"{len(names)} vs {len(imgs)}")

    # ---------------------------------------------------------------- youtube
    print("\n[YouTube: nonaktif]")
    code, body = resolve(YT)
    check("YouTube -> 422 disabled", code == 422 and body.get("code") == "disabled", f"HTTP {code} {body.get('code')}")
    combined = f"{body.get('error', '')} {body.get('hint', '')}"
    check("pesan menyebut TikTok & Threads", "Threads" in combined, combined.strip()[:90])

    # ---------------------------------------------------------------- misc
    print("\n[Validasi & error]")
    r = requests.post(f"{BASE}/api/resolve", json={"url": "bukan-url"}, timeout=30)
    check("URL tanpa skema -> 400", r.status_code == 400, f"HTTP {r.status_code}")
    r = requests.post(f"{BASE}/api/download", json={"token": "palsu", "format_id": "nowm"}, timeout=30)
    check("token palsu -> 410", r.status_code == 410, f"HTTP {r.status_code}")
    code, body = resolve("https://vimeo.com/12345")
    check("platform lain -> pesan jelas", code == 422, f"HTTP {code}")

    # ---------------------------------------------------------------- summary
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'='*60}\n{passed}/{total} PASS")
    if passed != total:
        print("GAGAL:")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name} [{detail}]")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
