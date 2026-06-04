import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Globe, Lock, Cpu, Tag, X, Pencil, Check, Trash2, Type } from 'lucide-react'
import { blogApi, settingsApi, BlogPost } from '../api/client'
import { Card } from '../components/Card'
import { Button } from '../components/settings/Button'
import { FormInput, FormTextarea } from '../components/FormField'

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

  // 사이트 텍스트 (랜딩 + 블로그)
  const [text, setText] = useState({
    site_hero_title: '한 사람의 인덱스',
    site_hero_subtitle: '매일 들여다보면서 알게 된 것들.',
    site_editor_note: '',
    site_footer_copyright: 'U.T Lab4 — 한 사람의 인덱스',
    blog_title: 'Notes from the U.T Lab4',
    blog_subtitle: '영화 · 책 · 음악 · 여행 · 코드 · 가끔 시장. 한 사람의 인덱스.',
  })
  const [textDirty, setTextDirty] = useState(false)
  const [textSaving, setTextSaving] = useState(false)
  const [textSaved, setTextSaved] = useState(false)

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
    settingsApi.get()
      .then(({ data }) => {
        setText(prev => ({
          site_hero_title: data.site_hero_title ?? prev.site_hero_title,
          site_hero_subtitle: data.site_hero_subtitle ?? prev.site_hero_subtitle,
          site_editor_note: data.site_editor_note ?? prev.site_editor_note,
          site_footer_copyright: data.site_footer_copyright ?? prev.site_footer_copyright,
          blog_title: data.blog_title ?? prev.blog_title,
          blog_subtitle: data.blog_subtitle ?? prev.blog_subtitle,
        }))
      })
      .catch(() => {})
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    loadPosts()
  }

  const updateText = (patch: Partial<typeof text>) => {
    setText(prev => ({ ...prev, ...patch }))
    setTextDirty(true)
    setTextSaved(false)
  }

  async function saveText() {
    setTextSaving(true)
    try {
      await settingsApi.update({
        ...text,
        site_hero_title: text.site_hero_title.replace(/\.$/, ''),
        blog_title: text.blog_title.replace(/\.$/, ''),
      })
      setTextDirty(false)
      setTextSaved(true)
      setTimeout(() => setTextSaved(false), 3000)
    } catch {
      // ignore
    } finally {
      setTextSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* ── 사이트 텍스트 (랜딩 + 블로그 제목) ── */}
      <Card collapsible id="blog-site-text" icon={<Type size={16} />} title="사이트 텍스트" defaultOpen={false}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormInput
              label="메인 제목 (랜딩)"
              hint="마침표(.)는 자동으로 붙습니다"
              value={text.site_hero_title}
              onChange={e => updateText({ site_hero_title: e.target.value.replace(/\.$/, '') })}
              placeholder="한 사람의 인덱스"
            />
            <FormInput
              label="메인 부제 (랜딩)"
              value={text.site_hero_subtitle}
              onChange={e => updateText({ site_hero_subtitle: e.target.value })}
              placeholder="매일 들여다보면서 알게 된 것들."
            />
            <FormInput
              label="블로그 제목"
              value={text.blog_title}
              onChange={e => updateText({ blog_title: e.target.value })}
              placeholder="Notes from the U.T Lab4"
            />
            <FormInput
              label="블로그 부제"
              value={text.blog_subtitle}
              onChange={e => updateText({ blog_subtitle: e.target.value })}
              placeholder="한 사람의 인덱스."
            />
          </div>
          <FormTextarea
            label="Editor's Note"
            rows={3}
            value={text.site_editor_note}
            onChange={e => updateText({ site_editor_note: e.target.value })}
            placeholder="메인 페이지 Editor's Note에 표시될 문구"
          />
          <FormInput
            label="푸터 Copyright"
            hint={`© ${new Date().getFullYear()} 가 자동으로 앞에 붙습니다`}
            value={text.site_footer_copyright}
            onChange={e => updateText({ site_footer_copyright: e.target.value })}
            placeholder="U.T Lab4 — 한 사람의 인덱스"
          />
          <div className="flex items-center gap-3">
            <Button onClick={saveText} loading={textSaving} loadingLabel="저장 중..." disabled={!textDirty} icon={<Check size={14} />}>
              텍스트 저장
            </Button>
            {textSaved && <span className="text-xs text-accent font-medium">저장되었습니다.</span>}
          </div>
        </div>
      </Card>

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-200">블로그 글</h1>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/blog/new')}>새 글</Button>
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
      {!loading && <p className="text-xs text-zinc-400">{posts.length}개의 글</p>}

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
              <div className="flex-shrink-0">
                {post.visibility === 'public'
                  ? <Globe size={13} className="text-green-500" />
                  : <Lock size={13} className="text-zinc-400" />
                }
              </div>

              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/blog/${post.id}`)}>
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
