import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ChevronUp, ChevronLeft, ChevronRight, LogIn } from 'lucide-react'
import { authApi, blogApi, settingsApi, BlogPost } from '../api/client'
import HubCenter from './HubCenter'
import BreathingIndicator from '../components/BreathingIndicator'
import RaindropCanvas from '../components/RaindropCanvas'

type Position = 'center' | 'right' | 'bottom'
type ContentView = 'card' | 'list'

/* ── 테마 토큰 ── */
function getTokens(isLight: boolean) {
  return isLight
    ? {
        bg:               '#ffffff',
        borderColor:      'rgba(8,10,30,0.10)',
        textPrimary:      'rgba(8,10,30,0.88)',
        textMuted:        'rgba(8,10,30,0.45)',
        inputBg:          'rgba(8,10,30,0.04)',
        inputBorder:      'rgba(8,10,30,0.14)',
        inputFocusBg:     'rgba(8,10,30,0.07)',
        inputFocusBorder: 'rgba(8,10,30,0.40)',
        inputText:        'rgba(8,10,30,0.88)',
        btnBg:            'rgba(8,10,30,0.08)',
        btnBorder:        'rgba(8,10,30,0.30)',
        btnText:          'rgba(8,10,30,0.88)',
        accent:           'rgba(8,10,30,0.55)',
        divider:          'rgba(8,10,30,0.07)',
      }
    : {
        bg:               '#000000',
        borderColor:      'rgba(188,214,255,0.12)',
        textPrimary:      'rgba(220,228,255,0.90)',
        textMuted:        'rgba(220,228,255,0.45)',
        inputBg:          'rgba(255,255,255,0.04)',
        inputBorder:      'rgba(80,90,160,0.20)',
        inputFocusBg:     'rgba(255,255,255,0.07)',
        inputFocusBorder: 'rgba(90,160,255,0.48)',
        inputText:        'rgba(210,218,255,0.88)',
        btnBg:            'rgba(188,214,255,0.12)',
        btnBorder:        'rgba(188,214,255,0.28)',
        btnText:          'rgba(220,228,255,0.92)',
        accent:           'rgba(188,214,255,0.75)',
        divider:          'rgba(188,214,255,0.20)',
      }
}

/* ── InputField ── */
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

/* ── LoginPanel ── */
interface LoginPanelProps { onGoBack: () => void; isLight: boolean }
const LoginPanel: React.FC<LoginPanelProps> = ({ onGoBack, isLight }) => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      localStorage.setItem('token', data.access_token)
      navigate('/portfolio', { replace: true })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string }; status?: number } }
      if (ax.response?.status === 429)      setError(ax.response.data?.detail ?? '계정이 잠겼습니다.')
      else if (ax.response?.status === 401) setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      else                                  setError('로그인 중 오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  const t = getTokens(isLight)
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 py-10 relative"
      style={{ background: t.bg, borderLeft: `1px solid ${t.borderColor}`, transition: 'background 0.55s, border-color 0.55s' }}>
      <BreathingIndicator direction="left" onClick={onGoBack} label="뒤로" variant={isLight ? 'light' : 'dark'} />
      <div className="w-full" style={{ maxWidth: '280px' }}>
        <div className="mb-8">
          <h1 className="font-bold tracking-tight" style={{ fontSize: '18px', color: t.textPrimary, letterSpacing: '-0.025em' }}>
            U<span style={{ color: t.accent }}>.</span>T<span style={{ fontWeight: 300, opacity: 0.75 }}> Lab</span>
          </h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2.5">
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>아이디</label>
              <InputField isLight={isLight} type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required />
            </div>
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>비밀번호</label>
              <InputField isLight={isLight} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          </div>
          {error && <div className="px-2.5 py-1.5 rounded-lg" style={{ fontSize: '11px', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.22)', color: 'rgba(220,38,38,0.88)' }}>{error}</div>}
          <button type="submit" disabled={loading} className="w-full font-medium rounded-lg transition-opacity disabled:opacity-50"
            style={{ padding: '7px 0', fontSize: '12px', marginTop: '4px', background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.btnText }}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
        <div className="text-center mt-4">
          <button onClick={onGoBack} style={{ fontSize: '11px', color: t.textMuted }} className="hover:opacity-80 transition-opacity">← 돌아가기</button>
        </div>
      </div>
    </div>
  )
}

/* ── 아이콘 SVG ── */
function IconList({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.8" rx="0.5" fill={color}/>
      <rect x="1" y="6.1" width="12" height="1.8" rx="0.5" fill={color}/>
      <rect x="1" y="10.2" width="12" height="1.8" rx="0.5" fill={color}/>
    </svg>
  )
}
function IconCard({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5.2" height="5.2" rx="0.9" fill={color}/>
      <rect x="7.8" y="1" width="5.2" height="5.2" rx="0.9" fill={color}/>
      <rect x="1" y="7.8" width="5.2" height="5.2" rx="0.9" fill={color}/>
      <rect x="7.8" y="7.8" width="5.2" height="5.2" rx="0.9" fill={color}/>
    </svg>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}
function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const ANIM_H     = '42%'
const CARDS_PAGE = 8
const LIST_PAGE  = 10
const CONTENT_MAX = '1120px'
const CONTENT_PX  = '1.5rem'

/* ── BlogPanel ── */
interface BlogPanelProps {
  onGoBack: () => void
  scrollRef: React.RefObject<HTMLDivElement>
  isLight: boolean
  onViewChange: (v: 'list' | 'detail') => void
}
const DEFAULT_BLOG_TITLE = 'Notes from the U.T Lab4'

const BlogPanel: React.FC<BlogPanelProps> = ({ onGoBack, scrollRef, isLight, onViewChange }) => {
  const navigate = useNavigate()
  const [posts, setPosts]           = useState<BlogPost[]>([])
  const [loading, setLoading]       = useState(true)
  const [page, setPage]             = useState(0)
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null)
  const [view, setView]             = useState<'list' | 'detail'>('list')
  const [contentView, setContentView] = useState<ContentView>('card')
  const [activeTag, setActiveTag]   = useState('all')
  const [blogTitle, setBlogTitle]   = useState(DEFAULT_BLOG_TITLE)

  const animDivRef     = useRef<HTMLDivElement>(null)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    blogApi.publicList({ limit: 80 })
      .then(({ data }) => setPosts(data))
      .catch(console.error)
      .finally(() => setLoading(false))
    settingsApi.publicGet()
      .then(({ data }) => { if (data.blog_title) setBlogTitle(data.blog_title) })
      .catch(() => {})
  }, [])

  const allTags = React.useMemo(() => {
    const set = new Set<string>()
    posts.forEach(p => p.tags.forEach(t => set.add(t)))
    return Array.from(set).slice(0, 10)
  }, [posts])

  const filtered = React.useMemo(() =>
    activeTag === 'all' ? posts : posts.filter(p => p.tags.includes(activeTag)),
    [posts, activeTag]
  )

  const perPage    = contentView === 'card' ? CARDS_PAGE : LIST_PAGE
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible    = filtered.slice(page * perPage, (page + 1) * perPage)

  const openPost = (post: BlogPost) => {
    setSelectedPost(post)
    setView('detail')
    onViewChange('detail')
    setTimeout(() => detailPanelRef.current?.scrollTo({ top: 0 }), 0)
  }
  const closePost = () => {
    setView('list')
    onViewChange('list')
    setTimeout(() => setSelectedPost(null), 420)
  }
  const changeTag = (tag: string) => { setActiveTag(tag); setPage(0) }
  const prevPage  = () => setPage(p => Math.max(0, p - 1))
  const nextPage  = () => setPage(p => Math.min(totalPages - 1, p + 1))

  const t = getTokens(isLight)
  const sep          = t.divider
  const titleColor   = isLight ? 'rgba(8,10,30,0.92)'   : 'rgba(220,232,255,0.96)'
  const labelColor   = isLight ? 'rgba(8,10,30,0.42)'   : 'rgba(188,214,255,0.48)'
  const toggleOn     = isLight ? 'rgba(8,10,30,0.85)'   : 'rgba(220,230,255,0.90)'
  const toggleOff    = isLight ? 'rgba(8,10,30,0.32)'   : 'rgba(188,214,255,0.35)'
  const toggleActiveBg = isLight ? 'rgba(8,10,30,0.09)' : 'rgba(188,214,255,0.16)'
  const arrowEnabled = isLight ? 'rgba(8,10,30,0.75)'   : 'rgba(188,214,255,0.80)'
  const arrowDisabled= isLight ? 'rgba(8,10,30,0.16)'   : 'rgba(188,214,255,0.16)'

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: t.bg, transition: 'background 0.55s' }}>

      {/* ── 애니메이션 헤더 ── */}
      <div
        ref={animDivRef}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: ANIM_H,
          overflow: 'hidden', zIndex: 3,
          transform: view === 'detail' ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform 0.42s cubic-bezier(0.4,0,0.2,1)',
          borderBottom: `1px solid ${t.divider}`,
        }}
      >
        <RaindropCanvas isLight={isLight} />


        {/* 하단 타이틀 오버레이 — 콘텐츠 좌측라인에 맞춤 */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: isLight
            ? 'linear-gradient(to top, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.44) 54%, transparent 100%)'
            : 'linear-gradient(to top, rgba(3,6,18,0.94) 0%, rgba(3,6,18,0.48) 54%, transparent 100%)',
        }}>
          <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', padding: `0 ${CONTENT_PX} 1.1rem`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: '11px', letterSpacing: '0.20em', textTransform: 'uppercase', color: labelColor, marginBottom: '6px' }}>
                journal · blog
              </div>
              <h1 style={{ margin: 0, fontSize: 'clamp(1.3rem, 3vw, 1.9rem)', fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.1, color: titleColor }}>
                {blogTitle}
              </h1>
            </div>
            {/* 보기 전환 토글 */}
            <div style={{ paddingBottom: '4px' }}>
              <div style={{
                display: 'flex', borderRadius: '8px', overflow: 'hidden',
                border: isLight ? '1px solid rgba(8,10,30,0.13)' : '1px solid rgba(188,214,255,0.17)',
                background: isLight ? 'rgba(255,255,255,0.75)' : 'rgba(6,12,32,0.72)',
              }}>
                {(['card', 'list'] as ContentView[]).map(v => (
                  <button key={v} onClick={() => { setContentView(v); setPage(0) }} style={{
                    width: '32px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: contentView === v ? toggleActiveBg : 'transparent',
                    border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                  }}>
                    {v === 'card'
                      ? <IconCard size={13} color={contentView === v ? toggleOn : toggleOff} />
                      : <IconList size={13} color={contentView === v ? toggleOn : toggleOff} />
                    }
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 목록 패널 ── */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>

        {/* 애니메이션 영역만큼 spacer (height % = 컨테이너 높이 기준 → 올바름) */}
        <div style={{ height: ANIM_H, flexShrink: 0 }} />

        {/* 태그 필터 */}
        <div style={{
          flexShrink: 0,
          overflowX: 'auto', scrollbarWidth: 'none',
          background: isLight ? 'rgba(8,10,30,0.025)' : 'rgba(188,214,255,0.025)',
        }}>
          <div style={{
            maxWidth: CONTENT_MAX, margin: '0 auto', padding: `5px ${CONTENT_PX}`,
            display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap',
          }}>
            {/* Hub / Login 네비게이션 */}
            <button onClick={onGoBack} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px',
              fontSize: '9.5px', letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '1.5px 7px', borderRadius: '100px',
              background: 'transparent',
              border: isLight ? '1px solid rgba(8,10,30,0.16)' : '1px solid rgba(188,214,255,0.20)',
              color: t.textMuted, cursor: 'pointer', transition: 'all 0.14s',
            }}>
              <ChevronUp size={9} />Hub
            </button>
            <button onClick={() => navigate('/login')} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px',
              fontSize: '9.5px', letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '1.5px 7px', borderRadius: '100px',
              background: 'transparent',
              border: isLight ? '1px solid rgba(8,10,30,0.16)' : '1px solid rgba(188,214,255,0.20)',
              color: t.textMuted, cursor: 'pointer', transition: 'all 0.14s',
            }}>
              <LogIn size={9} />Login
            </button>
            {/* 태그와 구분 */}
            <div style={{ width: '1px', height: '11px', background: isLight ? 'rgba(8,10,30,0.13)' : 'rgba(188,214,255,0.20)', flexShrink: 0, margin: '0 3px' }} />
            {(['all', ...allTags]).map(tag => (
              <button key={tag} onClick={() => changeTag(tag)} style={{
                flexShrink: 0, fontSize: '9.5px',
                letterSpacing: tag === 'all' ? '0.08em' : '0.02em',
                textTransform: tag === 'all' ? 'uppercase' : 'none',
                padding: '1.5px 7px', borderRadius: '100px',
                background: activeTag === tag
                  ? (isLight ? 'rgba(8,10,30,0.09)' : 'rgba(188,214,255,0.13)')
                  : 'transparent',
                border: activeTag === tag
                  ? (isLight ? '1px solid rgba(8,10,30,0.19)' : '1px solid rgba(188,214,255,0.25)')
                  : '1px solid transparent',
                color: activeTag === tag ? t.textPrimary : t.textMuted,
                cursor: 'pointer', transition: 'all 0.14s',
              }}>
                {tag === 'all' ? 'All' : tag}
              </button>
            ))}
          </div>
        </div>

        {/* 스크롤 가능한 콘텐츠 */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none' }}>
          {loading && (
            <div style={{ height: '60%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: '13px' }}>
              불러오는 중...
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ height: '60%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: '13px' }}>
              공개된 글이 없습니다
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ maxWidth: CONTENT_MAX, margin: '0 auto', padding: `28px ${CONTENT_PX} 24px`, boxSizing: 'border-box' }}>

              {/* ── 카드 뷰 (1행 최대 4개, 반응형) ── */}
              {contentView === 'card' && (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                    gap: '16px',
                  }}>
                    {visible.map(post => (
                      <div
                        key={post.id}
                        onClick={() => openPost(post)}
                        style={{
                          cursor: 'pointer', borderRadius: '12px', overflow: 'hidden',
                          border: `1px solid ${sep}`,
                          background: isLight ? 'rgba(8,10,30,0.015)' : 'rgba(188,214,255,0.025)',
                          transition: 'transform 0.18s, box-shadow 0.18s',
                          display: 'flex', flexDirection: 'column',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'
                          ;(e.currentTarget as HTMLElement).style.boxShadow = isLight
                            ? '0 6px 20px rgba(0,0,0,0.10)' : '0 6px 20px rgba(0,0,0,0.45)'
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
                          ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                        }}
                      >
                        {/* 커버 이미지 — 3:2 비율 */}
                        <div style={{ paddingTop: '66.67%', position: 'relative', flexShrink: 0, overflow: 'hidden', background: isLight ? 'linear-gradient(135deg,rgba(59,130,246,0.08),rgba(59,130,246,0.02))' : 'linear-gradient(135deg,rgba(188,214,255,0.09),rgba(188,214,255,0.02))' }}>
                          {post.cover_image
                            ? <img src={post.cover_image} alt={post.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '2.2rem', fontWeight: 900, opacity: 0.11, color: t.accent }}>{post.title[0]}</span>
                              </div>
                          }
                        </div>
                        {/* 카드 텍스트 */}
                        <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <h3 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: t.textPrimary, lineHeight: 1.35, letterSpacing: '-0.01em', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {post.title}
                          </h3>
                          <p style={{ margin: 0, fontSize: '0.70rem', color: t.textMuted, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 1 }}>
                            {post.excerpt || stripHtml(post.content || '')}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                            <span style={{ fontSize: '0.62rem', color: t.textMuted }}>{formatDate(post.created_at)}</span>
                            {post.tags.length > 0 && (
                              <span style={{ fontSize: '0.61rem', padding: '1px 6px', borderRadius: '100px', background: isLight ? 'rgba(8,10,30,0.06)' : 'rgba(188,214,255,0.08)', color: t.textMuted, flexShrink: 0 }}>
                                {post.tags[0]}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 카드 내비게이션 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginTop: '14px' }}>
                    <button onClick={prevPage} disabled={page === 0} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', border: `1px solid ${page === 0 ? sep : (isLight ? 'rgba(8,10,30,0.20)' : 'rgba(188,214,255,0.25)')}`, background: 'none', cursor: page === 0 ? 'default' : 'pointer', color: page === 0 ? arrowDisabled : arrowEnabled, transition: 'all 0.15s' }}>
                      <ChevronLeft size={14} />
                    </button>

                    {/* 페이지 닷 */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {Array.from({ length: totalPages }).map((_, i) => (
                        <button key={i} onClick={() => setPage(i)} style={{
                          width: i === page ? '18px' : '6px', height: '6px', borderRadius: '3px',
                          background: i === page ? (isLight ? 'rgba(8,10,30,0.60)' : 'rgba(188,214,255,0.70)') : sep,
                          border: 'none', cursor: 'pointer', padding: 0,
                          transition: 'all 0.2s',
                        }} />
                      ))}
                    </div>

                    <button onClick={nextPage} disabled={page === totalPages - 1} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', border: `1px solid ${page === totalPages - 1 ? sep : (isLight ? 'rgba(8,10,30,0.20)' : 'rgba(188,214,255,0.25)')}`, background: 'none', cursor: page === totalPages - 1 ? 'default' : 'pointer', color: page === totalPages - 1 ? arrowDisabled : arrowEnabled, transition: 'all 0.15s' }}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </>
              )}

              {/* ── 리스트 뷰 (심플) ── */}
              {contentView === 'list' && (
                <>
                  <div>
                    {visible.map((post, i) => (
                      <div
                        key={post.id}
                        onClick={() => openPost(post)}
                        style={{
                          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                          gap: '12px', padding: '9px 0',
                          borderBottom: i < visible.length - 1 ? `1px solid ${sep}` : 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.72'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                      >
                        <span style={{ fontSize: '0.84rem', fontWeight: 500, color: t.textPrimary, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {post.title}
                        </span>
                        <span style={{ fontSize: '0.67rem', color: t.textMuted, flexShrink: 0, fontFamily: 'ui-monospace,monospace' }}>
                          {formatDate(post.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* 리스트 페이지네이션 */}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', paddingTop: '12px' }}>
                      <button onClick={prevPage} disabled={page === 0} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', border: `1px solid ${page === 0 ? sep : (isLight ? 'rgba(8,10,30,0.20)' : 'rgba(188,214,255,0.25)')}`, background: 'none', cursor: page === 0 ? 'default' : 'pointer', color: page === 0 ? arrowDisabled : arrowEnabled }}>
                        <ChevronLeft size={14} />
                      </button>
                      <span style={{ fontSize: '11px', color: t.textMuted }}>{page + 1} / {totalPages}</span>
                      <button onClick={nextPage} disabled={page === totalPages - 1} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', border: `1px solid ${page === totalPages - 1 ? sep : (isLight ? 'rgba(8,10,30,0.20)' : 'rgba(188,214,255,0.25)')}`, background: 'none', cursor: page === totalPages - 1 ? 'default' : 'pointer', color: page === totalPages - 1 ? arrowDisabled : arrowEnabled }}>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 상세 오버레이 (전체화면, 우측에서 슬라이드) ── */}
      <div
        ref={detailPanelRef}
        style={{
          position: 'absolute', inset: 0, zIndex: 4,
          background: t.bg,
          transform: view === 'detail' ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.42s cubic-bezier(0.4,0,0.2,1)',
          overflowY: 'auto', scrollbarWidth: 'none',
        }}
      >
        {selectedPost && (
          <>
            {/* 상세 상단 Nav */}
            <div style={{
              position: 'sticky', top: 0, zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 1.25rem', height: '48px',
              background: t.bg,
              borderBottom: `1px solid ${sep}`,
            }}>
              <button onClick={closePost} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
                <ChevronLeft size={14} />
                <span>목록으로</span>
              </button>
              <div style={{ display: 'flex', gap: '6px' }}>
                {selectedPost.tags.map(tag => (
                  <span key={tag} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '100px', background: isLight ? 'rgba(8,10,30,0.06)' : 'rgba(188,214,255,0.08)', color: t.textMuted }}>{tag}</span>
                ))}
              </div>
            </div>

            {/* 상세 본문 */}
            <div style={{ maxWidth: '720px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
              {selectedPost.cover_image && (
                <div style={{ borderRadius: '12px', overflow: 'hidden', height: '220px', marginBottom: '1.6rem' }}>
                  <img src={selectedPost.cover_image} alt={selectedPost.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div style={{ fontSize: '11px', color: t.textMuted, marginBottom: '0.6rem', fontFamily: 'ui-monospace,monospace' }}>
                {new Date(selectedPost.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
              <h1 style={{ fontSize: 'clamp(1.35rem,3vw,1.9rem)', fontWeight: 700, color: t.textPrimary, lineHeight: 1.28, letterSpacing: '-0.022em', marginBottom: '1.8rem' }}>
                {selectedPost.title}
              </h1>
              <div className="hub-prose" dangerouslySetInnerHTML={{ __html: selectedPost.content || '' }} style={{ color: t.textPrimary }} />
            </div>
          </>
        )}
      </div>

      <style>{`
        .hub-prose { line-height: 1.78; font-size: 0.93rem; }
        .hub-prose h1 { font-size:1.5em; font-weight:700; margin:1.15em 0 0.45em; letter-spacing:-0.02em; }
        .hub-prose h2 { font-size:1.22em; font-weight:700; margin:1.05em 0 0.38em; }
        .hub-prose h3 { font-size:1.06em; font-weight:600; margin:0.95em 0 0.32em; }
        .hub-prose p  { margin:0.58em 0; }
        .hub-prose img { max-width:100%; border-radius:8px; margin:0.7em 0; display:block; }
        .hub-prose a  { text-decoration:underline; opacity:0.8; }
        .hub-prose ul,.hub-prose ol { padding-left:1.5em; margin:0.45em 0; }
        .hub-prose li { margin:0.2em 0; }
        .hub-prose blockquote { border-left:3px solid currentColor; padding-left:1em; margin:0.7em 0; opacity:0.60; }
        .hub-prose code { font-family:ui-monospace,monospace; font-size:0.875em; padding:0.14em 0.38em; border-radius:4px; background:rgba(128,128,128,0.13); }
        .hub-prose pre { padding:0.9em 1em; border-radius:8px; overflow-x:auto; margin:0.7em 0; background:rgba(128,128,128,0.10); }
        .hub-prose pre code { background:none; padding:0; }
        .hub-prose table { width:100%; border-collapse:collapse; margin:0.7em 0; font-size:0.88em; }
        .hub-prose td,.hub-prose th { border:1px solid rgba(128,128,128,0.20); padding:0.42em 0.65em; }
        .hub-prose hr { border:none; border-top:1px solid rgba(128,128,128,0.16); margin:1.4em 0; }
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
  const touchStartX     = useRef(0)
  const touchStartY     = useRef(0)
  const blogScrollRef   = useRef<HTMLDivElement>(null)
  const blogViewRef     = useRef<'list' | 'detail'>('list')

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if      (e.key === 'ArrowRight' && position === 'center') goTo('right')
      else if (e.key === 'ArrowDown'  && position === 'center') goTo('bottom')
      else if ((e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') && position !== 'center') goTo('center')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [position, goTo])

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (isTransitioning.current) return
      if (position === 'center' && e.deltaY > 60) {
        goTo('bottom')
      } else if (position === 'bottom' && e.deltaY < -60) {
        if (blogViewRef.current === 'detail') return
        if ((blogScrollRef.current?.scrollTop ?? 0) < 5) goTo('center')
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
    const ax = Math.abs(dx), ay = Math.abs(dy)
    if (ax > 60 && ay < ax * 0.5) {
      if (dx < 0 && position === 'center') goTo('right')
      else if (dx > 0 && position === 'right') goTo('center')
    } else if (ay > 60 && ax < ay * 0.5) {
      if (dy < 0 && position === 'center') goTo('bottom')
      else if (dy > 0 && position === 'bottom') {
        if (blogViewRef.current === 'detail') return
        if ((blogScrollRef.current?.scrollTop ?? 0) < 5) goTo('center')
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
        style={{ position: 'absolute', width: '200vw', height: '200vh', transform: getTransform(), transition: 'transform 0.38s cubic-bezier(0.4,0,0.2,1)', willChange: 'transform' }}
      >
        {/* 중앙: 허브 */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100vw', height: '100vh' }}>
          <HubCenter onGoRight={() => goTo('right')} onGoBottom={() => goTo('bottom')} isLight={isLight} setIsLight={setIsLight} />
        </div>

        {/* 우측: 로그인 */}
        <div style={{ position: 'absolute', left: '100vw', top: 0, width: '100vw', height: '100vh' }}>
          <LoginPanel onGoBack={() => goTo('center')} isLight={isLight} />
        </div>

        {/* 하단: 블로그 */}
        <div style={{ position: 'absolute', left: 0, top: '100vh', width: '100vw', height: '100vh' }}>
          <BlogPanel
            onGoBack={() => goTo('center')}
            scrollRef={blogScrollRef}
            isLight={isLight}
            onViewChange={v => { blogViewRef.current = v }}
          />
        </div>
      </div>
    </div>
  )
}
