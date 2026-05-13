import { useContext, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Menu, LogOut, Moon, Sun } from 'lucide-react'
import Logo from './Logo'
import apiClient from '../api/client'
import { getProfileIconNode } from '../pages/Settings'
import { NAV_GROUPS, getActiveGroup } from '../nav'
import { HomeFavContext } from '../contexts'

interface SidebarNavProps {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

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

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('theme') === 'dark' || document.documentElement.classList.contains('dark')
  )
  const [profileIcon, setProfileIcon] = useState(() => localStorage.getItem('profileIcon') || 'user')

  useEffect(() => {
    if (activeGroup) setExpanded(prev => new Set([...prev, activeGroup.id]))
  }, [activeGroup?.id])

  useEffect(() => {
    const sync = () => setProfileIcon(localStorage.getItem('profileIcon') || 'user')
    window.addEventListener('profileIconChange', sync)
    return () => window.removeEventListener('profileIconChange', sync)
  }, [])

  const toggle = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleDark = () => {
    const next = !darkMode
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setDarkMode(next)
    const el = document.documentElement
    const uL = el.getAttribute('data-pnl-up-light'), dL = el.getAttribute('data-pnl-down-light')
    const uD = el.getAttribute('data-pnl-up-dark'),  dD = el.getAttribute('data-pnl-down-dark')
    if (uL && dL && uD && dD) {
      el.style.setProperty('--c-up',   next ? uD : uL)
      el.style.setProperty('--c-down', next ? dD : dL)
    }
    apiClient.put('/api/settings', { settings: { ui_dark_mode: next } }).catch(() => {})
  }

  const handleLogout = () => { localStorage.removeItem('token'); navigate('/login') }

  const w = collapsed ? 'w-14' : 'w-56'

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 h-screen
        bg-white dark:bg-zinc-950
        border-r border-zinc-100 dark:border-zinc-800
        z-40 flex flex-col
        overflow-hidden
        transition-[width] duration-200 ease-in-out
        ${w}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        {/* 헤더: 로고 + 접기 버튼 */}
        <div className="flex-shrink-0 flex items-center h-11 px-2.5 border-b border-zinc-100 dark:border-zinc-800 gap-2">
          {collapsed ? (
            /* 접힌 상태: 아이콘만 중앙 크게 */
            <div className="w-full flex items-center justify-center">
              <div
                className="cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                onClick={() => { navigate(homeTab); onClose() }}
              >
                <Logo size="md" iconOnly className="text-zinc-900 dark:text-zinc-100" />
              </div>
            </div>
          ) : (
            /* 펼친 상태: 로고 좌측 + 접기 버튼 우측 */
            <>
              <div
                className="flex-1 cursor-pointer hover:opacity-75 transition-opacity active:scale-95"
                onClick={() => { navigate(homeTab); onClose() }}
              >
                <Logo size="sm" className="text-zinc-900 dark:text-zinc-100" />
              </div>
              <button
                onClick={onToggleCollapse}
                className="hidden lg:flex w-6 h-6 items-center justify-center rounded-md text-zinc-400 hover:text-accent hover:bg-accent/10 transition-colors flex-shrink-0"
                title="접기"
              >
                <ChevronsLeft size={14} />
              </button>
            </>
          )}
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          {NAV_GROUPS.map(group => {
            const isGroupActive = activeGroup?.id === group.id
            const isExpanded = expanded.has(group.id)
            const hasChildren = (group.children?.length ?? 0) > 0

            if (!hasChildren) {
              return (
                <div key={group.id} className="relative group/item">
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
              )
            }

            return (
              <div key={group.id}>
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
                  <div className="ml-4 border-l border-zinc-200 dark:border-zinc-700 mt-0.5 space-y-0.5 animate-accordion">
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
            )
          })}
          {/* collapsed 상태 펼치기 버튼 — 네비게이션 하단 */}
          {collapsed && (
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex w-full items-center justify-center py-2 mt-1 text-zinc-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
              title="펼치기"
            >
              <ChevronsRight size={15} />
            </button>
          )}
        </nav>

        {/* 하단 유저 컨트롤 */}
        <div className={`flex-shrink-0 border-t border-zinc-100 dark:border-zinc-800 p-2 ${
          collapsed ? 'flex flex-col items-center gap-1' : 'space-y-1'
        }`}>
          {/* 다크모드 토글 */}
          <button
            onClick={toggleDark}
            title={darkMode ? '라이트 모드' : '다크 모드'}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm w-full transition-colors text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            {!collapsed && <span>{darkMode ? '라이트 모드' : '다크 모드'}</span>}
          </button>

          {/* 설정/프로필 */}
          <button
            onClick={() => { navigate('/settings'); onClose() }}
            title="설정"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm w-full transition-colors text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
              {getProfileIconNode(profileIcon, 15)}
            </span>
            {!collapsed && <span>프로필 / 설정</span>}
          </button>

          {/* 로그아웃 */}
          <button
            onClick={handleLogout}
            title="로그아웃"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm w-full transition-colors text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-red-500 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut size={15} className="flex-shrink-0" />
            {!collapsed && <span>로그아웃</span>}
          </button>
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
      className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-accent hover:border-accent transition-colors lg:hidden"
      title="메뉴 열기"
    >
      <Menu size={15} />
    </button>
  )
}
