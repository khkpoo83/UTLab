import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Globe, Lock, Cpu, Tag, X, Pencil, Check, Trash2 } from 'lucide-react'
import { blogApi, settingsApi, BlogPost } from '../api/client'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function Blog() {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all')
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')

  const [blogTitle, setBlogTitle] = useState('Notes from the U.T Lab4')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const allTags = Array.from(new Set(posts.flatMap(p => p.tags))).filter(Boolean)

  async function loadPosts() {
    setLoading(true)
    try {
      const { data } = await blogApi.list({
        visibility: visibility !== 'all' ? visibility : undefined,
        q: query || undefined,
        tag: activeTag || undefined,
      })
      setPosts(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPosts() }, [visibility, activeTag])

  useEffect(() => {
    settingsApi.publicGet()
      .then(({ data }) => { if (data.blog_title) setBlogTitle(data.blog_title) })
      .catch(() => {})
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    loadPosts()
  }

  function startEditTitle() {
    setTitleDraft(blogTitle)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }

  async function saveTitle() {
    const next = titleDraft.trim()
    if (!next || next === blogTitle) { setEditingTitle(false); return }
    setSavingTitle(true)
    try {
      await settingsApi.update({ blog_title: next })
      setBlogTitle(next)
    } catch {
      // ignore
    } finally {
      setSavingTitle(false)
      setEditingTitle(false)
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveTitle()
    else if (e.key === 'Escape') setEditingTitle(false)
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* 블로그 타이틀 편집 */}
      <div className="flex items-center gap-2 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-zinc-400 mb-1 tracking-widest uppercase">블로그 대표 제목</p>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              className="w-full text-sm font-medium bg-transparent outline-none border-b border-accent text-zinc-800 dark:text-zinc-200 pb-0.5"
              placeholder="블로그 제목 입력..."
              autoFocus
            />
          ) : (
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{blogTitle}</p>
          )}
        </div>
        {editingTitle ? (
          <button
            onClick={saveTitle}
            disabled={savingTitle}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-accent text-white disabled:opacity-50 transition-opacity flex-shrink-0"
          >
            <Check size={11} /> {savingTitle ? '저장 중' : '저장'}
          </button>
        ) : (
          <button
            onClick={startEditTitle}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-200">블로그 관리</h1>
        <button
          onClick={() => navigate('/blog/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent/90 transition-colors"
        >
          <Plus size={14} /> 새 글
        </button>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <form onSubmit={handleSearch} className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5">
          <Search size={13} className="text-zinc-400 flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="제목 검색..."
            className="bg-transparent text-sm outline-none w-36 text-zinc-700 dark:text-zinc-300 placeholder-zinc-400"
          />
        </form>

        <div className="flex gap-1">
          {(['all', 'public', 'private'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                visibility === v
                  ? 'bg-accent text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {v === 'all' ? '전체' : v === 'public' ? '공개' : '비공개'}
            </button>
          ))}
        </div>

        {allTags.slice(0, 6).map(tag => (
          <button
            key={tag}
            onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors ${
              activeTag === tag
                ? 'bg-accent/15 text-accent'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            <Tag size={10} /> {tag}
          </button>
        ))}
        {activeTag && (
          <button onClick={() => setActiveTag('')} className="p-1 text-zinc-400 hover:text-zinc-600">
            <X size={12} />
          </button>
        )}
      </div>

      {/* 게시 수 */}
      {!loading && (
        <p className="text-xs text-zinc-400">{posts.length}개의 글</p>
      )}

      {loading && <div className="text-center py-12 text-zinc-400 text-sm">불러오는 중...</div>}

      {!loading && posts.length === 0 && (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-sm">작성된 글이 없습니다</p>
          <button onClick={() => navigate('/blog/new')} className="mt-3 text-accent text-sm hover:underline">
            첫 글 작성하기
          </button>
        </div>
      )}

      {/* 리스트 */}
      {!loading && posts.length > 0 && (
        <div className="space-y-1.5">
          {posts.map(post => (
            <div
              key={post.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors group"
            >
              {/* 상태 아이콘 */}
              <div className="flex-shrink-0">
                {post.visibility === 'public'
                  ? <Globe size={13} className="text-green-500" />
                  : <Lock size={13} className="text-zinc-400" />
                }
              </div>

              {/* 제목 + 메타 */}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => navigate(`/blog/${post.id}`)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-sm text-zinc-800 dark:text-zinc-200 truncate">{post.title}</span>
                  {post.ai_generated && <Cpu size={10} className="text-purple-400 flex-shrink-0" />}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-zinc-400">{formatDate(post.created_at)}</span>
                  {post.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 rounded-full">{tag}</span>
                  ))}
                </div>
              </div>

              {/* 수정/삭제 버튼 */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => navigate(`/blog/${post.id}/edit`)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  title="수정"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`"${post.title}" 글을 삭제하시겠습니까?`)) return
                    await blogApi.delete(post.id)
                    loadPosts()
                  }}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-zinc-400 hover:text-red-500"
                  title="삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
