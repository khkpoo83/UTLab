import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import PageTitle from '../components/PageTitle'
import { memoApi, settingsApi, type Memo } from '../api/client'

// marked 전역 설정 — gfm + 줄바꿈 지원
marked.use({ gfm: true, breaks: true })
import {
  PASTEL_PALETTE,
  memoPaperPalette,
  pickPaperColor,
  type PaperColor,
} from '../utils/memoPaper'

// ── 결정적 난수 (id 기반) ────────────────────────────────────────────────────
function hashRand(seed: string | number, salt = 0): number {
  let h = 2166136261 ^ salt
  const s = String(seed)
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 16777619)
  h ^= h >>> 15
  return ((h >>> 0) % 100000) / 100000
}

// ── 템플릿 정의 ─────────────────────────────────────────────────────────────
const SPEC_FIELDS = [
  { key: 'purpose', label: '목적 / 배경',     hint: '왜 이 기능이 필요한가? 무엇을 해결하는가?' },
  { key: 'user',    label: '사용자 시나리오', hint: '누가 / 언제 / 어떤 흐름으로 사용하는가?' },
  { key: 'ui',      label: '화면 구성',       hint: '핵심 화면 / 주요 상태 / 인터랙션' },
  { key: 'io',      label: '입력 / 출력',     hint: '받아야 할 데이터 / 응답·결과물' },
  { key: 'data',    label: '데이터 모델',     hint: '저장 항목, 타입, 제약, 관계' },
  { key: 'edge',    label: '예외 / 비고',     hint: '에러 / 빈 상태 / 권한 / 성능 등' },
]
const TEMPLATES = [
  {
    id: 'spec',
    label: '기능 명세서',
    emoji: '📋',
    build: () => SPEC_FIELDS.map(f => `## ${f.label}\n<!-- ${f.hint} -->\n\n`).join(''),
  },
  {
    id: 'idea',
    label: '아이디어 스케치',
    emoji: '💡',
    build: () => `## 핵심 아이디어\n\n## 왜 필요한가\n\n## 구현 방향\n\n## 다음 액션\n- [ ] \n`,
  },
  {
    id: 'meeting',
    label: '회의 / 기획',
    emoji: '📝',
    build: () => `## 목표 / 결론\n\n## 논의 내용\n- \n\n## 결정 사항\n- \n\n## 할 일\n- [ ] \n`,
  },
]

// ── 본문 스마트 프리뷰 ───────────────────────────────────────────────────────
type PreviewLine =
  | { kind: 'gap' }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; n: string; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'text'; text: string }

function stripInline(s: string) {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}
function parsePreviewLine(line: string): PreviewLine {
  if (line.trim() === '') return { kind: 'gap' }
  let m: RegExpMatchArray | null
  // space 없이 붙은 경우도 허용 (###제목 → heading)
  if ((m = line.match(/^(#{1,6})\s*(.+?)\s*$/))) return { kind: 'heading', level: m[1].length, text: stripInline(m[2]) }
  if ((m = line.match(/^[-*]\s+(.+)$/))) return { kind: 'bullet', text: stripInline(m[1]) }
  if ((m = line.match(/^(\d+)\.\s+(.+)$/))) return { kind: 'numbered', n: m[1], text: stripInline(m[2]) }
  if ((m = line.match(/^>\s?(.*)$/))) return { kind: 'quote', text: stripInline(m[1]) }
  return { kind: 'text', text: stripInline(line) }
}

interface PreviewResult {
  empty: boolean
  mode: 'outline' | 'prose'
  lines: PreviewLine[]
  faded: boolean
  totalLines: number
}

// 헤딩 ≥2개 → 아웃라인(헤딩 계층 요약), 없으면 첫 줄부터 산문
function summarizeBody(body: string): PreviewResult {
  const raw = (body || '').trim()
  if (!raw) return { empty: true, mode: 'prose', lines: [], faded: false, totalLines: 0 }

  const allLines = raw.split('\n')

  // 주석(<!-- -->) 제거, 연속 빈줄 1개로 압축
  const cleaned: string[] = []
  for (const l of allLines) {
    if (/^<!--/.test(l)) continue
    if (l.trim() === '') {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') cleaned.push('')
    } else {
      cleaned.push(l)
    }
  }
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop()

  const headings = cleaned.filter(l => /^#{1,6}\s*\S/.test(l))

  if (headings.length >= 2) {
    const VISIBLE = 8
    const faded = headings.length > VISIBLE
    return {
      empty: false,
      mode: 'outline',
      lines: headings.slice(0, VISIBLE).map(parsePreviewLine),
      faded,
      totalLines: cleaned.filter(l => l.trim()).length,
    }
  }

  const VISIBLE = 7
  const faded = cleaned.length > VISIBLE
  return {
    empty: false,
    mode: 'prose',
    lines: cleaned.slice(0, VISIBLE).map(parsePreviewLine),
    faded,
    totalLines: allLines.length,
  }
}

function fmtDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() === now.getFullYear()
    ? `${mm}.${dd}`
    : `${d.getFullYear()}.${mm}.${dd}`
}

// ── 포스트잇 레이아웃 ────────────────────────────────────────────────────────
interface PlacedNote {
  note: Memo
  left: number
  top: number
  noteW: number
  noteH: number
  rot: number
  row: number
  palette: PaperColor
  deco: 'tape-single' | 'tape-double' | 'pin'
  tapeColor: string
}

const TAPE_COLORS = [
  'rgba(245,235,180,0.65)',
  'rgba(180,210,235,0.60)',
  'rgba(230,200,210,0.60)',
  'rgba(210,220,180,0.60)',
  'rgba(220,210,235,0.60)',
]

function pinColorFor(hex: string): string {
  // 종이 배경의 채도 높인 버전을 핀 색으로
  return hex.replace(/^#/, '') ? hex : '#c44'
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
type ColorMode = 'pastel' | 'theme'

interface EditingState {
  id: number | null
  title: string
  body: string
  isNew: boolean
}

export default function MemoPage() {
  const [notes, setNotes] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)
  const [colorMode, setColorMode] = useState<ColorMode>('pastel')
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Memo | null>(null)
  const [accentRgb, setAccentRgb] = useState('26 158 255')
  const [scheme, setScheme] = useState<'light' | 'dark'>('light')

  // accent 색 + 다크모드 감지
  useEffect(() => {
    function read() {
      const style = getComputedStyle(document.documentElement)
      const rgb = style.getPropertyValue('--c-accent-rgb').trim()
      if (rgb) setAccentRgb(rgb)
      setScheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    }
    read()
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-season'] })
    return () => mo.disconnect()
  }, [])

  // 초기 데이터 로드
  useEffect(() => {
    Promise.all([
      memoApi.list(),
      settingsApi.get().then(r => r.data),
    ]).then(([memos, settings]) => {
      setNotes(memos)
      if (settings?.memo_color_mode) setColorMode(settings.memo_color_mode as ColorMode)
    }).catch(() => {
      memoApi.list().then(setNotes)
    }).finally(() => setLoading(false))
  }, [])

  // 팔레트 계산
  const palette = useMemo<PaperColor[]>(() => {
    if (colorMode === 'pastel') return PASTEL_PALETTE[scheme]
    return memoPaperPalette(accentRgb, scheme)
  }, [colorMode, accentRgb, scheme])

  // CRUD
  function openNew() {
    setEditing({ id: null, title: '', body: '', isNew: true })
  }
  function openEdit(n: Memo) {
    setEditing({ id: n.id, title: n.title, body: n.body ?? '', isNew: false })
  }

  async function commit(): Promise<boolean> {
    if (!editing) return false
    const title = editing.title.trim()
    // 제목 없으면: 새 메모는 그냥 닫기, 기존 메모는 흔들림으로 알림
    if (!title) {
      if (editing.isNew) {
        setEditing(null)
        return true
      }
      const el = document.getElementById('memo-title-input') as HTMLInputElement | null
      if (el) {
        el.classList.remove('memo-shake')
        void el.offsetWidth
        el.classList.add('memo-shake')
        el.focus()
      }
      return false
    }
    try {
      if (editing.isNew) {
        const created = await memoApi.create({ title, body: editing.body })
        setNotes(prev => [created, ...prev])
      } else if (editing.id != null) {
        const updated = await memoApi.update(editing.id, { title, body: editing.body })
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
      }
      setEditing(null)
      return true
    } catch {
      return false
    }
  }

  async function remove(id: number) {
    await memoApi.delete(id)
    setNotes(prev => prev.filter(n => n.id !== id))
    setConfirmDelete(null)
  }

  // 키보드 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'n' && !editing && document.activeElement === document.body) {
        e.preventDefault()
        openNew()
      } else if (e.key === 'Escape' && editing) {
        e.preventDefault()
        commit()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's' && editing) {
        e.preventDefault()
        commit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  return (
    <div className="relative min-h-screen pb-24">
      <MemoTopBar count={notes.length} />

      {loading ? (
        <div className="flex items-center justify-center py-32 text-ink-4 text-sm">
          불러오는 중…
        </div>
      ) : notes.length === 0 ? (
        <EmptyWall onAdd={openNew} />
      ) : (
        <MemoWall
          notes={notes}
          palette={palette}
          onOpen={openEdit}
          onAskDelete={setConfirmDelete}
        />
      )}

      <MemoFAB onClick={openNew} />

      {editing && (
        <EditorModal
          editing={editing}
          setEditing={setEditing}
          onCloseSave={commit}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          note={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => remove(confirmDelete.id)}
        />
      )}
    </div>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────
function MemoTopBar({ count }: { count: number }) {
  return (
    <PageTitle
      sub="ideas"
      title="Memo"
      subtitle={`${count} note${count !== 1 ? 's' : ''} on the wall`}
    />
  )
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────
function EmptyWall({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-4">
      <div className="text-5xl opacity-30 select-none">📌</div>
      <p className="text-ink-4 text-sm">
        아직 메모가 없어요. 아이디어를 붙여보세요!
      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity"
      >
        첫 메모 추가 +
      </button>
    </div>
  )
}

// ── Wall ──────────────────────────────────────────────────────────────────────
function MemoWall({ notes, palette, onOpen, onAskDelete }: {
  notes: Memo[]
  palette: PaperColor[]
  onOpen: (n: Memo) => void
  onAskDelete: (n: Memo) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ cols: 4, cellW: 260, width: 1200 })

  useEffect(() => {
    function measure() {
      const el = wrapRef.current
      if (!el) return
      const w = el.clientWidth
      const cols = Math.max(2, Math.min(6, Math.floor(w / 250)))
      const cellW = Math.floor(w / cols)
      setLayout({ cols, cellW, width: w })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const placed = useMemo<PlacedNote[]>(() => {
    return notes.map((n, i) => {
      const col = i % layout.cols
      const row = Math.floor(i / layout.cols)
      const r1 = hashRand(n.id, 1)
      const r2 = hashRand(n.id, 2)
      const r3 = hashRand(n.id, 3)
      const r4 = hashRand(n.id, 4)
      const r5 = hashRand(n.id, 5)

      // 노트 크기 — 셀 폭 기반 파생 (잘림 방지)
      const noteW = Math.round(Math.max(150, Math.min(248, layout.cellW * 0.82)) + r1 * 24)
      const noteH = noteW + Math.round(r2 * 48)

      const jitterX = (r3 - 0.5) * Math.max(20, layout.cellW - noteW + 40)
      const jitterY = (r4 - 0.5) * 8  // ±4px (타이틀 가림 최소화)
      const rot = (r5 - 0.5) * 12 // ±6°

      // 황금비 기반 색상 배분 — 연속 ID에서도 색상 다양성 보장
      const GOLDEN_R = 0.6180339887498949
      const colorBase = (n.id * GOLDEN_R) % 1
      const colorJitter = hashRand(n.id, 6) * 0.06
      const paperColor = pickPaperColor(palette, (colorBase + colorJitter) % 1)

      const decoVal = r1
      const deco: PlacedNote['deco'] = decoVal > 0.66 ? 'pin' : decoVal > 0.33 ? 'tape-double' : 'tape-single'
      const tapeColor = TAPE_COLORS[Math.floor(r2 * TAPE_COLORS.length)]

      const ROW_PITCH = 240 // 행 간격 — jitterY ±4 기준 타이틀 안가림
      const left = col * layout.cellW + (layout.cellW - noteW) / 2 + jitterX
      const top = row * ROW_PITCH + jitterY + 12

      return { note: n, left, top, noteW, noteH, rot, row, palette: paperColor, deco, tapeColor }
    })
  }, [notes, layout, palette])

  const totalRows = Math.ceil(notes.length / layout.cols)
  const wallHeight = Math.max(480, totalRows * 240 + 120)

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: wallHeight }}>
      {placed.map(p => (
        <StickyNote
          key={p.note.id}
          placed={p}
          onOpen={() => onOpen(p.note)}
          onDelete={() => onAskDelete(p.note)}
        />
      ))}
    </div>
  )
}

// ── StickyNote ────────────────────────────────────────────────────────────────
function StickyNote({ placed, onOpen, onDelete }: {
  placed: PlacedNote
  onOpen: () => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  const { note, left, top, noteW, noteH, rot, row, palette, deco, tapeColor } = placed
  const summary = useMemo(() => summarizeBody(note.body ?? ''), [note.body])

  // 나중 행이 높은 z-index → 이전 행 하단을 가리되 자신의 제목은 항상 노출
  const baseZ = row * 4 + 10 + Math.round(Math.abs(rot))

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        position: 'absolute',
        left,
        top,
        width: noteW,
        height: noteH,
        transform: `rotate(${rot}deg)${hover ? ' translateY(-5px) scale(1.03)' : ''}`,
        transformOrigin: '50% 0%',
        transition: 'transform 220ms cubic-bezier(.2,.7,.2,1), box-shadow 200ms ease',
        zIndex: hover ? 500 : baseZ,
        cursor: 'pointer',
        willChange: 'transform',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden' as const,
      }}
    >
      {/* 종이 본체 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: palette.bg,
          color: palette.ink,
          padding: '16px 14px 14px',
          borderRadius: 2,
          boxShadow: hover
            ? `0 18px 28px rgba(0,0,0,0.28), 0 4px 8px rgba(0,0,0,0.18), inset 0 0 0 0.5px ${palette.edge}88`
            : `0 6px 14px rgba(0,0,0,0.14), 0 2px 4px rgba(0,0,0,0.08), inset 0 0 0 0.5px ${palette.edge}66`,
          overflow: 'hidden',
          backgroundImage: `
            radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 50%),
            radial-gradient(80% 60% at 100% 100%, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0) 60%)`,
          transition: 'box-shadow 200ms ease',
          transform: 'translateZ(0)',
          textRendering: 'optimizeLegibility' as const,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale' as const,
        }}
      >
        {/* 삭제 버튼 (hover 시 표시) */}
        <button
          aria-label="메모 삭제"
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(0,0,0,0.25)', color: '#fff',
            border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, lineHeight: 1,
            opacity: hover ? 1 : 0,
            transform: hover ? 'scale(1)' : 'scale(0.6)',
            transition: 'opacity 150ms ease, transform 150ms ease',
          }}
        >×</button>

        {/* 제목 */}
        <div style={{
          fontWeight: 700,
          fontSize: summary.empty ? 18 : 15,
          lineHeight: 1.22,
          letterSpacing: '-0.01em',
          marginBottom: summary.empty ? 0 : 8,
          wordBreak: 'keep-all',
          paddingRight: 20,
          color: palette.ink,
        }}>
          {note.title}
        </div>

        {/* 본문 프리뷰 */}
        <div style={{
          position: 'absolute',
          left: 14, right: 14,
          top: summary.empty ? '50%' : 46,
          bottom: 26,
          overflow: 'hidden',
        }}>
          {!summary.empty && (
            <ProsePreview
              lines={summary.lines}
              ink={palette.ink}
              small={false}
              faded={summary.faded}
            />
          )}
        </div>

        {/* 하단 메타 */}
        <div style={{
          position: 'absolute', left: 14, right: 14, bottom: 8,
          display: 'flex', justifyContent: 'space-between',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9, letterSpacing: '0.06em',
          color: palette.ink, opacity: 0.5, textTransform: 'uppercase',
        }}>
          <span>{fmtDate(note.updated_at)}</span>
          <span>
            {summary.empty
              ? '— empty —'
              : summary.mode === 'outline'
                ? `${summary.lines.length} sec`
                : `${summary.totalLines} ln`}
          </span>
        </div>

        {/* dog-ear (우하단 접힘) */}
        <div aria-hidden="true" style={{
          position: 'absolute', right: 0, bottom: 0,
          width: 16, height: 16,
          background: `linear-gradient(135deg, transparent 50%, ${palette.edge}55 50%)`,
        }} />
      </div>

      {/* 테이프 / 핀 */}
      {deco === 'tape-single' && (
        <div style={{
          position: 'absolute', height: 18, borderRadius: 1,
          top: -10, left: noteW * 0.5 - 26, width: 52,
          background: tapeColor,
          transform: 'rotate(-4deg)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.14)',
        }} />
      )}
      {deco === 'tape-double' && (
        <>
          <div style={{
            position: 'absolute', height: 18, borderRadius: 1,
            top: -8, left: 6, width: 42,
            background: tapeColor, transform: 'rotate(-12deg)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.14)',
          }} />
          <div style={{
            position: 'absolute', height: 18, borderRadius: 1,
            top: -10, left: noteW - 50, width: 42,
            background: tapeColor, transform: 'rotate(9deg)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.14)',
          }} />
        </>
      )}
      {deco === 'pin' && (
        <div style={{
          position: 'absolute', top: -5, left: noteW * 0.5 - 6,
          width: 12, height: 12, borderRadius: '50%',
          background: pinColorFor(palette.edge),
          boxShadow: 'inset -2px -2px 3px rgba(0,0,0,0.3), inset 2px 2px 3px rgba(255,255,255,0.4), 0 3px 4px rgba(0,0,0,0.3)',
        }} />
      )}
    </div>
  )
}

// ── 프리뷰 서브 컴포넌트 ─────────────────────────────────────────────────────
// outline/prose 모두 동일한 PreviewLine 렌더러로 통합
function NotePreviewLines({ lines, ink, small, faded }: {
  lines: PreviewLine[]
  ink: string
  small: boolean
  faded: boolean
}) {
  return (
    <div style={{
      fontFamily: 'inherit', fontSize: small ? 13 : 12.5, lineHeight: 1.55, color: ink,
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale' as const,
      WebkitMaskImage: faded
        ? 'linear-gradient(180deg, #000 0%, #000 55%, rgba(0,0,0,0.2) 90%, transparent 100%)'
        : 'none',
      maskImage: faded
        ? 'linear-gradient(180deg, #000 0%, #000 55%, rgba(0,0,0,0.2) 90%, transparent 100%)'
        : 'none',
    }}>
      {lines.map((ln, i) => {
        if (ln.kind === 'gap') return <div key={i} style={{ height: 3 }} />
        if (ln.kind === 'heading') {
          const isH1 = ln.level === 1
          const isH2 = ln.level === 2
          const indent = Math.max(0, (ln.level - 2) * 10)
          return (
            <div key={i} style={{
              fontWeight: ln.level <= 3 ? 700 : 600,
              fontSize: isH1 ? 14 : isH2 ? 13 : 12,
              color: ink,
              opacity: isH2 ? 1 : 0.85,
              marginTop: i === 0 ? 0 : (ln.level <= 2 ? 5 : 2),
              marginBottom: 1,
              paddingLeft: indent,
              wordBreak: 'keep-all',
              borderLeft: ln.level >= 3 ? `2px solid ${ink}44` : 'none',
              paddingRight: 2,
            }}>
              {ln.text}
            </div>
          )
        }
        if (ln.kind === 'bullet') return (
          <div key={i} style={{ display: 'flex', gap: 5, opacity: 0.92, paddingLeft: 2 }}>
            <span style={{ flexShrink: 0, fontSize: 11, lineHeight: '1.65', opacity: 0.7 }}>•</span>
            <span style={{ overflow: 'hidden', wordBreak: 'keep-all' }}>{ln.text}</span>
          </div>
        )
        if (ln.kind === 'numbered') return (
          <div key={i} style={{ display: 'flex', gap: 5, opacity: 0.92, paddingLeft: 2 }}>
            <span style={{ flexShrink: 0, opacity: 0.65 }}>{ln.n}.</span>
            <span style={{ overflow: 'hidden' }}>{ln.text}</span>
          </div>
        )
        if (ln.kind === 'quote') return (
          <div key={i} style={{
            paddingLeft: 6, opacity: 0.82, fontStyle: 'italic',
            borderLeft: `2px solid ${ink}66`,
          }}>{ln.text}</div>
        )
        return <div key={i} style={{ opacity: 0.90, wordBreak: 'keep-all' }}>{ln.text}</div>
      })}
    </div>
  )
}


function ProsePreview({ lines, ink, small, faded }: {
  lines: PreviewLine[]
  ink: string
  small: boolean
  faded?: boolean
}) {
  return <NotePreviewLines lines={lines} ink={ink} small={small} faded={!!faded} />
}

// ── FAB ───────────────────────────────────────────────────────────────────────
function MemoFAB({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="새 메모 추가"
      style={{
        position: 'fixed', right: 76, bottom: 28,
        height: 52, padding: '0 22px 0 16px', borderRadius: 999,
        background: 'var(--fab-bg, #1a1a1a)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: hover
          ? '0 14px 32px rgba(0,0,0,0.3), 0 3px 8px rgba(0,0,0,0.2)'
          : '0 8px 20px rgba(0,0,0,0.22), 0 2px 5px rgba(0,0,0,0.14)',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
        zIndex: 800,
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
      }}
      className="dark:bg-zinc-800 dark:border-ink-4"
    >
      <span style={{
        width: 22, height: 22, borderRadius: 999,
        background: 'rgb(var(--c-accent-rgb))',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17, lineHeight: 1,
      }}>+</span>
      <span>새 메모</span>
    </button>
  )
}

// ── 편집 모달 ─────────────────────────────────────────────────────────────────
type EditorTab = 'write' | 'guide' | 'preview'

function EditorModal({ editing, setEditing, onCloseSave }: {
  editing: EditingState
  setEditing: (e: EditingState) => void
  onCloseSave: () => Promise<boolean>
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  // 신규: 작성 탭 먼저 / 기존: 미리보기 탭 먼저
  const [tab, setTab] = useState<EditorTab>(editing.isNew ? 'write' : 'preview')
  const titleEmpty = !editing.title.trim()

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 50)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function insertTemplate(build: () => string) {
    const tmpl = build()
    setEditing({ ...editing, body: editing.body ? editing.body + '\n\n' + tmpl : tmpl })
    setTab('write')
  }

  const previewHtml = useMemo(() => {
    if (!editing.body.trim()) return ''
    return marked.parse(editing.body, { async: false }) as string
  }, [editing.body])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center"
      style={{
        background: 'var(--overlay-bg)',
        backdropFilter: 'var(--overlay-filter)',
        WebkitBackdropFilter: 'var(--overlay-filter)',
        padding: '2vh 16px 16px',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCloseSave() }}
    >
      <div
        className="w-full panel-surface border rounded-2xl shadow-2xl flex flex-col"
        style={{ maxWidth: 860, maxHeight: '96vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 상단 바 */}
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--divide)]">
          <span className="font-mono text-[11px] tracking-widest uppercase text-ink-4">
            memo / <span className="text-ink-1">{editing.isNew ? 'new' : 'edit'}</span>
          </span>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[11px] tracking-wide ${titleEmpty ? 'text-warning' : 'text-success'}`}>
              {titleEmpty
                ? (editing.isNew ? '● 제목 없이 닫으면 버림' : '● 제목 필수')
                : '● 닫으면 저장'}
            </span>
            <button
              onClick={onCloseSave}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                titleEmpty
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-ink-4 border border-ink-5'
                  : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}
            >
              <span>✓</span> 닫기 &amp; 저장
            </button>
          </div>
        </div>

        {/* 제목 */}
        <div className="px-5 pt-3">
          <input
            id="memo-title-input"
            ref={titleRef}
            value={editing.title}
            onChange={e => setEditing({ ...editing, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setTab('write') } }}
            placeholder="제목 (필수)"
            className="w-full bg-transparent border-b border-[var(--line)] outline-none text-2xl font-bold tracking-tight pb-2 mb-1 text-ink-0 placeholder:text-ink-5"
          />
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-0 px-5 border-b border-[var(--divide)]">
          {(['write', 'preview', 'guide'] as EditorTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-ink-0 text-ink-0'
                  : 'border-transparent text-ink-4 hover:text-ink-2'
              }`}
            >
              {t === 'write' ? '작성' : t === 'preview' ? '미리보기' : '입력 가이드'}
            </button>
          ))}
          <div className="flex-1" />
          {tab === 'write' && (
            <span className="font-mono text-[11px] text-ink-4 pr-1">
              {editing.body.length.toLocaleString()} chars
            </span>
          )}
        </div>

        {/* 탭 바디 */}
        <div className="flex-1 overflow-hidden flex flex-col px-5 py-3" style={{ minHeight: 400 }}>
          {tab === 'write' && (
            <textarea
              value={editing.body}
              onChange={e => setEditing({ ...editing, body: e.target.value })}
              placeholder={'마크다운으로 작성하세요.\n「입력 가이드」 탭에서 명세서용 템플릿을 삽입할 수 있어요.\n\n## 목적 / 배경\n\n## 화면 구성\n'}
              className="flex-1 w-full bg-zinc-50 dark:bg-zinc-900 border border-ink-5 rounded-xl text-ink-0 p-4 outline-none resize-y font-mono text-sm leading-relaxed"
              style={{ minHeight: 380 }}
              spellCheck={false}
            />
          )}
          {tab === 'guide' && (
            <GuideTab onInsert={insertTemplate} />
          )}
          {tab === 'preview' && (
            <div className="flex-1 overflow-y-auto memo-md-preview" style={{ minHeight: 380 }}>
              {editing.body.trim()
                ? <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                : <p className="text-ink-4 italic text-sm">(미리볼 내용이 없습니다)</p>
              }
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-[var(--divide)] text-xs text-ink-4 font-mono">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded border border-ink-5 bg-zinc-50 dark:bg-zinc-800 text-[10px]">Esc</kbd>
            저장 ·
            <kbd className="px-1.5 py-0.5 rounded border border-ink-5 bg-zinc-50 dark:bg-zinc-800 text-[10px]">⌘S</kbd>
            저장
          </span>
          <span>{editing.isNew ? 'new note' : 'editing'}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── 입력 가이드 탭 ────────────────────────────────────────────────────────────
function GuideTab({ onInsert }: { onInsert: (build: () => string) => void }) {
  return (
    <div className="flex flex-col gap-5 overflow-y-auto" style={{ minHeight: 380 }}>
      {/* 템플릿 삽입 */}
      <div>
        <p className="text-[11px] font-semibold text-ink-4 uppercase tracking-wider mb-2.5">
          템플릿 삽입
        </p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => onInsert(t.build)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm border border-ink-5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-ink-5 transition-colors"
            >
              <span className="text-base leading-none">{t.emoji}</span>
              <span className="font-semibold text-ink-1">{t.label}</span>
              <span className="text-[11px] text-ink-4 font-mono">↵</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-4 mt-2">
          클릭하면 현재 본문에 삽입됩니다. 명세서 항목을 채워두면 <strong className="text-ink-2">「○○ 명세서 만들어줘」</strong> AI 호출 시 컨텍스트로 활용됩니다.
        </p>
      </div>

      {/* 마크다운 문법 가이드 */}
      <div className="border-t border-[var(--divide)] pt-4">
        <p className="text-[11px] font-semibold text-ink-4 uppercase tracking-wider mb-3">
          마크다운 문법
        </p>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <GuideBlock title="제목" items={[
            ['# 제목1', '가장 큰 제목'],
            ['## 제목2', '섹션 제목'],
            ['### 제목3', '하위 섹션'],
          ]} />
          <GuideBlock title="강조" items={[
            ['**굵게**', '볼드'],
            ['*기울임꼴*', '이탤릭'],
            ['~~취소선~~', '취소선'],
            ['<u>밑줄</u>', 'HTML 밑줄'],
          ]} />
          <GuideBlock title="목록 (들여쓰기 2칸씩)" items={[
            ['- 항목', '1단계'],
            ['  - 하위', '2단계 (스페이스 2개)'],
            ['    - 하위하위', '3단계 (스페이스 4개)'],
            ['1. 번호', '번호 목록'],
            ['- [ ] 할 일', '체크박스'],
          ]} />
          <GuideBlock title="인용 / 구분선" items={[
            ['> 인용문', '인용 블록'],
            ['---', '수평 구분선'],
          ]} />
          <GuideBlock title="코드" items={[
            ['`인라인 코드`', '짧은 코드'],
            ['```\n코드 블록\n```', '여러 줄 코드'],
          ]} />
          <GuideBlock title="기타" items={[
            ['[텍스트](URL)', '링크'],
            ['![alt](이미지URL)', '이미지'],
          ]} />
        </div>
      </div>
    </div>
  )
}

function GuideBlock({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="rounded-xl surface border border-ink-5 overflow-hidden">
      <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-[var(--divide)]">
        <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">{title}</span>
      </div>
      <div className="divide-y divide-[var(--divide)]">
        {items.map(([code, desc], i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-1.5">
            <code className="text-[11px] font-mono text-ink-1 bg-zinc-50 dark:bg-zinc-800 px-1.5 py-0.5 rounded whitespace-pre shrink-0">{code}</code>
            <span className="text-[11px] text-ink-4">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 삭제 확인 모달 ─────────────────────────────────────────────────────────────
function ConfirmDeleteModal({ note, onCancel, onConfirm }: {
  note: Memo
  onCancel: () => void
  onConfirm: () => void
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{
        background: 'var(--overlay-bg)',
        backdropFilter: 'var(--overlay-filter)',
        WebkitBackdropFilter: 'var(--overlay-filter)',
        padding: '0 16px',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="w-full max-w-sm panel-surface border rounded-2xl shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <p className="font-mono text-[11px] tracking-widest uppercase text-ink-4 mb-3">
          memo / <span className="text-red-500">delete</span>
        </p>
        <p className="text-lg font-semibold mb-1 text-ink-0">이 메모를 삭제할까요?</p>
        <p className="text-sm text-ink-3 mb-5">
          "<span className="font-semibold text-ink-0">{note.title}</span>" — 삭제하면 되돌릴 수 없어요.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border border-ink-5 text-ink-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            삭제
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
