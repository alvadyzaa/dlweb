import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import DotGrid from './DotGrid'
import PlatformIcon from './PlatformIcon'
import { ACTIVE_PLATFORMS } from '../lib/api'
import { useI18n } from '../lib/i18n'

const EASE = [0.22, 1, 0.36, 1] as const

/** Strip teks berjalan; konten digandakan 2x agar loop mulus (translate -50%). */
function Ticker({ items }: { items: string[] }) {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <span key={copy} className="flex shrink-0">
            {items.map((item) => (
              <span key={item} className="flex shrink-0 items-center">
                <span className="px-5 font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
                  {item}
                </span>
                <span className="size-1 rounded-full bg-line-3" />
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Scroll ke panel unduh lalu fokuskan input. */
function focusDownloader() {
  document.getElementById('downloader')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => document.getElementById('url-input')?.focus({ preventScroll: true }), 450)
}

export default function HeroSection() {
  const { t } = useI18n()

  const headlineLines = [t('hero.headline1'), t('hero.headline2')]
  const headline = headlineLines.map((line) => line.split(' '))
  const offsets = headline.map((_, i) =>
    headline.slice(0, i).reduce((n, words) => n + words.length, 0),
  )

  const stats = [
    { label: t('hero.stat.platforms'), value: '03' },
    { label: t('hero.stat.mediaTypes'), value: '02' },
    { label: t('hero.stat.apps'), value: t('hero.stat.zero') },
    { label: t('hero.stat.cost'), value: t('hero.stat.free') },
  ]

  const ticker = [
    'TikTok',
    'Threads',
    'X (Twitter)',
    t('ticker.noWatermark'),
    t('ticker.media'),
    t('ticker.noApp'),
    t('ticker.free'),
  ]

  return (
    <>
      <section id="beranda" className="relative scroll-mt-24 overflow-hidden">
        <DotGrid />
        {/* Fade ke warna dasar di bawah agar dot-grid tidak terpotong kasar. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(to_bottom,transparent,var(--color-base))]"
        />

        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 pb-24 pt-24 text-center sm:px-8 sm:pb-32 sm:pt-32">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="rounded-full border border-line-2 bg-base/60 px-3 py-1 text-xs text-muted backdrop-blur"
          >
            {ACTIVE_PLATFORMS.map((p) => p.label).join(' · ')}
          </motion.p>

          <h1
            aria-label={headlineLines.join(' ')}
            className="mt-6 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tighter sm:text-6xl lg:text-7xl"
          >
            {headline.map((words, li) => (
              <span key={li} className="block" aria-hidden="true">
                {words.map((word, wi) => {
                  const i = offsets[li] + wi
                  return (
                    <motion.span
                      key={`${word}-${i}`}
                      className="inline-block whitespace-pre"
                      initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                      transition={{ duration: 0.7, ease: EASE, delay: 0.1 + i * 0.08 }}
                    >
                      {wi < words.length - 1 ? `${word} ` : word}
                    </motion.span>
                  )
                })}
                {li < headline.length - 1 ? ' ' : null}
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.45 }}
            className="mt-6 max-w-xl text-[16px] leading-7 text-muted sm:text-lg"
          >
            {t('hero.sub')}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.6 }}
            className="mt-9 flex flex-wrap justify-center gap-3"
          >
            <button
              type="button"
              onClick={focusDownloader}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-medium text-inverse transition-colors hover:bg-muted"
            >
              {t('hero.cta.download')} <ArrowRight className="size-4" aria-hidden="true" />
            </button>
            <a
              href="#fitur"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-line-2 bg-surface-2 px-5 text-sm font-medium text-ink transition-colors hover:border-line-3"
            >
              {t('hero.cta.features')}
            </a>
          </motion.div>
        </div>
      </section>

      {/* Statistik — 4 sel bersekat, gaya rdhx */}
      <div className="border-y border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-5 sm:grid-cols-4 sm:px-8">
          {stats.map(({ label, value }) => (
            <div
              key={label}
              className="border-line odd:border-r sm:border-r sm:px-6 sm:last:border-r-0 px-2 py-8"
            >
              <p className="text-xs text-faint">{label}</p>
              <div className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Platform yang didukung */}
      <div className="border-b border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-line px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8">
          {ACTIVE_PLATFORMS.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-2 py-6 sm:px-6">
              <PlatformIcon id={p.id} size="md" />
              <div className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{p.label}</span>
                <span className="block font-mono text-[11px] uppercase tracking-wide text-faint">
                  {t('hero.supported')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-line py-4">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Ticker items={ticker} />
        </div>
      </div>
    </>
  )
}
