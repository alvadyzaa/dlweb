import { motion } from 'framer-motion'
import { Layers, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { useI18n } from '../lib/i18n'

export default function FeatureGrid() {
  const { t } = useI18n()

  const features = [
    { icon: Zap, title: t('feature.auto.title'), body: t('feature.auto.body') },
    { icon: Layers, title: t('feature.platforms.title'), body: t('feature.platforms.body') },
    { icon: Smartphone, title: t('feature.responsive.title'), body: t('feature.responsive.body') },
    { icon: ShieldCheck, title: t('feature.transparent.title'), body: t('feature.transparent.body') },
  ]

  return (
    <section id="fitur" className="band scroll-mt-24">
      <div className="shell py-14 sm:py-20">
        <p className="eyebrow">{t('feature.eyebrow')}</p>

        {/* Grid bersekat: latar garis tipis + sel berlatar surface (gap-px sebagai divider). */}
        <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="bg-surface p-5 sm:p-6"
            >
              <Icon className="size-5 text-muted" strokeWidth={2} aria-hidden="true" />
              <h3 className="mt-4 text-sm font-medium text-ink">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
