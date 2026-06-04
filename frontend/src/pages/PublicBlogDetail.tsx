import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, LogIn, Globe, Tag, Calendar, Sun, Moon, Monitor } from 'lucide-react'
import { blogApi, BlogPost } from '../api/client'
import BlogEditor from '../components/blog/BlogEditor'
import { LogoMark, Wordmark } from '../components/ut/UTLogo'
import { usePublicTheme } from '../hooks/usePublicTheme'

export default function PublicBlogDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { mode: themeMode, isDark, cycleTheme } = usePublicTheme()
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor

  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const isLoggedIn = !!localStorage.getItem('token')

  useEffect(() => {
    blogApi.publicGet(Number(id))
      .then(({ data }) => setPost(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
      불러오는 중...
    </div>
  )
  if (!post) return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--ink-3)' }}>
      <p>글을 찾을 수 없습니다</p>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--c-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
        블로그로 돌아가기
      </button>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      {/* 헤더 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--pub-header-bg)',
        borderBottom: '1px solid var(--line)',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '52px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => navigate(-1)}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <ArrowLeft size={15} /> 목록
            </button>
          </div>
          <div
            onClick={() => navigate('/public/blog')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <LogoMark size={22} variant={isDark ? 'ink' : 'paper'} />
            <Wordmark size={12} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={cycleTheme}
              title={themeMode === 'dark' ? '다크 모드' : themeMode === 'light' ? '라이트 모드' : '시스템 모드'}
              style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                border: '1px solid var(--line)', background: 'var(--mist)',
                color: 'var(--ink-3)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer',
              }}
            ><ThemeIcon size={13} /></button>
            <button
              onClick={() => navigate(isLoggedIn ? '/home' : '/login')}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 14px', borderRadius: '20px', fontSize: '12px',
                border: '1px solid var(--line)',
                background: 'var(--mist)', color: 'var(--ink-3)', cursor: 'pointer',
              }}
            >
              <LogIn size={13} /> {isLoggedIn ? '관리자' : '로그인'}
            </button>
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '2.5rem 1.5rem 5rem' }}>
        {post.cover_image && (
          <div style={{ borderRadius: '16px', overflow: 'hidden', height: '240px', marginBottom: '2rem' }}>
            <img src={post.cover_image} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)', fontWeight: 700, color: 'var(--ink-0)', lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
            {post.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--ink-3)', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Calendar size={12} />
              {new Date(post.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Globe size={12} style={{ color: '#22c55e' }} /> 공개
            </span>
          </div>
          {post.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {post.tags.map(tag => (
                <span key={tag} style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '3px 10px', borderRadius: '100px',
                  background: 'var(--mist)', color: 'var(--ink-3)', fontSize: '11px',
                }}>
                  <Tag size={9} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ color: 'var(--ink-1)' }}>
          <BlogEditor content={post.content || ''} onChange={() => {}} editable={false} />
        </div>
      </div>
    </div>
  )
}
