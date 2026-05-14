/**
 * TopBar — 상단 메뉴 모드에서 로고 + 그룹 탭 + 유저 컨트롤을 한 줄로 통합
 */
import { useContext, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import apiClient from '../api/client'
import { getProfileIconNode } from '../utils/settings-utils'
import { HomeFavContext } from '../contexts'
import { NAV_GROUPS, getActiveGroup, getFirstRoute } from '../nav'

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500 hidden sm:inline">
      {time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

function DarkToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1"
      title={dark ? '라이트 모드' : '다크 모드'}
    >
      {dark ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  )
}

function ProfileBtn() {
  const navigate = useNavigate()
  const [iconId, setIconId] = useState(() => localStorage.getItem('profileIcon') || 'user')
  useEffect(() => {
    const sync = () => setIconId(localStorage.getItem('profileIcon') || 'user')
    window.addEventListener('profileIconChange', sync)
    return () => window.removeEventListener('profileIconChange', sync)
  }, [])
  return (
    <button
      onClick={() => navigate('/settings')}
      className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-accent hover:border-accent transition-colors"
      title="설정"
    >
      {getProfileIconNode(iconId, 14)}
    </button>
  )
}

function FavStar({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`absolute top-0.5 right-0 p-0.5 transition-all ${
        active ? 'text-amber-400 opacity-100' : 'text-zinc-300 dark:text-zinc-600 opacity-0 group-hover/tab:opacity-100 hover:text-amber-400'
      }`}
    >
      <svg className="w-2.5 h-2.5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { homeTab, saveHomeTab } = useContext(HomeFavContext)
  const activeGroup = getActiveGroup(location.pathname)
  const hasSubNav = (activeGroup?.children?.length ?? 0) > 0

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('theme') === 'dark' || document.documentElement.classList.contains('dark')
  )

  const toggleDark = () => {
    const next = !darkMode
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setDarkMode(next)
    const el = document.documentElement
    const upLight = el.getAttribute('data-pnl-up-light')
    const downLight = el.getAttribute('data-pnl-down-light')
    const upDark = el.getAttribute('data-pnl-up-dark')
    const downDark = el.getAttribute('data-pnl-down-dark')
    if (upLight && downLight && upDark && downDark) {
      el.style.setProperty('--c-up', next ? upDark : upLight)
      el.style.setProperty('--c-down', next ? downDark : downLight)
    }
    const token = localStorage.getItem('token')
    if (token) apiClient.put('/api/settings', { settings: { ui_dark_mode: next } }).catch(() => {})
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-100 dark:border-zinc-800">
      {/* 메인 행: 로고 | 구분선 | 탭 | 유저컨트롤 */}
      <div className="flex items-center h-11 px-3 gap-2">
        {/* 로고 */}
        <div
          className="flex-shrink-0 cursor-pointer hover:opacity-75 transition-opacity active:scale-95 pr-1"
          onClick={() => navigate(homeTab)}
          title="홈으로"
        >
          <Logo size="sm" className="text-zinc-900 dark:text-zinc-100" />
        </div>

        {/* 세로 구분선 */}
        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0" />

        {/* 그룹 탭 (스크롤 가능) */}
        <div className="flex-1 flex overflow-x-auto scrollbar-none min-w-0">
          {NAV_GROUPS.map(group => {
            const isActive = activeGroup?.id === group.id
            const dest = getFirstRoute(group)
            return (
              <div key={group.id} className="relative flex-shrink-0 group/tab">
                <button
                  onClick={() => group.href ? window.open(group.href, '_blank', 'noopener') : navigate(dest)}
                  className={`flex items-center gap-1.5 px-2.5 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-accent text-accent font-medium'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <group.Icon size={13} />
                  <span className="hidden sm:inline">{group.label}</span>
                </button>
                {!group.href && <FavStar active={homeTab === dest} onClick={() => saveHomeTab(dest)} />}
              </div>
            )
          })}
        </div>

        {/* 유저 컨트롤 */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pl-1">
          <Clock />
          <DarkToggle dark={darkMode} onToggle={toggleDark} />
          <ProfileBtn />
          <button
            onClick={handleLogout}
            className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors px-1 hidden sm:block"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* 서브탭 행 (그룹에 children 있을 때) */}
      {hasSubNav && (
        <div className="flex px-3 overflow-x-auto scrollbar-none bg-zinc-50/80 dark:bg-zinc-900/80 border-t border-zinc-100 dark:border-zinc-800/60">
          {activeGroup!.children!.map(item => (
            <div key={item.to} className="relative flex-shrink-0 group/tab">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-accent text-accent font-medium'
                      : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                  }`
                }
              >
                <item.Icon size={11} />
                {item.label}
              </NavLink>
              <FavStar active={homeTab === item.to} onClick={() => saveHomeTab(item.to)} />
            </div>
          ))}
        </div>
      )}
    </header>
  )
}
