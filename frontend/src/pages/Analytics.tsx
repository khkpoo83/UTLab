import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { portfolioApi, PortfolioItem, PortfolioAnalysisGroup, PortfolioAnalysisItem } from '../api/client'
import { Card } from '../components/Card'
import SectorBar, { SectorWeight } from '../components/SectorBar'
import PageHeader from '../components/PageHeader'
import Notice from '../components/Notice'
import Button from '../components/Button'
import PortfolioReturnsCard from '../components/PortfolioReturnsCard'
import { SortableItem } from '../components/SortableItem'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { Bot, PieChart } from 'lucide-react'

const ANALYTICS_CARD_IDS = ['analytics-returns', 'analytics-sector', 'analytics-ai']
const ANALYTICS_CARD_TITLES: Record<string, string> = {
  'analytics-returns': '수익금 분석',
  'analytics-sector':  '섹터 집중도',
  'analytics-ai':      'AI 종목 분석',
}
const ANALYTICS_ORDER_KEY = 'analytics_card_order'

function loadAnalyticsOrder(): string[] {
  try {
    const saved = localStorage.getItem(ANALYTICS_ORDER_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      if (Array.isArray(parsed) && parsed.length === ANALYTICS_CARD_IDS.length &&
          ANALYTICS_CARD_IDS.every(id => parsed.includes(id))) return parsed
    }
  } catch {}
  return [...ANALYTICS_CARD_IDS]
}

function calcSectorWeights(items: PortfolioItem[]): SectorWeight[] {
  const map = new Map<string, number>()
  let total = 0
  for (const item of items) {
    const price = item.current_price ?? item.avg_price
    const val = price * item.quantity
    const sector = item.sector ?? '기타'
    map.set(sector, (map.get(sector) ?? 0) + val)
    total += val
  }
  if (total === 0) return []
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.pct - a.pct)
}

const Analytics: React.FC = () => {
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [analysisGroups, setAnalysisGroups] = useState<PortfolioAnalysisGroup[]>([])
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisRefreshing, setAnalysisRefreshing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [selectedAnalysisItem, setSelectedAnalysisItem] = useState<PortfolioAnalysisItem | null>(null)

  const [cardOrder, setCardOrder] = useState(loadAnalyticsOrder)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    setActiveCardId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setCardOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string))
      localStorage.setItem(ANALYTICS_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true)
    try {
      const data = await portfolioApi.analysis()
      setAnalysisGroups(data)
    } catch {
      setAnalysisGroups([])
    } finally {
      setAnalysisLoading(false)
    }
  }, [])

  const handleRefreshAnalysis = async () => {
    setAnalysisRefreshing(true)
    setAnalysisProgress(0)
    const t1 = setTimeout(() => setAnalysisProgress(25), 600)
    const t2 = setTimeout(() => setAnalysisProgress(50), 3000)
    const t3 = setTimeout(() => setAnalysisProgress(80), 8000)
    try {
      await portfolioApi.refreshAnalysis()
      setAnalysisProgress(100)
      await loadAnalysis()
    } catch {
      // ignore
    } finally {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      setTimeout(() => { setAnalysisRefreshing(false); setAnalysisProgress(0) }, 800)
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const portRes = await portfolioApi.list({ skip_price: true })
      setPortfolioItems(portRes.data)
    } catch {
      setError('데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    loadAnalysis()
  }, [loadData, loadAnalysis])

  const sectorWeights = calcSectorWeights(portfolioItems)
  const hasSectorWarning = sectorWeights.some((s) => s.pct > 40)

  return (
    <div className="space-y-4">
      <PageHeader title="포트폴리오 분석" subtitle="수익금 분석 및 섹터 구성" />

      {error && <Notice variant="red" className="text-xs">{error}</Notice>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={e => setActiveCardId(e.active.id as string)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
          <div className="flex flex-col gap-4">
            {cardOrder.map(id => {
              if (id === 'analytics-returns') return (
                <SortableItem key={id} id={id} order={cardOrder.indexOf(id)}>{(dragHandle) => (
                  <PortfolioReturnsCard dragHandle={dragHandle} />
                )}</SortableItem>
              )

              if (id === 'analytics-sector') return (
                <SortableItem key={id} id={id} order={cardOrder.indexOf(id)}>{(dragHandle) => (
                  <Card
                    collapsible
                    dragHandle={dragHandle}
                    icon={<PieChart size={15} />}
                    title="섹터 집중도"
                    right={!loading && hasSectorWarning ? <span className="tag tag-amber">집중 위험</span> : undefined}
                  >
                    <div className="p-4">
                      <SectorBar items={sectorWeights} loading={loading} />
                    </div>
                  </Card>
                )}</SortableItem>
              )

              if (id === 'analytics-ai') return (
                <SortableItem key={id} id={id} order={cardOrder.indexOf(id)}>{(dragHandle) => (
                  <Card
                    collapsible
                    dragHandle={dragHandle}
                    defaultOpen={false}
                    icon={<Bot size={15} />}
                    title="AI 종목 분석"
                    subtitle={analysisGroups.length > 0 && !analysisRefreshing ? analysisGroups[0]?.session_date : analysisRefreshing ? '' : undefined}
                    right={
                      <Button variant="secondary" size="xs"
                        onClick={handleRefreshAnalysis} disabled={analysisRefreshing}
                        loading={analysisRefreshing} loadingText="분석 중..."
                      >새로고침</Button>
                    }
                    contentClassName=""
                  >
                    {analysisRefreshing && (
                      <div className="h-1 bg-zinc-100 dark:bg-zinc-800 w-full">
                        <div className="h-1 bg-accent transition-all duration-700 ease-out" style={{ width: `${analysisProgress}%` }} />
                      </div>
                    )}
                    <div className="px-4 pb-3 pt-1">
                      {analysisLoading ? (
                        <div className="flex gap-2 flex-wrap">
                          {[1, 2, 3].map(i => <div key={i} className="h-7 w-24 skeleton rounded-full" />)}
                        </div>
                      ) : analysisGroups.length === 0 ? (
                        <div className="flex items-center gap-3 py-1">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">분석 없음 · 매일 03:00 자동 실행</span>
                          <Button variant="primary" size="xs"
                            onClick={handleRefreshAnalysis} disabled={analysisRefreshing}>
                            지금 분석
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {analysisGroups.map((group) => (
                            <div key={group.account_id ?? 'unassigned'}>
                              {analysisGroups.length > 1 && (
                                <p className="text-2xs text-zinc-400 mb-1.5">{group.account_name}</p>
                              )}
                              <div className="flex flex-wrap gap-1.5">
                                {group.items.map((item: PortfolioAnalysisItem) => {
                                  const outlookArrowCls =
                                    item.outlook === 'bullish' ? 'text-up' :
                                    item.outlook === 'bearish' ? 'text-down' : 'text-zinc-400'
                                  const outlookIcon = item.outlook === 'bullish' ? '↑' : item.outlook === 'bearish' ? '↓' : '→'
                                  const recDot =
                                    item.recommendation === 'buy_more' ? 'bg-up' :
                                    item.recommendation === 'reduce' ? 'bg-down' :
                                    item.recommendation === 'sell' ? 'bg-down' : 'bg-zinc-400'
                                  return (
                                    <button key={item.ticker} onClick={() => setSelectedAnalysisItem(item)}
                                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 surface hover:bg-zinc-100 dark:hover:bg-zinc-700 text-2xs font-medium transition-colors">
                                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${recDot}`} />
                                      <span className="text-zinc-800 dark:text-zinc-200 font-semibold">{item.name}</span>
                                      <span className={`font-bold ${outlookArrowCls}`}>{outlookIcon}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                )}</SortableItem>
              )

              return null
            })}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeCardId ? (
            <div className="bg-white dark:bg-zinc-900 border-2 border-dashed border-accent rounded-2xl px-4 py-3 text-sm font-medium text-zinc-500 dark:text-zinc-400 shadow-lg">
              {ANALYTICS_CARD_TITLES[activeCardId]}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedAnalysisItem && (() => {
        const item = selectedAnalysisItem
        const outlookBadge =
          item.outlook === 'bullish' ? { cls: 'text-up border border-up/40', style: { backgroundColor: 'rgb(var(--c-up-rgb, 240 80 122) / 0.15)' }, label: '강세 ↑' } :
          item.outlook === 'bearish' ? { cls: 'text-down border border-down/40', style: { backgroundColor: 'rgb(var(--c-accent-rgb) / 0.15)' }, label: '약세 ↓' } :
          { cls: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600', style: {}, label: '중립 →' }
        const recBadge =
          item.recommendation === 'buy_more' ? { cls: 'text-white', style: { backgroundColor: 'var(--c-up)' }, label: '추가매수' } :
          item.recommendation === 'reduce'   ? { cls: 'text-white', style: { backgroundColor: 'var(--c-down)' }, label: '비중축소' } :
          item.recommendation === 'sell'     ? { cls: 'text-white', style: { backgroundColor: 'var(--c-down)' }, label: '매도' } :
          { cls: 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300', style: {}, label: '보유' }
        const confLabel =
          item.confidence === 'high'   ? { cls: 'text-[color:var(--tag-amber-fg)]', label: '★★★ 확실' } :
          item.confidence === 'medium' ? { cls: 'text-zinc-500 dark:text-zinc-400', label: '★★☆ 보통' } :
          { cls: 'text-zinc-400 dark:text-zinc-500', label: '★☆☆ 참고' }
        return createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
            style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
            onClick={() => setSelectedAnalysisItem(null)}
          >
            <div
              className="w-full sm:max-w-md panel-surface border rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{item.name}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.ticker}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${outlookBadge.cls}`} style={outlookBadge.style}>{outlookBadge.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${recBadge.cls}`} style={recBadge.style}>{recBadge.label}</span>
                    <span className={`text-xs ${confLabel.cls}`}>{confLabel.label}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAnalysisItem(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {item.short_term_forecast && (
                <div>
                  <p className="text-2xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">단기 전망</p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{item.short_term_forecast}</p>
                </div>
              )}
              {item.key_points?.length > 0 && (
                <div>
                  <p className="text-2xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1.5">핵심 포인트</p>
                  <ul className="space-y-1.5">
                    {item.key_points.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="flex-shrink-0 mt-0.5 text-down">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.risks && (
                <div className="notice notice-amber flex items-start gap-2">
                  <span className="flex-shrink-0 text-sm">⚠</span>
                  <p className="text-sm">{item.risks}</p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      })()}
    </div>
  )
}

export default Analytics
