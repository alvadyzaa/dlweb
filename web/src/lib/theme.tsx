import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'pluckdl-theme'

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

interface ThemeContextValue {
  theme: Theme
  /** Ganti tema; `origin` (titik klik) jadi pusat animasi lingkaran. */
  toggleTheme: (origin?: { x: number; y: number }) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** `?theme=light|dark` untuk pratinjau/QA — menang atas preferensi tersimpan. */
function readThemeParam(): Theme | null {
  const value = new URLSearchParams(window.location.search).get('theme')
  return value === 'light' || value === 'dark' ? value : null
}

const URL_THEME = readThemeParam()

/** Tema tersimpan (null bila belum pernah memilih). */
function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const STORED_THEME = readStoredTheme()

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function initialTheme(): Theme {
  if (URL_THEME) return URL_THEME
  if (STORED_THEME) return STORED_THEME
  return systemTheme()
}

/** Tulis tema ke <html> + meta theme-color (dipakai juga oleh pre-paint script). */
function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme

  // Meta awal punya `media` (gelap/terang). Setelah JS jalan, satu meta saja
  // yang dipakai supaya pilihan manual tidak dilawan preferensi OS.
  const color = theme === 'light' ? '#ffffff' : '#000000'
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
  metas.forEach((meta, index) => {
    meta.removeAttribute('media')
    if (index === 0) meta.setAttribute('content', color)
    else meta.remove()
  })

  if (!persist) return
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* abaikan */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    // Jangan simpan saat tema dari URL, atau saat masih mengikuti sistem.
    applyTheme(theme, !URL_THEME && STORED_THEME !== null)
  }, [theme])

  // Belum pernah memilih -> ikut perubahan tema OS secara langsung.
  useEffect(() => {
    if (URL_THEME || STORED_THEME) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'light' : 'dark')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = useCallback(
    (origin?: { x: number; y: number }) => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      const commit = () => {
        setTheme(next)
        applyTheme(next)
      }

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const doc = document as ViewTransitionDocument
      // Fallback: tanpa View Transitions API, ganti langsung (tetap tersimpan).
      if (!doc.startViewTransition || reduce) {
        commit()
        return
      }

      const x = origin?.x ?? window.innerWidth - 44
      const y = origin?.y ?? 32
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )

      const transition = doc.startViewTransition(() => {
        flushSync(commit)
      })

      // Snapshot baru dibuka sebagai lingkaran dari tombol yang diklik.
      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 520,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          )
        })
        .catch(() => {
          /* transisi dibatalkan (mis. klik cepat) */
        })
    },
    [theme],
  )

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme harus dipakai di dalam ThemeProvider')
  return ctx
}
