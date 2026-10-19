/** Tipe bersama + klien API (Worker). Logika pemrosesan URL dipisah dari komponen
 *  visual (design.md §14: "Pisahkan komponen visual dari logika pemrosesan URL dan API").
 *
 *  Berbeda dari backend Python lama: tidak ada job/polling. `/api/resolve` langsung
 *  mengembalikan URL unduhan per format, dan unduhan lewat `/api/dl` proxy di Worker.
 */

export type PlatformId = 'tiktok' | 'threads' | 'twitter'

export interface Platform {
  id: PlatformId
  label: string
  /** host yang dianggap milik platform ini */
  hosts: string[]
  /** domain pemendek tautan (redirect ke host di atas) */
  shortHosts?: string[]
  /** contoh URL untuk helper text (§6.4) */
  example: string
  /** false = disembunyikan dari UI tapi definisinya tetap ada (mudah diaktifkan lagi) */
  enabled: boolean
}

/** Daftar platform yang dikenal. Workers menangani TikTok, Threads, dan X. */
export const PLATFORMS: Platform[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    hosts: ['tiktok.com', 'douyin.com'],
    shortHosts: [
      'vt.tiktok.com',
      'vm.tiktok.com',
      't.tiktok.com',
      'vt.tiktokv.com',
      'tt.site',
    ],
    example: 'https://www.tiktok.com/@user/video/1234…',
    enabled: true,
  },
  {
    id: 'threads',
    label: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    example: 'https://www.threads.com/@user/post/ABC123xyz',
    enabled: true,
  },
  {
    id: 'twitter',
    label: 'X',
    hosts: ['x.com', 'twitter.com'],
    example: 'https://x.com/user/status/1234567890',
    enabled: true,
  },
]

/** Platform yang benar-benar ditampilkan di UI. */
export const ACTIVE_PLATFORMS: Platform[] = PLATFORMS.filter((p) => p.enabled)

export interface MediaFormat {
  id: string
  label: string
  ext: string
  kind: 'video' | 'audio' | 'image'
  /** URL unduhan (relatif, lewat /api/dl atau /api/zip di Worker). */
  url: string
  size: number | null
  note: string
  /** Untuk post gambar: URL gambar itu, dipakai sebagai thumbnail pilihan. */
  thumb?: string
}

export interface ResolvedMedia {
  platform: PlatformId
  title: string
  author: string
  thumbnail: string
  duration: number | null
  formats: MediaFormat[]
}

export interface ApiError {
  error: string
  hint: string
  code: string
}

/** Error yang membawa pesan ramah + saran tindakan (§6.5, §15). */
export class RequestError extends Error {
  hint: string
  code: string
  constructor(message: string, hint = '', code = 'unknown') {
    super(message)
    this.hint = hint
    this.code = code
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* bukan JSON */
  }
  if (!res.ok) {
    const b = body as Partial<ApiError>
    throw new RequestError(
      b?.error || `Permintaan gagal (HTTP ${res.status}).`,
      b?.hint || '',
      b?.code || 'http_error',
    )
  }
  return body as T
}

export async function resolveUrl(url: string): Promise<ResolvedMedia> {
  const res = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return parse<ResolvedMedia>(res)
}

/* ── Helper tampilan ─────────────────────────────────────────────── */

export function humanSize(bytes: number | null): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function humanDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function platformById(id: PlatformId): Platform {
  return PLATFORMS.find((p) => p.id === id) ?? ACTIVE_PLATFORMS[0]
}

/** Label platform aktif untuk pesan error, mis. "TikTok dan Threads". */
export function activePlatformLabels(): string {
  const names = ACTIVE_PLATFORMS.map((p) => p.label)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]}`
}

/** Cocokkan URL ke platform berdasarkan host — bukan sekadar "mengandung nama domain" (§6.2). */
export function platformOfUrl(raw: string): Platform | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  const match = (hosts?: string[]) =>
    Boolean(hosts?.some((h) => host === h || host.endsWith(`.${h}`)))
  return (
    PLATFORMS.find((p) => match(p.hosts) || match(p.shortHosts)) ?? null
  )
}

/** True bila tautan memakai domain pemendek (perlu di-follow server dulu). */
export function isShortLink(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  return PLATFORMS.some((p) =>
    p.shortHosts?.some((h) => host === h || host.endsWith(`.${h}`)),
  )
}

export type ValidationResult =
  | { ok: true; platform: Platform }
  | {
      ok: false
      reason: 'empty' | 'invalid' | 'unsupported' | 'disabled' | 'incomplete'
      message: string
      /** nama platform, diisi untuk reason 'disabled' (dipakai i18n). */
      platformLabel?: string
    }

/**
 * Apakah tautan sudah menunjuk ke SATU post (bukan sekadar host atau profil)?
 *
 * Dipakai untuk memutuskan kapan resolve otomatis boleh jalan. Tanpa ini, mengetik
 * `https://www.tiktok.com/@user` sudah memicu resolve dan menampilkan "video tidak
 * tersedia" padahal pengguna belum selesai mengetik.
 */
export function looksComplete(raw: string): boolean {
  const platform = platformOfUrl(raw.trim())
  if (!platform) return false
  const url = raw.trim()
  // Tautan pendek sudah "lengkap" apa adanya: server yang akan mengikuti
  // redirect-nya. Bentuknya tidak bisa divalidasi lebih jauh dari sisi klien.
  if (isShortLink(url)) return true
  if (platform.id === 'tiktok') {
    // /@user/video/<id>, /@user/photo/<id>, atau /t/<kode>
    if (/\/(video|photo|v)\/\d{6,}/i.test(url)) return true
    if (/\/t\/[A-Za-z0-9]{4,}/i.test(url)) return true
    return false
  }
  if (platform.id === 'twitter') {
    // /<user>/status/<id> — juga cocok untuk akhiran /photo/1 atau /video/1.
    return /\/status\/\d{6,}/i.test(url)
  }
  // threads: /@user/post/<kode> atau /t/<kode>
  return /\/post\/[A-Za-z0-9_-]{4,}/i.test(url) || /\/t\/[A-Za-z0-9_-]{4,}/i.test(url)
}

/**
 * Validasi klien untuk feedback cepat; server tetap memvalidasi ulang (§6.2).
 *
 * Platform dideteksi dari tautannya sendiri, jadi tidak ada kemungkinan "salah tab".
 */
export function validateUrl(raw: string): ValidationResult {
  const url = raw.trim()
  if (!url) return { ok: false, reason: 'empty', message: '' }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: 'incomplete', message: '' }
  }
  const platform = platformOfUrl(url)
  if (!platform) {
    // Host belum lengkap (mis. "https://www.tik") — jangan tuduh salah platform
    // selagi pengguna masih mengetik.
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return { ok: false, reason: 'incomplete', message: '' }
    }
    if (!host.includes('.') || host.endsWith('.')) {
      return { ok: false, reason: 'incomplete', message: '' }
    }
    return {
      ok: false,
      reason: 'unsupported',
      message: `Tautan ini belum didukung. Saat ini hanya ${activePlatformLabels()}.`,
    }
  }
  if (!platform.enabled) {
    return {
      ok: false,
      reason: 'disabled',
      message: `${platform.label} belum tersedia di sini. Saat ini hanya ${activePlatformLabels()}.`,
      platformLabel: platform.label,
    }
  }
  if (!looksComplete(url)) {
    // Host sudah benar tapi belum ada id post — jangan resolve dulu.
    return { ok: false, reason: 'incomplete', message: '' }
  }
  return { ok: true, platform }
}
