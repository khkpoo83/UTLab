import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, RefreshCw, GripVertical } from 'lucide-react'
import PageTitle from '../components/PageTitle'
import Button from '../components/Button'
import ToggleChip from '../components/ToggleChip'
import ProgressBar from '../components/ProgressBar'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableItem } from '../components/SortableItem'
import { newsApi, NewsItem, NewsList } from '../api/client'
import Skeleton from '../components/Skeleton'
import { Card, fmtUpdated } from '../components/Card'

interface NewsModalProps {
  group: NewsGroup
  onClose: () => void
}

function NewsModal({ group, onClose }: NewsModalProps) {
  const item = group.representative
  const isPending = item.status === 'pending' || item.status === 'summarizing'
  const sources = [...new Set(group.articles.map((a) => a.source).filter(Boolean))]
  const [previewOpen, setPreviewOpen] = useState(false)

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-3 py-4"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl panel-surface border rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start gap-3 p-5 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {item.sector && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-md font-medium">
                  {item.sector}
                </span>
              )}
              {isPending ? (
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-500 rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  분석 중
                </span>
              ) : item.summary ? (
                <span className="tag tag-tonal font-medium">
                  ✓ 분석완료
                </span>
              ) : null}
              {group.count > 1 && (
                <span className="px-2 py-0.5 text-xs bg-accent/10 text-accent rounded-md font-medium">
                  {group.count}건 관련기사
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              {item.title}
            </h2>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400">
              <span>{sources.join(' · ')}</span>
              {item.published_at && <span>· {formatTime(item.published_at)}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="닫기 (ESC)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* AI 요약 */}
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-4">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">AI 요약</p>
            {isPending ? (
              <div className="space-y-2">
                <div className="text-sm text-zinc-400 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  분석 중입니다...
                </div>
                <Skeleton lines={3} className="h-3.5" />
              </div>
            ) : item.summary ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{item.summary}</p>
            ) : (
              <p className="text-sm text-zinc-400">AI 요약이 없습니다.</p>
            )}
          </div>

          {/* 관련 종목 */}
          {item.related_stocks && item.related_stocks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">관련 종목</p>
              <div className="flex flex-wrap gap-1.5">
                {item.related_stocks.map((s) => (
                  <span key={s} className="text-sm px-2.5 py-1 bg-accent/10 text-accent rounded-lg font-medium">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 관련 기사 목록 */}
          {group.articles.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                관련 기사 ({group.articles.length}건)
              </p>
              <div className="space-y-1.5">
                {group.articles.map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                  >
                    <span className="flex-shrink-0 text-xs text-zinc-400 pt-0.5 w-16 truncate">{a.source}</span>
                    <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-accent leading-snug line-clamp-2">
                      {a.title}
                    </span>
                    <svg className="flex-shrink-0 w-3.5 h-3.5 text-zinc-300 group-hover:text-accent mt-0.5 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 페이지 미리보기 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">페이지 미리보기</p>
              <button
                onClick={() => setPreviewOpen((v) => !v)}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 hover:border-zinc-400 transition-colors"
              >
                {previewOpen ? '접기' : '열기'}
              </button>
            </div>
            {previewOpen && (
              <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
                <iframe
                  src={item.url}
                  className="w-full h-[420px]"
                  title="기사 미리보기"
                  sandbox="allow-scripts allow-same-origin"
                />
                <div className="px-3 py-2 text-xs text-zinc-400 border-t border-zinc-200 dark:border-zinc-700">
                  일부 사이트는 미리보기가 제한될 수 있습니다.
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:underline">새 탭에서 열기 →</a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 rounded-b-2xl">
          <span className="text-xs text-zinc-400">ESC 키로 닫기</span>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 bg-accent text-white rounded-lg hover:opacity-85 active:scale-95 transition-all"
          >
            원문 보기
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

const SECTORS = [
  'IT/반도체', '금융', '에너지', '바이오/헬스케어',
  '소비재', '산업재', '통신', '유틸리티', '부동산', '소재',
]

interface NewsGroup {
  id: string
  representative: NewsItem
  articles: NewsItem[]
  count: number
}

interface QueueStatus {
  queue_size: number
  worker_running: boolean
  pending: number
  summarizing: number
  done: number
}

function normalizeTitle(title: string): string {
  // [속보], [단독], [긴급], [종합] 등 접두 태그 반복 제거
  let t = title
  const prefixRe = /^\s*\[[^\]]{1,10}\]\s*/
  while (prefixRe.test(t)) t = t.replace(prefixRe, '')
  return t.replace(/[^\w가-힣]/g, '').toLowerCase()
}

function titleSimilarity(a: string, b: string): number {
  // Dice coefficient (bigram)
  const bigrams = (s: string) => {
    const set: string[] = []
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2))
    return set
  }
  const ba = bigrams(a)
  const bb = bigrams(b)
  if (ba.length === 0 || bb.length === 0) return 0
  const setB = new Map<string, number>()
  bb.forEach((g) => setB.set(g, (setB.get(g) ?? 0) + 1))
  let matches = 0
  ba.forEach((g) => {
    const cnt = setB.get(g) ?? 0
    if (cnt > 0) { matches++; setB.set(g, cnt - 1) }
  })
  return (2 * matches) / (ba.length + bb.length)
}

function groupNewsItems(items: NewsItem[]): NewsGroup[] {
  // Step 1: 백엔드 group_id 기준 그룹화
  const groupMap = new Map<string, NewsItem[]>()
  for (const item of items) {
    const key = item.group_id ?? `solo-${item.id}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(item)
  }

  // Step 2: 그룹 대표 기사 선정
  const groups: NewsGroup[] = []
  groupMap.forEach((articles, key) => {
    const representative =
      articles.find((a) => a.status === 'done' && a.summary) ??
      articles.find((a) => a.status === 'done') ??
      articles[0]
    groups.push({ id: key, representative, articles, count: articles.length })
  })

  // Step 3: 프론트엔드 추가 그룹핑 (solo 그룹끼리 제목 유사도 0.5+ 이면 병합)
  const merged = new Map<string, number>() // groupId → 병합된 대표 인덱스
  for (let i = 0; i < groups.length; i++) {
    if (merged.has(groups[i].id)) continue
    const normI = normalizeTitle(groups[i].representative.title)
    for (let j = i + 1; j < groups.length; j++) {
      if (merged.has(groups[j].id)) continue
      const normJ = normalizeTitle(groups[j].representative.title)
      // 앞 15자 일치 또는 유사도 0.5+
      const prefix = Math.min(15, normI.length, normJ.length)
      const prefixMatch = prefix >= 8 && normI.slice(0, prefix) === normJ.slice(0, prefix)
      const sim = prefixMatch ? 1 : titleSimilarity(normI, normJ)
      if (prefixMatch || sim >= 0.5) {
        merged.set(groups[j].id, i)
        // j 그룹의 기사를 i에 병합
        groups[i].articles.push(...groups[j].articles)
        groups[i].count = groups[i].articles.length
        // 더 좋은 대표 기사 선택
        const better =
          groups[i].articles.find((a) => a.status === 'done' && a.summary) ??
          groups[i].articles.find((a) => a.status === 'done') ??
          groups[i].articles[0]
        groups[i].representative = better
      }
    }
  }

  return groups.filter((g) => !merged.has(g.id)).sort((a, b) => b.count - a.count)
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 60) return `${diffMin}분 전`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}시간 전`
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
}

// 토픽 키워드 패턴 (우선순위 순) - 색상 제거, 모노크롬
const TOPIC_PATTERNS: { topic: string; keywords: RegExp }[] = [
  { topic: '중동/전쟁', keywords: /이란|이스라엘|가자|하마스|헤즈볼라|후티|레바논|시리아|우크라이나|러시아|전쟁|분쟁|테러/ },
  { topic: '미중관계', keywords: /미중|중국|무역전쟁|관세|트럼프|바이든|시진핑|미국.*중국|중국.*미국/ },
  { topic: '반도체', keywords: /반도체|메모리|HBM|D램|낸드|파운드리|엔비디아|TSMC|인텔|삼성전자.*반도체|SK하이닉스/ },
  { topic: '금리/환율', keywords: /금리|기준금리|연준|Fed|FOMC|환율|달러|원달러|금통위|통화정책/ },
  { topic: 'AI/테크', keywords: /인공지능 .*(투자|산업|기술|시장|혁신)|빅테크|오픈AI|클로드|챗GPT|ChatGPT|LLM|딥러닝|AI (반도체|칩|모델|서버|데이터센터)/ },
  { topic: '배터리/EV', keywords: /배터리|전기차|EV|LFP|양극재|음극재|에코프로|포스코|리튬/ },
  { topic: '바이오/제약', keywords: /바이오|임상|신약|FDA|항암|유한양행|셀트리온|제약|의약품|임상시험/ },
  { topic: '금융/증시', keywords: /증시|코스피|코스닥|나스닥|S&P|다우|주가지수|펀드|ETF(?!관련)|IPO|상장/ },
  { topic: '부동산/건설', keywords: /부동산|아파트|분양|건설|재건축|재개발|주택|청약/ },
  { topic: '자동차', keywords: /현대차|기아차|자동차|완성차|수출.*차|차량/ },
]

function detectTopic(title: string): string | null {
  for (const p of TOPIC_PATTERNS) {
    if (p.keywords.test(title)) return p.topic
  }
  return null
}

interface SuperGroup {
  topic: string
  groups: NewsGroup[]
  totalCount: number
}

function buildSuperGroups(groups: NewsGroup[]): SuperGroup[] {
  const topicMap = new Map<string, NewsGroup[]>()
  const noTopic: NewsGroup[] = []

  for (const g of groups) {
    const topic = detectTopic(g.representative.title)
    if (topic) {
      if (!topicMap.has(topic)) topicMap.set(topic, [])
      topicMap.get(topic)!.push(g)
    } else {
      noTopic.push(g)
    }
  }

  const superGroups: SuperGroup[] = []

  // 토픽별 슈퍼그룹 (패턴 순서 유지)
  TOPIC_PATTERNS.forEach(({ topic }) => {
    const gs = topicMap.get(topic)
    if (gs && gs.length > 0) {
      // 같은 토픽 내 group들을 count 기준 정렬 후 count 합산
      const sorted = gs.sort((a, b) => b.count - a.count)
      superGroups.push({
        topic,
        groups: sorted,
        totalCount: sorted.reduce((s, g) => s + g.count, 0),
      })
    }
  })

  // 토픽 미분류 → 섹터 검증 후 묶기
  if (noTopic.length > 0) {
    const SECTOR_VALIDATE: Record<string, RegExp> = {
      'IT/반도체': /반도체|IT|소프트웨어|플랫폼|인터넷|게임|클라우드|데이터센터|디스플레이/,
      '금융': /금융|은행|증권|보험|카드|대출|금리|투자|펀드|채권|자산/,
      '에너지': /에너지|정유|석유|가스|화학|전력|LNG/,
      '바이오/헬스케어': /바이오|의약|제약|헬스|병원|임상|치료제|백신/,
      '소비재': /소비|유통|음식|식품|의류|화장품|브랜드|백화점|마트/,
      '산업재': /산업|기계|조선|항공|철도|물류|포워딩/,
      '통신': /통신|이동통신|SK텔레콤|KT|LG유플러스/,
      '부동산': /부동산|아파트|건설|분양|청약|주택|재건축/,
      '자동차': /자동차|현대차|기아|전기차|자율주행/,
      '소재': /소재|철강|비철|알루미늄|구리|화학소재/,
    }
    const sectorMap = new Map<string, NewsGroup[]>()
    for (const g of noTopic) {
      const rawSector = g.representative.sector ?? '기타'
      const validator = SECTOR_VALIDATE[rawSector]
      // 제목에 해당 섹터 키워드 없으면 기타로 분류
      const sector = (validator && !validator.test(g.representative.title)) ? '기타' : rawSector
      if (!sectorMap.has(sector)) sectorMap.set(sector, [])
      sectorMap.get(sector)!.push(g)
    }
    sectorMap.forEach((gs, sector) => {
      superGroups.push({
        topic: sector,
        groups: gs.sort((a, b) => b.count - a.count),
        totalCount: gs.reduce((s, g) => s + g.count, 0),
      })
    })
  }

  return superGroups.sort((a, b) => b.totalCount - a.totalCount)
}

// Memoized NewsItem card for rendering individual news group blocks
interface NewsBlockCardProps {
  group: NewsGroup
  idx: number
  totalTop: number
  onBlockClick: (g: NewsGroup) => void
}

const NewsBlockCard = React.memo(function NewsBlockCard({ group, idx, totalTop, onBlockClick }: NewsBlockCardProps) {
  const item = group.representative
  const isPending = item.status === 'pending' || item.status === 'summarizing'
  const isFirst = idx === 0
  const flexBasis = isFirst ? '45%' : `${55 / (totalTop - 1)}%`

  return (
    <div
      onClick={() => onBlockClick(group)}
      className={`news-card flex flex-col p-3 cursor-pointer ${idx > 0 ? 'border-l border-zinc-100 dark:border-zinc-800' : ''}`}
      style={{ flexBasis: totalTop === 1 ? '100%' : flexBasis, flexShrink: 0, minWidth: 0 }}
    >
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        {group.count > 1 && (
          <span className="text-2xs font-semibold text-accent">{group.count}건</span>
        )}
        {isPending ? (
          <span className="flex items-center gap-0.5 text-2xs text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />분석중
          </span>
        ) : item.summary ? (
          <span className="text-2xs text-accent font-medium">✓</span>
        ) : null}
      </div>
      <p className={`font-medium text-zinc-900 dark:text-zinc-100 leading-snug ${isFirst ? 'text-sm line-clamp-3' : 'text-xs line-clamp-3'}`}>
        {item.title}
      </p>
      {isFirst && item.summary && !isPending && (
        <p className="text-2xs text-zinc-500 dark:text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">{item.summary}</p>
      )}
      <p className="text-2xs text-zinc-400 mt-auto pt-1.5">{formatTime(item.published_at)}</p>
    </div>
  )
})

// Memoized list row for rest (non-top) news items
interface NewsListRowProps {
  group: NewsGroup
  onBlockClick: (g: NewsGroup) => void
}

const NewsListRow = React.memo(function NewsListRow({ group, onBlockClick }: NewsListRowProps) {
  const item = group.representative
  const isPending = item.status === 'pending' || item.status === 'summarizing'
  return (
    <div
      onClick={() => onBlockClick(group)}
      className="news-card flex items-center gap-2 px-3 py-2 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1 flex-shrink-0">
        {group.count > 1 && (
          <span className="text-2xs font-semibold text-accent">{group.count}건</span>
        )}
        {isPending ? (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
        ) : item.summary ? (
          <span className="text-2xs text-accent">✓</span>
        ) : null}
      </div>
      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-2 flex-1">{item.title}</p>
      <span className="text-2xs text-zinc-400 flex-shrink-0">{formatTime(item.published_at)}</span>
    </div>
  )
})

const TopicSection = React.memo(function TopicSection({ sg, onBlockClick, dragHandle }: { sg: SuperGroup; onBlockClick: (g: NewsGroup) => void; dragHandle?: React.ReactNode }) {
  const MAX_GROUPS = 5
  const TOP_N = 3
  const visibleGroups = sg.groups.slice(0, MAX_GROUPS)
  const topGroups = visibleGroups.slice(0, TOP_N)
  const restGroups = visibleGroups.slice(TOP_N)
  const hiddenCount = sg.groups.length - MAX_GROUPS

  return (
    <Card
      collapsible
      id={`news-topic-${sg.topic}`}
      dragHandle={dragHandle}
      title={sg.topic}
      subtitle={`${sg.totalCount}건`}
      contentClassName=""
    >
      {/* 상위 기사: 가로 flex 블록 */}
      {topGroups.length > 0 && (
        <div className="flex border-b border-zinc-100 dark:border-zinc-800 overflow-hidden">
          {topGroups.map((group, idx) => (
            <NewsBlockCard
              key={group.id}
              group={group}
              idx={idx}
              totalTop={topGroups.length}
              onBlockClick={onBlockClick}
            />
          ))}
        </div>
      )}

      {/* 나머지 기사: 제목 목록 */}
      {restGroups.length > 0 && (
        <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
          {restGroups.map((group) => (
            <NewsListRow key={group.id} group={group} onBlockClick={onBlockClick} />
          ))}
        </div>
      )}

      {/* 숨겨진 그룹 수 표시 */}
      {hiddenCount > 0 && (
        <div className="px-3 py-1.5 text-2xs text-zinc-400 border-t border-zinc-50 dark:border-zinc-800/50">
          +{hiddenCount}개 기사 더 있음
        </div>
      )}
    </Card>
  )
})

function QueueStatusBar({ status }: { status: QueueStatus | null }) {
  if (!status) return null
  const { pending, summarizing, done, queue_size } = status
  const total = pending + summarizing + done
  const progress = total > 0 ? Math.round((done / total) * 100) : 100
  const active = pending + summarizing > 0

  if (!active && done === 0) return null

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 card-surface px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-3 text-2xs text-zinc-500">
          {summarizing > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              분석 중 {summarizing}건
            </span>
          )}
          {pending > 0 && <span className="text-zinc-400">대기 {pending}건</span>}
          <span className="text-zinc-400">완료 {done}건</span>
          {queue_size > 0 && <span className="text-zinc-400 dark:text-zinc-500">큐 {queue_size}</span>}
        </div>
        <span className="text-2xs text-zinc-400">{progress}%</span>
      </div>
      <ProgressBar value={progress} />
    </div>
  )
}


function getDateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

const NEWS_TOPIC_ORDER_KEY = 'news_topic_order'

function applyTopicOrder(groups: SuperGroup[], order: string[]): SuperGroup[] {
  if (!order.length) return groups
  const map = new Map(groups.map(g => [g.topic, g]))
  const ordered = order.filter(t => map.has(t)).map(t => map.get(t)!)
  const rest = groups.filter(g => !order.includes(g.topic))
  return [...ordered, ...rest]
}

const News: React.FC = () => {
  const [newsData, setNewsData] = useState<NewsList | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sectorFilter, setSectorFilter] = useState<string>('')
  const [onlyDone, setOnlyDone] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedDay, setSelectedDay] = useState(0)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<NewsGroup | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [topicOrder, setTopicOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(NEWS_TOPIC_ORDER_KEY) ?? '[]') } catch { return [] }
  })
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const newsSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  const orderedSuperGroupsRef = useRef(orderedSuperGroups)
  orderedSuperGroupsRef.current = orderedSuperGroups

  function handleTopicDragEnd(event: DragEndEvent) {
    setActiveTopicId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const currentTopics = orderedSuperGroupsRef.current.map(g => g.topic)
    const next = arrayMove(currentTopics, currentTopics.indexOf(active.id as string), currentTopics.indexOf(over.id as string))
    localStorage.setItem(NEWS_TOPIC_ORDER_KEY, JSON.stringify(next))
    setTopicOrder(next)
  }

  const loadNews = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const params: { page: number; page_size: number; sector?: string; date?: string } = {
          page,
          page_size: 100,
          date: getDateStr(selectedDay),
        }
        if (sectorFilter) params.sector = sectorFilter
        const { data } = await newsApi.list(params)
        setNewsData(data)
        setLastFetched(new Date())
      } catch {
        // ignore
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [page, sectorFilter, selectedDay]
  )

  const loadQueueStatus = useCallback(async () => {
    try {
      const { data } = await newsApi.queueStatus()
      setQueueStatus(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadNews()
  }, [loadNews])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => loadNews(true), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadNews])

  useEffect(() => {
    loadQueueStatus()
    queuePollRef.current = setInterval(loadQueueStatus, 3000)
    return () => { if (queuePollRef.current) clearInterval(queuePollRef.current) }
  }, [loadQueueStatus])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await newsApi.refresh()
      await loadNews()
      await loadQueueStatus()
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }

  const allGroups = useMemo(() => newsData ? groupNewsItems(newsData.items) : [], [newsData])
  const groups = useMemo(() =>
    onlyDone
      ? allGroups.filter((g) => g.representative.status === 'done' && g.representative.summary)
      : allGroups,
  [allGroups, onlyDone])
  const superGroups = useMemo(() => buildSuperGroups(groups), [groups])
  const orderedSuperGroups = useMemo(() => applyTopicOrder(superGroups, topicOrder), [superGroups, topicOrder])
  const doneCount = useMemo(() => allGroups.filter((g) => g.representative.status === 'done' && g.representative.summary).length, [allGroups])

  return (
    <div className="space-y-3">
      {/* News Detail Modal */}
      {selectedGroup && (
        <NewsModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />
      )}

      <PageTitle sub="market intel" title="News" subtitle={lastFetched ? fmtUpdated(lastFetched) : undefined} />

      {/* Queue Status */}
      <QueueStatusBar status={queueStatus} />

      {/* Header Controls */}
      <div className="space-y-2">
        {/* 날짜 탭 */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((d) => {
            const dateStr = getDateStr(d)
            const label = d === 0 ? '오늘' : d === 1 ? '어제' : '2일 전'
            return (
              <ToggleChip key={d} active={selectedDay === d} size="sm"
                onClick={() => { setSelectedDay(d); setPage(1) }}>
                {label}
                <span className="ml-1 opacity-60 text-2xs">{dateStr.slice(5).replace('-', '/')}</span>
              </ToggleChip>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="text-2xs text-zinc-400 pr-1">뉴스 60분마다 자동갱신</span>
            <ToggleChip pill size="sm" active={!sectorFilter}
              onClick={() => { setSectorFilter(''); setPage(1) }}>전체</ToggleChip>
            {SECTORS.map((s) => (
              <ToggleChip key={s} pill size="sm" active={sectorFilter === s}
                onClick={() => { setSectorFilter(s); setPage(1) }}>{s}</ToggleChip>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 분석완료 필터 토글 */}
            <ToggleChip active={onlyDone} size="md"
              onClick={() => setOnlyDone((v) => !v)}
            >
              {onlyDone ? '✓' : '○'} 분석완료
              {doneCount > 0 && <span className={`ml-0.5 ${onlyDone ? 'opacity-70' : 'text-accent'}`}>{doneCount}</span>}
            </ToggleChip>
            <Button variant="secondary" size="md"
              onClick={handleRefresh} disabled={refreshing}
              icon={<RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />}
            >새로고침</Button>
          </div>
        </div>
      </div>

      {/* 토픽별 섹션 */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
              <div className="h-8 skeleton" />
              <div className="flex">
                <div className="skeleton h-24 flex-1 border-r border-white" />
                <div className="skeleton h-24 flex-1" />
              </div>
            </div>
          ))}
        </div>
      ) : orderedSuperGroups.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-400">
          <p>뉴스가 없습니다.</p>
          <p className="text-xs mt-1 text-zinc-400 dark:text-zinc-500">새로고침 버튼을 눌러 뉴스를 가져오세요.</p>
        </div>
      ) : (
        <DndContext
          sensors={newsSensors}
          collisionDetection={closestCenter}
          onDragStart={e => setActiveTopicId(e.active.id as string)}
          onDragEnd={handleTopicDragEnd}
        >
          <SortableContext items={orderedSuperGroups.map(sg => sg.topic)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {orderedSuperGroups.map((sg) => (
                <SortableItem key={sg.topic} id={sg.topic}>
                  {(dragHandle) => (
                    <TopicSection sg={sg} onBlockClick={setSelectedGroup} dragHandle={dragHandle} />
                  )}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeTopicId && (
              <div className="shadow-xl rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800">
                  <GripVertical size={13} className="text-zinc-300 dark:text-zinc-600" />
                  <Hash size={13} className="text-zinc-400 dark:text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{activeTopicId}</span>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Pagination */}
      {newsData && newsData.total > newsData.page_size && (
        <div className="flex items-center justify-center gap-2 py-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-xs px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 disabled:opacity-40 hover:border-zinc-400 transition-colors">이전</button>
          <span className="text-xs text-zinc-500">{page} / {Math.ceil(newsData.total / newsData.page_size)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(newsData.total / newsData.page_size)} className="text-xs px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 disabled:opacity-40 hover:border-zinc-400 transition-colors">다음</button>
        </div>
      )}
    </div>
  )
}

export default News
