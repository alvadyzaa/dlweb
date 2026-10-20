import { useEffect } from 'react'
import SiteHeader from './components/SiteHeader'
import HeroSection from './components/HeroSection'
import DownloaderPanel from './components/DownloaderPanel'
import FeatureGrid from './components/FeatureGrid'
import HowItWorks from './components/HowItWorks'
import Faq from './components/Faq'
import SiteFooter from './components/SiteFooter'

/** Satu halaman landing: hero -> panel unduh -> fitur -> cara pakai -> FAQ -> footer. */
export default function App() {
  useEffect(() => {
    let id = ''
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      id = window.location.hash.slice(1)
    }
    if (!id) return
    const scroll = () => document.getElementById(id)?.scrollIntoView({ block: 'start' })
    requestAnimationFrame(() => requestAnimationFrame(scroll))
    document.fonts?.ready.then(scroll)
  }, [])

  return (
    <div className="page-enter flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <HeroSection />
        <DownloaderPanel />
        <FeatureGrid />
        <HowItWorks />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  )
}
