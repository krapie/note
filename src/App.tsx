import { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import IndexPage from './pages/IndexPage'
import TcpPage from './pages/TcpPage'
import ClosPage from './pages/ClosPage'
import VpcPage from './pages/VpcPage'
import MtrPage from './pages/MtrPage'
import BgpPage from './pages/BgpPage'
import IpsecPage from './pages/IpsecPage'
import MtuPage from './pages/MtuPage'
import ConntrackPage from './pages/ConntrackPage'
import InetPage from './pages/InetPage'
import OverlayPage from './pages/OverlayPage'
import DnsPage from './pages/DnsPage'
import CrdtPage from './pages/CrdtPage'
import CastPage from './pages/CastPage'
import EcmpPage from './pages/EcmpPage'

type Theme = 'light' | 'dark'
export type Lang = 'en' | 'ko'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void; embed: boolean }>({
  theme: 'light',
  toggle: () => {},
  embed: false,
})
const LangCtx = createContext<{ lang: Lang; toggleLang: () => void }>({
  lang: 'en',
  toggleLang: () => {},
})

export function useTheme() { return useContext(ThemeCtx) }
export function useLang() { return useContext(LangCtx) }

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const embed = params.get('embed') === '1'
  const themeParam = params.get('theme')
  const langParam  = params.get('lang')

  const [theme, setTheme] = useState<Theme>(() => {
    if (themeParam === 'light' || themeParam === 'dark') return themeParam
    const stored = localStorage.getItem('kp-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const [lang, setLang] = useState<Lang>(() => {
    if (langParam === 'en' || langParam === 'ko') return langParam
    const stored = localStorage.getItem('kp-lang')
    return stored === 'ko' ? 'ko' : 'en'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kp-theme', theme)
  }, [theme])

  useEffect(() => { localStorage.setItem('kp-lang', lang) }, [lang])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'kp-theme' && (e.data.theme === 'light' || e.data.theme === 'dark')) {
        setTheme(e.data.theme as Theme)
      }
      if (e.data?.type === 'kp-lang' && (e.data.lang === 'en' || e.data.lang === 'ko')) {
        setLang(e.data.lang as Lang)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  function toggle() { setTheme(t => t === 'dark' ? 'light' : 'dark') }
  function toggleLang() { setLang(l => l === 'en' ? 'ko' : 'en') }

  return (
    <LangCtx.Provider value={{ lang, toggleLang }}>
      <ThemeCtx.Provider value={{ theme, toggle, embed }}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<IndexPage />} />
            <Route path="/tcp" element={<TcpPage />} />
            <Route path="/clos" element={<ClosPage />} />
            <Route path="/vpc" element={<VpcPage />} />
            <Route path="/mtr" element={<MtrPage />} />
            <Route path="/bgp" element={<BgpPage />} />
            <Route path="/ipsec" element={<IpsecPage />} />
            <Route path="/mtu" element={<MtuPage />} />
            <Route path="/conntrack" element={<ConntrackPage />} />
            <Route path="/inet" element={<InetPage />} />
            <Route path="/overlay" element={<OverlayPage />} />
            <Route path="/dns" element={<DnsPage />} />
            <Route path="/crdt" element={<CrdtPage />} />
            <Route path="/cast" element={<CastPage />} />
            <Route path="/ecmp" element={<EcmpPage />} />
          </Routes>
        </BrowserRouter>
      </ThemeCtx.Provider>
    </LangCtx.Provider>
  )
}
