import { Fragment, useContext, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Menu,
  LogOut, Moon, Sun, Monitor, Settings, FileText, Globe,
} from 'lucide-react'
import Logo from './Logo'
import apiClient, { authApi } from '../api/client'
import { loadBgConfig, applyBackground } from '../utils/background'
import { getProfileIconNode } from '../utils/settings-utils'
import { NAV_GROUPS, getActiveGroup } from '../nav'
import { HomeFavContext } from '../contexts'

interface SidebarNavProps {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

type ThemeMode = 'light' | 'dark' | 'system'

function FavStar({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-all ${
        active
          ? 'text-amber-400 opacity-100'
          : 'text-zinc-300 dark:text-zinc-600 opacity-0 group-hover/item:opacity-100 hover:text-amber-400'
      }`}
    >
      <svg className="w-2.5 h-2.5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  )
}

function syncPnlColors(isDark: boolean) {
  const el = document.documentElement
  const uL = el.getAttribute('data-pnl-up-light'), dL = el.getAttribute('data-pnl-down-light')
  const uD = el.getAttribute('data-pnl-up-dark'),  dD = el.getAttribute('data-pnl-down-dark')
  if (uL && dL && uD && dD) {
    el.style.setProperty('--c-up',   isDark ? uD : uL)
    el.style.setProperty('--c-down', isDark ? dD : dL)
    el.style.setProperty('--up',     isDark ? uD : uL)
    el.style.setProperty('--down',   isDark ? dD : dL)
  }
}

export function SidebarNav({ mobileOpen, onClose, collapsed, onToggleCollapse }: SidebarNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { homeTab, saveHomeTab } = useContext(HomeFavContext)
  const activeGroup = getActiveGroup(location.pathname)

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>()
    if (activeGroup) init.add(activeGroup.id)
    return init
  })

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme') as ThemeMode | null
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    return 'system'
  })
  const [profileIcon, setProfileIcon] = useState(() => localStorage.getItem('profileIcon') || 'user')
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (activeGroup) setExpanded(prev => new Set([...prev, activeGroup.id]))
  }, [activeGroup?.id])

  useEffect(() => {
    const sync = () => setProfileIcon(localStorage.getItem('profileIcon') || 'user')
    window.addEventListener('profileIconChange', sync)
    return () => window.removeEventListener('profileIconChange', sync)
  }, [])

  useEffect(() => {
    authApi.me().then(({ data }) => setUsername(data.username)).catch(() => {})
  }, [])

  // 시스템 모드일 때 OS 변경 감지
  useEffect(() => {
    if (themeMode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches)
      syncPnlColors(e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeMode])

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const cycleTheme = () => {
    const next: ThemeMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light'
    localStorage.setItem('theme', next)
    setThemeModeState(next)
    let isDark: boolean
    if (next === 'dark') { isDark = true }
    else if (next === 'light') { isDark = false }
    else { isDark = window.matchMedia('(prefers-color-scheme: dark)').matches }
    document.documentElement.classList.toggle('dark', isDark)
    syncPnlColors(isDark)
    applyBackground(loadBgConfig(isDark ? 'dark' : 'light'))
    apiClient.put('/api/settings', { settings: { ui_dark_mode: next === 'system' ? null : isDark } }).catch(() => {})
  }

  const handleLogout = () => { localStorage.removeItem('token'); navigate('/login') }

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor
  const themeTitle = themeMode === 'dark' ? '다크 모드' : themeMode === 'light' ? '라이트 모드' : '시스템 모드'

  const w = collapsed ? 'w-14' : 'w-56'

  const iconBtnCls = `flex items-center justify-center w-9 h-9 rounded-lg transition-colors
    text-zinc-500 dark:text-zinc-400
    hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200`

  // 관리 영역 전용 — 메인 nav보다 한 단계 작게
  const mgmtBtnCls = `flex items-center justify-center w-7 h-7 rounded-md transition-colors
    text-zinc-400 dark:text-zinc-500
    hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300`

  const mainNavGroups = NAV_GROUPS.filter(g => !g.hideInSidebar)

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 h-screen
        bg-white dark:bg-zinc-950
        border-r border-zinc-100 dark:border-white/[.05]
        z-40 flex flex-col
        overflow-hidden
        transition-[width] duration-200 ease-in-out
        ${w}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        {/* 헤더: 로고 + 접기/펼치기 */}
        <div className="flex-shrink-0 flex items-center h-11 px-2.5 border-b border-zinc-100 dark:border-white/[.05]">
          {collapsed ? (
            <>
              {/* 데스크탑: 로고 클릭 = 펼치기 */}
              <button
                className="hidden lg:flex flex-1 items-center justify-center hover:opacity-75 transition-opacity active:scale-95"
                onClick={onToggleCollapse}
                title="펼치기"
              >
                <Logo size="md" iconOnly className="text-zinc-900 dark:text-zinc-100" />
              </button>
              {/* 모바일: 로고 클릭 = 홈 이동 */}
              <div
                className="lg:hidden flex-1 flex justify-center cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                onClick={() => { navigate(homeTab); onClose() }}
              >
                <Logo size="md" iconOnly className="text-zinc-900 dark:text-zinc-100" />
              </div>
            </>
          ) : (
            <>
              <div
                className="flex-1 cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                onClick={() => { navigate(homeTab); onClose() }}
              >
                <Logo size="sm" className="text-zinc-900 dark:text-zinc-100" />
              </div>
              <button
                onClick={onToggleCollapse}
                title="접기"
                className={`${iconBtnCls} hidden lg:flex flex-shrink-0`}
              >
                <ChevronsLeft size={16} />
              </button>
            </>
          )}
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {mainNavGroups.map(group => {
            const isGroupActive = activeGroup?.id === group.id
            const isExpanded = expanded.has(group.id)
            const hasChildren = (group.children?.length ?? 0) > 0

            if (!hasChildren) {
              const linkClass = `flex items-center rounded-lg text-sm transition-colors ${
                collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2'
              } text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200`

              if (group.href) {
                return (
                  <Fragment key={group.id}>
                    <div className="relative group/item">
                      <a
                        href={group.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={collapsed ? group.label : undefined}
                        className={linkClass}
                        onClick={onClose}
                      >
                        <group.Icon size={collapsed ? 19 : 17} className="flex-shrink-0" />
                        {!collapsed && <span className="flex-1 truncate">{group.label}</span>}
                      </a>
                    </div>
                  </Fragment>
                )
              }

              return (
                <Fragment key={group.id}>
                  <div className="relative group/item">
                    <NavLink
                      to={group.to!}
                      onClick={onClose}
                      title={collapsed ? group.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center rounded-lg text-sm transition-colors ${
                          collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2'
                        } ${
                          isActive
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`
                      }
                    >
                      <group.Icon size={collapsed ? 19 : 17} className="flex-shrink-0" />
                      {!collapsed && <span className="flex-1 truncate">{group.label}</span>}
                    </NavLink>
                    {!collapsed && (
                      <FavStar active={homeTab === group.to!} onClick={() => saveHomeTab(group.to!)} />
                    )}
                  </div>
                </Fragment>
              )
            }

            return (
              <Fragment key={group.id}>
                <div>
                  <button
                    onClick={() => { if (!collapsed) toggle(group.id) }}
                    title={collapsed ? group.label : undefined}
                    className={`w-full flex items-center rounded-lg text-sm transition-colors ${
                      collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2'
                    } ${
                      isGroupActive
                        ? 'text-accent'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                  >
                    <group.Icon size={collapsed ? 19 : 17} className={`flex-shrink-0 ${isGroupActive ? 'text-accent' : ''}`} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{group.label}</span>
                        {isExpanded
                          ? <ChevronDown size={13} className="opacity-40 flex-shrink-0" />
                          : <ChevronRight size={13} className="opacity-40 flex-shrink-0" />
                        }
                      </>
                    )}
                  </button>

                  {!collapsed && isExpanded && (
                    <div className="ml-4 border-l border-zinc-200 dark:border-white/[.04] mt-0.5 space-y-0.5 animate-accordion">
                      {group.children!.map(item => (
                        <div key={item.to} className="relative group/item">
                          <NavLink
                            to={item.to}
                            onClick={onClose}
                            className={({ isActive }) =>
                              `flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-r-md text-xs transition-colors ${
                                isActive
                                  ? 'bg-accent/10 text-accent font-medium'
                                  : 'text-zinc-500 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
                              }`
                            }
                          >
                            <item.Icon size={13} className="flex-shrink-0" />
                            <span className="flex-1 truncate">{item.label}</span>
                          </NavLink>
                          <FavStar active={homeTab === item.to} onClick={() => saveHomeTab(item.to)} />
                        </div>
                      ))}
                    </div>
                  )}

                  {collapsed && (
                    <div className="relative mt-0.5 space-y-0.5 ml-[5px]">
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-200 dark:bg-zinc-700 rounded-full pointer-events-none" />
                      {group.children!.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={onClose}
                          title={item.label}
                          className={({ isActive }) =>
                            `flex items-center justify-center pl-2 pr-1.5 py-1.5 rounded-r-md transition-colors ${
                              isActive
                                ? 'bg-accent/10 text-accent'
                                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300'
                            }`
                          }
                        >
                          <item.Icon size={13} />
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              </Fragment>
            )
          })}

        </nav>

        {/* 하단 유저 바 */}
        <div className="flex-shrink-0 border-t border-zinc-100 dark:border-white/[.05]">
          {collapsed ? (
            /* ── 접힌 상태 ── */
            <div className="flex flex-col items-center gap-0.5 py-2 px-1">
              {/* 프로필 카드 (접힘) — card 스타일 */}
              <div className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                {getProfileIconNode(profileIcon, 17)}
              </div>
              <div className="w-4 h-px bg-zinc-100 dark:bg-zinc-800 my-0.5" />
              {/* 관리 아이콘 — 소형 */}
              <button onClick={cycleTheme} title={themeTitle} className={mgmtBtnCls}>
                <ThemeIcon size={15} />
              </button>
              <button
                onClick={() => { navigate('/settings'); onClose() }}
                title="설정"
                className={mgmtBtnCls}
              >
                <Settings size={15} />
              </button>
              <a
                href="/docs/"
                target="_blank"
                rel="noopener noreferrer"
                title="명세서"
                className={mgmtBtnCls}
              >
                <FileText size={15} />
              </a>
              <button
                onClick={handleLogout}
                title="로그아웃"
                className={`${mgmtBtnCls} hover:text-red-400 dark:hover:text-red-400`}
              >
                <LogOut size={15} />
              </button>
              <div className="w-4 h-px bg-zinc-100 dark:bg-zinc-800 my-0.5" />
              <button
                onClick={() => { navigate('/'); onClose() }}
                title="메인으로 가기"
                className={mgmtBtnCls}
              >
                <Globe size={13} />
              </button>
              <button
                onClick={onToggleCollapse}
                title="펼치기"
                className={`${mgmtBtnCls} hidden lg:flex`}
              >
                <ChevronsRight size={13} />
              </button>
            </div>
          ) : (
            /* ── 펼친 상태 ── */
            <div className="px-2.5 py-2">
              {/* 프로필 카드 (펼침) — card 스타일 (테두리 + 그림자) */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm bg-white dark:bg-zinc-900 px-2.5 py-2 mb-2 flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-zinc-500 dark:text-zinc-400">
                  {getProfileIconNode(profileIcon, 16)}
                </span>
                <span className="flex-1 text-xs font-semibold truncate text-zinc-700 dark:text-zinc-200">
                  {username || 'admin'}
                </span>
              </div>
              {/* 관리 아이콘 행 — 소형 */}
              <div className="flex items-center gap-0.5 mb-1">
                <button onClick={cycleTheme} title={themeTitle} className={mgmtBtnCls}>
                  <ThemeIcon size={15} />
                </button>
                <button
                  onClick={() => { navigate('/settings'); onClose() }}
                  title="설정"
                  className={mgmtBtnCls}
                >
                  <Settings size={15} />
                </button>
                <a
                  href="/docs/"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="명세서"
                  className={mgmtBtnCls}
                >
                  <FileText size={15} />
                </a>
                <button
                  onClick={handleLogout}
                  title="로그아웃"
                  className={`${mgmtBtnCls} hover:text-red-400 dark:hover:text-red-400`}
                >
                  <LogOut size={15} />
                </button>
              </div>
              {/* 구분선 + 하단 소형 버튼 */}
              <div className="w-full h-px bg-zinc-100 dark:bg-zinc-800 mb-1" />
              <button
                onClick={() => { navigate('/'); onClose() }}
                className="flex w-full items-center gap-1.5 px-1 py-1 text-2xs text-zinc-400 hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                title="메인으로 가기"
              >
                <Globe size={12} />
                <span>메인으로 가기</span>
              </button>
              <button
                onClick={onToggleCollapse}
                className="hidden lg:flex w-full items-center gap-1.5 px-1 py-1 text-2xs text-zinc-400 hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                title="접기"
              >
                <ChevronsLeft size={12} />
                <span>접기</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/** 모바일 햄버거 버튼 */
export function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/[.04] flex items-center justify-center text-zinc-500 hover:text-accent hover:border-accent transition-colors lg:hidden"
      title="메뉴 열기"
    >
      <Menu size={15} />
    </button>
  )
}
