import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ChevronUp, ChevronLeft, LogIn, Globe } from 'lucide-react'
import { authApi, blogApi, BlogPost } from '../api/client'
import HubCenter from './HubCenter'
import BreathingIndicator from '../components/BreathingIndicator'
import RaindropCanvas from '../components/RaindropCanvas'

type Position = 'center' | 'right' | 'bottom'

/* ── 다크/라이트 테마 토큰 ─────────────────────────────────────────── */
function getTokens(isLight: boolean) {
  return isLight
    ? {
        bg:          '#ffffff',
        borderColor: 'rgba(8,10,30,0.10)',
        textPrimary: 'rgba(8,10,30,0.88)',
        textMuted:   'rgba(8,10,30,0.45)',
        inputBg:     'rgba(8,10,30,0.04)',
        inputBorder: 'rgba(8,10,30,0.14)',
        inputFocusBg:'rgba(8,10,30,0.07)',
        inputFocusBorder:'rgba(8,10,30,0.40)',
        inputText:   'rgba(8,10,30,0.88)',
        btnBg:       'rgba(8,10,30,0.08)',
        btnBorder:   'rgba(8,10,30,0.30)',
        btnText:     'rgba(8,10,30,0.88)',
        accent:      'rgba(8,10,30,0.55)',
      }
    : {
        bg:          '#000000',
        borderColor: 'rgba(188,214,255,0.12)',
        textPrimary: 'rgba(220,228,255,0.90)',
        textMuted:   'rgba(220,228,255,0.45)',
        inputBg:     'rgba(255,255,255,0.04)',
        inputBorder: 'rgba(80,90,160,0.20)',
        inputFocusBg:'rgba(255,255,255,0.07)',
        inputFocusBorder:'rgba(90,160,255,0.48)',
        inputText:   'rgba(210,218,255,0.88)',
        btnBg:       'rgba(188,214,255,0.12)',
        btnBorder:   'rgba(188,214,255,0.28)',
        btnText:     'rgba(220,228,255,0.92)',
        accent:      'rgba(188,214,255,0.75)',
      }
}

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isLight?: boolean
}
const InputField: React.FC<InputFieldProps> = ({ isLight = false, ...props }) => {
  const [focused, setFocused] = React.useState(false)
  const t = getTokens(isLight)
  const base:  React.CSSProperties = { background: t.inputBg,      border: `1px solid ${t.inputBorder}`,      color: t.inputText }
  const focus: React.CSSProperties = { background: t.inputFocusBg, border: `1px solid ${t.inputFocusBorder}`, color: t.inputText }
  return (
    <input
      {...props}
      className="w-full rounded-lg outline-none transition-all"
      style={{ ...(focused ? focus : base), padding: '6px 10px', fontSize: '12px' }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
      onBlur={(e)  => { setFocused(false); props.onBlur?.(e) }}
    />
  )
}

interface LoginPanelProps { onGoBack: () => void; isLight: boolean }
const LoginPanel: React.FC<LoginPanelProps> = ({ onGoBack, isLight }) => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      localStorage.setItem('token', data.access_token)
      navigate('/portfolio', { replace: true })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string }; status?: number } }
      if (ax.response?.status === 429)
        setError(ax.response.data?.detail ?? '계정이 잠겼습니다. 잠시 후 다시 시도하세요.')
      else if (ax.response?.status === 401)
        setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      else
        setError('로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const t = getTokens(isLight)

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center px-8 py-10 relative"
      style={{ background: t.bg, borderLeft: `1px solid ${t.borderColor}`, transition: 'background 0.55s, border-color 0.55s' }}
    >
      <BreathingIndicator direction="left" onClick={onGoBack} label="뒤로" variant={isLight ? 'light' : 'dark'} />

      <div className="w-full" style={{ maxWidth: '280px' }}>
        <div className="mb-8">
          <h1 className="font-bold tracking-tight" style={{ fontSize: '18px', color: t.textPrimary, letterSpacing: '-0.025em' }}>
            U<span style={{ color: t.accent }}>.</span>T
            <span style={{ fontWeight: 300, opacity: 0.75 }}> Lab</span>
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2.5">
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>아이디</label>
              <InputField isLight={isLight} type="text" autoComplete="username" value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="admin" required />
            </div>
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>비밀번호</label>
              <InputField isLight={isLight} type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          </div>

          {error && (
            <div className="px-2.5 py-1.5 rounded-lg" style={{
              fontSize: '11px',
              background: 'rgba(220,38,38,0.12)',
              border: '1px solid rgba(220,38,38,0.22)',
              color: 'rgba(220,38,38,0.88)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full font-medium rounded-lg transition-opacity disabled:opacity-50"
            style={{ padding: '7px 0', fontSize: '12px', marginTop: '4px', background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.btnText }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="text-center mt-4">
          <button onClick={onGoBack} style={{ fontSize: '11px', color: t.textMuted }} className="hover:opacity-80 transition-opacity">
            ← 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 블로그 패널: 상단 1/3 빗방울 파티클 구분선 + 하단 2/3 목록/상세 ── */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface BlogPanelProps {
  onGoBack: () => void
  scrollRef: React.RefObject<HTMLDivElement>
  isLight: boolean
  onViewChange: (v: 'list' | 'detail') => void
}
const BlogPanel: React.FC<BlogPanelProps> = ({ onGoBack, scrollRef, isLight, onViewChange }) => {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null)
  const [view, setView] = useState<'list' | 'detail'>('list')

  const ROWS = 4

  useEffect(() => {
    blogApi.publicList({ limit: 40 })
      .then(({ data }) => setPosts(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const totalPages = Math.max(1, Math.ceil(posts.length / ROWS))
  const visiblePosts = posts.slice(page * ROWS, (page + 1) * ROWS)

  const openPost = (post: BlogPost) => {
    setSelectedPost(post)
    setView('detail')
    onViewChange('detail')
  }

  const closePost = () => {
    setView('list')
    onViewChange('list')
    setTimeout(() => setSelectedPost(null), 420)
  }

  const t = getTokens(isLight)

  // 구분선 색상 (내부 전용, 더 옅게)
  const sepColor = isLight ? 'rgba(8,10,30,0.055)' : 'rgba(188,214,255,0.06)'

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: t.bg, transition: 'background 0.55s' }}>

      {/* 상단 1/3: 빗방울 파티클 + 네비게이션 오버레이 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '33.333%', overflow: 'hidden', background: t.bg }}>
        <RaindropCanvas isLight={isLight} />

        {/* Nav 오버레이 — 파티클 위에 부유 */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '42px', zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1.25rem',
          background: isLight
            ? 'linear-gradient(to bottom, rgba(255,255,255,0.72) 0%, transparent 100%)'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)',
        }}>
          <button
            onClick={view === 'detail' ? closePost : onGoBack}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', minWidth: '56px' }}
          >
            {view === 'detail'
              ? <><ChevronLeft size={13} /><span>목록</span></>
              : <><ChevronUp size={13} /><span>허브로</span></>
            }
          </button>
          <span style={{ fontWeight: 700, fontSize: '12px', color: t.textPrimary, letterSpacing: '-0.02em', opacity: 0.70 }}>
            U.T Lab4&nbsp;<span style={{ fontWeight: 300 }}>·</span>&nbsp;글
          </span>
          <button
            onClick={() => navigate('/login')}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', minWidth: '56px', justifyContent: 'flex-end' }}
          >
            <LogIn size={12} /><span>로그인</span>
          </button>
        </div>
      </div>

      {/* 하단 2/3: 슬라이딩 뷰 (헤더 없음 — 콘텐츠 전용) */}
      <div style={{
        position: 'absolute', top: '33.333%', left: 0, right: 0, bottom: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', width: '200%', height: '100%',
          transform: view === 'detail' ? 'translateX(-50%)' : 'translateX(0)',
          transition: 'transform 0.38s cubic-bezier(0.4,0,0.2,1)',
        }}>

          {/* ── 목록 패널 ── */}
          <div
            ref={scrollRef}
            style={{ width: '50%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* 로딩 */}
            {loading && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: '14px' }}>
                불러오는 중...
              </div>
            )}

            {/* 빈 상태 */}
            {!loading && posts.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: t.textMuted }}>
                <Globe size={34} style={{ opacity: 0.22, marginBottom: '12px' }} />
                <p style={{ fontSize: '13px' }}>공개된 글이 없습니다</p>
              </div>
            )}

            {/* 글 목록: 항상 4행 고정 그리드 */}
            {!loading && posts.length > 0 && (
              /* 중앙 정렬 컬럼 — 목록·구분선·썸네일이 maxWidth 이내에서만 표현 */
              <div style={{ width: '100%', maxWidth: '780px', margin: '0 auto', padding: '0 28px', boxSizing: 'border-box', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {/* 4행 고정 그리드 */}
                <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'repeat(4, 1fr)' }}>
                  {Array.from({ length: 4 }, (_, i) => {
                    const post = visiblePosts[i]
                    if (!post) {
                      return (
                        <div key={`slot-${i}`} style={{ position: 'relative' }}>
                          {i < 3 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px', background: sepColor }} />}
                        </div>
                      )
                    }
                    return (
                      <div
                        key={post.id}
                        onClick={() => openPost(post)}
                        style={{
                          display: 'flex', cursor: 'pointer', overflow: 'hidden',
                          position: 'relative', transition: 'background 0.14s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isLight ? 'rgba(8,10,30,0.025)' : 'rgba(188,214,255,0.04)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        {/* 썸네일 50% */}
                        <div style={{ width: '50%', flexShrink: 0, overflow: 'hidden', borderRadius: '6px', margin: '6px 12px 6px 0' }}>
                          {post.cover_image ? (
                            <img src={post.cover_image} alt={post.title}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.35s ease' }}
                              className="brow-thumb"
                            />
                          ) : (
                            <div style={{
                              width: '100%', height: '100%',
                              background: isLight
                                ? 'linear-gradient(135deg,rgba(59,130,246,0.08),rgba(59,130,246,0.02))'
                                : 'linear-gradient(135deg,rgba(188,214,255,0.10),rgba(188,214,255,0.03))',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <span style={{ fontSize: 'clamp(1.5rem,3vw,2.2rem)', fontWeight: 900, opacity: 0.16, color: t.accent }}>
                                {post.title[0]}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* 정보 50% */}
                        <div style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden', minWidth: 0, gap: '3px' }}>
                          <h3 style={{
                            fontSize: 'clamp(0.79rem,1.1vw,0.89rem)', fontWeight: 600,
                            color: t.textPrimary, lineHeight: 1.35, letterSpacing: '-0.01em',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {post.title}
                          </h3>
                          {post.excerpt && (
                            <p style={{
                              fontSize: 'clamp(0.70rem,0.92vw,0.76rem)', color: t.textMuted, lineHeight: 1.4,
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                              {post.excerpt}
                            </p>
                          )}
                          <span style={{ fontSize: '0.67rem', color: t.textMuted }}>{formatDate(post.created_at)}</span>
                          {post.tags.length > 0 && (
                            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                              {post.tags.slice(0, 2).map(tag => (
                                <span key={tag} style={{ fontSize: '0.63rem', padding: '1px 5px', borderRadius: '100px', background: isLight ? 'rgba(8,10,30,0.06)' : 'rgba(188,214,255,0.08)', color: t.textMuted }}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* 행 구분선 — 컬럼 내부에만 */}
                        {i < 3 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px', background: sepColor }} />}
                      </div>
                    )
                  })}
                </div>

                {/* 페이지 바 — 항상 고정 */}
                <div style={{
                  flexShrink: 0, height: '38px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
                  borderTop: `1px solid ${sepColor}`,
                }}>
                  {totalPages > 1 ? (
                    <>
                      <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                        style={{ fontSize: '14px', color: page === 0 ? sepColor : t.textMuted, background: 'none', border: 'none', cursor: page === 0 ? 'default' : 'pointer', lineHeight: 1 }}>←</button>
                      <span style={{ fontSize: '11px', color: t.textMuted }}>{page + 1} / {totalPages}</span>
                      <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                        style={{ fontSize: '14px', color: page === totalPages - 1 ? sepColor : t.textMuted, background: 'none', border: 'none', cursor: page === totalPages - 1 ? 'default' : 'pointer', lineHeight: 1 }}>→</button>
                    </>
                  ) : (
                    <div style={{ width: '18px', height: '2px', borderRadius: '1px', background: sepColor }} />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── 상세 패널 ── */}
          <div style={{ width: '50%', height: '100%', overflowY: 'auto' }}>
            {selectedPost && (
              <div style={{ padding: '1.5rem 1.75rem 3rem', maxWidth: '780px', margin: '0 auto' }}>
                {selectedPost.cover_image && (
                  <div style={{ borderRadius: '10px', overflow: 'hidden', height: '190px', marginBottom: '1.4rem' }}>
                    <img src={selectedPost.cover_image} alt={selectedPost.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                )}
                <h1 style={{ fontSize: 'clamp(1.2rem,3vw,1.7rem)', fontWeight: 700, color: t.textPrimary, lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: '0.55rem' }}>
                  {selectedPost.title}
                </h1>
                <div style={{ fontSize: '11px', color: t.textMuted, marginBottom: '1.4rem', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  <span>{new Date(selectedPost.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  {selectedPost.tags.map(tag => (
                    <span key={tag} style={{ padding: '2px 7px', borderRadius: '100px', background: isLight ? 'rgba(8,10,30,0.06)' : 'rgba(188,214,255,0.08)', fontSize: '10px' }}>{tag}</span>
                  ))}
                </div>
                <div className="hub-prose" dangerouslySetInnerHTML={{ __html: selectedPost.content || '' }} style={{ color: t.textPrimary }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .brow-thumb { transition: transform 0.35s ease; }
        div:hover > .brow-thumb { transform: scale(1.04); }
        .hub-prose { line-height: 1.78; font-size: 0.93rem; }
        .hub-prose h1 { font-size: 1.5em; font-weight: 700; margin: 1.15em 0 0.45em; letter-spacing: -0.02em; }
        .hub-prose h2 { font-size: 1.22em; font-weight: 700; margin: 1.05em 0 0.38em; }
        .hub-prose h3 { font-size: 1.06em; font-weight: 600; margin: 0.95em 0 0.32em; }
        .hub-prose p { margin: 0.58em 0; }
        .hub-prose img { max-width: 100%; border-radius: 8px; margin: 0.7em 0; display: block; }
        .hub-prose a { text-decoration: underline; opacity: 0.8; }
        .hub-prose ul, .hub-prose ol { padding-left: 1.5em; margin: 0.45em 0; }
        .hub-prose li { margin: 0.2em 0; }
        .hub-prose blockquote { border-left: 3px solid currentColor; padding-left: 1em; margin: 0.7em 0; opacity: 0.60; }
        .hub-prose code { font-family: ui-monospace,monospace; font-size: 0.875em; padding: 0.14em 0.38em; border-radius: 4px; background: rgba(128,128,128,0.13); }
        .hub-prose pre { padding: 0.9em 1em; border-radius: 8px; overflow-x: auto; margin: 0.7em 0; background: rgba(128,128,128,0.10); }
        .hub-prose pre code { background: none; padding: 0; }
        .hub-prose table { width: 100%; border-collapse: collapse; margin: 0.7em 0; font-size: 0.88em; }
        .hub-prose td, .hub-prose th { border: 1px solid rgba(128,128,128,0.20); padding: 0.42em 0.65em; }
        .hub-prose hr { border: none; border-top: 1px solid rgba(128,128,128,0.16); margin: 1.4em 0; }
      `}</style>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   SpatialHub — 공간 네비게이션 컨테이너
   ══════════════════════════════════════════════════════════ */
export default function SpatialHub() {
  const token = localStorage.getItem('token')
  if (token) return <Navigate to="/portfolio" replace />

  return <SpatialHubInner />
}

function SpatialHubInner() {
  const [position, setPosition] = useState<Position>(() => {
    if (sessionStorage.getItem('hubReturnBlog') === '1') {
      sessionStorage.removeItem('hubReturnBlog')
      return 'bottom'
    }
    return 'center'
  })
  const [isLight, setIsLightState] = useState(() => localStorage.getItem('hubMode') === 'light')
  const isTransitioning = useRef(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const blogScrollRef = useRef<HTMLDivElement>(null)
  const blogViewRef = useRef<'list' | 'detail'>('list')

  const setIsLight = (v: boolean) => {
    setIsLightState(v)
    localStorage.setItem('hubMode', v ? 'light' : 'dark')
  }

  const goTo = useCallback((pos: Position) => {
    if (isTransitioning.current) return
    isTransitioning.current = true
    setPosition(pos)
    setTimeout(() => { isTransitioning.current = false }, 420)
  }, [])

  // 키보드 이벤트
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && position === 'center') goTo('right')
      else if (e.key === 'ArrowDown' && position === 'center') goTo('bottom')
      else if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (position !== 'center') goTo('center')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [position, goTo])

  // 마우스 휠 이벤트 (상하 양방향)
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (isTransitioning.current) return
      if (position === 'center' && e.deltaY > 60) {
        goTo('bottom')
      } else if (position === 'bottom' && e.deltaY < -60) {
        if (blogViewRef.current === 'detail') return
        const scrollTop = blogScrollRef.current?.scrollTop ?? 0
        if (scrollTop < 5) goTo('center')
      }
    }
    window.addEventListener('wheel', handler, { passive: true })
    return () => window.removeEventListener('wheel', handler)
  }, [position, goTo])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isTransitioning.current) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    const absDx = Math.abs(dx), absDy = Math.abs(dy)

    if (absDx > 60 && absDy < absDx * 0.5) {
      // 수평 스와이프
      if (dx < 0 && position === 'center') goTo('right')
      else if (dx > 0 && position === 'right') goTo('center')
    } else if (absDy > 60 && absDx < absDy * 0.5) {
      // 수직 스와이프
      if (dy < 0 && position === 'center') goTo('bottom')
      else if (dy > 0 && position === 'bottom') {
        if (blogViewRef.current === 'detail') return
        const scrollTop = blogScrollRef.current?.scrollTop ?? 0
        if (scrollTop < 5) goTo('center')
      }
    }
  }, [position, goTo])

  const getTransform = () => {
    if (position === 'right')  return 'translateX(-100vw)'
    if (position === 'bottom') return 'translateY(-100vh)'
    return 'translate(0,0)'
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 0, background: isLight ? '#ffffff' : '#000000', transition: 'background 0.55s' }}>
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'absolute',
          width: '200vw',
          height: '200vh',
          transform: getTransform(),
          transition: 'transform 0.38s cubic-bezier(0.4,0,0.2,1)',
          willChange: 'transform',
        }}
      >
        {/* ── 중앙: 허브 (0,0) ── */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100vw', height: '100vh' }}>
          <HubCenter
            onGoRight={() => goTo('right')}
            onGoBottom={() => goTo('bottom')}
            isLight={isLight}
            setIsLight={setIsLight}
          />
        </div>

        {/* ── 우측: 로그인 (100vw,0) ── */}
        <div style={{ position: 'absolute', left: '100vw', top: 0, width: '100vw', height: '100vh' }}>
          <LoginPanel onGoBack={() => goTo('center')} isLight={isLight} />
        </div>

        {/* ── 하단: Brunch 블로그 (0,100vh) ── */}
        <div style={{ position: 'absolute', left: 0, top: '100vh', width: '100vw', height: '100vh' }}>
          <BlogPanel onGoBack={() => goTo('center')} scrollRef={blogScrollRef} isLight={isLight} onViewChange={v => { blogViewRef.current = v }} />
        </div>
      </div>
    </div>
  )
}
