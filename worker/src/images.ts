/** TikTok photo posts + Threads media — port dari app/extractors/images.py.
 *
 *  TikTok  -> tikwm.com API publik (array `images`, JPEG besar).
 *  Threads -> JSON server-rendered dari halaman post itu sendiri, memakai UA
 *             Googlebot: Meta merender data CDN lengkap untuk link-preview crawler.
 *             video_versions dipakai juga untuk video Threads (pengganti plugin
 *             yt-dlp yang tidak bisa berjalan di Workers).
 */
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const UA_GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const TIKWM = 'https://www.tikwm.com/api/'

export class ImageError extends Error {
  hint: string
  code: string
  constructor(message: string, hint = '', code = 'no_images') {
    super(message)
    this.hint = hint
    this.code = code
  }
}

export interface ImageItem {
  index: number
  url: string
  width: number
  height: number
  isVideo: boolean
  /** URL video untuk item carousel (bila ada). */
  videoUrl?: string | null
}

export interface ImagePost {
  /** ID post asli (angka TikTok/Twitter, shortcode Threads). */
  id: string
  title: string
  author: string
  thumbnail: string
  duration: number | null
  items: ImageItem[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ TikTok */

export async function tiktokPhoto(url: string): Promise<ImagePost> {
  let body: any
  try {
    const res = await fetch(`${TIKWM}?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': UA_BROWSER },
    })
    body = await res.json()
  } catch {
    throw new ImageError('Post ini tidak bisa dibaca.', 'Coba lagi sebentar lagi.', 'network')
  }
  if (body?.code !== 0) {
    throw new ImageError(
      'Post ini tidak bisa dibaca.',
      'Kemungkinan sudah dihapus, privat, atau tautannya bukan post TikTok.',
      'not_found',
    )
  }
  const data = body.data ?? {}
  const images: unknown[] = data.images ?? []
  if (!images.length) throw new ImageError('Post ini tidak berisi gambar.')

  const author = data.author?.unique_id ?? ''
  const items: ImageItem[] = []
  images.forEach((u: any, i: number) => {
    const imageUrl = typeof u === 'string' ? u : u?.url
    if (imageUrl) items.push({ index: items.length + 1, url: imageUrl, width: 0, height: 0, isVideo: false })
  })
  if (!items.length) throw new ImageError('Post ini tidak berisi gambar.')

  return {
    id: String(data.id ?? ''),
    title: (data.title ?? '').trim() || (author ? `TikTok ${author}` : 'Post TikTok'),
    author,
    thumbnail: data.cover ?? '',
    duration: typeof data.duration === 'number' ? data.duration : null,
    items,
  }
}

/* ----------------------------------------------------------------- Threads */

function scriptBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/json"[^>]*data-sjs>(.*?)<\/script>/gs)].map(
    (m) => m[1],
  )
}

/** Shortcode post yang diminta, dari bentuk /@user/post/<kode> atau /t/<kode>. */
function postCodeFromUrl(rawUrl: string): string | null {
  try {
    const m = /\/(?:post|t)\/([A-Za-z0-9_-]+)/.exec(new URL(rawUrl.trim()).pathname)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** SQL/JSON tree Threads memuat feed rekomendasi + balasan orang lain. Hanya
 *  objek dengan `code` yang sama dengan URL yang boleh dipakai; tanpa ini post
 *  yang tidak ada (atau quote-post) bisa mengembalikan media milik orang lain. */
function findPostByCode(node: unknown, code: string): Record<string, any> | null {
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findPostByCode(v, code)
      if (found) return found
    }
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, any>
    if (
      String(obj.code ?? '') === code &&
      (obj.pk != null || obj.user || obj.image_versions2 || obj.carousel_media || obj.video_versions)
    ) {
      return obj
    }
    for (const v of Object.values(obj)) {
      const found = findPostByCode(v, code)
      if (found) return found
    }
  }
  return null
}

/** Durasi video Threads hanya ada di manifest DASH (ISO-8601). */
function parseDashDuration(manifest: unknown): number | null {
  if (typeof manifest !== 'string') return null
  const raw = /mediaPresentationDuration="([^"]+)"/.exec(manifest)?.[1]
  const m = raw ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(raw) : null
  if (!m) return null
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return Number.isFinite(total) && total > 0 ? total : null
}

function mediaDuration(media: Record<string, any>, entries: Record<string, any>[]): number | null {
  if (typeof media.video_duration === 'number' && media.video_duration > 0) {
    return media.video_duration
  }
  const own = parseDashDuration(media.video_dash_manifest)
  if (own) return own
  for (const entry of entries) {
    if (typeof entry.video_duration === 'number' && entry.video_duration > 0) {
      return entry.video_duration
    }
    const d = parseDashDuration(entry.video_dash_manifest)
    if (d) return d
  }
  return null
}

function bestCandidate(media: Record<string, any>): { url: string; width: number; height: number } | null {
  const cands = media.image_versions2?.candidates ?? []
  if (!cands.length) return null
  const best = cands.reduce((a: any, b: any) =>
    (b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a,
  )
  return best?.url ? { url: best.url, width: best.width ?? 0, height: best.height ?? 0 } : null
}

function bestVideo(media: Record<string, any>): string | null {
  const vers = media.video_versions ?? []
  if (!vers.length) return null
  // Ambil yang beresolusi/bitrate tertinggi.
  const best = vers.reduce((a: any, b: any) =>
    (b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a,
  )
  return best?.url ?? null
}

function hasPlayableMedia(media: Record<string, any>): boolean {
  if (bestVideo(media)) return true
  if (Array.isArray(media.carousel_media) && media.carousel_media.length) {
    return media.carousel_media.some(
      (entry: Record<string, any>) => bestCandidate(entry) || bestVideo(entry),
    )
  }
  return Boolean(bestCandidate(media))
}

/** Ambil media dari satu post Threads: video ATAU gambar/carousel. */
export async function threadsPost(url: string): Promise<ImagePost & { videoUrl: string | null }> {
  const code = postCodeFromUrl(url)
  if (!code) {
    throw new ImageError(
      'Tautan Threads tidak valid.',
      'Gunakan tautan ke satu post, bentuknya threads.com/@user/post/<kode>.',
      'invalid_url',
    )
  }

  let html = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA_GOOGLEBOT, Accept: 'text/html,application/xhtml+xml' },
      })
      if (res.status === 404) {
        throw new ImageError(
          'Post Threads ini tidak bisa dibuka.',
          'Kemungkinan sudah dihapus, privat, atau hanya bisa dilihat setelah login.',
          'not_found',
        )
      }
      if (res.ok) {
        html = await res.text()
        break
      }
    } catch (err) {
      if (err instanceof ImageError) throw err
    }
    if (attempt < 2) await sleep(600 * (attempt + 1))
  }
  if (!html) {
    throw new ImageError(
      'Threads sedang tidak bisa dihubungi.',
      'Server Threads sedang bermasalah atau menolak permintaan. Coba lagi sebentar lagi.',
      'upstream',
    )
  }

  let media: Record<string, any> | null = null
  for (const block of scriptBlocks(html)) {
    let obj: unknown
    try {
      obj = JSON.parse(block)
    } catch {
      continue
    }
    media = findPostByCode(obj, code)
    if (media) break
  }

  if (!media) {
    // Halaman post yang tidak ada berisi feed rekomendasi (feedData) milik akun
    // lain. Jangan pernah memakai media dari sana.
    if (!html.includes(code) && !html.includes('feedData')) {
      throw new ImageError(
        'Threads sedang tidak bisa dihubungi.',
        'Server Threads sedang bermasalah atau menolak permintaan. Coba lagi sebentar lagi.',
        'upstream',
      )
    }
    throw new ImageError(
      'Post Threads ini tidak bisa dibuka.',
      'Kemungkinan sudah dihapus, privat, atau tautannya salah.',
      'not_found',
    )
  }

  // Post quote/repost bisa menyimpan media di post yang di-quote. Pakai media
  // itu, tapi judul/author tetap dari post terluar (bukan akun yang di-quote).
  const share = media.text_post_app_info?.share_info
  const shared = share?.quoted_post ?? share?.reposted_post
  const content: Record<string, any> =
    !hasPlayableMedia(media) && shared && hasPlayableMedia(shared) ? shared : media

  // Video tunggal: langsung pakai video_versions.
  const videoUrl = bestVideo(content)
  const entries: Record<string, any>[] = Array.isArray(content.carousel_media) && content.carousel_media.length
    ? content.carousel_media
    : [content]

  const items: ImageItem[] = []
  for (const entry of entries) {
    const best = bestCandidate(entry)
    if (!best) continue
    items.push({
      index: items.length + 1,
      url: best.url,
      width: best.width,
      height: best.height,
      isVideo: Boolean(entry.video_versions?.length),
      videoUrl: entry.video_versions?.length ? bestVideo(entry) : null,
    })
  }

  if (!items.length && !videoUrl) {
    throw new ImageError(
      'Post ini tidak berisi media.',
      'Pastikan tautannya mengarah ke post Threads yang ada gambar atau videonya.',
      'no_media',
    )
  }

  const user = media.user?.username ?? ''
  const caption: string = media.caption?.text ?? ''
  const title = caption.trim()
    ? caption.trim().split('\n')[0].slice(0, 120)
    : user
      ? `Threads ${user}`
      : 'Post Threads'
  const thumb = bestCandidate(media) ?? bestCandidate(content)

  return {
    id: code,
    title,
    author: user,
    thumbnail: thumb?.url ?? '',
    duration: mediaDuration(content, entries),
    items,
    videoUrl,
  }
}
