import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Lang = 'id' | 'en'

const STORAGE_KEY = 'pluckdl-lang'

/** Teks sumber (Indonesia) — semua kunci wajib ada di sini. */
const id = {
  'meta.title': 'Unduh Video TikTok, Threads & X Tanpa Watermark — PluckDL',
  'meta.description':
    'Unduh video dan foto TikTok, Threads, dan X tanpa watermark. Tempel tautan, platform terdeteksi otomatis, file siap diunduh. Gratis, tanpa aplikasi.',

  'header.home': 'PluckDL — ke beranda',
  'header.version': 'Versi 1.1',

  'theme.toLight': 'Aktifkan mode terang',
  'theme.toDark': 'Aktifkan mode gelap',
  'lang.label': 'Ganti bahasa',

  'hero.headline1': 'Tempel tautannya.',
  'hero.headline2': 'Ambil medianya.',
  'hero.sub': 'Unduh video dan foto dalam hitungan detik.',
  'hero.cta.download': 'Mulai unduh',
  'hero.cta.features': 'Lihat fitur',
  'hero.badge.noApp': 'Tanpa aplikasi',
  'hero.badge.media': 'Video & carousel',
  'hero.badge.free': 'Gratis',
  'hero.stat.platforms': 'Platform',
  'hero.stat.mediaTypes': 'Jenis media',
  'hero.stat.apps': 'Aplikasi',
  'hero.stat.cost': 'Biaya',
  'hero.stat.zero': 'Nol',
  'hero.stat.free': 'Gratis',
  'hero.supported': 'Didukung',

  'ticker.noWatermark': 'Tanpa watermark',
  'ticker.media': 'Video & carousel',
  'ticker.noApp': 'Tanpa aplikasi',
  'ticker.free': 'Gratis',

  'input.label': 'Tautan TikTok, Threads, atau X',
  'input.placeholder': 'Tempel tautan TikTok, Threads, atau X...',
  'input.clear': 'Hapus tautan',

  'action.download': 'Unduh',
  'action.checking': 'Memeriksa…',
  'action.retry': 'Coba lagi',

  'helper.hint': 'Tempel tautan TikTok, Threads, atau X — platform terdeteksi otomatis.',
  'detected.label': '{platform} terdeteksi',

  'status.checking': 'Memeriksa tautan {platform}...',
  'status.detected': 'Tautan {platform} terdeteksi…',
  'status.success': 'Tautan berhasil dibaca.',
  'status.successHint': 'Pilih format di bawah, lalu tekan Unduh.',
  'status.incomplete': 'Tautan belum lengkap.',
  'status.incompleteHint': 'Buka video atau post-nya dulu, lalu salin tautan dari address bar.',
  'status.network': 'Tidak bisa menghubungi server.',
  'status.networkHint': 'Coba lagi sebentar lagi.',

  'validate.unsupported': 'Tautan ini belum didukung. Saat ini hanya {platforms}.',
  'validate.disabled': '{platform} belum tersedia di sini. Saat ini hanya {platforms}.',
  'platform.list': 'TikTok, Threads, dan X',

  'err.notFound': 'Post ini tidak tersedia.',
  'err.notFoundHint': 'Kemungkinan sudah dihapus, akunnya privat, atau tautannya bukan post.',
  'err.noMedia': 'Post ini tidak berisi media yang bisa diunduh.',
  'err.noMediaHint': 'Pastikan tautannya mengarah ke post yang punya video atau gambar.',
  'err.invalidUrl': 'Tautan ini tidak valid.',
  'err.invalidUrlHint': 'Gunakan tautan ke satu post, bukan ke profil.',
  'err.network': 'Post ini gagal dibaca.',
  'err.networkHint': 'Coba lagi sebentar lagi.',
  'err.generic': 'Terjadi kesalahan.',
  'err.genericHint': 'Coba lagi sebentar lagi.',

  'fmt.video': 'Video (audio+video)',
  'fmt.nowm': 'Video (tanpa watermark)',
  'fmt.hd': 'Video resolusi tertinggi',
  'fmt.image': 'Gambar {n}',
  'fmt.videoN': 'Video {n}',
  'fmt.zip': 'Semua gambar (.zip · {n} file)',
  'note.singleFile': 'satu file',
  'note.smaller': 'ukuran file bisa lebih kecil',

  'gallery.countOne': '1 gambar',
  'gallery.countMany': '{n} gambar',
  'gallery.tapAll': 'Ketuk gambar untuk mengunduh, atau ambil semuanya',
  'gallery.tapOne': 'Ketuk untuk mengunduh',
  'gallery.downloadAll': 'Unduh semua (.zip)',
  'gallery.zipFiles': '{n} gambar dalam satu file',
  'gallery.ariaZip': 'Unduh semua gambar sebagai zip',
  'gallery.ariaImage': 'Unduh {label}',

  'feature.eyebrow': 'Kenapa PluckDL',
  'feature.auto.title': 'Otomatis',
  'feature.auto.body': 'Tempel tautan, platform terdeteksi, file langsung siap.',
  'feature.platforms.title': 'Tiga platform',
  'feature.platforms.body': 'TikTok, Threads, dan X dalam satu tempat.',
  'feature.responsive.title': 'Responsif',
  'feature.responsive.body': 'Nyaman di ponsel maupun desktop.',
  'feature.transparent.title': 'Transparan',
  'feature.transparent.body': 'Setiap format dan status terlihat jelas.',

  'how.eyebrow': 'Cara pakai',
  'how.title': 'Cara mengunduh video TikTok, Threads, dan X tanpa watermark',
  'how.step1.title': 'Tempel tautan',
  'how.step1.body':
    'Salin tautan video atau post dari TikTok, Threads, atau X, lalu tempel di kolom unduh.',
  'how.step2.title': 'Platform terdeteksi',
  'how.step2.body':
    'PluckDL membaca tautan secara otomatis dan mengambil video, foto, atau carousel yang tersedia.',
  'how.step3.title': 'Unduh filenya',
  'how.step3.body':
    'Pilih format lalu unduh. Video TikTok tanpa watermark, foto bisa satu per satu atau sekaligus sebagai ZIP.',
  'how.cta': 'Tempel tautan sekarang',

  'faq.eyebrow': 'FAQ',
  'faq.title': 'Pertanyaan umum seputar mengunduh video dan foto',
  'faq.q1': 'Apakah PluckDL gratis?',
  'faq.a1': 'Ya, PluckDL gratis dipakai tanpa batas unduhan dan tanpa perlu membuat akun.',
  'faq.q2': 'Apakah video TikTok yang diunduh masih ada watermark?',
  'faq.a2':
    'Tidak. Untuk TikTok, PluckDL mengambil versi video tanpa watermark selama versi tersebut tersedia dari sumbernya.',
  'faq.q3': 'Platform apa saja yang didukung?',
  'faq.a3':
    'Saat ini PluckDL mendukung TikTok, Threads, dan X (Twitter), baik untuk video maupun foto.',
  'faq.q4': 'Apakah perlu aplikasi atau akun untuk mengunduh?',
  'faq.a4':
    'Tidak perlu. Cukup buka PluckDL di browser, tempel tautan, lalu unduh. Tanpa aplikasi dan tanpa login.',
  'faq.q5': 'Format file apa yang tersedia?',
  'faq.a5':
    'Video tersedia dalam MP4, foto dalam JPG, dan carousel bisa diunduh sekaligus sebagai ZIP.',

  'footer.madeBy': 'Dibuat oleh',
} as const

export type MessageKey = keyof typeof id

const en: Record<MessageKey, string> = {
  'meta.title': 'Download TikTok, Threads & X Videos Without Watermark — PluckDL',
  'meta.description':
    'Download TikTok, Threads, and X videos and photos without a watermark. Paste a link, the platform is detected automatically, and files are ready. Free, no app.',

  'header.home': 'PluckDL — back to home',
  'header.version': 'Version 1.1',

  'theme.toLight': 'Switch to light mode',
  'theme.toDark': 'Switch to dark mode',
  'lang.label': 'Change language',

  'hero.headline1': 'Paste the link.',
  'hero.headline2': 'Get the media.',
  'hero.sub': 'Download videos and photos in seconds.',
  'hero.cta.download': 'Start downloading',
  'hero.cta.features': 'See features',
  'hero.badge.noApp': 'No app needed',
  'hero.badge.media': 'Video & carousels',
  'hero.badge.free': 'Free',
  'hero.stat.platforms': 'Platforms',
  'hero.stat.mediaTypes': 'Media types',
  'hero.stat.apps': 'Apps required',
  'hero.stat.cost': 'Cost',
  'hero.stat.zero': 'Zero',
  'hero.stat.free': 'Free',
  'hero.supported': 'Supported',

  'ticker.noWatermark': 'No watermark',
  'ticker.media': 'Video & carousels',
  'ticker.noApp': 'No app',
  'ticker.free': 'Free',

  'input.label': 'TikTok, Threads, or X link',
  'input.placeholder': 'Paste a TikTok, Threads, or X link...',
  'input.clear': 'Clear link',

  'action.download': 'Download',
  'action.checking': 'Checking…',
  'action.retry': 'Try again',

  'helper.hint': 'Paste a TikTok, Threads, or X link — the platform is detected automatically.',
  'detected.label': '{platform} detected',

  'status.checking': 'Checking the {platform} link...',
  'status.detected': '{platform} link detected…',
  'status.success': 'Link read successfully.',
  'status.successHint': 'Pick a format below, then press Download.',
  'status.incomplete': 'The link is not complete yet.',
  'status.incompleteHint': 'Open the video or post first, then copy the link from the address bar.',
  'status.network': "Couldn't reach the server.",
  'status.networkHint': 'Please try again in a moment.',

  'validate.unsupported': 'This link is not supported yet. Currently only {platforms}.',
  'validate.disabled': '{platform} is not available here. Currently only {platforms}.',
  'platform.list': 'TikTok, Threads, and X',

  'err.notFound': 'This post is unavailable.',
  'err.notFoundHint': 'It may have been deleted, the account may be private, or the link may not be a post.',
  'err.noMedia': 'This post has no downloadable media.',
  'err.noMediaHint': 'Make sure the link points to a post with a video or photos.',
  'err.invalidUrl': "That link doesn't look right.",
  'err.invalidUrlHint': 'Use a link to a single post, not a profile.',
  'err.network': "Couldn't read this post.",
  'err.networkHint': 'Please try again in a moment.',
  'err.generic': 'Something went wrong.',
  'err.genericHint': 'Please try again in a moment.',

  'fmt.video': 'Video (audio+video)',
  'fmt.nowm': 'Video (no watermark)',
  'fmt.hd': 'Highest resolution video',
  'fmt.image': 'Image {n}',
  'fmt.videoN': 'Video {n}',
  'fmt.zip': 'All images (.zip · {n} files)',
  'note.singleFile': 'single file',
  'note.smaller': 'file size may be smaller',

  'gallery.countOne': '1 image',
  'gallery.countMany': '{n} images',
  'gallery.tapAll': 'Tap an image to download, or grab them all',
  'gallery.tapOne': 'Tap to download',
  'gallery.downloadAll': 'Download all (.zip)',
  'gallery.zipFiles': '{n} images in one file',
  'gallery.ariaZip': 'Download all images as a zip',
  'gallery.ariaImage': 'Download {label}',

  'feature.eyebrow': 'Why PluckDL',
  'feature.auto.title': 'Automatic',
  'feature.auto.body': 'Paste a link, the platform is detected, and files are ready.',
  'feature.platforms.title': 'Three platforms',
  'feature.platforms.body': 'TikTok, Threads, and X in one place.',
  'feature.responsive.title': 'Responsive',
  'feature.responsive.body': 'Comfortable on phones and desktops.',
  'feature.transparent.title': 'Transparent',
  'feature.transparent.body': 'Every format and status is clearly shown.',

  'how.eyebrow': 'How it works',
  'how.title': 'How to download TikTok, Threads, and X videos without a watermark',
  'how.step1.title': 'Paste the link',
  'how.step1.body':
    'Copy a video or post link from TikTok, Threads, or X, then paste it into the download field.',
  'how.step2.title': 'Platform detected',
  'how.step2.body':
    'PluckDL reads the link automatically and fetches the available video, photos, or carousel.',
  'how.step3.title': 'Download the file',
  'how.step3.body':
    'Pick a format and download. TikTok videos come watermark-free; photos can be saved one by one or all at once as a ZIP.',
  'how.cta': 'Paste a link now',

  'faq.eyebrow': 'FAQ',
  'faq.title': 'Common questions about downloading videos and photos',
  'faq.q1': 'Is PluckDL free?',
  'faq.a1': 'Yes. PluckDL is free with unlimited downloads and no account required.',
  'faq.q2': 'Do downloaded TikTok videos still have a watermark?',
  'faq.a2':
    'No. For TikTok, PluckDL fetches the watermark-free version whenever the source provides it.',
  'faq.q3': 'Which platforms are supported?',
  'faq.a3': 'PluckDL currently supports TikTok, Threads, and X (Twitter), for both videos and photos.',
  'faq.q4': 'Do I need an app or an account?',
  'faq.a4':
    'No. Just open PluckDL in your browser, paste a link, and download. No app and no login.',
  'faq.q5': 'What file formats are available?',
  'faq.a5':
    'Videos come as MP4, photos as JPG, and carousels can be downloaded all at once as a ZIP.',

  'footer.madeBy': 'Made by',
}

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { id, en }

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  t: Translate
}

const I18nContext = createContext<I18nContextValue | null>(null)

/** `?lang=id|en` untuk pratinjau/QA — menang atas preferensi tersimpan. */
function readLangParam(): Lang | null {
  const value = new URLSearchParams(window.location.search).get('lang')
  return value === 'en' || value === 'id' ? value : null
}

const URL_LANG = readLangParam()

function initialLang(): Lang {
  if (URL_LANG) return URL_LANG
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'id') return stored
  } catch {
    /* storage bisa diblokir */
  }
  return document.documentElement.lang === 'en' ? 'en' : 'id'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const t = useCallback<Translate>(
    (key, vars) => {
      let text = MESSAGES[lang][key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    },
    [lang],
  )

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* abaikan */
    }
  }, [])

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === 'id' ? 'en' : 'id'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* abaikan */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('meta.title')
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('meta.description'))
  }, [lang, t])

  const value = useMemo(
    () => ({ lang, setLang, toggleLang, t }),
    [lang, setLang, toggleLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n harus dipakai di dalam I18nProvider')
  return ctx
}
