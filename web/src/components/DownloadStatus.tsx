import { AlertCircle, CheckCircle2, Info, LoaderCircle, RotateCcw } from 'lucide-react'
import { useI18n } from '../lib/i18n'

export type StatusTone = 'idle' | 'loading' | 'error' | 'success' | 'info'

/** Status proses — selalu punya label teks, bukan hanya warna.
 *  Di-announce lewat aria-live oleh parent. */
export default function DownloadStatus({
  tone,
  message,
  hint,
  onRetry,
}: {
  tone: StatusTone
  message: string
  hint?: string
  onRetry?: () => void
}) {
  const { t } = useI18n()
  if (tone === 'idle' || !message) return null

  const isError = tone === 'error'
  const isLoading = tone === 'loading'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={[
        'mt-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-3',
        isError ? 'border-danger/40 bg-danger/10' : '',
        tone === 'success' ? 'border-success/40 bg-success/10' : '',
        isLoading || tone === 'info' ? 'border-line-2 bg-surface-2' : '',
      ].join(' ')}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {isError && <AlertCircle className="size-4 text-danger" strokeWidth={2.25} />}
        {tone === 'success' && <CheckCircle2 className="size-4 text-success" strokeWidth={2.25} />}
        {isLoading && <LoaderCircle className="size-4 animate-spin text-muted" strokeWidth={2.25} />}
        {tone === 'info' && <Info className="size-4 text-muted" strokeWidth={2.25} />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={[
            'text-[13.5px] font-medium leading-snug',
            isError ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
          ].join(' ')}
        >
          {message}
        </p>
        {hint && <p className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</p>}
        {isError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-md border border-line-3 bg-surface px-3 text-[12.5px] font-medium text-muted transition-colors hover:border-focus hover:text-ink"
          >
            <RotateCcw className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            {t('action.retry')}
          </button>
        )}
      </div>
    </div>
  )
}
