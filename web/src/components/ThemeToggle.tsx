import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'

/** Tombol tema: ikon matahari/bulan bertukar dengan sedikit rotasi + naik-turun. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()
  const light = theme === 'light'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label={light ? t('theme.toDark') : t('theme.toLight')}
      title={light ? t('theme.toDark') : t('theme.toLight')}
      onClick={(event) => toggleTheme({ x: event.clientX, y: event.clientY })}
      className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-2 bg-surface text-muted transition-colors hover:border-line-3 hover:text-ink"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={theme}
          initial={{ y: light ? 12 : -12, opacity: 0, rotate: light ? -45 : 45 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: light ? -12 : 12, opacity: 0, rotate: light ? 45 : -45 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
        >
          {light ? (
            <Sun className="size-4" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Moon className="size-4" strokeWidth={2} aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
