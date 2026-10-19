import { motion } from 'framer-motion'

/** Wordmark monokrom: mark kotak + nama, gaya minimalis ala rdhx. */
export default function BrandLogo({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const sm = size === 'sm'
  return (
    <motion.span
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="inline-flex items-center gap-2"
    >
      <span
        className={[
          'grid place-items-center rounded-md border border-line-3 bg-surface-3 text-ink',
          sm ? 'size-6' : 'size-7',
        ].join(' ')}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={sm ? 'size-3.5' : 'size-4'}
        >
          {/* Dua garis bersilang: "tik" dan "thread" */}
          <path d="M6 5v9a3 3 0 0 0 3 3h9" />
          <path d="M14 5l4 4-4 4" />
        </svg>
      </span>
      <span className={['font-semibold tracking-tight', sm ? 'text-[15px]' : 'text-[16px]'].join(' ')}>
        Pluck<span className="text-faint">DL</span>
      </span>
    </motion.span>
  )
}
