import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, LogIn, Globe, Tag, Calendar } from 'lucide-react'
import { blogApi, BlogPost } from '../api/client'
import BlogEditor from '../components/blog/BlogEditor'

function getTokens(isLight: boolean) {
  return isLight
    ? {
        bg:         '#ffffff',
        headerBg:   'rgba(255,255,255,0.94)',
        border:     'rgba(8,10,30,0.09)',
        textPrimary:'rgba(8,10,30,0.88)',
        textMuted:  'rgba(8,10,30,0.45)',
        tagBg:      'rgba(8,10,30,0.06)',
        tagText:    'rgba(8,10,30,0.55)',
        btnBorder:  'rgba(8,10,30,0.18)',
        btnBg:      'rgba(8,10,30,0.06)',
      }
    : {
        bg:         '#000000',
        headerBg:   'rgba(0,0,0,0.92)',
        border:     'rgba(188,214,255,0.10)',
        textPrimary:'rgba(220,228,255,0.90)',
        textMuted:  'rgba(220,228,255,0.45)',
        tagBg:      'rgba(188,214,255,0.08)',
        tagText:    'rgba(188,214,255,0.55)',
        btnBorder:  'rgba(188,214,255,0.18)',
        btnBg:      'rgba(188,214,255,0.06)',
      }
}

export default function PublicBlogDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isLight = localStorage.getItem('hubMode') === 'light'
  const t = getTokens(isLight)

  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    blogApi.publicGet(Number(id))
      .then(({ data }) => setPost(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted }}>
      불러오는 중...
    </div>
  )
  if (!post) return (
    <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: t.textMuted }}>
      <p>글을 찾을 수 없습니다</p>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--c-accent,#3b82f6)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
        블로그로 돌아가기
      </button>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      {/* 헤더 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: t.headerBg,
        borderBottom: `1px solid ${t.border}`,
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '52px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft size={15} /> 목록
          </button>
          <button
            onClick={() => navigate('/login')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 14px', borderRadius: '20px', fontSize: '12px',
              border: `1px solid ${t.btnBorder}`,
              background: t.btnBg, color: t.textMuted, cursor: 'pointer',
            }}
          >
            <LogIn size={13} /> 로그인
          </button>
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
          <h1 style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)', fontWeight: 700, color: t.textPrimary, lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
            {post.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: t.textMuted, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
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
                  background: t.tagBg, color: t.tagText, fontSize: '11px',
                }}>
                  <Tag size={9} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ color: t.textPrimary }}>
          <BlogEditor content={post.content || ''} onChange={() => {}} editable={false} />
        </div>
      </div>
    </div>
  )
}
