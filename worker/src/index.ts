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

/** Content-type yang menandakan upstream mengirim halaman web, bukan berkas media. */
function isHtmlContentType(ct: string): boolean {
  return ct.includes('text/html') || ct.includes('application/xhtml')
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

/** SSRF guard ringan: hanya http(s), blokir host internal/metadata. */
function assertPublicHttp(raw: string): void {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new ApiFail('URL tidak valid.', '', 'invalid_url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ApiFail('URL tidak valid.', '', 'invalid_url')
  }
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new ApiFail('URL tidak diizinkan.', '', 'unsafe_url')
  }
}

/* --------------------------------------------------------------- resolver */

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
    throw new ApiFail('Video ini gagal diambil.', 'Kemungkinan video privat, atau server sedang ditolak platform. Coba lagi sebentar lagi.')
  }

  const author = data.author?.username ?? ''
  let title = (data.title ?? '').trim()
  if (!title || title.startsWith('http://') || title.startsWith('https://')) {
    title = author ? `TikTok ${author}` : 'Video TikTok'
  }
  const formats: MediaFormat[] = []
  if (data.downloadUrl) {
    formats.push({ id: 'nowm', label: 'Video (no watermark)', ext: 'mp4', kind: 'video', url: proxyUrl(data.downloadUrl, 'mp4', title), size: null, note: '' })
  }
  if (data.hdDownloadUrl) {
    // /api/hd butuh token X-Verify baru; tunda sampai pengguna memilih format hd.
    formats.push({ id: 'hd', label: 'Video resolusi tertinggi', ext: 'mp4', kind: 'video', url: `/api/hdresolve?u=${encodeURIComponent(target)}&f=${encodeURIComponent(title)}`, size: null, note: 'ukuran file bisa lebih kecil' })
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
    if (err instanceof ImageError) throw new ApiFail(err.message, err.hint, err.code)
    throw err
  }
  const formats: MediaFormat[] = post.items.map((item) => ({
    id: `img${item.index}`,
    label: `Gambar ${item.index}`,
    ext: 'jpg',
    kind: 'image' as const,
    url: proxyUrl(item.url, 'jpg', post.title),
    size: null,
    note: '',
    thumb: proxyUrl(item.url, 'jpg'),
  }))
  if (formats.length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${formats.length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(post.items.map((i) => i.url), post.title),
      size: null,
      note: 'satu file',
    })
  }
  return {
    platform: 'tiktok',
    title: post.title,
    author: post.author,
    thumbnail: post.thumbnail,
    duration: null,
    formats,
  }
}

async function resolveThreads(rawUrl: string): Promise<ResolvedMedia> {
  let post
  try {
    post = await threadsPost(rawUrl.trim())
  } catch (err) {
    if (err instanceof ImageError) throw new ApiFail(err.message, err.hint, err.code)
    throw err
  }

  const formats: MediaFormat[] = []
  if (post.videoUrl) {
    formats.push({ id: 'video', label: 'Video (audio+video)', ext: 'mp4', kind: 'video', url: proxyUrl(post.videoUrl, 'mp4', post.title), size: null, note: '' })
  }
  for (const item of post.items) {
    if (item.isVideo) continue // video sudah ditangani lewat videoUrl
    formats.push({
      id: `img${item.index}`,
      label: `Gambar ${item.index}` + (item.width ? ` · ${item.width}×${item.height}` : ''),
      ext: 'jpg',
      kind: 'image',
      url: proxyUrl(item.url, 'jpg', post.title),
      size: null,
      note: '',
      thumb: proxyUrl(item.url, 'jpg'),
    })
  }
  if (formats.filter((f) => f.kind === 'image').length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${post.items.filter((i) => !i.isVideo).length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(post.items.filter((i) => !i.isVideo).map((i) => i.url), post.title),
      size: null,
      note: 'satu file',
    })
  }
  if (!formats.length) {
    throw new ApiFail('Post ini tidak berisi media yang bisa diunduh.', '', 'no_media')
  }
  return {
    platform: 'threads',
    title: post.title,
    author: post.author,
    thumbnail: post.thumbnail,
    duration: null,
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
    if (res.ok || res.status === 404) data = await res.json()
  } catch {
    throw new ApiFail('Post X ini gagal dibaca.', 'Coba lagi sebentar lagi.', 'network')
  }
  if (httpStatus === 0 || httpStatus >= 500) {
    throw new ApiFail('Post X ini gagal dibaca.', 'Coba lagi sebentar lagi.', 'network')
  }

  const tweet = data?.tweet
  if (httpStatus === 404 || !tweet || (typeof data?.code === 'number' && data.code !== 200)) {
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
      url: proxyUrl(url, 'mp4', title),
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
      url: proxyUrl(p.url, 'jpg', title),
      size: null,
      note: '',
      thumb: proxyUrl(p.url, 'jpg'),
    })
  })

  if (photos.length > 1) {
    formats.push({
      id: 'zip',
      label: `Semua gambar (.zip · ${photos.length} file)`,
      ext: 'zip',
      kind: 'image',
      url: zipUrl(photos.map((p) => p.url), title),
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

function proxyUrl(u: string, ext?: string, title?: string): string {
  // `e` = perkiraan ekstensi dari resolver. Dipakai kalau CDN membalas
  // content-type generik (application/octet-stream) dan URL tanpa ekstensi,
  // supaya berkas tidak tersimpan sebagai .bin.
  // `f` = judul post, dipakai sebagai dasar nama file unduhan.
  const params = new URLSearchParams({ u, n: nonce() })
  if (ext) params.set('e', ext)
  if (title) params.set('f', title)
  return `/api/dl?${params.toString()}`
}

function zipUrl(urls: string[], title?: string): string {
  const params = new URLSearchParams({ n: nonce() })
  for (const u of urls) params.append('u', u)
  if (title) params.set('f', title)
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

/** Fallback ASCII untuk header Content-Disposition. */
function asciiName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return ascii || 'download'
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

function contentDisposition(name: string): string {
  return `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeRFC5987(name)}`
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
  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body bukan JSON.', hint: '', code: 'bad_request' }, 400)
  }
  const url = (body.url ?? '').trim()
  if (url.length < 5 || url.length > 2000) {
    return json({ error: 'URL tidak valid.', hint: '', code: 'invalid_url' }, 400)
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

async function handleHdResolve(src: string, title: string): Promise<Response> {
  assertPublicHttp(src)
  if (!hostMatches(src, TIKTOK_HOSTS)) {
    return json({ error: 'URL tidak diizinkan.', hint: '', code: 'unsafe_url' }, 400)
  }
  try {
    const data = await extract(src, 6)
    const target = await hdUrl(data)
    if (!target) {
      return json({ error: 'Versi resolusi tertinggi tidak bisa diambil untuk video ini.', hint: 'Coba pilih "Video (no watermark)"; isinya biasanya sama.', code: 'hd_failed' }, 400)
    }
    // Relatif ke Worker ini (BUKAN Response.redirect, yang menyalin URL absolut
    // dan melewati proxy — CDN TikTok menolak hotlink tanpa referer yang benar).
    // `f` wajib diteruskan, kalau tidak nama file jatuh ke "PluckDL.mp4".
    return new Response(null, {
      status: 302,
      headers: { location: proxyUrl(target, 'mp4', title), 'cache-control': 'private, no-store' },
    })
  } catch {
    return json({ error: 'Versi resolusi tertinggi tidak bisa diambil untuk video ini.', hint: 'Coba pilih "Video (no watermark)".', code: 'hd_failed' }, 400)
  }
}

async function fetchMedia(url: string, range?: string): Promise<Response> {
  const headers: Record<string, string> = { 'User-Agent': UA_BROWSER }
  // CDN TikTok butuh Referer snaptik; CDN X (twimg) justru menolak Referer
  // pihak ketiga dengan 403, jadi hanya kirim Referer untuk non-twimg.
  if (!hostMatches(url, ['twimg.com'])) headers.Referer = 'https://snaptik.app/'
  if (range) headers.Range = range
  return fetch(url, { headers, redirect: 'follow' })
}

async function handleDownload(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const src = params.get('u') ?? ''
  if (!src) return json({ error: 'Parameter u wajib.', hint: '', code: 'bad_request' }, 400)
  assertPublicHttp(src)
  // Hanya izinkan host CDN yang relevan, bukan sembarang situs.
  const allowed = [
    'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com',
    'byteoversea.com', 'ibyteimg.com', 'tikwm.com', 'snaptik.app', 'rapidcdn.app',
    'cdninstagram.com', 'fbcdn.net', 'threads.com', 'threads.net',
    'twimg.com',
  ]
  if (!hostMatches(src, allowed)) {
    return json({ error: 'Host unduhan tidak diizinkan.', hint: '', code: 'unsafe_url' }, 400)
  }

  const range = req.headers.get('range') ?? undefined
  let upstream: Response
  try {
    upstream = await fetchMedia(src, range)
  } catch {
    return json({ error: 'Gagal mengunduh.', hint: 'Koneksi ke server penyimpanan terputus. Coba lagi.', code: 'upstream' }, 502)
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: 'Gagal mengunduh.', hint: 'Koneksi ke server penyimpanan terputus. Coba lagi.', code: 'upstream' }, 502)
  }
  const contentType = upstream.headers.get('content-type') ?? ''
  // CDN Threads/Instagram membalas HTML halaman login saat sesi/URL ditolak.
  // Menyimpannya sebagai .mp4/.htm menyesatkan pengguna — tolak dengan pesan jelas.
  if (isHtmlContentType(contentType)) {
    return json(
      { error: 'Server media menolak permintaan ini.', hint: 'Tautan media mungkin sudah kedaluwarsa. Tekan "Periksa tautan" lagi untuk URL baru.', code: 'upstream' },
      502,
    )
  }

  // Ekstensi dari content-type/URL; kalau generik, pakai petunjuk `e` dari resolver
  // (mis. CDN rapidcdn membalas application/octet-stream pada URL tanpa ekstensi).
  let ext = guessExt(src, contentType)
  const hinted = (params.get('e') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toLowerCase()
  if (ext === 'bin' && hinted) ext = hinted
  const name = downloadName(params.get('f') ?? '', ext)
  const headers = new Headers()
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream')
  headers.set('content-disposition', contentDisposition(name))
  // Penting: tanpa ini Cloudflare edge bisa meng-cache response upstream untuk URL
  // /api/dl?u=... dan menyajikan berkas basi ke pengguna berikutnya.
  headers.set('cache-control', 'private, no-store')
  // HEAD (dipakai sebagian browser/pengunduh untuk cek ukuran) tidak boleh punya body.
  if (req.method === 'HEAD') return new Response(null, { status: upstream.status, headers })
  return new Response(upstream.body, { status: upstream.status, headers })
}

async function handleZip(req: Request): Promise<Response> {
  const urls = [...new URL(req.url).searchParams.getAll('u')]
  if (!urls.length || urls.length > 30) {
    return json({ error: 'Jumlah gambar tidak valid.', hint: '', code: 'bad_request' }, 400)
  }
  for (const u of urls) assertPublicHttp(u)

  const items: Array<{ name: string; data: Uint8Array }> = []
  let i = 0
  for (const u of urls) {
    i++
    try {
      const res = await fetchMedia(u)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Halaman login/kedaluwarsa jangan ikut dimasukkan sebagai .jpg.
      if (isHtmlContentType(res.headers.get('content-type') ?? '')) throw new Error('html')
      const buf = new Uint8Array(await res.arrayBuffer())
      if (!buf.length) throw new Error('empty')
      items.push({ name: `${String(i).padStart(2, '0')}.jpg`, data: buf })
    } catch {
      return json({ error: `Gagal mengunduh gambar ${i}.`, hint: 'Coba lagi sebentar lagi.', code: 'upstream' }, 502)
    }
  }
  const zip = makeZip(items)
  const name = downloadName(new URL(req.url).searchParams.get('f') ?? '', 'zip')
  const headers = {
    'content-type': 'application/zip',
    'content-disposition': contentDisposition(name),
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
      return await route(req, env)
    } catch (err) {
      if (err instanceof ApiFail) {
        return json({ error: err.message, hint: err.hint, code: err.code }, err.status)
      }
      return json(
        { error: 'Terjadi kesalahan tak terduga.', hint: 'Coba lagi sebentar lagi.', code: 'unknown' },
        500,
      )
    }
  },
} satisfies ExportedHandler<{ ASSETS: Fetcher }>

async function route(req: Request, env: { ASSETS: Fetcher }): Promise<Response> {
  const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Content-Type',
        },
      })
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
        url.searchParams.get('u') ?? '',
        url.searchParams.get('f') ?? '',
      )
    }

    // Jaring pengaman: rute /api/* yang tidak dikenal JANGAN jatuh ke SPA.
    // Tanpa ini, fallback single-page-application menyajikan index.html
    // (text/html) — Cloudflare meng-cache-nya, lalu unduhan memakai URL itu
    // malah tersimpan sebagai .htm. Selalu balas JSON dengan no-store.
    if (path === '/api' || path.startsWith('/api/')) {
      return json({ error: 'Endpoint tidak ditemukan.', hint: '', code: 'not_found' }, 404)
    }

    // Static assets (SPA frontend).
    try {
      return await env.ASSETS.fetch(req)
    } catch {
      return new Response('Not found', { status: 404 })
    }
}
