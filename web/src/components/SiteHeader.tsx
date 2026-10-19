import { motion } from 'framer-motion'
import BrandLogo from './BrandLogo'
import LanguageToggle from './LanguageToggle'
import ThemeToggle from './ThemeToggle'
import { useI18n } from '../lib/i18n'

/** Header minimal: sticky, garis tipis, blur. Berisi brand + kontrol tema/bahasa. */
export default function SiteHeader() {
  const { t } = useI18n()

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-40 border-b border-line bg-base/70 backdrop-blur-md"
    >
      <div className="shell flex h-14 items-center justify-between gap-3 sm:h-16">
        <a
          href="#beranda"
          aria-label={t('header.home')}
          className="inline-flex min-h-[44px] items-center"
        >
          <BrandLogo />
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-faint sm:block">
            {t('header.version')}
          </span>
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </motion.header>
  )
}
