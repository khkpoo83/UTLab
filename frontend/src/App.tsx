import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { loadBgConfig, applyBackground, saveBgConfig } from './utils/background'
import { applySeasonTheme, applyPnlColors, loadPnlColorConfig, applyUiRadius, UiRadius, getCardOpacity, applyCardOpacity } from './pages/Settings'
import { setLogoIconStyle } from './components/Logo'
import { loadOverlayStyle, applyOverlayStyle } from './utils/overlay'
import apiClient from './api/client'
import Login from './pages/Login'
import Home from './pages/Home'
import Portfolio from './pages/Portfolio'
import News from './pages/News'
import Recommend from './pages/Recommend'
import Settings from './pages/Settings'
import Planner from './pages/Planner'
import Analytics from './pages/Analytics'
import Watchlist from './pages/Watchlist'
import CalendarPage from './pages/Calendar'
import { TopBar } from './components/TopBar'
import { SidebarNav, SidebarToggle } from './components/SidebarNav'
import { HomeFavContext, NavModeContext } from './contexts'
import { ALL_ROUTES } from './nav'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function useHomeTab() {
  const [homeTab, setHomeTab] = useState(() => localStorage.getItem('homeTab') ?? '/portfolio')
  const saveHomeTab = (path: string) => {
    localStorage.setItem('homeTab', path)
    setHomeTab(path)
  }
  return { homeTab, saveHomeTab }
}

function useNavMode() {
  const [navMode, setNavModeState] = useState<'top' | 'sidebar'>(
    () => (localStorage.getItem('nav_mode') as 'top' | 'sidebar') ?? 'top'
  )
  const setNavMode = (mode: 'top' | 'sidebar') => {
    localStorage.setItem('nav_mode', mode)
    setNavModeState(mode)
  }
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<{ mode: 'top' | 'sidebar' }>).detail.mode
      setNavModeState(mode)
    }
    window.addEventListener('navModeChange', handler)
    return () => window.removeEventListener('navModeChange', handler)
  }, [])
  return { navMode, setNavMode }
}

function ScrollButtons() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 300)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])
  return (
    <div className="fixed bottom-6 right-4 z-50 flex flex-col gap-2">
      {scrolled && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 shadow-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-accent hover:border-accent transition-colors"
          title="맨 위로"
        >
          <ChevronUp size={18} />
        </button>
      )}
      <button
        onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
        className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 shadow-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-accent hover:border-accent transition-colors"
        title="맨 아래로"
      >
        <ChevronDown size={18} />
      </button>
    </div>
  )
}

const AppRoutes = () => (
  <Routes>
    <Route path="/home"      element={<Home />} />
    <Route path="/portfolio" element={<Portfolio />} />
    <Route path="/planner"   element={<Planner />} />
    <Route path="/news"      element={<News />} />
    <Route path="/recommend" element={<Recommend />} />
    <Route path="/analytics" element={<Analytics />} />
    <Route path="/watchlist" element={<Watchlist />} />
    <Route path="/calendar"  element={<CalendarPage />} />
    <Route path="/settings"  element={<Settings />} />
    <Route path="*"          element={<Navigate to="/home" replace />} />
  </Routes>
)

function MainLayout() {
  const navigate = useNavigate()
  const { homeTab, saveHomeTab } = useHomeTab()
  const { navMode, setNavMode } = useNavMode()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  )
  const toggleSidebarCollapse = () => {
    setSidebarCollapsed(v => {
      localStorage.setItem('sidebar_collapsed', String(!v))
      return !v
    })
  }

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchFromEdge = useRef(false)

  useEffect(() => {
    applyBackground(loadBgConfig())
    // 로컬 설정 먼저 적용 (서버 응답 전 깜빡임 방지)
    const localRadius = localStorage.getItem('ui_radius') as UiRadius | null
    if (localRadius) applyUiRadius(localRadius)
    applyOverlayStyle(loadOverlayStyle())
    applyCardOpacity(getCardOpacity())

    const token = localStorage.getItem('token')
    if (!token) return
    apiClient.get('/api/settings').then(({ data }) => {
      if (data.ui_season)           applySeasonTheme(data.ui_season)
      if (data.ui_logo_icon)        setLogoIconStyle(data.ui_logo_icon as Parameters<typeof setLogoIconStyle>[0])
      if (data.ui_pnl_color_config) applyPnlColors({ ...loadPnlColorConfig(), ...data.ui_pnl_color_config })
      if (data.ui_bg_config)        { saveBgConfig(data.ui_bg_config); applyBackground(data.ui_bg_config) }
      if (data.ui_dark_mode != null) {
        const dark = Boolean(data.ui_dark_mode)
        document.documentElement.classList.toggle('dark', dark)
        localStorage.setItem('theme', dark ? 'dark' : 'light')
      }
      if (data.ui_nav_mode) {
        const mode = data.ui_nav_mode as 'top' | 'sidebar'
        localStorage.setItem('nav_mode', mode)
        setNavMode(mode)
      }
      if (data.ui_radius) applyUiRadius(data.ui_radius as UiRadius)
      if (data.ui_overlay_style) applyOverlayStyle(data.ui_overlay_style)
      if (data.ui_card_opacity != null) applyCardOpacity(data.ui_card_opacity)
    }).catch(() => {})
  }, [])

  // Google Calendar SSE — push webhook 수신 시 calendar_updated 이벤트를 window에 전파
  useEffect(() => {
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 2000

    const connect = () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      const token = localStorage.getItem('token')
      if (!token) return
      es = new EventSource(`/api/calendar/stream?token=${encodeURIComponent(token)}`)
      es.addEventListener('calendar_updated', () => {
        retryDelay = 2000
        window.dispatchEvent(new CustomEvent('calendarUpdated'))
      })
      es.addEventListener('ping', () => { retryDelay = 2000 })
      es.onerror = () => {
        es?.close()
        es = null
        const delay = retryDelay
        retryDelay = Math.min(retryDelay * 2, 10000) // 최대 10초
        retryTimer = setTimeout(connect, delay)
      }
    }

    connect()

    // 탭이 다시 포커스될 때: SSE 재연결 + 즉시 데이터 갱신
    const onVisible = () => {
      if (document.hidden) return
      if (!es || es.readyState === EventSource.CLOSED) connect()
      window.dispatchEvent(new CustomEvent('calendarUpdated'))
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      es?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const getActiveIdx = () => {
    const path = window.location.pathname
    const idx = ALL_ROUTES.findIndex(r => path.startsWith(r))
    return idx >= 0 ? idx : 0
  }

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const x = e.touches[0].clientX
    touchFromEdge.current = x <= 20 || x >= window.innerWidth - 20
    touchStartX.current = x
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchFromEdge.current || touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null; touchStartY.current = null; touchFromEdge.current = false
    if (Math.abs(dy) > Math.abs(dx) * 0.5) return
    if (Math.abs(dx) < 80) return
    const cur = getActiveIdx()
    if (dx < 0 && cur < ALL_ROUTES.length - 1) navigate(ALL_ROUTES[cur + 1])
    if (dx > 0 && cur > 0) navigate(ALL_ROUTES[cur - 1])
  }, [navigate])

  const isSidebar = navMode === 'sidebar'
  const contentMargin = isSidebar ? (sidebarCollapsed ? 'lg:ml-14' : 'lg:ml-56') : ''

  return (
    <HomeFavContext.Provider value={{ homeTab, saveHomeTab }}>
      <NavModeContext.Provider value={{ navMode, setNavMode }}>
        <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>

          {isSidebar ? (
            /* ── 사이드바 레이아웃 ──────────────────────────────────────── */
            <>
              {/* 모바일 슬림 상단바 (lg에서는 숨김) */}
              <header className="lg:hidden h-11 sticky top-0 z-50 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-100 dark:border-zinc-800 flex items-center px-3 gap-2">
                <SidebarToggle onClick={() => setSidebarOpen(v => !v)} />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">UT.Lab</span>
              </header>

              <SidebarNav
                mobileOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                onToggleCollapse={toggleSidebarCollapse}
              />

              {/* 콘텐츠 + 글래스 래퍼 */}
              <div className={`${contentMargin} transition-[margin] duration-200 px-2 pt-2 pb-2`}>
                <div className="max-w-screen-xl mx-auto">
                  <div className="glass-panel rounded-2xl bg-white/30 dark:bg-zinc-950/30 min-h-[calc(100vh-4rem)] lg:min-h-[calc(100vh-1rem)]">
                    <main className="px-4 py-4">
                      <AppRoutes />
                    </main>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* ── 상단탭 레이아웃 ─────────────────────────────────────────── */
            <>
              <TopBar />
              {/* 글래스 래퍼: TopBar 바로 아래부터, 콘텐츠 폭 = max-w-screen-xl */}
              <div className="max-w-screen-xl mx-auto px-2 pt-1 pb-2">
                <div className="glass-panel rounded-2xl bg-white/30 dark:bg-zinc-950/30 min-h-[calc(100vh-6rem)]">
                  <main className="px-4 py-4">
                    <AppRoutes />
                  </main>
                </div>
              </div>
            </>
          )}
        </div>
        <ScrollButtons />
      </NavModeContext.Provider>
    </HomeFavContext.Provider>
  )
}

function App() {
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark') document.documentElement.classList.add('dark')
    else if (saved === 'light') document.documentElement.classList.remove('dark')
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.add('dark')

    const season = localStorage.getItem('season')
    if (season && season !== 'default')
      document.documentElement.setAttribute('data-season', season)

    try {
      const raw = localStorage.getItem('pnl_color_config')
      if (raw) {
        const cfg = JSON.parse(raw)
        const dark = document.documentElement.classList.contains('dark')
        document.documentElement.style.setProperty('--c-up',   dark ? cfg.upDark   : cfg.upLight)
        document.documentElement.style.setProperty('--c-down', dark ? cfg.downDark : cfg.downLight)
        document.documentElement.setAttribute('data-pnl-up-light',   cfg.upLight)
        document.documentElement.setAttribute('data-pnl-down-light', cfg.downLight)
        document.documentElement.setAttribute('data-pnl-up-dark',    cfg.upDark)
        document.documentElement.setAttribute('data-pnl-down-dark',  cfg.downDark)
      }
    } catch {}

    const syncThemeColor = () => {
      const dark = document.documentElement.classList.contains('dark')
      const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null
      if (meta) meta.content = dark ? '#0c0d16' : '#ffffff'
    }
    syncThemeColor()
    const obs = new MutationObserver(syncThemeColor)
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
