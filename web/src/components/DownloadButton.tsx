import { Download, LoaderCircle } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/** CTA utama: kontras tinggi (putih di tema gelap, hitam di tema terang). */
export default function DownloadButton({
  onClick,
  loading,
  disabled,
  label,
}: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  label?: string
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-ink px-6 text-[15px] font-semibold text-inverse transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-faint lg:w-auto lg:min-w-[168px]"
    >
      {loading ? (
        <LoaderCircle className="size-[18px] animate-spin" strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <Download className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
      )}
      {loading ? t('action.checking') : (label ?? t('action.download'))}
    </button>
  )
}
