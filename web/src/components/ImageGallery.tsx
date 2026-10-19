import { useState } from 'react'
import { Download, FileArchive, ImageIcon } from 'lucide-react'
import { humanSize, type MediaFormat } from '../lib/api'
import { useI18n } from '../lib/i18n'

/** Galeri untuk post gambar / carousel.
 *
 *  Kenapa terpisah dari daftar format biasa: carousel bisa berisi 14+ gambar, sehingga
 *  deretan baris teks "Gambar 1..14" sulit dipindai. Setiap gambar tampil sebagai thumbnail
 *  yang bisa diketuk untuk diunduh, plus satu tombol "unduh semua sebagai .zip". */
export default function ImageGallery({ formats }: { formats: MediaFormat[] }) {
  const { t } = useI18n()
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const images = formats.filter((f) => f.kind === 'image' && f.id !== 'zip')
  const zip = formats.find((f) => f.id === 'zip')

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="font-mono text-[11px] uppercase tracking-wide text-faint">
          {images.length > 1 ? t('gallery.countMany', { n: images.length }) : t('gallery.countOne')}
        </p>
        <p className="text-[12px] text-faint">
          {images.length > 1 ? t('gallery.tapAll') : t('gallery.tapOne')}
        </p>
      </div>

      {/* Unduh semua sebagai zip — di atas grid agar tidak perlu scroll melewati thumbnail. */}
      {zip && (
        <a
          href={zip.url}
          download
          aria-label={t('gallery.ariaZip')}
          className="group mt-2.5 flex min-h-[56px] w-full items-center gap-3 rounded-lg border border-line-2 bg-surface px-3.5 text-left transition-colors hover:border-line-3"
        >
          <FileArchive className="size-[17px] shrink-0 text-muted" strokeWidth={2} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-ink">
              {t('gallery.downloadAll')}
            </span>
            <span className="mt-0.5 block font-mono text-[11px] text-faint">
              {t('gallery.zipFiles', { n: images.length })}
              {zip.size ? ` · ${humanSize(zip.size)}` : ''}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1 text-[12px] font-medium text-faint transition-colors group-hover:text-ink">
            <Download className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            {t('action.download')}
          </span>
        </a>
      )}

      {/* Grid thumbnail — 3 kolom di ponsel, lebih banyak di layar lebar. */}
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {images.map((f) => {
          const failed = broken[f.id]
          return (
            <li key={f.id}>
              <a
                href={f.url}
                download
                aria-label={t('gallery.ariaImage', { label: t('fmt.image', { n: f.id.replace('img', '') }) })}
                className="group relative block w-full overflow-hidden rounded-lg border border-line-2 transition-colors hover:border-line-3"
              >
                <span className="block aspect-[3/4] bg-surface-3">
                  {failed || !f.thumb ? (
                    <span className="flex size-full items-center justify-center">
                      <ImageIcon className="size-5 text-faint" aria-hidden="true" />
                    </span>
                  ) : (
                    <img
                      src={f.thumb}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => setBroken((b) => ({ ...b, [f.id]: true }))}
                      className="size-full object-cover"
                    />
                  )}
                </span>

                {/* Nomor urut dari id (img3 -> 3), bukan dari label. */}
                <span className="absolute left-1.5 top-1.5 inline-flex min-w-[20px] items-center justify-center rounded-md border border-line-3 bg-base/80 px-1 font-mono text-[11px] font-medium leading-[17px] text-ink backdrop-blur">
                  {f.id.replace('img', '')}
                </span>

                <span className="absolute bottom-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md bg-ink text-inverse opacity-0 transition-opacity group-hover:opacity-100">
                  <Download className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
