/** Tipe bersama antara Worker dan frontend. */
export type PlatformId = 'tiktok' | 'threads' | 'twitter'

export interface MediaFormat {
  id: string
  label: string
  ext: string
  kind: 'video' | 'audio' | 'image'
  /** URL unduhan (kadang relatif ke /api/dl). */
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
