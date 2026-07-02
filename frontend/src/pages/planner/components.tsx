// Retirement-planner leaf UI components (roadmap Phase 3, P3-3). Extracted
// verbatim from pages/Planner.tsx: the tag pill, accordion section wrapper, and
// the polling AI-status badge. Self-contained (props / own state only).
import { useState, useEffect } from 'react'
import { recommendApi } from '../../api/client'

export function OptionTag({ label, color = 'zinc' }: { label: string; color?: string }) {
  return <span className={`tag tag-${color}`}>{label}</span>
}

// ─── 테마 헬퍼 ───────────────────────────────────────────────────────────────


// 아코디언 섹션 wrapper
interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  badge?: React.ReactNode
  tags?: React.ReactNode
  dragHandle?: React.ReactNode
}

export function Accordion({ title, defaultOpen = false, children, badge, tags, dragHandle }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
          open
            ? 'bg-accent/5 dark:bg-accent/10 border-b border-[var(--divide)]'
            : 'surface-subtle hover:bg-zinc-100 dark:hover:bg-zinc-700'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {dragHandle}
          <span className={`text-sm flex-shrink-0 ${open ? 'text-ink-0 font-medium' : 'text-ink-1'}`}>{title}</span>
          {badge}
        </div>
        <svg
          className={`w-4 h-4 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-0 text-accent' : '-rotate-90 text-ink-4'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {tags && open && (
        <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5 border-b border-[var(--divide)]">
          {tags}
        </div>
      )}
      {open && (
        <div className="px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── AI 상태 배지 ─────────────────────────────────────────────────────────────

export function AiStatusBadge() {
  const [status, setStatus]     = useState<'loading' | 'available' | 'limited' | 'error'>('loading')
  const [rpd, setRpd]           = useState('')
  const [countdown, setCountdown] = useState(0)  // 쿨다운 남은 초

  const fetchStatus = () => {
    recommendApi.aiStatus()
      .then(res => {
        const s = res.data
        if (s.rate_limited) {
          setStatus('limited')
          setCountdown(s.rate_limit_seconds_remaining)
          setRpd('')
        } else if (s.rpd_used >= s.rpd_limit) {
          setStatus('limited')
          setCountdown(0)
          setRpd(`일일 한도 소진 (${s.rpd_used}/${s.rpd_limit})`)
        } else {
          setStatus('available')
          setCountdown(0)
          setRpd(`오늘 ${s.rpd_used}/${s.rpd_limit} 사용`)
        }
      })
      .catch(() => { setStatus('error'); setRpd('') })
  }

  // 최초 + 30초마다 상태 갱신
  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 30_000)
    return () => clearInterval(id)
  }, [])

  // 쿨다운 1초 카운트다운
  useEffect(() => {
    if (countdown <= 0) return
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchStatus(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [countdown > 0])

  if (status === 'loading') return null

  const cfg = {
    available: { dot: 'bg-accent', text: 'text-accent', label: 'AI 사용 가능' },
    limited:   { dot: 'bg-[color:var(--tag-amber-fg)]', text: 'text-[color:var(--tag-amber-fg)]', label: 'AI 한도 제한' },
    error:     { dot: 'bg-zinc-400',  text: 'text-ink-3',                       label: 'AI 상태 불명' },
  }[status]

  const detail = countdown > 0
    ? `${Math.ceil(countdown / 60)}분 ${countdown % 60}초 후 재개`
    : rpd

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg surface-subtle border border-ink-5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${status === 'available' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
      <span className="text-xs text-ink-4 ml-auto tabular-nums">{detail}</span>
    </div>
  )
}
