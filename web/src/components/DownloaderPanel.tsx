import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DownloadButton from './DownloadButton'
import DownloadResult from './DownloadResult'
import DownloadStatus, { type StatusTone } from './DownloadStatus'
import PlatformIcon from './PlatformIcon'
import UrlInput from './UrlInput'
import {
  platformOfUrl,
  RequestError,
  resolveUrl,
  validateUrl,
  type Platform,
  type ResolvedMedia,
  type ValidationResult,
} from '../lib/api'
import { useI18n, type Lang, type Translate } from '../lib/i18n'

type Phase = 'idle' | 'checking' | 'result' | 'downloading'

/** Kode error yang tidak akan berubah kalau pengguna mencoba lagi. */
const PERMANENT_CODES = new Set([
  'disabled',
  'unsupported',
  'not_found',
  'image_post',
  'no_video',
  'no_media',
  'short_link',
  'unsafe_url',
])

/** Jeda setelah berhenti mengetik/menempel sebelum resolve otomatis. */
const AUTO_DELAY = 650

/** Pesan validasi klien dalam bahasa aktif (server tetap memvalidasi ulang). */
function validationMessage(
  v: Extract<ValidationResult, { ok: false }>,
  t: Translate,
  lang: Lang,
): string {
  if (lang === 'id') return v.message
  if (v.reason === 'unsupported') {
    return t('validate.unsupported', { platforms: t('platform.list') })
  }
  if (v.reason === 'disabled') {
    return t('validate.disabled', {
      platform: v.platformLabel ?? '',
      platforms: t('platform.list'),
    })
  }
  return ''
}

/** Error dari Worker: versi ID memakai pesan server, versi EN dipetakan per kode. */
function requestErrorCopy(
  err: RequestError,
  t: Translate,
  lang: Lang,
): { message: string; hint?: string } {
  if (lang === 'id') return { message: err.message, hint: err.hint }
  switch (err.code) {
    case 'not_found':
      return { message: t('err.notFound'), hint: t('err.notFoundHint') }
    case 'no_media':
    case 'no_video':
    case 'image_post':
      return { message: t('err.noMedia'), hint: t('err.noMediaHint') }
    case 'invalid_url':
    case 'unsafe_url':
      return { message: t('err.invalidUrl'), hint: t('err.invalidUrlHint') }
    case 'network':
      return { message: t('err.network'), hint: t('err.networkHint') }
    default:
      return { message: t('err.generic'), hint: t('err.genericHint') }
  }
}

export default function DownloaderPanel() {
  const { t, lang } = useI18n()
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [media, setMedia] = useState<ResolvedMedia | null>(null)
  const [formatId, setFormatId] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: StatusTone; message: string; hint?: string }>({
    tone: 'idle',
    message: '',
  })
  const [canRetry, setCanRetry] = useState(false)
  /** Platform hasil deteksi dari tautan — null selama URL belum valid. */
  const [detected, setDetected] = useState<Platform | null>(null)

  const timerRef = useRef<number | null>(null)
  /** URL yang terakhir berhasil/gagal di-resolve, untuk mencegah resolve berulang. */
  const lastResolvedRef = useRef<string>('')
  /** Naikkan setiap kali permintaan baru dimulai; hasil lama yang datang terlambat diabaikan. */
  const seqRef = useRef(0)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const busy = phase === 'checking'

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function resetResult() {
    setMedia(null)
    setFormatId(null)
    setPhase('idle')
    setCanRetry(false)
    setStatus({ tone: 'idle', message: '' })
  }

  async function check(target: string) {
    const v = validateUrl(target)
    if (!v.ok) {
      const message = validationMessage(v, t, lang)
      setDetected(null)
      setPhase('idle')
      setMedia(null)
      setCanRetry(!PERMANENT_CODES.has(v.reason))
      setStatus({ tone: message ? 'error' : 'idle', message })
      return
    }

    setDetected(v.platform)
    const seq = ++seqRef.current
    setPhase('checking')
    setMedia(null)
    setCanRetry(true)
    setStatus({ tone: 'loading', message: t('status.checking', { platform: v.platform.label }) })

    try {
      const result = await resolveUrl(target.trim())
      if (seq !== seqRef.current) return // sudah ada permintaan yang lebih baru
      lastResolvedRef.current = target.trim()
      setMedia(result)
      setFormatId(result.formats[0]?.id ?? null)
      setPhase('result')
      setStatus({
        tone: 'success',
        message: t('status.success'),
        hint: t('status.successHint'),
      })
    } catch (err) {
      if (seq !== seqRef.current) return
      setPhase('idle')
      if (err instanceof RequestError) {
        setCanRetry(!PERMANENT_CODES.has(err.code))
        setStatus({ tone: 'error', ...requestErrorCopy(err, t, lang) })
      } else {
        setCanRetry(true)
        setStatus({
          tone: 'error',
          message: t('status.network'),
          hint: t('status.networkHint'),
        })
      }
    }
  }

  /** Dipanggil setiap kali isi input berubah: deteksi platform + jadwalkan resolve. */
  function onUrlChange(value: string) {
    setUrl(value)
    clearTimer()

    const v = validateUrl(value)
    setDetected(v.ok ? v.platform : platformOfUrl(value.trim()))

    // Tautan berubah -> hasil lama tidak berlaku lagi.
    if (media) resetResult()

    if (v.ok) {
      if (value.trim() === lastResolvedRef.current) return
      setStatus({ tone: 'loading', message: t('status.detected', { platform: v.platform.label }) })
      timerRef.current = window.setTimeout(() => {
        if (value.trim() !== lastResolvedRef.current) check(value)
      }, AUTO_DELAY)
    } else {
      lastResolvedRef.current = ''
      if (v.reason === 'empty') {
        setStatus({ tone: 'idle', message: '' })
      } else if (v.reason === 'incomplete') {
        // Sedang mengetik / tautan profil, bukan tautan satu post.
        setStatus(
          value.trim()
            ? {
                tone: 'info',
                message: t('status.incomplete'),
                hint: t('status.incompleteHint'),
              }
            : { tone: 'idle', message: '' },
        )
      } else {
        setStatus({ tone: 'error', message: validationMessage(v, t, lang) })
      }
      setCanRetry(false)
    }
  }

  function reset() {
    clearTimer()
    seqRef.current += 1
    lastResolvedRef.current = ''
    setUrl('')
    setDetected(null)
    resetResult()
  }

  const detectedHost = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  return (
    <section id="downloader" className="shell scroll-mt-24 pb-10">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl border border-line-2 bg-surface p-4 sm:p-6"
      >
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <UrlInput
              value={url}
              onChange={onUrlChange}
              onClear={reset}
              disabled={false}
              describedBy="url-helper"
            />
          </div>
          <DownloadButton
            onClick={() => check(url)}
            loading={phase === 'checking'}
            disabled={busy || !detected}
            label={t('action.download')}
          />
        </div>

        {/* Baris deteksi: platform muncul otomatis dari tautan, tanpa tab. */}
        <div id="url-helper" className="mt-2.5 min-h-[26px]">
          <AnimatePresence mode="wait" initial={false}>
            {detected ? (
              <motion.div
                key={detected.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line-3 bg-surface-2 px-2 py-1 font-medium text-ink">
                  <PlatformIcon id={detected.id} size="sm" />
                  {t('detected.label', { platform: detected.label })}
                </span>
                <span className="truncate font-mono text-[11px] text-faint">{detectedHost}</span>
              </motion.div>
            ) : (
              <motion.p
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[12.5px] leading-snug text-faint"
              >
                {t('helper.hint')}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div aria-live="polite" aria-atomic="true">
          <DownloadStatus
            tone={status.tone}
            message={status.message}
            hint={status.hint}
            onRetry={status.tone === 'error' && url && canRetry ? () => check(url) : undefined}
          />
        </div>

        <AnimatePresence initial={false}>
          {media && (
            <motion.div
              key="result"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <DownloadResult media={media} activeFormat={formatId} onPick={setFormatId} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </section>
  )
}
