import { useRef } from 'react'
import { Link2, X } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/** Input URL: ikon link di kiri, tombol hapus saat ada teks.
 *  Font 16px agar iOS tidak auto-zoom. Tautan diperiksa otomatis saat ditempel/diketik. */
export default function UrlInput({
  value,
  onChange,
  onClear,
  disabled,
  invalid,
  describedBy,
}: {
  value: string
  onChange: (v: string) => void
  onClear: () => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  return (
    <div className="relative">
      <label htmlFor="url-input" className="sr-only">
        {t('input.label')}
      </label>
      <Link2
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-faint"
        strokeWidth={2}
      />
      <input
        ref={ref}
        id="url-input"
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder={t('input.placeholder')}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          // Tempel = langsung periksa, tanpa menunggu jeda ketik.
          const text = e.clipboardData.getData('text')
          if (text) {
            e.preventDefault()
            onChange(text.trim())
          }
        }}
        onKeyDown={(e) => {
          // Enter hanya menutup keyboard di ponsel; pemeriksaan sudah otomatis.
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className={[
          'h-12 w-full rounded-lg border bg-surface-2 pl-10 pr-12 text-[16px] text-ink transition-colors',
          'placeholder:text-faint focus:outline-none disabled:opacity-60',
          invalid ? 'border-danger' : 'border-line-2 focus:border-focus',
        ].join(' ')}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onClear()
            ref.current?.focus()
          }}
          aria-label={t('input.clear')}
          className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <X className="size-[17px]" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}
