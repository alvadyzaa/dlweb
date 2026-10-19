/** Client snaptik.app — port dari app/extractors/snaptik_api.py.
 *
 *  Endpoint (dari https://snaptik.app/js/core.min.js):
 *    POST /api/token            -> {"id","p"}   (p = base64 AES-256-CBC)
 *    GET  /api/extract?url=<u>  -> {"success":true,"data":{...}}  header X-Verify
 *    GET  /api/hd?token=<t>     -> {"error":false,"url":"<mp4>"}  (butuh X-Verify)
 *
 *  X-Verify = f"{id}:{jawaban_challenge}:{_e}:{_h}"
 *  key = sha256("sn4pt1k_v3r1fy2026:" + id), iv = 16 byte pertama hasil decode p.
 *
 *  Catatan Workers: Challenge AES tidak bisa memakai Node crypto; WebCrypto
 *  AES-CBC men-decrypt langsung dan menghapus padding PKCS#7 otomatis.
 */
const BASE = 'https://snaptik.app'
const LOCALE_PATH = '/en3'
const KEY_SEED = 'sn4pt1k_v3r1fy2026'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const AJAX: Record<string, string> = {
  'X-Requested-With': 'XMLHttpRequest',
  Referer: `${BASE}${LOCALE_PATH}`,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256(data: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function decrypt(tid: string, payloadB64: string): Promise<Record<string, unknown>> {
  const raw = b64decode(payloadB64)
  const iv = raw.slice(0, 16)
  const blob = raw.slice(16)
  const keyBuf = await sha256(`${KEY_SEED}:${tid}`)
  const key = await crypto.subtle.importKey('raw', keyBuf, 'AES-CBC', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, blob)
  return JSON.parse(new TextDecoder().decode(plain))
}

/** Jawab challenge aritmetika snaptik. */
function solve(t: Record<string, any>): number {
  switch (t.t) {
    case 'b':
      return ((t.a ^ t.b) >> t.s) & 255
    case 'r':
      return t.n.reduce((a: number, b: number) => a + b, 0) * 2 + 1
    case 'c':
      return t.w.charCodeAt(t.i) * t.m
    case 'm':
      return ((t.a + t.b) % 100) * t.c
    case 'n':
      return t.a * t.b + t.b * t.c + t.c * t.a - t.a
    default:
      throw new Error(`unknown challenge type ${JSON.stringify(t)}`)
  }
}

/** Session sederhana: cookie jar __cflb dari halaman locale. */
interface SnapSession {
  cookies: string
}

async function newSession(): Promise<SnapSession> {
  const cookies: string[] = []
  try {
    const res = await fetch(`${BASE}${LOCALE_PATH}`, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    })
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0]
      if (pair) cookies.push(pair)
    }
  } catch {
    /* locale gagal tetap lanjut; tanpa cookie sering masih OK */
  }
  return { cookies: cookies.join('; ') }
}

async function makeVerify(s: SnapSession): Promise<string> {
  const res = await fetch(`${BASE}/api/token`, {
    method: 'POST',
    headers: { ...AJAX, 'User-Agent': UA, 'Content-Type': 'application/json', Cookie: s.cookies },
    body: '{}',
  })
  if (!res.ok) throw new Error(`token HTTP ${res.status}`)
  const tok = (await res.json()) as { id: string; p: string }
  const challenge = await decrypt(tok.id, tok.p)
  const e = challenge._e as string
  const h = challenge._h as string
  delete challenge._e
  delete challenge._h
  return `${tok.id}:${solve(challenge)}:${e}:${h}`
}

/** Error permanen: media memang tidak ada, mengulang tidak akan membantu. */
export class PermanentError extends Error {}

export interface SnapData {
  downloadUrl?: string
  hdDownloadUrl?: string
  title?: string
  thumbnail?: string
  author?: { username?: string }
  videoDuration?: number
  id?: string | number
  type?: string
  [k: string]: unknown
}

export async function extract(url: string, attempts = 10): Promise<SnapData> {
  let last = ''
  let s: SnapSession | null = null
  for (let i = 0; i < attempts; i++) {
    // Workers tidak punya session persisten; sesi baru tiap 3 percobaan seperti versi Python.
    if (!s || i % 3 === 2) s = await newSession()
    try {
      const verify = await makeVerify(s)
      const res = await fetch(`${BASE}/api/extract?url=${encodeURIComponent(url)}`, {
        headers: { ...AJAX, 'User-Agent': UA, 'X-Verify': verify, Cookie: s.cookies },
      })
      if (res.status === 200) {
        const body = (await res.json()) as { success?: boolean; data?: SnapData }
        if (body.success && body.data) return body.data
        last = JSON.stringify(body).slice(0, 200)
      } else if (res.status === 404) {
        throw new PermanentError((await res.text()).slice(0, 160))
      } else {
        last = `HTTP ${res.status} ${(await res.text()).slice(0, 160)}`
      }
    } catch (err) {
      if (err instanceof PermanentError) throw err
      last = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
    await sleep(1000)
  }
  throw new Error(`snaptik extract failed after ${attempts} attempts: ${last}`)
}

/** Resolve /api/hd (URL token relatif) menjadi URL mp4 langsung. */
export async function hdUrl(data: SnapData, attempts = 5): Promise<string | null> {
  const rel = data.hdDownloadUrl
  if (!rel) return null
  const s = await newSession()
  for (let i = 0; i < attempts; i++) {
    try {
      const verify = await makeVerify(s)
      const res = await fetch(`${BASE}${rel}`, {
        headers: { ...AJAX, 'User-Agent': UA, 'X-Verify': verify, Accept: '*/*', Cookie: s.cookies },
      })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const body = (await res.json()) as { error?: boolean; url?: string }
        if (body.error === false && body.url) return body.url
      }
    } catch {
      /* coba lagi */
    }
    await sleep(1000)
  }
  return null
}

/** Follow tautan pendek (vt./vm.tiktok.com) → URL kanonik /@user/video/<id>.
 *  URL kanonik dibaca dari header Location 302 pertama, bukan URL final —
 *  hop terakhir bisa mendarat di halaman status walaupun Location-nya benar.
 */
export async function resolveShort(url: string, attempts = 3): Promise<string | null> {
  const UAS = [UA]
  const videoUrl = (candidate: string): string | null => {
    const clean = (candidate || '').split('?')[0]
    return /\/(video|photo)\/\d+/.test(clean) ? clean : null
  }
  for (let i = 0; i < attempts; i++) {
    for (const ua of UAS) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'manual' })
        const found = videoUrl(res.headers.get('location') ?? '')
        if (found) return found
        if (res.status >= 300 && res.status < 400) {
          const res2 = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow' })
          const found2 = videoUrl(res2.url ?? '')
          if (found2) return found2
        } else if (res.status === 200) {
          const found3 = videoUrl(res.url ?? '')
          if (found3) return found3
        }
      } catch {
        /* coba UA berikutnya */
      }
    }
    if (i < attempts - 1) await sleep(1200)
  }
  return null
}
