import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { loadBgConfig, applyBackground, saveBgConfig, getCurrentMode } from './utils/background'
import { applySeasonTheme, applyPnlColors, loadPnlColorConfig, applyUiRadius, UiRadius, applyCardOpacity, applyDotColor, applyColorTheme, ColorTheme } from './utils/settings-utils'
import { saveWeatherIconStyle } from './components/WeatherWidget'
import { setLogoIconStyle } from './components/Logo'
import { applyOverlayStyle } from './utils/overlay'
import apiClient from './api/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TopBar } from './components/TopBar'
import { SidebarNav, SidebarToggle } from './components/SidebarNav'
import { HomeFavContext, NavModeContext } from './contexts'
import { ALL_ROUTES } from './nav'

const SpatialHub      = React.lazy(() => import('./pages/SpatialHub'))
const Landing         = React.lazy(() => import('./pages/Landing'))
const Login           = React.lazy(() => import('./pages/Login'))
const Home            = React.lazy(() => import('./pages/Home'))
const Portfolio       = React.lazy(() => import('./pages/Portfolio'))
const News            = React.lazy(() => import('./pages/News'))
const Recommend       = React.lazy(() => import('./pages/Recommend'))
const Settings        = React.lazy(() => import('./pages/Settings'))
const Planner         = React.lazy(() => import('./pages/Planner'))
const Analytics       = React.lazy(() => import('./pages/Analytics'))
const Watchlist       = React.lazy(() => import('./pages/Watchlist'))
const CalendarPage    = React.lazy(() => import('./pages/Calendar'))
const Blog            = React.lazy(() => import('./pages/Blog'))
const BlogWrite       = React.lazy(() => import('./pages/BlogWrite'))
const BlogDetail      = React.lazy(() => import('./pages/BlogDetail'))
const PublicBlog      = React.lazy(() => import('./pages/PublicBlog'))
const PublicBlogDetail = React.lazy(() => import('./pages/PublicBlogDetail'))
const Memo            = React.lazy(() => import('./pages/Memo'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function useHomeTab() {
  const [homeTab, setHomeTab] = useState(() => localStorage.getItem('homeTab') ?? '/portfolio')
  const saveHomeTab = useCallback((path: string) => {
    localStorage.setItem('homeTab', path)
    setHomeTab(path)
  }, [])
  return { homeTab, saveHomeTab }
}

function useNavMode() {
  const [navMode, setNavModeState] = useState<'top' | 'sidebar'>(
    () => (localStorage.getItem('nav_mode') as 'top' | 'sidebar') ?? 'top'
  )
  const setNavMode = useCallback((mode: 'top' | 'sidebar') => {
    localStorage.setItem('nav_mode', mode)
    setNavModeState(mode)
  }, [])
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
  <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/home"           element={<Home />} />
        <Route path="/portfolio"      element={<Portfolio />} />
        <Route path="/planner"        element={<Planner />} />
        <Route path="/news"           element={<News />} />
        <Route path="/recommend"      element={<Recommend />} />
        <Route path="/analytics"      element={<Analytics />} />
        <Route path="/watchlist"      element={<Watchlist />} />
        <Route path="/calendar"       element={<CalendarPage />} />
        <Route path="/settings"       element={<Settings />} />
        <Route path="/blog"           element={<Blog />} />
        <Route path="/blog/new"       element={<BlogWrite />} />
        <Route path="/blog/:id"       element={<BlogDetail />} />
        <Route path="/blog/:id/edit"  element={<BlogWrite />} />
        <Route path="/memo"           element={<Memo />} />
        <Route path="*"               element={<Navigate to="/home" replace />} />
      </Routes>
    </Suspense>
  </ErrorBoundary>
)

function MainLayout() {
  const navigate = useNavigate()
  const { homeTab, saveHomeTab } = useHomeTab()
  const { navMode, setNavMode } = useNavMode()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  )
  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(v => {
      localStorage.setItem('sidebar_collapsed', String(!v))
      return !v
    })
  }, [])

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchFromEdge = useRef(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    apiClient.get('/api/settings').then(({ data }) => {
      if (data.ui_season)           applySeasonTheme(data.ui_season)
      if (data.ui_logo_icon)        setLogoIconStyle(data.ui_logo_icon as Parameters<typeof setLogoIconStyle>[0])
      if (data.ui_pnl_color_config) applyPnlColors({ ...loadPnlColorConfig(), ...data.ui_pnl_color_config })
      if (data.ui_bg_config)        saveBgConfig(data.ui_bg_config, 'light')
      if (data.ui_bg_config_dark)   saveBgConfig(data.ui_bg_config_dark, 'dark')
      if (data.ui_bg_config || data.ui_bg_config_dark) applyBackground(loadBgConfig(getCurrentMode()))
      if (data.ui_dark_mode != null && localStorage.getItem('theme') !== 'system') {
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
      if (data.ui_dot_color) applyDotColor(data.ui_dot_color as string)
      // 색상 테마(팔레트)는 dot 이후 적용 — 인라인 dot 오버라이드 제거하고 팔레트가 제어
      if (data.ui_color_theme) applyColorTheme(data.ui_color_theme as ColorTheme)
      if (data.ui_weather_icon_style) saveWeatherIconStyle(data.ui_weather_icon_style)
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

  const getActiveIdx = useCallback(() => {
    const path = window.location.pathname
    const idx = ALL_ROUTES.findIndex(r => path.startsWith(r))
    return idx >= 0 ? idx : 0
  }, [])

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
              <header className="lg:hidden h-11 sticky top-0 z-50 bg-[var(--nav-bg)] backdrop-blur-md border-b border-[var(--nav-border)] flex items-center px-3 gap-2">
                <SidebarToggle onClick={() => setSidebarOpen(v => !v)} />
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">U.T Lab4</span>
              </header>

              <SidebarNav
                mobileOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                collapsed={sidebarCollapsed}
                onToggleCollapse={toggleSidebarCollapse}
              />

              {/* 콘텐츠 */}
              <div className={`${contentMargin} transition-[margin] duration-200 px-2 pt-2 pb-2`}>
                <div className="max-w-screen-xl mx-auto">
                  <main className="px-4 py-4 min-h-[calc(100vh-4rem)] lg:min-h-[calc(100vh-1rem)]">
                    <AppRoutes />
                  </main>
                </div>
              </div>
            </>
          ) : (
            /* ── 상단탭 레이아웃 ─────────────────────────────────────────── */
            <>
              <TopBar />
              <div className="max-w-screen-xl mx-auto px-2 pt-1 pb-2">
                <main className="px-4 py-4 min-h-[calc(100vh-6rem)]">
                  <AppRoutes />
                </main>
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
    // 모든 시각 설정은 index.html 인라인 스크립트에서 즉시 적용됨 (FOUC 방지)
    const syncThemeColor = () => {
      const dark = document.documentElement.classList.contains('dark')
      const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null
      if (meta) meta.content = dark ? '#0c0d16' : '#ffffff'
    }
    syncThemeColor()
    const obs = new MutationObserver(syncThemeColor)
    obs.observe(document.documentElement, { attributeFilter: ['class'] })

    // 저장된 favicon 복원
    const savedFavicon = localStorage.getItem('favicon')
    if (savedFavicon) {
      const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
      if (link) link.href = savedFavicon
    }

    return () => obs.disconnect()
  }, [])

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/spatial" element={<SpatialHub />} />
            <Route path="/login" element={<Login />} />
            <Route path="/public/blog" element={<PublicBlog />} />
            <Route path="/public/blog/:id" element={<PublicBlogDetail />} />
            <Route
              path="/*"
              element={
                <PrivateRoute>
                  <MainLayout />
                </PrivateRoute>
              }
            />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
