import { useEffect, useRef } from 'react'
import { useTheme } from '../lib/theme'

/** Latar dot-grid bergelombang — port dari canvas rdhx:
 *  grid 22px, gelombang sinus menjalar dari tengah, memudar radial.
 *  Warna titik mengikuti tema (putih di gelap, hitam di terang). */
export default function DotGrid() {
  const ref = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rgb = theme === 'light' ? '0,0,0' : '255,255,255'
    // Titik hitam di atas putih terlihat lebih tegas, jadi alpha diturunkan.
    const strength = theme === 'light' ? 0.55 : 1
    let w = 0
    let h = 0
    let raf = 0
    let visible = true

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (ts: number) => {
      const t = ts / 1000
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h * 0.55
      for (let x = 11; x < w; x += 22) {
        for (let y = 11; y < h; y += 22) {
          const dx = (x - cx) / w
          const dy = (y - cy) / h
          const dist = Math.sqrt(dx * dx + dy * dy)
          const wave = Math.sin(dist * 14 - t * 0.9) * 0.5 + 0.5
          const falloff = Math.max(0, 1 - dist * 1.7)
          const alpha = (0.06 + wave * 0.5) * falloff
          if (alpha < 0.02) continue
          ctx.fillStyle = `rgba(${rgb},${(alpha * strength).toFixed(3)})`
          const radius = 0.6 + wave * 0.9
          ctx.beginPath()
          ctx.arc(x, y + Math.sin(t * 0.6 + x * 0.02) * 2 * falloff, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    const loop = (ts: number) => {
      if (visible) draw(ts)
      raf = requestAnimationFrame(loop)
    }

    resize()
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(canvas)
    window.addEventListener('resize', resize)
    if (reduce) draw(0)
    else raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [theme])

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  )
}
