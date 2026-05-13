import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  portfolioApi,
  Account,
  PortfolioItem,
  ChartPoint,
  NewsItem,
} from '../api/client'
import { formatPrice, formatPct } from '../utils/format'
import StockChart from './StockChart'
import Skeleton from './Skeleton'
import PnlText from './PnlText'

interface HoldingDrawerProps {
  holding: PortfolioItem
  onClose: () => void
  accounts: Account[]
}

function PnlCell({ value, pct }: { value: number | null; pct: number | null }) {
  return <PnlText value={value} pct={pct} />
}

const HoldingDrawer: React.FC<HoldingDrawerProps> = ({ holding, onClose, accounts }) => {
  const [period, setPeriod] = useState('3m')
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [drawerTab, setDrawerTab] = useState<'chart' | 'calc'>('chart')
  const [calcQty, setCalcQty] = useState('')
  const [calcPrice, setCalcPrice] = useState('')
  const [isWide, setIsWide] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const loadChart = useCallback(async () => {
    setChartLoading(true)
    try {
      const { data } = await portfolioApi.chartByTicker(holding.ticker, period)
      setChartData(data)
    } catch {
      setChartData([])
    } finally {
      setChartLoading(false)
    }
  }, [holding.ticker, period])

  useEffect(() => { loadChart() }, [loadChart])

  useEffect(() => {
    portfolioApi.newsByTicker(holding.ticker, holding.name ?? '').then(({ data }) => {
      setNews(data)
      setNewsLoading(false)
    }).catch(() => setNewsLoading(false))
  }, [holding.ticker, holding.name])

  return createPortal(
    <div className="fixed inset-0 z-[200] flex"
      style={{ backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}>
      <div
        className="flex-1"
        style={{ background: 'var(--overlay-bg)' }}
        onClick={onClose}
      />
      <div
        className="panel-surface border-l overflow-y-auto flex flex-col shadow-[-8px_0_32px_rgba(0,0,0,0.18)]"
        style={{
          width: isWide ? '48rem' : '36rem',
          maxWidth: '100%',
          transition: 'width 0.3s ease-in-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 panel-header-surface z-10">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{holding.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-zinc-400">{holding.ticker} · {holding.exchange ?? ''}</p>
              {holding.account_name && (() => {
                const acct = accounts.find(a => a.name === holding.account_name)
                return acct ? (
                  <span className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: acct.color }} />
                    {acct.name}
                  </span>
                ) : null
              })()}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => setIsWide(w => !w)}
              title={isWide ? '기본 너비로' : '더 넓게 보기'}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isWide ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l-3 3 3 3M15 9l3 3-3 3" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9l3 3-3 3M9 9l-3 3 3 3" />
                </svg>
              )}
            </button>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5">현재가</p>
              <p className="text-sm font-semibold tabular-nums">
                {holding.current_price != null ? formatPrice(holding.current_price) : '-'}
              </p>
            </div>
            <div>
              <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5">평균단가</p>
              <p className="text-sm tabular-nums">{formatPrice(holding.avg_price)}</p>
            </div>
            <div>
              <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5">평가손익</p>
              <PnlCell value={holding.pnl} pct={holding.pnl_pct} />
            </div>
          </div>

          {/* Tabs */}
          <div>
            <div className="flex gap-1 mb-3 border-b border-zinc-100 dark:border-zinc-800">
              {(['chart', 'calc'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    drawerTab === tab
                      ? 'border-accent text-accent'
                      : 'border-transparent text-zinc-400 hover:text-zinc-600'
                  }`}
                >
                  {tab === 'chart' ? '차트' : '추가매수 계산기'}
                </button>
              ))}
            </div>

            {drawerTab === 'chart' ? (
              <StockChart
                data={chartData}
                avgPrice={holding.avg_price}
                period={period}
                onPeriodChange={setPeriod}
                loading={chartLoading}
                height={280}
              />
            ) : (
              (() => {
                const addQty = parseFloat(calcQty) || 0
                const addPrice = parseFloat(calcPrice) || 0
                const newTotalQty = holding.quantity + addQty
                const newAvgPrice = addQty > 0 && addPrice > 0
                  ? (holding.avg_price * holding.quantity + addPrice * addQty) / newTotalQty
                  : holding.avg_price
                const newTotalCost = newAvgPrice * newTotalQty
                const breakEven = newAvgPrice
                const newPnl = holding.current_price != null
                  ? (holding.current_price - newAvgPrice) * newTotalQty
                  : null
                const newPnlPct = holding.current_price != null
                  ? (holding.current_price - newAvgPrice) / newAvgPrice * 100
                  : null
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-2xs text-zinc-500 mb-1 block">추가 수량 (주)</label>
                        <input
                          type="number"
                          value={calcQty}
                          onChange={e => setCalcQty(e.target.value)}
                          placeholder="0"
                          className="w-full text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-2xs text-zinc-500 mb-1 block">추가 단가 (원)</label>
                        <input
                          type="number"
                          value={calcPrice}
                          onChange={e => setCalcPrice(e.target.value)}
                          placeholder={holding.current_price?.toString() ?? '0'}
                          className="w-full text-sm px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="panel-inner-surface border rounded-xl p-4 space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">현재 보유</span>
                        <span className="text-xs tabular-nums">{holding.quantity.toLocaleString()}주 @ {formatPrice(holding.avg_price)}</span>
                      </div>
                      {addQty > 0 && addPrice > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-500">추가 매수</span>
                          <span className="text-xs tabular-nums text-accent">{addQty.toLocaleString()}주 @ {formatPrice(addPrice)}</span>
                        </div>
                      )}
                      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-2.5 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">새 평균단가</span>
                          <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                            {formatPrice(Math.round(newAvgPrice))}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-500">총 수량</span>
                          <span className="text-xs tabular-nums">{newTotalQty.toLocaleString()}주</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-500">총 투자금</span>
                          <span className="text-xs tabular-nums">{formatPrice(Math.round(newTotalCost))}</span>
                        </div>
                        {newPnl !== null && (
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">현재가 기준 손익</span>
                            <span className={`text-xs font-semibold tabular-nums ${newPnl >= 0 ? 'text-up' : 'text-down'}`}>
                              {formatPrice(Math.round(newPnl))} ({newPnlPct != null ? formatPct(Math.round(newPnlPct * 100) / 100) : '-'})
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-500">손익분기점</span>
                          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{formatPrice(Math.round(breakEven))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()
            )}
          </div>

          {/* Related News + External Links */}
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-2">외부 링크</h3>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://finance.naver.com/item/main.naver?code=${holding.ticker.replace(/\.[A-Z]+$/, '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg panel-inner-surface border text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
                >
                  <span className="font-bold text-accent">N</span> 네이버 금융
                </a>
                <a
                  href={`https://finance.naver.com/item/board.naver?code=${holding.ticker.replace(/\.[A-Z]+$/, '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg panel-inner-surface border text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
                >
                  <span className="font-bold text-accent">N</span> 종목토론방
                </a>
                <a
                  href={`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(holding.name)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg panel-inner-surface border text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  뉴스 검색
                </a>
                {/^\d{6}$/.test(holding.ticker.replace(/\.[A-Z]+$/, '')) && (
                  <a
                    href={`https://dart.fss.or.kr/dsab002/search.ax?textCrpNm=${encodeURIComponent(holding.name)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg panel-inner-surface border text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    DART 공시
                  </a>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-2">관련 뉴스 (수집된 기사)</h3>
              {newsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
                </div>
              ) : news.length === 0 ? (
                <div className="py-3 text-center">
                  <p className="text-xs text-zinc-400">수집된 관련 기사가 없습니다.</p>
                  <p className="text-2xs text-zinc-400 dark:text-zinc-500 mt-1">위 링크에서 최신 뉴스를 확인하세요.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                  {news.map((n) => (
                    <a
                      key={n.id}
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block py-2.5 px-1 rounded hover:bg-accent/5 transition-colors group"
                    >
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-accent line-clamp-2">{n.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-2xs text-zinc-400">{n.source}</p>
                        {n.published_at && <p className="text-2xs text-zinc-400">{new Date(n.published_at).toLocaleDateString('ko-KR')}</p>}
                        {n.summary && <span className="text-2xs text-accent">✓ AI요약</span>}
                      </div>
                      {n.summary && (
                        <p className="text-2xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2 leading-relaxed">{n.summary}</p>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default HoldingDrawer
