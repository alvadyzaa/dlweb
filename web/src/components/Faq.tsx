import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useI18n } from '../lib/i18n'

const EASE = [0.22, 1, 0.36, 1] as const

/** FAQ yang terlihat di halaman; versi ID-nya harus cocok dengan FAQPage JSON-LD. */
export default function Faq() {
  const { t } = useI18n()

  const faq = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
  ]

  return (
    <section id="faq" className="band scroll-mt-24">
      <div className="shell py-14 sm:py-20">
        <p className="eyebrow">{t('faq.eyebrow')}</p>
        <h2 className="mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('faq.title')}
        </h2>

        <div className="mt-8 divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-surface">
          {faq.map(({ q, a }, i) => (
            <motion.details
              key={q}
              className="group p-5 sm:p-6"
              open={i === 0}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <Plus
                  className="size-4 shrink-0 text-faint transition-transform duration-300 group-open:rotate-45"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">{a}</p>
            </motion.details>
          ))}
        </div>
      </div>
    </section>
  )
}
