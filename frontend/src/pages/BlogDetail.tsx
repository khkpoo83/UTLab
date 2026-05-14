import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit2, Trash2, Globe, Lock, Cpu, Tag, Calendar } from 'lucide-react'
import { blogApi, BlogPost } from '../api/client'
import BlogEditor from '../components/blog/BlogEditor'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

export default function BlogDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    blogApi.get(Number(id))
      .then(({ data }) => setPost(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!post) return
    if (!window.confirm('이 글을 삭제하시겠습니까?')) return
    await blogApi.delete(post.id)
    navigate('/blog')
  }

  if (loading) return <div className="flex items-center justify-center h-full text-zinc-400">불러오는 중...</div>
  if (!post) return <div className="flex items-center justify-center h-full text-zinc-400">글을 찾을 수 없습니다</div>

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/blog')} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm">
          <ArrowLeft size={16} /> 목록
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/blog/${post.id}/edit`)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <Edit2 size={13} /> 수정
          </button>
          <button onClick={handleDelete}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
            <Trash2 size={13} /> 삭제
          </button>
        </div>
      </div>

      {/* 커버 이미지 */}
      {post.cover_image && (
        <div className="rounded-2xl overflow-hidden h-56">
          <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}

      {/* 메타 정보 */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-snug">{post.title}</h1>
        <div className="flex items-center gap-3 flex-wrap text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Calendar size={12} /> {formatDate(post.created_at)}
          </span>
          <span className="flex items-center gap-1">
            {post.visibility === 'public' ? <><Globe size={12} className="text-green-500" /> 공개</> : <><Lock size={12} /> 비공개</>}
          </span>
          {post.ai_generated && (
            <span className="flex items-center gap-1 text-purple-500"><Cpu size={12} /> AI 생성</span>
          )}
          <span>{post.word_count.toLocaleString()} 자</span>
        </div>
        {post.tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {post.tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs rounded-full">
                <Tag size={9} /> {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 본문 */}
      <div className="min-h-[400px]">
        <BlogEditor content={post.content || ''} onChange={() => {}} editable={false} />
      </div>
    </div>
  )
}
