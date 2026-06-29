import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, BubbleMenu, Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Typography from '@tiptap/extension-typography'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from 'lowlight'
import { marked } from 'marked'
import { blogApi } from '../../api/client'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, CheckSquare,
  Link2, Link2Off, Image as ImageIcon, Table as TableIcon,
  Quote, Minus, Undo, Redo, Palette, X, Trash2, FileCode,
} from 'lucide-react'

marked.setOptions({ breaks: true, gfm: true })

// ── HTML → Markdown 변환 ──────────────────────────────────────────────────────
function htmlToMarkdown(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html

  function nodeToMd(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const inner = () => Array.from(el.childNodes).map(nodeToMd).join('')
    switch (tag) {
      case 'h1': return `\n# ${inner().trim()}\n\n`
      case 'h2': return `\n## ${inner().trim()}\n\n`
      case 'h3': return `\n### ${inner().trim()}\n\n`
      case 'p': { const c = inner().trim(); return c ? `${c}\n\n` : '' }
      case 'strong': case 'b': return `**${inner()}**`
      case 'em': case 'i': return `*${inner()}*`
      case 'u': return `__${inner()}__`
      case 's': case 'del': case 'strike': return `~~${inner()}~~`
      case 'code':
        return el.parentElement?.tagName.toLowerCase() === 'pre'
          ? el.textContent || ''
          : `\`${inner()}\``
      case 'pre': return `\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`
      case 'blockquote':
        return inner().split('\n').filter(l => l.trim()).map(l => `> ${l}`).join('\n') + '\n\n'
      case 'ul':
        return Array.from(el.children)
          .map(li => `- ${Array.from(li.childNodes).map(nodeToMd).join('').trim()}`)
          .join('\n') + '\n\n'
      case 'ol':
        return Array.from(el.children)
          .map((li, i) => `${i + 1}. ${Array.from(li.childNodes).map(nodeToMd).join('').trim()}`)
          .join('\n') + '\n\n'
      case 'li': return inner()
      case 'a': return `[${inner()}](${el.getAttribute('href') || ''})`
      case 'img': return `![${el.getAttribute('alt') || ''}](${el.getAttribute('src') || ''})\n`
      case 'hr': return `---\n\n`
      case 'br': return '\n'
      default: return inner()
    }
  }

  return Array.from(div.childNodes)
    .map(nodeToMd)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── FontSize 익스텐션 ─────────────────────────────────────────────────────────
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.fontSize || null,
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    } as any
  },
})

const FONT_FAMILIES = [
  { label: '기본', value: '' },
  { label: '나눔고딕', value: "'Nanum Gothic', sans-serif" },
  { label: '본고딕', value: "'Noto Sans KR', sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Mono', value: "'Courier New', monospace" },
]

const FONT_SIZES = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px']

const HIGHLIGHT_COLORS = [
  { label: '노랑', value: '#fef08a' },
  { label: '초록', value: '#86efac' },
  { label: '하늘', value: '#93c5fd' },
  { label: '분홍', value: '#f9a8d4' },
  { label: '빨강', value: '#fca5a5' },
  { label: '주황', value: '#fdba74' },
  { label: '보라', value: '#c4b5fd' },
  { label: '제거', value: '' },
]

const AlignableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'center',
        parseHTML: el => el.getAttribute('data-align') || 'center',
        renderHTML: ({ align }) => ({ 'data-align': align }),
      },
    }
  },
})

interface Props {
  content: string
  onChange: (html: string) => void
  editable?: boolean
  placeholder?: string
}

function Sep() {
  return <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5 self-center flex-shrink-0" />
}

function TB({
  onClick, active, title, children, disabled,
}: {
  onClick: () => void
  active?: boolean
  title?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-ink-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-ink-1'
      }`}
    >
      {children}
    </button>
  )
}

export default function BlogEditor({
  content, onChange, editable = true, placeholder = '내용을 입력하세요...',
}: Props) {
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const linkInputRef  = useRef<HTMLInputElement>(null)
  const editorRef     = useRef<Editor | null>(null)
  const [linkDialog,         setLinkDialog]         = useState(false)
  const [linkUrl,            setLinkUrl]             = useState('')
  const [tableDropdown,      setTableDropdown]       = useState(false)
  const [tableHover,         setTableHover]          = useState({ rows: 0, cols: 0 })
  const [highlightDropdown,  setHighlightDropdown]   = useState(false)
  const [uploadError,        setUploadError]         = useState<string | null>(null)
  const [mdMode,             setMdMode]              = useState(false)
  const [mdText,             setMdText]              = useState('')

  function showUploadError(msg: string) {
    setUploadError(msg)
    setTimeout(() => setUploadError(null), 4000)
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      AlignableImage.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Underline,
      Placeholder.configure({ placeholder }),
      CharacterCount,
      Typography,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content,
    editable,
    onCreate: ({ editor: e }) => { editorRef.current = e },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        const images = Array.from(files).filter(f => f.type.startsWith('image/'))
        if (!images.length) return false
        event.preventDefault()
        images.forEach(async file => {
          try {
            const { data } = await blogApi.upload(file)
            const node = view.state.schema.nodes.image.create({ src: data.url })
            view.dispatch(view.state.tr.replaceSelectionWith(node))
          } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            showUploadError(msg ?? '이미지 업로드 실패. 지원 형식: JPG·PNG·GIF·WEBP (최대 10MB)')
          }
        })
        return true
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        const images = Array.from(items).filter(i => i.type.startsWith('image/'))
        if (!images.length) return false
        event.preventDefault()
        images.forEach(async item => {
          const file = item.getAsFile()
          if (!file) return
          try {
            const { data } = await blogApi.upload(file)
            const node = view.state.schema.nodes.image.create({ src: data.url })
            view.dispatch(view.state.tr.replaceSelectionWith(node))
          } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            showUploadError(msg ?? '이미지 업로드 실패. 지원 형식: JPG·PNG·GIF·WEBP (최대 10MB)')
          }
        })
        return true
      },
    },
  })

  // 외부 content 변경 → 에디터 동기화
  // RAF로 React 렌더 사이클과 분리 → insertBefore 에러 방지
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (content === editor.getHTML()) return
    const raf = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.setContent(content, false)
    })
    return () => cancelAnimationFrame(raf)
  }, [content, editor])

  useEffect(() => {
    if (linkDialog) setTimeout(() => linkInputRef.current?.focus(), 50)
  }, [linkDialog])

  async function uploadFile(file: File) {
    try {
      const { data } = await blogApi.upload(file)
      editor?.chain().focus().setImage({ src: data.url }).run()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showUploadError(msg ?? '이미지 업로드 실패. 지원 형식: JPG·PNG·GIF·WEBP (최대 10MB)')
    }
  }

  function openLinkDialog() {
    setLinkUrl(editor?.getAttributes('link').href || 'https://')
    setLinkDialog(true)
  }

  function applyLink(e: React.FormEvent) {
    e.preventDefault()
    const url = linkUrl.trim()
    if (!url || url === 'https://') editor?.chain().focus().unsetLink().run()
    else editor?.chain().focus().setLink({ href: url }).run()
    setLinkDialog(false)
  }

  function insertTable(rows: number, cols: number) {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
    setTableDropdown(false)
  }

  function enterMdMode() {
    if (!editor) return
    setMdText(htmlToMarkdown(editor.getHTML()))
    setMdMode(true)
  }

  function exitMdMode() {
    const html = String(marked.parse(mdText))
    editor?.commands.setContent(html, false)
    onChange(html)
    setMdMode(false)
  }

  // 마크다운 붙여넣기 자동 변환 (이미지·HTML 붙여넣기와 충돌 없음)
  function handleContainerPaste(e: React.ClipboardEvent) {
    if (mdMode) return
    const items = Array.from(e.clipboardData.items || [])
    if (items.some(i => i.type.startsWith('image/'))) return
    const htmlData = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (!htmlData && text && /^(#{1,3}\s|[-*+]\s|\d+\.\s|```|> )/m.test(text)) {
      e.stopPropagation()
      e.preventDefault()
      editorRef.current?.commands.insertContent(String(marked.parse(text)))
    }
  }

  if (!editor) return null

  const inTable  = editor.isActive('table')
  const canMerge = editor.can().mergeCells()
  const canSplit = editor.can().splitCell()

  const blockType =
    editor.isActive('heading', { level: 1 }) ? 'h1' :
    editor.isActive('heading', { level: 2 }) ? 'h2' :
    editor.isActive('heading', { level: 3 }) ? 'h3' :
    editor.isActive('blockquote')            ? 'blockquote' :
    editor.isActive('codeBlock')             ? 'codeBlock' : 'paragraph'

  const currentFontSize = editor.getAttributes('textStyle').fontSize || ''

  // BubbleMenu shouldShow — try/catch로 안전하게
  const showImgMenu  = ({ editor: e }: any) => { try { return !mdMode && e.isActive('image') } catch { return false } }
  const showLinkMenu = ({ editor: e }: any) => { try { return !mdMode && e.isActive('link') && editable } catch { return false } }

  return (
    <div className="flex flex-col h-full border border-ink-5 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">

      {/* BubbleMenus — always mounted, appendTo body로 DOM 충돌 방지 */}
      <BubbleMenu editor={editor} shouldShow={showImgMenu} tippyOptions={{ duration: 100, appendTo: () => document.body }}>
        <div className="flex items-center gap-0.5 bg-white dark:bg-zinc-800 border border-ink-5 rounded-lg shadow-xl p-1">
          {(['left', 'center', 'right'] as const).map((align, i) => (
            <button
              key={align}
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().updateAttributes('image', { align }).run() }}
              title={['왼쪽', '가운데', '오른쪽'][i]}
              className={`p-1.5 rounded transition-colors ${
                editor.getAttributes('image').align === align
                  ? 'bg-accent/15 text-accent'
                  : 'text-ink-3 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
            >
              {align === 'left' ? <AlignLeft size={13} /> : align === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
          <button
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteSelection().run() }}
            className="p-1.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </BubbleMenu>

      <BubbleMenu editor={editor} shouldShow={showLinkMenu} tippyOptions={{ duration: 100, appendTo: () => document.body }}>
        <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 border border-ink-5 rounded-lg shadow-xl p-1.5">
          <span className="text-xs text-ink-3 px-1 max-w-[160px] truncate">{editor.getAttributes('link').href}</span>
          <button onMouseDown={e => { e.preventDefault(); openLinkDialog() }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-ink-3">
            <Link2 size={12} />
          </button>
          <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetLink().run() }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400">
            <Link2Off size={12} />
          </button>
        </div>
      </BubbleMenu>

      {editable && (
        <>
          {/* ── 메인 툴바 ── */}
          <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-[var(--divide)] bg-zinc-50 dark:bg-zinc-800/60 sticky top-0 z-10">
            <TB onClick={() => editor.chain().focus().undo().run()} title="실행 취소 (Ctrl+Z)"><Undo size={14} /></TB>
            <TB onClick={() => editor.chain().focus().redo().run()} title="다시 실행 (Ctrl+Y)"><Redo size={14} /></TB>
            <Sep />

            {/* Rich text 전용 컨트롤 — MD 모드에서는 숨김 */}
            {!mdMode && (
              <>
                <select
                  value={blockType}
                  onChange={e => {
                    const v = e.target.value
                    if (v === 'h1') editor.chain().focus().toggleHeading({ level: 1 }).run()
                    else if (v === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run()
                    else if (v === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run()
                    else if (v === 'blockquote') editor.chain().focus().toggleBlockquote().run()
                    else if (v === 'codeBlock') editor.chain().focus().toggleCodeBlock().run()
                    else editor.chain().focus().setParagraph().run()
                  }}
                  className="text-xs px-1.5 py-1 rounded border border-ink-5 bg-white dark:bg-zinc-800 text-ink-2 outline-none"
                >
                  <option value="paragraph">본문</option>
                  <option value="h1">제목 1</option>
                  <option value="h2">제목 2</option>
                  <option value="h3">제목 3</option>
                  <option value="blockquote">인용구</option>
                  <option value="codeBlock">코드 블록</option>
                </select>
                <select
                  value={currentFontSize}
                  onChange={e => {
                    const val = e.target.value
                    if (val) (editor.chain().focus() as any).setFontSize(val).run()
                    else (editor.chain().focus() as any).unsetFontSize().run()
                  }}
                  className="text-xs px-1.5 py-1 rounded border border-ink-5 bg-white dark:bg-zinc-800 text-ink-2 outline-none w-16"
                  title="글자 크기"
                >
                  <option value="">크기</option>
                  {FONT_SIZES.map(s => <option key={s} value={s}>{s.replace('px', '')}</option>)}
                </select>
                <select
                  defaultValue=""
                  onChange={e => {
                    const val = e.target.value
                    if (val) editor.chain().focus().setFontFamily(val).run()
                    else editor.chain().focus().unsetFontFamily().run()
                  }}
                  className="text-xs px-1.5 py-1 rounded border border-ink-5 bg-white dark:bg-zinc-800 text-ink-2 outline-none"
                >
                  {FONT_FAMILIES.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
                </select>
                <Sep />

                <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="굵게 (Ctrl+B)"><Bold size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="기울임 (Ctrl+I)"><Italic size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄 (Ctrl+U)"><UnderlineIcon size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="취소선"><Strikethrough size={14} /></TB>

                {/* 형광펜 */}
                <div className="relative">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run() }}
                      title="형광펜"
                      className={`p-1.5 rounded-l transition-colors ${editor.isActive('highlight') ? 'bg-accent/15 text-accent' : 'text-ink-3 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}
                    >
                      <Highlighter size={14} />
                    </button>
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); setHighlightDropdown(p => !p) }}
                      className="p-1 rounded-r text-ink-4 hover:bg-zinc-100 dark:hover:bg-zinc-700 border-l border-ink-5 transition-colors"
                    >
                      <span className="text-[9px] leading-none">▼</span>
                    </button>
                  </div>
                  {highlightDropdown && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-zinc-800 border border-ink-5 rounded-xl shadow-2xl p-2">
                      <div className="grid grid-cols-4 gap-1">
                        {HIGHLIGHT_COLORS.map(({ label, value }) => (
                          <button
                            key={label}
                            type="button"
                            onMouseDown={e => {
                              e.preventDefault()
                              if (value) editor.chain().focus().setHighlight({ color: value }).run()
                              else editor.chain().focus().unsetHighlight().run()
                              setHighlightDropdown(false)
                            }}
                            title={label}
                            className="w-7 h-7 rounded-md border border-ink-5 flex items-center justify-center hover:scale-110 transition-transform"
                            style={value ? { backgroundColor: value } : {}}
                          >
                            {!value && <X size={12} className="text-ink-4" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 글자 색상 */}
                <label title="글자 색상" className="p-1.5 rounded text-ink-3 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer flex items-center relative">
                  <Palette size={14} />
                  <input type="color" className="w-0 h-0 opacity-0 absolute" onChange={e => editor.chain().focus().setColor(e.target.value).run()} />
                </label>
                <Sep />

                <TB onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="왼쪽 정렬"><AlignLeft size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="가운데 정렬"><AlignCenter size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="오른쪽 정렬"><AlignRight size={14} /></TB>
                <Sep />

                <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="불릿 목록"><List size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="번호 목록"><ListOrdered size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="체크리스트"><CheckSquare size={14} /></TB>
                <TB onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="인용구"><Quote size={14} /></TB>
                <TB onClick={() => editor.chain().focus().setHorizontalRule().run()} title="구분선"><Minus size={14} /></TB>
                <Sep />

                {/* 링크 */}
                <div className="relative">
                  <TB onClick={openLinkDialog} active={editor.isActive('link')} title="링크 삽입/편집"><Link2 size={14} /></TB>
                  {linkDialog && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-zinc-800 border border-ink-5 rounded-xl shadow-2xl p-2">
                      <form onSubmit={applyLink} className="flex gap-1.5 min-w-[280px]">
                        <input
                          ref={linkInputRef}
                          value={linkUrl}
                          onChange={e => setLinkUrl(e.target.value)}
                          placeholder="https://..."
                          className="flex-1 text-xs px-2.5 py-1.5 border border-ink-5 rounded-lg bg-white dark:bg-zinc-900 text-ink-1 outline-none focus:border-accent"
                        />
                        <button type="submit" className="px-2.5 py-1 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 font-medium">적용</button>
                        {editor.isActive('link') && (
                          <button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkDialog(false) }}
                            className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-700 text-ink-3 rounded-lg hover:bg-zinc-200">
                            <Link2Off size={12} />
                          </button>
                        )}
                        <button type="button" onClick={() => setLinkDialog(false)} className="p-1 text-ink-4 hover:text-ink-2">
                          <X size={13} />
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* 이미지 */}
                <TB onClick={() => fileInputRef.current?.click()} title="이미지 삽입"><ImageIcon size={14} /></TB>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />

                {/* 표 */}
                <div className="relative">
                  <TB onClick={() => setTableDropdown(p => !p)} active={inTable} title="표 삽입/편집"><TableIcon size={14} /></TB>
                  {tableDropdown && !inTable && (
                    <div
                      className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-zinc-800 border border-ink-5 rounded-xl shadow-2xl p-3"
                      onMouseLeave={() => setTableHover({ rows: 0, cols: 0 })}
                    >
                      <p className="text-[11px] text-ink-4 mb-2 text-center">
                        {tableHover.rows > 0 ? `${tableHover.rows}×${tableHover.cols} 표` : '크기를 선택하세요'}
                      </p>
                      <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                        {Array.from({ length: 6 }, (_, r) =>
                          Array.from({ length: 6 }, (_, c) => {
                            const row = r + 1, col = c + 1
                            const active = row <= tableHover.rows && col <= tableHover.cols
                            return (
                              <button
                                key={`${r}-${c}`}
                                onMouseEnter={() => setTableHover({ rows: row, cols: col })}
                                onMouseDown={e => { e.preventDefault(); insertTable(row, col) }}
                                className={`w-5 h-5 rounded-sm border transition-colors ${
                                  active ? 'bg-accent/30 border-accent' : 'border-ink-5 hover:border-ink-5'
                                }`}
                              />
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <Sep />
              </>
            )}

            {/* Markdown 모드 토글 버튼 */}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); mdMode ? exitMdMode() : enterMdMode() }}
              title={mdMode ? 'Rich Text로 변환 후 적용' : 'Markdown 모드로 편집'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                mdMode
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                  : 'text-ink-3 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
            >
              <FileCode size={13} />
              {mdMode ? '적용' : 'MD'}
            </button>
          </div>

          {/* 표 컨텍스트 툴바 */}
          {!mdMode && inTable && (
            <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10">
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mr-1">표 편집</span>
              {[
                { label: '↑ 행 추가', fn: () => editor.chain().focus().addRowBefore().run() },
                { label: '↓ 행 추가', fn: () => editor.chain().focus().addRowAfter().run() },
                { label: '행 삭제', fn: () => editor.chain().focus().deleteRow().run(), red: true },
              ].map(({ label, fn, red }) => (
                <button key={label} onMouseDown={e => { e.preventDefault(); fn() }}
                  className={`px-2 py-0.5 text-[11px] rounded-md border transition-colors ${
                    red
                      ? 'border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20'
                      : 'border-ink-5 text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}>{label}</button>
              ))}
              <div className="w-px h-3 bg-amber-200 dark:bg-amber-700 mx-0.5" />
              {[
                { label: '← 열 추가', fn: () => editor.chain().focus().addColumnBefore().run() },
                { label: '→ 열 추가', fn: () => editor.chain().focus().addColumnAfter().run() },
                { label: '열 삭제', fn: () => editor.chain().focus().deleteColumn().run(), red: true },
              ].map(({ label, fn, red }) => (
                <button key={label} onMouseDown={e => { e.preventDefault(); fn() }}
                  className={`px-2 py-0.5 text-[11px] rounded-md border transition-colors ${
                    red
                      ? 'border-red-200 text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20'
                      : 'border-ink-5 text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}>{label}</button>
              ))}
              <div className="w-px h-3 bg-amber-200 dark:bg-amber-700 mx-0.5" />
              {canMerge && (
                <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().mergeCells().run() }}
                  className="px-2 py-0.5 text-[11px] rounded-md border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                  셀 병합
                </button>
              )}
              {canSplit && (
                <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().splitCell().run() }}
                  className="px-2 py-0.5 text-[11px] rounded-md border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                  셀 분할
                </button>
              )}
              <div className="w-px h-3 bg-amber-200 dark:bg-amber-700 mx-0.5" />
              <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteTable().run() }}
                className="px-2 py-0.5 text-[11px] rounded-md border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-1">
                <Trash2 size={10} /> 표 삭제
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Markdown 편집 모드 ── */}
      {mdMode ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 border-b border-emerald-200 dark:border-emerald-800/40 flex items-center justify-between gap-2 flex-shrink-0">
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Markdown 편집 모드 — 작성 후 <strong>MD 적용</strong> 버튼을 누르세요
            </span>
            <span className="text-[10px] text-ink-4 flex-shrink-0">붙여넣기 시 자동 변환</span>
          </div>
          <textarea
            value={mdText}
            onChange={e => setMdText(e.target.value)}
            className="flex-1 p-5 font-mono text-sm text-ink-1 bg-white dark:bg-zinc-900 outline-none resize-none leading-relaxed"
            placeholder={'# 제목\n\n## 소제목\n\n본문 내용...\n\n- 항목 1\n- 항목 2\n\n**굵게** *기울임* ~~취소선~~\n\n> 인용구\n\n```\n코드 블록\n```'}
            spellCheck={false}
          />
          <div className="px-4 py-1.5 border-t border-[var(--divide)] bg-zinc-50 dark:bg-zinc-800/30 text-right flex-shrink-0">
            <span className="text-[11px] text-ink-4">{mdText.length.toLocaleString()} 자</span>
          </div>
        </div>
      ) : (
        <>
          {/* ── Rich Text 에디터 ── */}
          <div
            className="flex-1 overflow-y-auto"
            onClick={() => editor.commands.focus()}
            onPaste={handleContainerPaste}
          >
            <EditorContent
              editor={editor}
              className="
                prose prose-zinc dark:prose-invert max-w-none p-6 min-h-[400px]
                [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[400px]
                [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-lg [&_.ProseMirror_img]:my-3 [&_.ProseMirror_img]:cursor-pointer
                [&_.ProseMirror_img[data-align='left']]:ml-0 [&_.ProseMirror_img[data-align='left']]:mr-auto [&_.ProseMirror_img[data-align='left']]:block
                [&_.ProseMirror_img[data-align='center']]:mx-auto [&_.ProseMirror_img[data-align='center']]:block
                [&_.ProseMirror_img[data-align='right']]:ml-auto [&_.ProseMirror_img[data-align='right']]:mr-0 [&_.ProseMirror_img[data-align='right']]:block
                [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
                [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-ink-4 dark:[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-ink-2
                [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none
                [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left
                [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0
                [&_.ProseMirror_.tableWrapper]:overflow-x-auto [&_.ProseMirror_.tableWrapper]:my-4
                [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full
                [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-ink-5 dark:[&_.ProseMirror_th]:border-ink-2 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:bg-zinc-100 dark:[&_.ProseMirror_th]:bg-zinc-800 [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_th]:text-sm [&_.ProseMirror_th]:text-left
                [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-ink-5 dark:[&_.ProseMirror_td]:border-ink-2 [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:text-sm
                [&_.ProseMirror_.selectedCell]:bg-accent/10
                [&_.ProseMirror_.column-resize-handle]:absolute [&_.ProseMirror_.column-resize-handle]:right-[-2px] [&_.ProseMirror_.column-resize-handle]:top-0 [&_.ProseMirror_.column-resize-handle]:bottom-0 [&_.ProseMirror_.column-resize-handle]:w-1 [&_.ProseMirror_.column-resize-handle]:bg-accent/50 [&_.ProseMirror_.column-resize-handle]:cursor-col-resize [&_.ProseMirror_.column-resize-handle]:z-10
                [&_.ProseMirror_.resize-cursor]:cursor-col-resize
                [&_.ProseMirror_ul[data-type='taskList']]:list-none [&_.ProseMirror_ul[data-type='taskList']]:pl-0 [&_.ProseMirror_ul[data-type='taskList']]:my-2
                [&_.ProseMirror_ul[data-type='taskList']_li]:flex [&_.ProseMirror_ul[data-type='taskList']_li]:items-start [&_.ProseMirror_ul[data-type='taskList']_li]:gap-2 [&_.ProseMirror_ul[data-type='taskList']_li]:my-1
                [&_.ProseMirror_ul[data-type='taskList']_li_label]:mt-0.5 [&_.ProseMirror_ul[data-type='taskList']_li_label]:cursor-pointer [&_.ProseMirror_ul[data-type='taskList']_li_label]:flex-shrink-0
                [&_.ProseMirror_ul[data-type='taskList']_li_div]:flex-1
                [&_.ProseMirror_pre]:bg-zinc-900 dark:[&_.ProseMirror_pre]:bg-zinc-950 [&_.ProseMirror_pre]:rounded-xl [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:my-4
                [&_.ProseMirror_pre_code]:text-ink-5 [&_.ProseMirror_pre_code]:text-sm [&_.ProseMirror_pre_code]:font-mono [&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0
                [&_.ProseMirror_:not(pre)_code]:bg-zinc-100 dark:[&_.ProseMirror_:not(pre)_code]:bg-zinc-800 [&_.ProseMirror_:not(pre)_code]:px-1.5 [&_.ProseMirror_:not(pre)_code]:py-0.5 [&_.ProseMirror_:not(pre)_code]:rounded [&_.ProseMirror_:not(pre)_code]:text-sm [&_.ProseMirror_:not(pre)_code]:font-mono
                [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-accent/50 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_blockquote]:text-ink-3 dark:[&_.ProseMirror_blockquote]:text-ink-4
              "
            />
          </div>

          {editable && (
            <div className="px-4 py-1.5 border-t border-[var(--divide)] bg-zinc-50 dark:bg-zinc-800/30 text-right">
              <span className="text-[11px] text-ink-4">
                {editor.storage.characterCount.characters().toLocaleString()} 자
              </span>
            </div>
          )}
        </>
      )}

      {uploadError && (
        <div style={{
          position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(220,38,38,0.94)', color: '#fff',
          padding: '10px 20px', borderRadius: '10px', fontSize: '13px',
          whiteSpace: 'nowrap', zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 6px 20px rgba(0,0,0,0.30)',
        }}>
          {uploadError}
        </div>
      )}
    </div>
  )
}
