import { Heart } from 'lucide-react'
import { motion } from 'framer-motion'
import BrandLogo from './BrandLogo'
import { useI18n } from '../lib/i18n'

export default function SiteFooter() {
  const { t } = useI18n()

  return (
    <footer className="band">
      <div className="shell flex flex-col items-center gap-4 py-10 text-center sm:py-12">
        <BrandLogo />

        <motion.p
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface px-3 py-1.5 font-mono text-[11px] tracking-wide text-faint"
        >
          {t('footer.madeBy')}
          <span className="text-ink">alvadyza</span>
          <Heart className="size-3 text-danger" strokeWidth={2.5} aria-hidden="true" />
        </motion.p>
      </div>
    </footer>
  )
}
