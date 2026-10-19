import { useState } from 'react'
import { Download, FileVideo, ImageIcon, Music4 } from 'lucide-react'
import {
  humanDuration,
  humanSize,
  platformById,
  type MediaFormat,
  type ResolvedMedia,
} from '../lib/api'
import PlatformIcon from './PlatformIcon'
import ImageGallery from './ImageGallery'
import { useI18n } from '../lib/i18n'

const KIND_ICON = { video: FileVideo, audio: Music4, image: ImageIcon } as const

/** Hasil: metadata nyata dari backend + hanya format yang benar-benar tersedia.
 *  Tidak ada progress server — unduhan berjalan langsung di browser lewat /api/dl. */
export default function DownloadResult({
  media,
  activeFormat,
  onPick,
}: {
  media: ResolvedMedia
  activeFormat: string | null
  onPick: (formatId: string) => void
}) {
  const { t } = useI18n()
  const platform = platformById(media.platform)
  const [thumbFailed, setThumbFailed] = useState(false)
  const showThumb = Boolean(media.thumbnail) && !thumbFailed
  // Post gambar/carousel punya banyak format image -> tampilkan galeri, bukan daftar baris.
  const isGallery = media.formats.some((f) => f.kind === 'image')
  const listFormats = isGallery ? media.formats.filter((f) => f.kind !== 'image') : media.formats
  const imageCount = media.formats.filter((f) => f.kind === 'image' && f.id !== 'zip').length

  /** Label format diturunkan dari id (stabil) supaya ikut bahasa yang aktif. */
  function labelOf(f: MediaFormat): string {
    if (f.id === 'nowm') return t('fmt.nowm')
    if (f.id === 'hd') return t('fmt.hd')
    if (f.id === 'zip') return t('fmt.zip', { n: imageCount })
    if (f.id.startsWith('img')) {
      const dims = /(\d+×\d+)/.exec(f.label)?.[1]
      return t('fmt.image', { n: f.id.slice(3) }) + (dims ? ` · ${dims}` : '')
    }
    const numbered = /^video(\d+)$/.exec(f.id)
    if (numbered) return t('fmt.videoN', { n: numbered[1] })
    return t('fmt.video')
  }

  function noteOf(note: string): string {
    if (note === 'satu file') return t('note.singleFile')
    if (note === 'ukuran file bisa lebih kecil') return t('note.smaller')
    return note
  }

  return (
    <div className="mt-4 rounded-xl border border-line-2 bg-surface-2 p-3.5 sm:p-4">
      {/* Metadata */}
      <div className="flex gap-3">
        {showThumb ? (
          <img
            src={media.thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbFailed(true)}
            className="size-[68px] shrink-0 rounded-lg border border-line-2 bg-surface-3 object-cover sm:size-[80px]"
          />
        ) : (
          <div className="flex size-[68px] shrink-0 items-center justify-center rounded-lg border border-line-2 bg-surface-3 sm:size-[80px]">
            <FileVideo className="size-5 text-faint" aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14px] font-medium leading-snug text-ink">{media.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-wide text-faint">
            <span className="inline-flex items-center gap-1.5">
              <PlatformIcon id={platform.id} size="sm" />
              <span className="text-muted">{platform.label}</span>
            </span>
            {media.author && <span className="truncate">@{media.author.replace(/^@/, '')}</span>}
            {media.duration ? <span>· {humanDuration(media.duration)}</span> : null}
          </div>
        </div>
      </div>

      {/* Pilihan format — hanya yang dikirim backend */}
      {isGallery && <ImageGallery formats={media.formats} />}

      <div className="mt-4 grid gap-2">
        {listFormats.map((f) => {
          const Icon = KIND_ICON[f.kind] ?? FileVideo
          const selected = activeFormat === f.id
          return (
            <a
              key={f.id}
              href={f.url}
              onClick={() => onPick(f.id)}
              download
              aria-pressed={selected}
              className={[
                'group flex min-h-[56px] items-center gap-3 rounded-lg border px-3.5 text-left transition-colors',
                selected ? 'border-focus bg-surface-3' : 'border-line-2 bg-surface hover:border-line-3',
              ].join(' ')}
            >
              <Icon className="size-[17px] shrink-0 text-muted" strokeWidth={2} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{labelOf(f)}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-faint">
                  .{f.ext}
                  {f.size ? ` · ${humanSize(f.size)}` : ''}
                  {f.note ? ` · ${noteOf(f.note)}` : ''}
                </span>
              </span>
              <span
                className={[
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
                  selected
                    ? 'border-line-3 text-ink'
                    : 'border-transparent text-faint group-hover:text-ink',
                ].join(' ')}
              >
                <Download className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                {t('action.download')}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

export type { MediaFormat }
