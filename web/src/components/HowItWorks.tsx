import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/** Penjelasan alur + H2 berisi kata kunci utama untuk SEO. */
export default function HowItWorks() {
  const { t } = useI18n()

  const steps = [
    { title: t('how.step1.title'), body: t('how.step1.body') },
    { title: t('how.step2.title'), body: t('how.step2.body') },
    { title: t('how.step3.title'), body: t('how.step3.body') },
  ]

  return (
    <section id="cara-pakai" className="band scroll-mt-24">
      <div className="shell py-14 sm:py-20">
        <p className="eyebrow">{t('how.eyebrow')}</p>
        <h2 className="mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('how.title')}
        </h2>

        <ol className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line-2 bg-line-2 sm:grid-cols-3">
          {steps.map(({ title, body }, i) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="bg-surface p-5 sm:p-6"
            >
              <span className="font-mono text-[11px] tracking-[0.18em] text-faint">0{i + 1}</span>
              <h3 className="mt-3 text-sm font-medium text-ink">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
            </motion.li>
          ))}
        </ol>

        <a
          href="#downloader"
          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line-2 bg-surface-2 px-4 text-[13.5px] font-medium text-ink transition-colors hover:border-line-3"
        >
          {t('how.cta')} <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
