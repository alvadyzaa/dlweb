import { motion } from 'framer-motion'
import { useI18n, type Lang } from '../lib/i18n'

const LANGS: Lang[] = ['id', 'en']

/** Switch bahasa ID/EN dengan pil yang meluncur (shared layout animation). */
export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t('lang.label')}
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-line-2 bg-surface p-1"
    >
      {LANGS.map((code) => {
        const active = lang === code
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={active}
            aria-label={code === 'id' ? 'Bahasa Indonesia' : 'English'}
            className={[
              'relative inline-flex h-7 w-8 items-center justify-center rounded-md font-mono text-[11px] font-medium uppercase tracking-wide transition-colors',
              active ? 'text-ink' : 'text-faint hover:text-muted',
            ].join(' ')}
          >
            {active && (
              <motion.span
                layoutId="lang-pill"
                className="absolute inset-0 rounded-md bg-surface-3"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{code}</span>
          </button>
        )
      })}
    </div>
  )
}
