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
}

export interface ImagePost {
  title: string
  author: string
  thumbnail: string
  items: ImageItem[]
}

/* ------------------------------------------------------------------ TikTok */

export async function tiktokPhoto(url: string): Promise<ImagePost> {
  let body: any
  try {
    const res = await fetch(`${TIKWM}?url=${encodeURIComponent(url)}&hd=1`, {
      headers: { 'User-Agent': UA_BROWSER },
    })
    body = await res.json()
  } catch {
    throw new ImageError('Post ini tidak bisa dibaca.', 'Coba lagi sebentar lagi.')
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
    title: (data.title ?? '').trim() || (author ? `TikTok ${author}` : 'Post TikTok'),
    author,
    thumbnail: data.cover ?? '',
    items,
  }
}

/* ----------------------------------------------------------------- Threads */

function scriptBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/json"[^>]*data-sjs>(.*?)<\/script>/gs)].map(
    (m) => m[1],
  )
}

function* findMediaNodes(node: unknown): Generator<Record<string, any>> {
  if (Array.isArray(node)) {
    for (const v of node) yield* findMediaNodes(v)
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, any>
    if (Array.isArray(obj.carousel_media) || (obj.image_versions2 && typeof obj.image_versions2 === 'object')) {
      yield obj
    }
    for (const v of Object.values(obj)) yield* findMediaNodes(v)
  }
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

/** Ambil media dari satu post Threads: video ATAU gambar/carousel. */
export async function threadsPost(url: string): Promise<ImagePost & { videoUrl: string | null }> {
  let html: string
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA_GOOGLEBOT } })
    if (!res.ok) throw new ImageError(
      'Post Threads ini tidak bisa dibuka.',
      'Kemungkinan sudah dihapus, privat, atau hanya bisa dilihat setelah login.',
      'not_found',
    )
    html = await res.text()
  } catch (err) {
    if (err instanceof ImageError) throw err
    throw new ImageError('Tidak bisa menghubungi Threads.', 'Koneksi sedang bermasalah. Coba lagi sebentar lagi.', 'network')
  }

  let media: Record<string, any> | null = null
  outer: for (const block of scriptBlocks(html)) {
    let obj: unknown
    try {
      obj = JSON.parse(block)
    } catch {
      continue
    }
    for (const node of findMediaNodes(obj)) {
      if (Array.isArray(node.carousel_media) && node.carousel_media.length) {
        media = node
        break outer
      }
      if (bestCandidate(node) || bestVideo(node)) {
        media = node
        break outer
      }
    }
  }

  if (!media) {
    throw new ImageError(
      'Post ini tidak berisi media.',
      'Pastikan tautannya mengarah ke post Threads yang ada gambar atau videonya.',
      'no_media',
    )
  }

  // Video tunggal: langsung pakai video_versions.
  const videoUrl = bestVideo(media)
  const entries: Record<string, any>[] = Array.isArray(media.carousel_media) && media.carousel_media.length
    ? media.carousel_media
    : [media]

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
    })
  }

  const user = media.user?.username ?? ''
  const caption: string = media.caption?.text ?? ''
  const title = caption.trim()
    ? caption.trim().split('\n')[0].slice(0, 120)
    : user
      ? `Threads ${user}`
      : 'Post Threads'
  const thumb = bestCandidate(media)

  return { title, author: user, thumbnail: thumb?.url ?? '', items, videoUrl }
}
