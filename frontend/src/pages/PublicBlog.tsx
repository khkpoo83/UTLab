import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogoMark, Wordmark } from '../components/ut/UTLogo'
import { blogApi, BlogPost } from '../api/client'

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function readMin(post: BlogPost) {
  const wc = post.word_count || Math.round((post.content?.length ?? 0) / 4)
  return Math.max(1, Math.round(wc / 200))
}

const GRADIENT_POOL: { bg: string; dark: boolean }[] = [
  { bg: 'linear-gradient(135deg,#1a1a1c 0%,#3a3a3e 100%)', dark: true },
  { bg: 'linear-gradient(135deg,#faf7ef 0%,#e8e3d3 100%)', dark: false },
  { bg: 'linear-gradient(135deg,#2a3940 0%,#1a2226 100%)', dark: true },
  { bg: 'linear-gradient(135deg,#f5f1e8 0%,#d9d4c2 100%)', dark: false },
  { bg: 'linear-gradient(135deg,#1c1c1f 0%,#2a2a2d 100%)', dark: true },
  { bg: 'linear-gradient(135deg,#f0ede4 0%,#c8c2b0 100%)', dark: false },
]

function CoverPlaceholder({ idx, title, large }: { idx: number; title: string; large?: boolean }) {
  const g = GRADIENT_POOL[idx % GRADIENT_POOL.length]
  const isDark = g.dark
  return (
    <div style={{
      width: '100%', height: '100%',
      background: g.bg,
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex', alignItems: 'flex-end',
      padding: large ? 32 : 20,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(circle,${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'} 1px,transparent 1px)`,
        backgroundSize: '14px 14px', opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute', top: large ? 28 : 16, right: large ? 32 : 18,
        fontSize: large ? 14 : 11, fontWeight: 700, letterSpacing: '0.14em',
        color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)',
      }}>U.T</div>
      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: large ? 11 : 10, fontWeight: 600, letterSpacing: '0.12em',
          color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
          marginBottom: 6,
        }}>FEATURE</div>
        <div style={{
          fontSize: large ? 28 : 15, fontWeight: 700, letterSpacing: '-0.025em',
          color: isDark ? '#fff' : '#0a0a0b', lineHeight: 1.2,
          maxWidth: large ? 360 : 200,
          display: '-webkit-box', WebkitLineClamp: large ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{title}</div>
      </div>
    </div>
  )
}

function PostReader({ post, loading, onClose }: { post: BlogPost; loading: boolean; onClose: () => void }) {
  return (
    <div style={{ padding: 'clamp(32px,4vw,56px)', maxWidth: 720, margin: '0 auto' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <button
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--ink-3)', padding: '4px 0',
          }}
        >
          ← 목록으로
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[200, 160, 240, 120].map((w, i) => (
            <div key={i} style={{ height: 16, width: w, background: 'var(--mist)', borderRadius: 4 }} />
          ))}
        </div>
      ) : (
        <>
          {/* 태그 */}
          {post.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {post.tags.map(t => (
                <span key={t} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 999,
                  background: 'rgb(var(--c-accent-rgb) / 0.1)',
                  color: 'var(--c-accent)',
                }}>{t}</span>
              ))}
            </div>
          )}

          {/* 제목 */}
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 700, fontStyle: 'italic',
            letterSpacing: '-0.02em', lineHeight: 1.2,
            color: 'var(--ink-0)', margin: '0 0 12px',
          }}>{post.title}</h1>

          {/* 날짜 */}
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 40 }}>
            {new Date(post.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
            {post.word_count ? ` · ${Math.max(1, Math.round(post.word_count / 200))}분` : null}
          </div>

          {/* 본문 */}
          <div
            style={{
              fontSize: 16, lineHeight: 1.8, color: 'var(--ink-1)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {post.content || post.excerpt || '본문이 없습니다.'}
          </div>
        </>
      )}
    </div>
  )
}

export default function PublicBlog() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTag, setActiveTag] = useState('전체')
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null)
  const [loadingPost, setLoadingPost] = useState(false)
  const isLoggedIn = !!localStorage.getItem('token')

  useEffect(() => {
    blogApi.publicList({ limit: 50 })
      .then(({ data }) => setPosts(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const openPost = async (post: BlogPost) => {
    setLoadingPost(true)
    setSelectedPost(post)
    try {
      const { data } = await blogApi.publicGet(post.id)
      setSelectedPost(data)
    } catch {
      /* keep preview */
    } finally {
      setLoadingPost(false)
    }
  }

  const closePost = () => setSelectedPost(null)

  const allTags = ['전체', ...Array.from(new Set(posts.flatMap(p => p.tags))).slice(0, 6)]
  const filtered = activeTag === '전체' ? posts : posts.filter(p => p.tags.includes(activeTag))

  const featured = filtered[0]
  const sidebar  = filtered.slice(1, 4)
  const grid     = filtered.slice(4)

  const now = new Date()
  const monthLabel = now.toLocaleString('en-US', { month: 'long' }).toUpperCase() + ' ' + now.getFullYear()

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#FAFAF7', fontFamily: 'var(--font-sans)' }}>

      {/* ── 좌측: 글 목록 ───────────────────────────────── */}
      <div style={{
        flex: selectedPost ? '0 0 380px' : '1',
        transition: 'flex 0.35s ease',
        overflow: 'hidden',
        borderRight: selectedPost ? '1px solid var(--line)' : 'none',
        minWidth: 0,
      }}>

        {/* ── Header ───────────────────────────────────────── */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 10,
          padding: '0 clamp(20px, 4vw, 48px)',
          height: 56,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(250,250,247,0.92)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--line)',
          gap: 16,
        }}>
          <button
            onClick={() => navigate('/')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            <LogoMark size={28} />
            <Wordmark size={15} />
            <span style={{ fontSize: 13, color: 'var(--ink-4)', marginLeft: 4 }}>· 글</span>
          </button>

          {!selectedPost && (
            <nav style={{ display: 'inline-flex', gap: 16, flexWrap: 'nowrap', overflow: 'hidden' }}>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  style={{
                    fontSize: 13, fontWeight: 500,
                    background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 4px',
                    color: activeTag === tag ? 'var(--ink-0)' : 'var(--ink-3)',
                    borderBottom: activeTag === tag ? '1.5px solid var(--ink-0)' : '1.5px solid transparent',
                    whiteSpace: 'nowrap',
                  }}
                >{tag}</button>
              ))}
            </nav>
          )}

          <button
            onClick={() => navigate(isLoggedIn ? '/home' : '/login')}
            className="ut-btn ut-btn-primary ut-btn-sm"
            style={{ flexShrink: 0 }}
          >{isLoggedIn ? '대시보드 →' : '로그인'}</button>
        </header>

        {/* ── Magazine intro ───────────────────────────────── */}
        {!selectedPost && (
          <section style={{ padding: 'clamp(40px,6vw,64px) clamp(20px,4vw,48px) clamp(24px,4vw,40px)' }}>
            <div className="ut-eyebrow" style={{ marginBottom: 24 }}>U.T LAB4 · WRITING — {monthLabel}</div>
            <h1 className="ut-display-2 ut-serif" style={{
              color: 'var(--ink-0)', maxWidth: 880,
              fontStyle: 'italic', fontWeight: 700, letterSpacing: '-0.02em',
            }}>
              매일 들여다보면서 알게 된 것들<span style={{ color: 'var(--dot)' }}>.</span>
            </h1>
            <p className="ut-body" style={{ color: 'var(--ink-3)', maxWidth: 620, marginTop: 18 }}>
              영화 · 책 · 음악 · 여행 · 코드 · 가끔 시장. 한 사람의 인덱스.
            </p>
          </section>
        )}

        {/* 패널 열린 상태: 컴팩트 헤더 간격 */}
        {selectedPost && <div style={{ height: 24 }} />}

        {/* ── States ───────────────────────────────────────── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '6rem 0', color: 'var(--ink-4)', fontSize: 14 }}>불러오는 중…</div>
        )}
        {!loading && posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '6rem 0', color: 'var(--ink-4)' }}>
            <p style={{ fontSize: 14 }}>공개된 글이 없습니다</p>
          </div>
        )}

        {!loading && filtered.length > 0 && featured && (
          <>
            {/* ── Featured + Sidebar (패널 닫힌 상태) ─────── */}
            {!selectedPost && (
              <section style={{
                padding: '0 clamp(20px,4vw,48px)',
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
                gap: 'clamp(24px,3vw,40px)',
                alignItems: 'start',
              }}>
                <article
                  style={{ cursor: 'pointer' }}
                  onClick={() => openPost(featured)}
                >
                  <div style={{ aspectRatio: '1.55', marginBottom: 24 }}>
                    {featured.cover_image
                      ? <img src={featured.cover_image} alt={featured.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-md)', display: 'block' }} />
                      : <CoverPlaceholder idx={0} title={featured.title} large />}
                  </div>
                  <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', marginBottom: 14, fontSize: 12 }}>
                    <span style={{ background: 'var(--ink-0)', color: '#FAFAF7', padding: '3px 10px', borderRadius: 999, fontWeight: 600, letterSpacing: '0.04em' }}>피쳐드</span>
                    {featured.tags[0] && <span style={{ color: 'var(--ink-4)' }}>{featured.tags[0]}</span>}
                    <span style={{ color: 'var(--ink-5)' }}>·</span>
                    <span className="ut-mono" style={{ color: 'var(--ink-4)' }}>{formatDate(featured.created_at)}</span>
                    <span style={{ color: 'var(--ink-5)' }}>·</span>
                    <span style={{ color: 'var(--ink-4)' }}>{readMin(featured)}분</span>
                  </div>
                  <h2 className="ut-h1" style={{ color: 'var(--ink-0)', marginBottom: 14 }}>{featured.title}</h2>
                  {featured.excerpt && (
                    <p className="ut-body" style={{ color: 'var(--ink-2)', maxWidth: 660 }}>{featured.excerpt}</p>
                  )}
                </article>

                <aside style={{ borderLeft: '1px solid var(--line)', paddingLeft: 'clamp(20px,3vw,40px)' }}>
                  <div className="ut-eyebrow" style={{ marginBottom: 24 }}>이번 달 읽을거리</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {sidebar.map((p, i) => (
                      <article
                        key={p.id}
                        onClick={() => openPost(p)}
                        style={{
                          display: 'grid', gridTemplateColumns: '32px 1fr', gap: 14,
                          paddingBottom: 20,
                          borderBottom: i < sidebar.length - 1 ? '1px solid var(--line-2)' : 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <div className="ut-mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em', paddingTop: 2 }}>0{i + 2}</div>
                        <div>
                          {p.tags[0] && (
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.08em', marginBottom: 4 }}>{p.tags[0].toUpperCase()}</div>
                          )}
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-0)', lineHeight: 1.34, marginBottom: 4, letterSpacing: '-0.01em' }}>{p.title}</div>
                          <div className="ut-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{formatDate(p.created_at)} · {readMin(p)}분</div>
                        </div>
                      </article>
                    ))}
                  </div>
                </aside>
              </section>
            )}

            {/* ── 패널 열린 상태: 컴팩트 글 목록 ─────────── */}
            {selectedPost && (
              <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {filtered.map((p, i) => (
                  <article
                    key={p.id}
                    onClick={() => openPost(p)}
                    style={{
                      padding: '14px 0',
                      borderBottom: '1px solid var(--line-2)',
                      cursor: 'pointer',
                      background: selectedPost.id === p.id ? 'rgba(0,0,0,0.03)' : 'transparent',
                      borderRadius: 6,
                      paddingLeft: selectedPost.id === p.id ? 10 : 0,
                      paddingRight: selectedPost.id === p.id ? 10 : 0,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      {p.cover_image ? (
                        <img src={p.cover_image} alt={p.title} style={{
                          width: 48, height: 48, objectFit: 'cover',
                          borderRadius: 6, flexShrink: 0,
                        }} />
                      ) : (
                        <div style={{
                          width: 48, height: 48, flexShrink: 0, borderRadius: 6,
                          background: GRADIENT_POOL[i % GRADIENT_POOL.length].bg,
                        }} />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {p.tags[0] && (
                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.08em', marginBottom: 3 }}>{p.tags[0].toUpperCase()}</div>
                        )}
                        <div style={{
                          fontSize: 14, fontWeight: 600, color: 'var(--ink-0)',
                          lineHeight: 1.3, letterSpacing: '-0.01em',
                          overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>{p.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                          {formatDate(p.created_at)} · {readMin(p)}분
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* ── Grid — remaining posts (패널 닫힌 상태) ─── */}
            {!selectedPost && grid.length > 0 && (
              <section style={{ padding: 'clamp(40px,5vw,64px) clamp(20px,4vw,48px) 80px' }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--line)',
                }}>
                  <h3 className="ut-h2" style={{ color: 'var(--ink-0)' }}>모든 글</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 28 }}>
                  {grid.map((p, i) => (
                    <article
                      key={p.id}
                      onClick={() => openPost(p)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ aspectRatio: '1.35', marginBottom: 16 }}>
                        {p.cover_image
                          ? <img src={p.cover_image} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-md)', display: 'block' }} />
                          : <CoverPlaceholder idx={i + 4} title={p.title} />}
                      </div>
                      {p.tags[0] && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.10em', marginBottom: 8 }}>{p.tags[0].toUpperCase()}</div>
                      )}
                      <h3 style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink-0)', lineHeight: 1.32, marginBottom: 10, letterSpacing: '-0.018em' }}>{p.title}</h3>
                      {p.excerpt && (
                        <p className="ut-body-sm" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>{p.excerpt}</p>
                      )}
                      <div className="ut-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{formatDate(p.created_at)} · {readMin(p)}분</div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── 우측: 슬라이드 패널 ─────────────────────────── */}
      <div style={{
        flex: selectedPost ? '1' : '0 0 0',
        transition: 'flex 0.35s ease',
        overflow: selectedPost ? 'auto' : 'hidden',
        minWidth: 0,
      }}>
        {selectedPost && (
          <PostReader post={selectedPost} loading={loadingPost} onClose={closePost} />
        )}
      </div>

    </div>
  )
}
