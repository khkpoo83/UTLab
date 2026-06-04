import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface SettingsTab {
  id: string
  label: string
  Icon: LucideIcon
}

export interface SettingsSection {
  id: string
  tab: string
  group?: string
  title: string
  keywords?: string[]
  element: React.ReactNode
}

interface SettingsLayoutProps {
  tabs: SettingsTab[]
  sections: SettingsSection[]
}

function matches(section: SettingsSection, q: string): boolean {
  const hay = [section.title, ...(section.keywords ?? [])].join(' ').toLowerCase()
  return hay.includes(q)
}

export function SettingsLayout({ tabs, sections }: SettingsLayoutProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? '')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // 현재 탭의 그룹 목록
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const s of sections) {
      if (s.tab === activeTab && s.group && !seen.has(s.group)) {
        seen.add(s.group)
        result.push(s.group)
      }
    }
    return result
  }, [sections, activeTab])

  const hasGroups = groups.length > 1

  const selectTab = (id: string) => {
    setActiveTab(id)
    setActiveGroup(null)
    setQuery('')
  }

  const selectGroup = (g: string | null) => setActiveGroup(g)

  const visible = useMemo(() => {
    if (searching) return sections.filter((s) => matches(s, q))
    const byTab = sections.filter((s) => s.tab === activeTab)
    if (hasGroups && activeGroup) return byTab.filter((s) => s.group === activeGroup)
    return byTab
  }, [sections, searching, q, activeTab, activeGroup, hasGroups])

  return (
    <div>
      {/* 검색 */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="설정 검색…"
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex gap-6 items-start">

        {/* ── 데스크탑 좌측 사이드바 ── */}
        {!searching && (
          <nav className="hidden md:flex flex-col gap-0.5 w-44 flex-shrink-0 sticky top-4">
            {tabs.map((t) => {
              const tabActive = t.id === activeTab
              const tabHasGroups = tabActive && hasGroups
              return (
                <div key={t.id}>
                  <button
                    onClick={() => selectTab(t.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                      tabActive
                        ? 'bg-accent/10 text-accent'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                    style={tabActive ? { color: 'var(--c-accent)' } : {}}
                  >
                    <t.Icon size={17} className="flex-shrink-0" />
                    {t.label}
                  </button>

                  {/* 서브그룹 — 활성 탭에 그룹이 있을 때만 */}
                  {tabHasGroups && (
                    <div className="ml-3 pl-3 border-l border-zinc-200 dark:border-zinc-700 mt-0.5 mb-1 flex flex-col gap-0.5">
                      <button
                        onClick={() => selectGroup(null)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-all ${
                          !activeGroup
                            ? 'text-accent bg-accent/8'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        style={!activeGroup ? { color: 'var(--c-accent)', backgroundColor: 'rgb(var(--c-accent-rgb)/0.08)' } : {}}
                      >
                        전체
                      </button>
                      {groups.map((g) => {
                        const gActive = activeGroup === g
                        return (
                          <button
                            key={g}
                            onClick={() => selectGroup(gActive ? null : g)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-all ${
                              gActive
                                ? 'text-accent'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                            style={gActive ? { color: 'var(--c-accent)', backgroundColor: 'rgb(var(--c-accent-rgb)/0.08)' } : {}}
                          >
                            {g}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
        )}

        <div className="flex-1 min-w-0 space-y-4">

          {/* ── 모바일 상단 탭 ── */}
          {!searching && (
            <div className="md:hidden flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {tabs.map((t) => {
                const active = t.id === activeTab
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                      active
                        ? 'bg-accent/10 text-accent'
                        : 'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800'
                    }`}
                    style={active ? { color: 'var(--c-accent)' } : {}}
                  >
                    <t.Icon size={15} />
                    {t.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── 모바일 서브그룹 pill ── */}
          {!searching && hasGroups && (
            <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                onClick={() => selectGroup(null)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  !activeGroup
                    ? 'text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
                style={!activeGroup ? { backgroundColor: 'var(--c-accent)' } : {}}
              >
                전체
              </button>
              {groups.map((g) => {
                const gActive = activeGroup === g
                return (
                  <button
                    key={g}
                    onClick={() => selectGroup(gActive ? null : g)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                      gActive
                        ? 'text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                    style={gActive ? { backgroundColor: 'var(--c-accent)' } : {}}
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── 콘텐츠 ── */}
          {searching ? (
            <>
              <p className="text-xs text-zinc-400">
                검색 결과 {visible.length}건{visible.length === 0 ? ' — 일치하는 설정이 없습니다.' : ''}
              </p>
              <div className="space-y-3">
                {visible.map((s) => <div key={s.id}>{s.element}</div>)}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {visible.map((s) => <div key={s.id}>{s.element}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsLayout
