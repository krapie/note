import { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import IndexPage from './pages/IndexPage'
import TcpPage from './pages/TcpPage'
import ClosPage from './pages/ClosPage'
import VpcPage from './pages/VpcPage'
import MtrPage from './pages/MtrPage'
import BgpPage from './pages/BgpPage'
import IpsecPage from './pages/IpsecPage'

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

  const [theme, setTheme] = useState<Theme>(() => {
    if (themeParam === 'light' || themeParam === 'dark') return themeParam
    const stored = localStorage.getItem('kp-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const [lang, setLang] = useState<Lang>(() => {
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
          </Routes>
        </BrowserRouter>
      </ThemeCtx.Provider>
    </LangCtx.Provider>
  )
}
