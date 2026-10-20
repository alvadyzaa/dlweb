/// <reference types="@cloudflare/workers-types" />
/** dlweb Worker: resolve TikTok/Threads -> URL unduhan langsung + proxy streaming.
 *
 *  Rute:
 *    GET  /api/health          -> daftar platform
 *    POST /api/resolve         -> {url} -> ResolvedMedia (format berisi URL unduhan)
 *    GET  /api/dl?u=<encoded>  -> proxy media: tambah Content-Disposition, sembunyikan
 *                                 referer asal (CDN TikTok/Threads menolak hotlink
 *                                 tanpa ini di beberapa kasus) + pass-through Range.
 *    GET  /api/zip?u=...&u=... -> gabung beberapa gambar jadi satu .zip (store-only)
 *    GET  /*                   -> static assets (frontend)
 */
import { extract, hdUrl, resolveShort, PermanentError } from './snaptik'
import { tiktokPhoto, threadsPost, ImageError } from './images'
import { makeZip } from './zip'
import type { MediaFormat, ResolvedMedia } from './types'

const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const TIKTOK_HOSTS = ['tiktok.com', 'douyin.com']
const TIKTOK_SHORT = ['vt.tiktok.com', 'vm.tiktok.com', 't.tiktok.com', 'vt.tiktokv.com', 'tt.site']
const THREADS_HOSTS = ['threads.com', 'threads.net']
const TWITTER_HOSTS = ['x.com', 'twitter.com']

/** Host CDN yang boleh diproksikan lewat /api/dl dan /api/zip. Tanpa daftar ini
 *  Worker menjadi proxy fetch gratis untuk URL publik mana pun. */
const MEDIA_HOSTS = [
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com',
  'byteoversea.com', 'ibyteimg.com', 'tikwm.com', 'snaptik.app', 'rapidcdn.app',
  'cdninstagram.com', 'fbcdn.net', 'threads.com', 'threads.net',
  'twimg.com',
]

/** Ekstensi yang boleh dipasang lewat parameter `e` dari resolver. */
const HINT_EXTS = new Set(['mp4', 'mov', 'webm', 'm4a', 'mp3', 'jpg', 'jpeg', 'png', 'webp'])

/** Origin yang memang memakai API ini dari browser. Same-origin selalu lolos. */
const ALLOWED_ORIGINS = new Set([
  'https://pluck.alva.web.id',
  'https://www.pluck.alva.web.id',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
])

/** API JSON tak resmi untuk X/Twitter: mengembalikan teks + media langsung
 *  dari video.twimg.com/pbs.twimg.com (jauh lebih stabil daripada scraping). */
const FX_API = 'https://api.fxtwitter.com'

class ApiFail extends Error {
  hint: string
  code: string
  status: number
  constructor(message: string, hint = '', code = 'unknown', status = 400) {
    super(message)
    this.hint = hint
    this.code = code
    this.status = status
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // no-store: balasan API (termasuk error) tidak boleh di-cache Cloudflare edge,
    // supaya kesalahan sesaat tidak lengket dan disajikan ke pengguna berikutnya.
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  })

/** Header keamanan untuk semua respons (API + halaman statis). */
const SECURITY_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
    "media-src 'self' https:; connect-src 'self'; font-src 'self' data:; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
}

/** CORS hanya untuk origin sendiri. Request same-origin tidak butuh header ini. */
function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  let sameOrigin = false
  try {
    const o = new URL(origin)
    const self = new URL(req.url)
    sameOrigin = o.protocol === self.protocol && o.host === self.host
  } catch {
    /* Origin tidak valid */
  }
  if (!sameOrigin && !ALLOWED_ORIGINS.has(origin)) return null
  return { 'access-control-allow-origin': origin, vary: 'Origin' }
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Error unduhan: browser yang menavigasi ke /api/dl jangan diberi JSON mentah. */
function downloadError(
  req: Request,
  message: string,
  hint: string,
  code: string,
  status = 502,
): Response {
  const accept = req.headers.get('accept') ?? ''
  const isNavigation =
    req.headers.get('sec-fetch-mode') === 'navigate' || accept.includes('text/html')
  if (!isNavigation) return json({ error: message, hint, code }, status)
  const html =
    '<!doctype html><html lang="id"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Unduhan gagal — PluckDL</title></head>` +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif">' +
    '<main style="max-width:34rem;padding:2rem;text-align:center">' +
    '<h1 style="font-size:1.35rem;margin:0 0 .75rem">Unduhan gagal</h1>' +
    `<p style="color:#b5b5b5;line-height:1.6;margin:0 0 .5rem">${escapeHtml(message)}</p>` +
    (hint ? `<p style="color:#8a8a8a;line-height:1.6;margin:0 0 1.25rem">${escapeHtml(hint)}</p>` : '') +
    '<a href="/" style="display:inline-block;padding:.65rem 1rem;border-radius:.5rem;background:#f5f5f5;color:#0a0a0a;text-decoration:none;font-weight:600">Kembali ke PluckDL</a>' +
    '</main></body></html>'
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

/** Terapkan security header + CORS (kalau diizinkan) ke respons apa pun. */
function finalize(req: Request, res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value)
  }
  if (isApiPath(new URL(req.url).pathname)) {
    const cors = corsHeaders(req)
    if (cors) {
      for (const [key, value] of Object.entries(cors)) headers.set(key, value)
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
}

/* ----------------------------------------------------------- rate limiting */

const RATE_WINDOW_MS = 60_000
const RATE_MAX_RESOLVE = 15
const RATE_MAX_ZIP = 10
const RATE_MAX_DOWNLOAD = 120
const rateBuckets = new Map<string, number[]>()

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

function rateLimit(req: Request, kind: string, max: number): Response | null {
  const key = `${kind}:${clientIp(req)}`
  const now = Date.now()
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= max) {
    rateBuckets.set(key, hits)
    const retry = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000))
    const res = downloadError(
      req,
      'Terlalu banyak permintaan.',
      `Coba lagi dalam ${retry} detik.`,
      'rate_limited',
      429,
    )
    res.headers.set('retry-after', String(retry))
    return res
  }
  hits.push(now)
  rateBuckets.set(key, hits)
  // Jaga ukuran map di isolate yang hidup lama.
  if (rateBuckets.size > 5000) {
    for (const [bucket, times] of rateBuckets) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) rateBuckets.delete(bucket)
    }
  }
  return null
}

function rateLimitResolve(req: Request): Response | null {
  return rateLimit(req, 'resolve', RATE_MAX_RESOLVE)
}

/** Content-type yang menandakan upstream mengirim halaman web, bukan berkas media. */
function isHtmlContentType(ct: string): boolean {
  return ct.includes('text/html') || ct.includes('application/xhtml')
}

/** Respons JSON/teks dari CDN hampir selalu pesan error (token kedaluwarsa,
 *  rate limit), bukan media. Jangan pernah disimpan sebagai .mp4/.jpg. */
function isNonMediaContentType(ct: string): boolean {
  const value = ct.toLowerCase()
  return isHtmlContentType(value) || value.includes('application/json') || value.startsWith('text/')
}

function hostMatches(url: string, hosts: string[]): boolean {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return hosts.some((h) => host === h || host.endsWith(`.${h}`))
}

function looksLikeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** SSRF guard ringan: hanya http(s), blokir host internal/metadata
 *  (termasuk IPv6 dan bentuk IPv4 yang sudah dinormalisasi URL parser). */
function assertPublicHttp(raw: string): void {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new ApiFail('URL tidak valid.', 'Tempel tautan lengkap yang diawali https://.', 'invalid_url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ApiFail('URL tidak valid.', 'Hanya tautan http:// atau https:// yang didukung.', 'invalid_url')
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  const ipv6 = host.startsWith('[') ? host.slice(1, -1) : ''
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // IPv6 loopback/unspecified/link-local/ULA, termasuk IPv4-mapped.
    ipv6 === '::1' ||
    ipv6 === '::' ||
    ipv6.startsWith('::ffff:') ||
    /^f[cd]/.test(ipv6) ||
    /^fe[89ab]/.test(ipv6)
  ) {
    throw new ApiFail(
      'URL tidak diizinkan.',
      'Gunakan tautan publik dari TikTok, Threads, atau X — bukan alamat jaringan internal.',
      'unsafe_url',
    )
  }
}

/* --------------------------------------------------------------- resolver */

/** ID post dari URL kanonik, dipakai sebagai nama file cadangan. */
function postIdFromUrl(raw: string): string {
  const m = /\/(?:video|photo)\/(\d+)/.exec(raw) || /\/status\/(\d+)/.exec(raw)
  return m ? m[1] : ''
}

async function resolveTiktok(rawUrl: string): Promise<ResolvedMedia> {
  let target = rawUrl.trim()

  if (hostMatches(target, TIKTOK_SHORT)) {
    const resolved = await resolveShort(target)
    if (!resolved) {
      throw new ApiFail(
        'Link pendek TikTok tidak bisa dibuka.',
        'Buka link pendeknya di browser sampai videonya terbuka, lalu salin URL penuh dari address bar (bentuknya https://www.tiktok.com/@user/video/angka).',
        'short_link',
      )
    }
    if (!hostMatches(resolved, TIKTOK_HOSTS)) {
      throw new ApiFail('Link pendek ini tidak mengarah ke TikTok.', 'Pastikan tautannya berasal dari aplikasi TikTok.', 'short_link')
    }
    target = resolved
  }

  if (target.includes('/photo/')) return resolveTiktokPhoto(target)

  let data
  try {
    data = await extract(target, 12)
  } catch (err) {
    if (err instanceof PermanentError) {
      throw new ApiFail('Video ini tidak tersedia.', 'Post-nya mungkin sudah dihapus atau dibuat privat oleh pemiliknya.', 'not_found')
    }
    throw new ApiFail(
      'Video ini gagal diambil.',
      'Kemungkinan video privat, atau server sedang ditolak platform. Coba lagi sebentar lagi.',
      'network',
      503,
    )
  }

  const author = data.author?.username ?? ''
  const postId = String(data.id ?? '') || postIdFromUrl(target)
  let title = (data.title ?? '').trim()
  if (!title || title.startsWith('http://') || title.startsWith('https://')) {
    title = author ? `TikTok ${author}` : 'Video TikTok'
  }
  const formats: MediaFormat[] = []
  if (data.downloadUrl) {
    formats.push({ id: 'nowm', label: 'Video (no watermark)', ext: 'mp4', kind: 'video', url: proxyUrl(data.downloadUrl, 'mp4', title, postId), size: null, note: '' })
  }
  if (data.hdDownloadUrl) {
    // Resolve token HD sekarang, bukan saat link diklik: kalau gagal, link
    // dibuang supaya pengguna tidak mendarat di halaman error JSON.
    const hdTarget = await hdUrl(data, 3).catch(() => null)
    if (hdTarget) {
      formats.push({ id: 'hd', label: 'Video resolusi tertinggi', ext: 'mp4', kind: 'video', url: proxyUrl(hdTarget, 'mp4', title, postId), size: null, note: 'ukuran file bisa lebih kecil' })
    }
  }
  if (!formats.length) {
    // Snaptik video-only; coba tikwm (bisa mengembalikan images ATAU video).
    return resolveTiktokPhoto(target)
  }

  return {
    platform: 'tiktok',
    title,
    author,
    thumbnail: data.thumbnail ?? '',
    duration: typeof data.videoDuration === 'number' ? data.videoDuration : null,
    formats,
  }
}

async function resolveTiktokPhoto(target: string): Promise<ResolvedMedia> {
  let post
  try {
    post = await tiktokPhoto(target)
  } catch (err) {
    if (err instanceof ImageError) {
      const status = err.code === 'upstream' || err.code === 'network' ? 503 : 400
      throw new ApiFail(err.message, err.hint, err.code, status)
    }
    throw err
  }
  const postId = post.id || postIdFromUrl(target)
  const formats: MediaFormat[] = post.items.map((item) => ({
    id: `img${item.index}`,
    label: `Gambar ${item.index}`,
    ext: 'jpg',
    kind: 'image' as const,
    url: proxyUrl(item.url, 'jpg', post.title, postId),
    size: null,
    note: '',
    thumb: proxyUrl(item.url, 'jpg', undefined, postId),
  }))
  if (formats.length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${formats.length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(post.items.map((i) => i.url), post.title, postId),
      size: null,
      note: 'satu file',
    })
  }
  return {
    platform: 'tiktok',
    title: post.title,
    author: post.author,
    thumbnail: post.thumbnail,
    duration: post.duration,
    formats,
  }
}

async function resolveThreads(rawUrl: string): Promise<ResolvedMedia> {
  let post
  try {
    post = await threadsPost(rawUrl.trim())
  } catch (err) {
    if (err instanceof ImageError) {
      const status = err.code === 'upstream' || err.code === 'network' ? 503 : 400
      throw new ApiFail(err.message, err.hint, err.code, status)
    }
    throw err
  }

  const formats: MediaFormat[] = []
  if (post.videoUrl) {
    formats.push({ id: 'video', label: 'Video (audio+video)', ext: 'mp4', kind: 'video', url: proxyUrl(post.videoUrl, 'mp4', post.title, post.id), size: null, note: '' })
  }
  for (const item of post.items) {
    if (item.isVideo) {
      // Carousel video: tiap entry punya video_versions sendiri.
      if (item.videoUrl && (post.items.length > 1 || !post.videoUrl)) {
        formats.push({
          id: post.items.length > 1 ? `video${item.index}` : 'video',
          label: `Video ${item.index}`,
          ext: 'mp4',
          kind: 'video',
          url: proxyUrl(item.videoUrl, 'mp4', post.title, post.id),
          size: null,
          note: '',
        })
      }
      continue
    }
    formats.push({
      id: `img${item.index}`,
      label: `Gambar ${item.index}` + (item.width ? ` · ${item.width}×${item.height}` : ''),
      ext: 'jpg',
      kind: 'image',
      url: proxyUrl(item.url, 'jpg', post.title, post.id),
      size: null,
      note: '',
      thumb: proxyUrl(item.url, 'jpg', undefined, post.id),
    })
  }
  if (formats.filter((f) => f.kind === 'image').length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${post.items.filter((i) => !i.isVideo).length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(post.items.filter((i) => !i.isVideo).map((i) => i.url), post.title, post.id),
      size: null,
      note: 'satu file',
    })
  }
  if (!formats.length) {
    throw new ApiFail(
      'Post ini tidak berisi media yang bisa diunduh.',
      'Pastikan tautannya mengarah ke post yang punya video atau gambar.',
      'no_media',
    )
  }
  return {
    platform: 'threads',
    title: post.title,
    author: post.author,
    thumbnail: post.thumbnail,
    duration: post.duration,
    formats,
  }
}

/** Ekstrak <user>/status/<id> dari tautan X/Twitter (abaikan akhiran /photo/1 dsb). */
function twitterPost(rawUrl: string): { user: string; id: string } | null {
  let u: URL
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return null
  }
  const m = /\/([^/]+)\/status\/(\d+)/.exec(u.pathname)
  return m ? { user: m[1], id: m[2] } : null
}

async function resolveTwitter(rawUrl: string): Promise<ResolvedMedia> {
  const post = twitterPost(rawUrl)
  if (!post) {
    throw new ApiFail(
      'Tautan X tidak valid.',
      'Gunakan tautan ke satu post, bentuknya x.com/<user>/status/<angka>.',
      'invalid_url',
    )
  }

  let data: any
  let httpStatus = 0
  try {
    const res = await fetch(`${FX_API}/${post.user}/status/${post.id}`, {
      headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json' },
    })
    httpStatus = res.status
    if (res.ok || res.status === 404) {
      try {
        data = await res.json()
      } catch {
        if (res.ok) {
          throw new ApiFail('Post X ini gagal dibaca.', 'Coba lagi sebentar lagi.', 'network', 503)
        }
      }
    }
  } catch (err) {
    if (err instanceof ApiFail) throw err
    throw new ApiFail('Post X ini gagal dibaca.', 'Coba lagi sebentar lagi.', 'network', 503)
  }
  if (httpStatus === 429) {
    throw new ApiFail(
      'Server X sedang membatasi permintaan.',
      'Coba lagi beberapa saat lagi.',
      'rate_limited',
      429,
    )
  }
  if (httpStatus === 0 || httpStatus === 401 || httpStatus === 403 || httpStatus >= 500) {
    throw new ApiFail('Post X ini gagal dibaca.', 'Coba lagi sebentar lagi.', 'network', 503)
  }

  if (httpStatus === 404) {
    throw new ApiFail(
      'Post X ini tidak bisa dibuka.',
      'Kemungkinan sudah dihapus, akunnya privat, atau tautannya bukan post.',
      'not_found',
    )
  }

  const tweet = data?.tweet
  if (!tweet || (typeof data?.code === 'number' && data.code !== 200)) {
    throw new ApiFail(
      'Post X ini tidak bisa dibuka.',
      'Kemungkinan sudah dihapus, akunnya privat, atau tautannya bukan post.',
      'not_found',
    )
  }

  const author: string = tweet.author?.screen_name ?? post.user
  let title = String(tweet.text ?? '').trim().split('\n')[0].trim()
  if (!title) title = `X @${author}`

  const formats: MediaFormat[] = []
  const videos: any[] = tweet.media?.videos ?? []
  videos.forEach((v: any, i: number) => {
    // Kumpulkan varian MP4 lalu ambil bitrate tertinggi.
    const variants: any[] = [...(v.variants ?? []), ...(v.formats ?? [])].filter((x: any) =>
      String(x?.url ?? '').includes('.mp4'),
    )
    const pool = variants.length ? variants : [{ url: v.url, bitrate: 0 }]
    const best = pool.reduce((a: any, b: any) => ((b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a), pool[0])
    const url: string | undefined = best?.url
    if (!url) return
    formats.push({
      id: videos.length > 1 ? `video${i + 1}` : 'video',
      label: videos.length > 1 ? `Video ${i + 1}` : 'Video (audio+video)',
      ext: 'mp4',
      kind: 'video',
      url: proxyUrl(url, 'mp4', title, post.id),
      size: null,
      note: '',
    })
  })

  const photos: any[] = tweet.media?.photos ?? []
  photos.forEach((p: any, i: number) => {
    if (!p?.url) return
    formats.push({
      id: `img${i + 1}`,
      label: `Gambar ${i + 1}` + (p.width ? ` · ${p.width}×${p.height}` : ''),
      ext: 'jpg',
      kind: 'image',
      url: proxyUrl(p.url, 'jpg', title, post.id),
      size: null,
      note: '',
      thumb: proxyUrl(p.url, 'jpg', undefined, post.id),
    })
  })

  const photoUrls = photos.map((p: any) => p?.url).filter((u: unknown): u is string => typeof u === 'string')
  if (photoUrls.length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${photoUrls.length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(photoUrls, title, post.id),
      size: null,
      note: 'satu file',
    })
  }

  if (!formats.length) {
    throw new ApiFail(
      'Post X ini tidak berisi video atau gambar.',
      'Pastikan tautannya mengarah ke post X yang punya media.',
      'no_media',
    )
  }

  const duration =
    typeof tweet.media?.videos?.[0]?.duration === 'number' ? tweet.media.videos[0].duration : null
  const thumbnail: string =
    tweet.media?.videos?.[0]?.thumbnail_url ?? photos[0]?.url ?? tweet.author?.avatar_url ?? ''

  return { platform: 'twitter', title, author, thumbnail, duration, formats }
}

/* ---------------------------------------------------------------- helpers */

/** Token anti-cache. Bikin URL unduhan unik tiap resolve agar cache browser/edge
 *  (mis. balasan HTML basi dari sebelum perbaikan) tidak pernah terpakai ulang. */
let nonceSeq = 0
function nonce(): string {
  nonceSeq = (nonceSeq + 1) % 0xffffff
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}-${nonceSeq.toString(36)}`
}

function proxyUrl(u: string, ext?: string, title?: string, postId?: string): string {
  // `e` = perkiraan ekstensi dari resolver. Dipakai kalau CDN membalas
  // content-type generik (application/octet-stream) dan URL tanpa ekstensi,
  // supaya berkas tidak tersimpan sebagai .bin.
  // `f` = judul post, dipakai sebagai dasar nama file unduhan.
  // `p` = ID post, cadangan nama file kalau judulnya non-ASCII semua (CJK).
  const params = new URLSearchParams({ u, n: nonce() })
  if (ext) params.set('e', ext)
  if (title) params.set('f', title)
  if (postId) params.set('p', postId)
  return `/api/dl?${params.toString()}`
}

function zipUrl(urls: string[], title?: string, postId?: string): string {
  const params = new URLSearchParams({ n: nonce() })
  for (const u of urls) params.append('u', u)
  if (title) params.set('f', title)
  if (postId) params.set('p', postId)
  return `/api/zip?${params.toString()}`
}

/** Ejaan brand untuk nama file unduhan. */
const BRAND = 'PluckDL'

/** Bersihkan judul agar aman jadi nama file (tanpa path/karakter kontrol). */
function cleanTitle(raw: string): string {
  let title = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (title.length > 80) {
    const cut = title.slice(0, 80)
    const space = cut.lastIndexOf(' ')
    title = space > 20 ? cut.slice(0, space) : cut
  }

  return title.replace(/[.,;:!\- ]+$/, '').trim()
}

/** Fallback ASCII untuk header Content-Disposition. Bisa kosong (mis. judul CJK). */
function asciiName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** RFC 5987 encoding untuk filename* (UTF-8). */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `<judul> by PluckDL.<ext>` — judul kosong? cukup `PluckDL.<ext>`. */
function downloadName(title: string, ext: string): string {
  const clean = cleanTitle(title)
  return `${clean ? `${clean} by ${BRAND}` : BRAND}.${ext}`
}

function contentDisposition(name: string, fallbackBase = ''): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? 'bin'
  let ascii = asciiName(name)
  const stem = ascii.replace(/\.[A-Za-z0-9]+$/, '')
  // Judul CJK habis jadi "by PluckDL.mp4" — ganti dengan ID post.
  if (!stem || stem === `by ${BRAND}`) {
    ascii = `${safeName(fallbackBase, 'pluck')} by ${BRAND}.${ext}`
  }
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRFC5987(name)}`
}

/** Nama file aman dari URL post: hindari path traversal. */
function safeName(value: string, fallback: string): string {
  const clean = value.split('?')[0].split('/').filter(Boolean).pop() ?? ''
  return clean.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback
}

function guessExt(u: string, contentType?: string): string {
  // HTML berarti upstream mengembalikan halaman (auth/redirect), bukan media —
  // handleDownload menolaknya lebih dulu. Jaring pengaman: jangan pernah hasilkan .htm.
  const ct = contentType ?? ''
  if (isHtmlContentType(ct)) return 'bin'
  const ctMap: Record<string, string> = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  }
  for (const [k, v] of Object.entries(ctMap)) {
    if (ct.includes(k)) return v
  }
  const m = /\.(jpe?g|png|webp|mp4|mov|m4a)(?:[?#]|$)/i.exec(u)
  return (m?.[1] ?? 'bin').toLowerCase().replace('jpeg', 'jpg')
}

/* ------------------------------------------------------------ route logic */

async function handleResolve(req: Request): Promise<Response> {
  const limited = rateLimitResolve(req)
  if (limited) return limited

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body bukan JSON.', hint: 'Kirim {"url": "<tautan>"}.', code: 'bad_request' }, 400)
  }
  if (!body || typeof body !== 'object' || typeof body.url !== 'string') {
    return json(
      { error: 'URL tidak valid.', hint: 'Field "url" harus berupa teks tautan.', code: 'invalid_url' },
      400,
    )
  }
  const url = normalizeUrl(body.url)
  if (url.length < 5 || url.length > 2000) {
    return json(
      { error: 'URL tidak valid.', hint: 'Tempel tautan lengkap post TikTok, Threads, atau X.', code: 'invalid_url' },
      400,
    )
  }
  if (!looksLikeHttpUrl(url)) {
    return json({ error: 'URL tidak valid.', hint: 'Tautan harus diawali http:// atau https://', code: 'invalid_url' }, 400)
  }
  assertPublicHttp(url)

  try {
    if (hostMatches(url, TIKTOK_HOSTS) || hostMatches(url, TIKTOK_SHORT)) {
      return json(await resolveTiktok(url))
    }
    if (hostMatches(url, THREADS_HOSTS)) {
      return json(await resolveThreads(url))
    }
    if (hostMatches(url, TWITTER_HOSTS)) {
      return json(await resolveTwitter(url))
    }
    return json({ error: 'Tautan ini belum didukung.', hint: 'Saat ini hanya TikTok, Threads, dan X.', code: 'unsupported' }, 400)
  } catch (err) {
    if (err instanceof ApiFail) {
      return json({ error: err.message, hint: err.hint, code: err.code }, err.status)
    }
    return json({ error: 'Terjadi kesalahan tak terduga.', hint: 'Coba lagi sebentar lagi.', code: 'unknown' }, 500)
  }
}

async function handleHdResolve(req: Request, src: string, title: string, postId = ''): Promise<Response> {
  try {
    assertPublicHttp(src)
  } catch (err) {
    if (err instanceof ApiFail) {
      return downloadError(req, err.message, err.hint, err.code, err.status)
    }
    throw err
  }
  if (!hostMatches(src, TIKTOK_HOSTS)) {
    return downloadError(
      req,
      'URL tidak diizinkan.',
      'Hanya tautan TikTok yang bisa di-resolve di sini.',
      'unsafe_url',
      400,
    )
  }
  try {
    const data = await extract(src, 6)
    const target = await hdUrl(data)
    if (!target) {
      return downloadError(
        req,
        'Versi resolusi tertinggi tidak bisa diambil untuk video ini.',
        'Coba pilih "Video (no watermark)"; isinya biasanya sama.',
        'hd_failed',
        400,
      )
    }
    // Relatif ke Worker ini (BUKAN Response.redirect, yang menyalin URL absolut
    // dan melewati proxy — CDN TikTok menolak hotlink tanpa referer yang benar).
    // `f` wajib diteruskan, kalau tidak nama file jatuh ke "PluckDL.mp4".
    return new Response(null, {
      status: 302,
      headers: {
        location: proxyUrl(target, 'mp4', title, postId || postIdFromUrl(src)),
        'cache-control': 'private, no-store',
      },
    })
  } catch {
    return downloadError(
      req,
      'Versi resolusi tertinggi tidak bisa diambil untuk video ini.',
      'Coba pilih "Video (no watermark)".',
      'hd_failed',
      400,
    )
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchMedia(url: string, range?: string, timeoutMs?: number): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': UA_BROWSER }
  // CDN TikTok butuh Referer snaptik; CDN X (twimg) justru menolak Referer
  // pihak ketiga dengan 403, jadi hanya kirim Referer untuk non-twimg.
  if (!hostMatches(url, ['twimg.com'])) headers.Referer = 'https://snaptik.app/'
  if (range) headers.Range = range
  return fetch(url, {
    headers,
    redirect: 'follow',
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  })
}

async function handleDownload(req: Request): Promise<Response> {
  const limited = rateLimit(req, 'download', RATE_MAX_DOWNLOAD)
  if (limited) return limited

  const params = new URL(req.url).searchParams
  const src = params.get('u') ?? ''
  if (!src) {
    return downloadError(req, 'Parameter u wajib.', 'Sertakan URL media di parameter u.', 'bad_request', 400)
  }
  try {
    assertPublicHttp(src)
  } catch (err) {
    if (err instanceof ApiFail) {
      return downloadError(req, err.message, err.hint, err.code, err.status)
    }
    throw err
  }
  // Hanya izinkan host CDN yang relevan, bukan sembarang situs.
  if (!hostMatches(src, MEDIA_HOSTS)) {
    return downloadError(
      req,
      'Host unduhan tidak diizinkan.',
      'Hanya CDN media TikTok, Threads, atau X yang bisa dipakai.',
      'unsafe_url',
      400,
    )
  }

  const range = req.headers.get('range') ?? undefined
  let upstream: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchMedia(src, range)
      upstream = res
      if (res.ok || res.status === 206 || (res.status < 500 && res.status !== 429)) break
    } catch {
      /* coba lagi */
    }
    if (attempt < 2) await sleep(250 * (attempt + 1))
  }
  if (!upstream) {
    return downloadError(
      req,
      'Gagal mengunduh.',
      'Koneksi ke server penyimpanan terputus. Coba lagi.',
      'upstream',
      502,
    )
  }
  if (!upstream.ok && upstream.status !== 206) {
    return downloadError(
      req,
      'Gagal mengunduh.',
      'Server penyimpanan sedang bermasalah. Coba lagi sebentar lagi.',
      'upstream',
      502,
    )
  }
  const contentType = upstream.headers.get('content-type') ?? ''
  // CDN membalas HTML/JSON saat sesi atau token ditolak. Jangan pernah simpan
  // respons itu sebagai .mp4/.jpg — pengguna akan mendapatkan file JSON rusak.
  if (isNonMediaContentType(contentType)) {
    return downloadError(
      req,
      'Server media menolak permintaan ini.',
      'Tautan media mungkin sudah kedaluwarsa. Tekan "Periksa tautan" lagi untuk URL baru.',
      'upstream',
      502,
    )
  }

  // Ekstensi dari content-type/URL; kalau generik, pakai petunjuk `e` dari resolver
  // (mis. CDN rapidcdn membalas application/octet-stream pada URL tanpa ekstensi).
  let ext = guessExt(src, contentType)
  const hintedRaw = (params.get('e') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toLowerCase()
  const hinted = HINT_EXTS.has(hintedRaw) ? (hintedRaw === 'jpeg' ? 'jpg' : hintedRaw) : ''
  if (ext === 'bin' && hinted) ext = hinted
  const name = downloadName(params.get('f') ?? '', ext)
  const fallback = params.get('p') ?? safeName(src, '')
  const headers = new Headers()
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream')
  headers.set('content-disposition', contentDisposition(name, fallback))
  // Penting: tanpa ini Cloudflare edge bisa meng-cache response upstream untuk URL
  // /api/dl?u=... dan menyajikan berkas basi ke pengguna berikutnya.
  headers.set('cache-control', 'private, no-store')
  // HEAD (dipakai sebagian browser/pengunduh untuk cek ukuran) tidak boleh punya body.
  if (req.method === 'HEAD') return new Response(null, { status: upstream.status, headers })
  return new Response(upstream.body, { status: upstream.status, headers })
}

const MAX_ZIP_ITEM_BYTES = 10 * 1024 * 1024
const MAX_ZIP_TOTAL_BYTES = 40 * 1024 * 1024

async function handleZip(req: Request): Promise<Response> {
  const limited = rateLimit(req, 'zip', RATE_MAX_ZIP)
  if (limited) return limited

  const params = new URL(req.url).searchParams
  const urls = [...params.getAll('u')]
  if (!urls.length || urls.length > 30) {
    return downloadError(
      req,
      'Jumlah gambar tidak valid.',
      'Sertakan 1–30 URL gambar di parameter u.',
      'bad_request',
      400,
    )
  }
  for (const u of urls) {
    try {
      assertPublicHttp(u)
    } catch (err) {
      if (err instanceof ApiFail) {
        return downloadError(req, err.message, err.hint, err.code, err.status)
      }
      throw err
    }
    // Allowlist yang sama dengan /api/dl — /api/zip tidak boleh jadi proxy bebas.
    if (!hostMatches(u, MEDIA_HOSTS)) {
      return downloadError(
        req,
        'Host gambar tidak diizinkan.',
        'Hanya CDN media TikTok, Threads, atau X yang bisa dipakai.',
        'unsafe_url',
        400,
      )
    }
  }

  const items: Array<{ name: string; data: Uint8Array }> = []
  let totalBytes = 0
  let i = 0
  for (const u of urls) {
    i++
    try {
      const res = await fetchMedia(u, undefined, 20_000)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Halaman login/error JSON jangan ikut dimasukkan sebagai gambar.
      if (isNonMediaContentType(res.headers.get('content-type') ?? '')) throw new Error('non-media')
      const declared = Number(res.headers.get('content-length') ?? '')
      if (Number.isFinite(declared) && declared > MAX_ZIP_ITEM_BYTES) {
        return downloadError(
          req,
          `Gambar ${i} terlalu besar.`,
          'Ukuran maksimal per gambar 10 MB.',
          'too_large',
          413,
        )
      }
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!buf.length) throw new Error('empty')
      if (buf.length > MAX_ZIP_ITEM_BYTES) {
        return downloadError(
          req,
          `Gambar ${i} terlalu besar.`,
          'Ukuran maksimal per gambar 10 MB.',
          'too_large',
          413,
        )
      }
      totalBytes += buf.length
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        return downloadError(
          req,
          'Total gambar terlalu besar.',
          'Ukuran maksimal arsip 40 MB.',
          'too_large',
          413,
        )
      }
      const guessed = guessExt(u, res.headers.get('content-type') ?? '')
      const ext = guessed === 'bin' ? 'jpg' : guessed
      items.push({ name: `${String(i).padStart(2, '0')}.${ext}`, data: buf })
    } catch {
      return downloadError(
        req,
        `Gagal mengunduh gambar ${i}.`,
        'Coba lagi sebentar lagi.',
        'upstream',
        502,
      )
    }
  }
  const zip = makeZip(items)
  const name = downloadName(params.get('f') ?? '', 'zip')
  const headers = {
    'content-type': 'application/zip',
    'content-disposition': contentDisposition(name, params.get('p') ?? ''),
    'cache-control': 'private, no-store',
  }
  if (req.method === 'HEAD') return new Response(null, { headers })
  return new Response(zip, { headers })
}

export default {
  async fetch(req: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    // Semua handler boleh melempar ApiFail (mis. assertPublicHttp). Tanpa
    // penangkap di sini, lemparan itu jadi 500 text/plain dari runtime dan
    // klien tidak bisa menampilkan pesan yang benar.
    try {
      return finalize(req, await route(req, env))
    } catch (err) {
      if (err instanceof ApiFail) {
        return finalize(req, json({ error: err.message, hint: err.hint, code: err.code }, err.status))
      }
      return finalize(
        req,
        json(
          { error: 'Terjadi kesalahan tak terduga.', hint: 'Coba lagi sebentar lagi.', code: 'unknown' },
          500,
        ),
      )
    }
  },
} satisfies ExportedHandler<{ ASSETS: Fetcher }>

async function route(req: Request, env: { ASSETS: Fetcher }): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  // Paksa HTTPS + HSTS. `cf-ray` hanya ada di Cloudflare produksi; wrangler dev
  // memetakan request lokal ke custom domain lewat HTTP, jadi jangan redirect di sana.
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !isLocal && req.headers.get('cf-ray')) {
    const target = new URL(url)
    target.protocol = 'https:'
    return new Response(null, {
      status: 301,
      headers: { location: target.toString(), 'cache-control': 'no-store' },
    })
  }
  // Kanonik: www -> apex (butuh route www di wrangler.jsonc).
  if (url.hostname === 'www.pluck.alva.web.id') {
    const target = new URL(url)
    target.hostname = 'pluck.alva.web.id'
    return new Response(null, {
      status: 301,
      headers: { location: target.toString(), 'cache-control': 'no-store' },
    })
  }

  if (req.method === 'OPTIONS') {
    const cors = corsHeaders(req)
    const headers: Record<string, string> = {
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    }
    if (cors) Object.assign(headers, cors)
    return new Response(null, { status: 204, headers })
  }

  if (path === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    return json({ ok: true, platforms: ['tiktok', 'threads', 'twitter'] })
  }
  if (path === '/api/resolve' && req.method === 'POST') {
    return handleResolve(req)
  }
  if (path === '/api/dl' && (req.method === 'GET' || req.method === 'HEAD')) {
    return handleDownload(req)
  }
  if (path === '/api/zip' && (req.method === 'GET' || req.method === 'HEAD')) {
    return handleZip(req)
  }
  if (path === '/api/hdresolve' && req.method === 'GET') {
    return handleHdResolve(
      req,
      url.searchParams.get('u') ?? '',
      url.searchParams.get('f') ?? '',
      url.searchParams.get('p') ?? '',
    )
  }

  // Jaring pengaman: rute /api/* yang tidak dikenal JANGAN jatuh ke SPA.
  // Tanpa ini, fallback single-page-application menyajikan index.html
  // (text/html) — Cloudflare meng-cache-nya, lalu unduhan memakai URL itu
  // malah tersimpan sebagai .htm. Selalu balas JSON dengan no-store.
  if (path === '/api' || path.startsWith('/api/')) {
    return json(
      { error: 'Endpoint tidak ditemukan.', hint: 'Periksa kembali URL endpoint API.', code: 'not_found' },
      404,
    )
  }

  // Static assets (SPA frontend).
  try {
    return await env.ASSETS.fetch(req)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
