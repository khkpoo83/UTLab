import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, Globe } from 'lucide-react'
import { blogApi, BlogPost } from '../api/client'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

function getTokens(isLight: boolean) {
  return isLight
    ? {
        bg:         '#ffffff',
        headerBg:   'rgba(255,255,255,0.94)',
        border:     'rgba(8,10,30,0.09)',
        cardBg:     '#ffffff',
        textPrimary:'rgba(8,10,30,0.88)',
        textMuted:  'rgba(8,10,30,0.45)',
        tagBg:      'rgba(8,10,30,0.06)',
        tagText:    'rgba(8,10,30,0.55)',
      }
    : {
        bg:         '#000000',
        headerBg:   'rgba(0,0,0,0.92)',
        border:     'rgba(188,214,255,0.10)',
        cardBg:     '#0a0d18',
        textPrimary:'rgba(220,228,255,0.90)',
        textMuted:  'rgba(220,228,255,0.45)',
        tagBg:      'rgba(188,214,255,0.08)',
        tagText:    'rgba(188,214,255,0.55)',
      }
}

export default function PublicBlog() {
  const navigate = useNavigate()
  const isLight = localStorage.getItem('hubMode') === 'light'
  const t = getTokens(isLight)

  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    blogApi.publicList({ limit: 30 })
      .then(({ data }) => setPosts(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      {/* 헤더 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: t.headerBg,
        borderBottom: `1px solid ${t.border}`,
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '52px' }}>
          <button
            onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Globe size={16} style={{ color: t.textMuted }} />
            <span style={{ fontWeight: 700, fontSize: '14px', color: t.textPrimary, letterSpacing: '-0.02em' }}>U.T Lab4</span>
            <span style={{ fontWeight: 300, color: t.textMuted, fontSize: '13px' }}>· 글</span>
          </button>
          <button
            onClick={() => navigate('/login')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 14px', borderRadius: '20px', fontSize: '12px',
              border: `1px solid ${t.border}`,
              background: 'transparent', color: t.textMuted, cursor: 'pointer',
            }}
          >
            <LogIn size={13} /> 로그인
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        {loading && <div style={{ textAlign: 'center', padding: '6rem 0', color: t.textMuted, fontSize: '14px' }}>불러오는 중...</div>}
        {!loading && posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '6rem 0', color: t.textMuted }}>
            <Globe size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ fontSize: '14px' }}>공개된 글이 없습니다</p>
          </div>
        )}
        {!loading && posts.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {posts.map(post => (
              <article
                key={post.id}
                onClick={() => { sessionStorage.setItem('hubReturnBlog', '1'); navigate(`/public/blog/${post.id}`) }}
                style={{
                  cursor: 'pointer', borderRadius: '14px',
                  border: `1px solid ${t.border}`,
                  background: t.cardBg,
                  overflow: 'hidden',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.boxShadow = isLight ? '0 8px 24px rgba(0,0,0,0.10)' : '0 8px 24px rgba(0,0,0,0.40)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}
              >
                {post.cover_image ? (
                  <div style={{ height: '176px', overflow: 'hidden' }}>
                    <img src={post.cover_image} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ) : (
                  <div style={{ height: '176px', background: isLight ? 'rgba(var(--c-accent-rgb,59 130 246)/0.06)' : 'rgba(var(--c-accent-rgb,59 130 246)/0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '3.5rem', fontWeight: 900, opacity: 0.15, color: 'var(--c-accent,#3b82f6)' }}>{post.title[0]}</span>
                  </div>
                )}
                <div style={{ padding: '1rem 1.1rem 1.2rem' }}>
                  <h2 style={{
                    fontWeight: 700, fontSize: '0.97rem', color: t.textPrimary,
                    marginBottom: '6px', lineHeight: 1.4,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{post.title}</h2>
                  {post.excerpt && (
                    <p style={{
                      fontSize: '0.83rem', color: t.textMuted, lineHeight: 1.55,
                      marginBottom: '10px',
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{post.excerpt}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.76rem', color: t.textMuted }}>{formatDate(post.created_at)}</span>
                    {post.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {post.tags.slice(0, 2).map(tag => (
                          <span key={tag} style={{ padding: '2px 8px', borderRadius: '100px', background: t.tagBg, color: t.tagText, fontSize: '0.72rem' }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
