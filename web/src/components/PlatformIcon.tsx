import { Music2, AtSign } from 'lucide-react'
import type { PlatformId } from '../lib/api'

/** Logo X (Twitter) — lucide tidak menyediakan ikon merek, jadi SVG lokal. */
function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const ICONS = {
  tiktok: Music2,
  threads: AtSign,
} as const

/** Kotak ikon platform — monokrom, senada tema gelap. */
export default function PlatformIcon({
  id,
  size = 'md',
}: {
  id: PlatformId
  size?: 'sm' | 'md' | 'lg'
}) {
  const box = size === 'lg' ? 'size-12 rounded-xl' : size === 'sm' ? 'size-7 rounded-md' : 'size-9 rounded-lg'
  const icon = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${box} items-center justify-center border border-line-3 bg-surface-3 text-ink`}
    >
      {id === 'twitter' ? (
        <XLogo className={icon} />
      ) : (
        (() => {
          const Icon = ICONS[id]
          return <Icon className={icon} strokeWidth={2} />
        })()
      )}
    </span>
  )
}
