import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  portfolioApi,
  kisApi,
  Account,
  PortfolioItem,
  ChartPoint,
  NewsItem,
  StockFundamentals,
  StockTransaction,
} from '../api/client'
import { formatPrice } from '../utils/format'
import StockChart from './StockChart'
import Skeleton from './Skeleton'

interface HoldingDrawerProps {
  holding: PortfolioItem
  onClose: () => void
  accounts: Account[]
}

// ── 포맷 헬퍼 ───────────────────────────────────────────────────────────────
function fmtMarketCap(n: number | null, currency: string | null): string {
  if (n == null) return '-'
  if (currency && currency !== 'KRW') {
    return `${(n / 1e9).toFixed(2)}B ${currency}`
  }
  const eok = n / 1e8
  if (eok >= 10000) return `${(eok / 10000).toFixed(2)}조`
  if (eok >= 1) return `${Math.round(eok).toLocaleString()}억`
  return n.toLocaleString()
}
const fmtNum = (n: number | null, digits = 2): string =>
  n == null ? '-' : n.toFixed(digits)
const fmtPctV = (n: number | null): string =>
  n == null ? '-' : `${n.toFixed(2)}%`

const HoldingDrawer: React.FC<HoldingDrawerProps> = ({ holding, onClose, accounts }) => {
  const [period, setPeriod] = useState('3m')
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [isWide, setIsWide] = useState(false)

  const [topTab, setTopTab] = useState<'summary' | 'info'>('summary')
  const [bottomTab, setBottomTab] = useState<'news' | 'tx'>('news')

  const [fundamentals, setFundamentals] = useState<StockFundamentals | null>(null)
  const [fundLoading, setFundLoading] = useState(false)
  const [fundLoaded, setFundLoaded] = useState(false)

  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txLoaded, setTxLoaded] = useState(false)

  const acct = accounts.find(a => a.name === holding.account_name)

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

  // 기업정보 탭 최초 진입 시 로드
  useEffect(() => {
    if (topTab !== 'info' || fundLoaded) return
    setFundLoading(true)
    portfolioApi.infoByTicker(holding.ticker)
      .then(({ data }) => setFundamentals(data))
      .catch(() => setFundamentals(null))
      .finally(() => { setFundLoading(false); setFundLoaded(true) })
  }, [topTab, fundLoaded, holding.ticker])

  // 거래내역 탭 최초 진입 시 로드
  useEffect(() => {
    if (bottomTab !== 'tx' || txLoaded) return
    setTxLoading(true)
    kisApi.getTransactions(holding.ticker, acct?.account_no)
      .then(data => setTransactions(data))
      .catch(() => setTransactions([]))
      .finally(() => { setTxLoading(false); setTxLoaded(true) })
  }, [bottomTab, txLoaded, holding.ticker, acct?.account_no])

  const code = holding.ticker.replace(/\.[A-Z]+$/, '')

  // ── 요약 지표 셀 ──
  const summaryCells: { label: string; value: React.ReactNode; tone?: 'up' | 'down' }[] = [
    { label: '현재가', value: holding.current_price != null ? formatPrice(holding.current_price) : '-' },
    {
      label: '당일등락',
      value: holding.day_change_pct != null
        ? `${holding.day_change_pct >= 0 ? '+' : ''}${holding.day_change_pct.toFixed(2)}%`
        : '-',
      tone: (holding.day_change_pct ?? 0) >= 0 ? 'up' : 'down',
    },
    { label: '평균단가', value: formatPrice(holding.avg_price) },
    {
      label: '수익률',
      value: holding.pnl_pct != null ? `${holding.pnl_pct >= 0 ? '+' : ''}${holding.pnl_pct.toFixed(2)}%` : '-',
      tone: (holding.pnl_pct ?? 0) >= 0 ? 'up' : 'down',
    },
    {
      label: '평가손익',
      value: holding.pnl != null ? `${holding.pnl >= 0 ? '+' : ''}${Math.round(holding.pnl).toLocaleString('ko-KR')}` : '-',
      tone: (holding.pnl ?? 0) >= 0 ? 'up' : 'down',
    },
    { label: '평가금액', value: holding.current_value != null ? formatPrice(holding.current_value) : '-' },
    { label: '보유수량', value: `${holding.quantity.toLocaleString()}주` },
    { label: '비중', value: holding.weight != null ? `${holding.weight.toFixed(1)}%` : '-' },
  ]

  // ── 기업정보 지표 셀 ──
  const f = fundamentals
  const infoCells: { label: string; value: string }[] = f ? [
    { label: '시가총액', value: f.market_cap_display || fmtMarketCap(f.market_cap, f.currency) },
    { label: 'PER', value: fmtNum(f.per) },
    { label: 'PER(선행)', value: fmtNum(f.forward_per) },
    { label: 'PBR', value: fmtNum(f.pbr) },
    { label: 'EPS', value: f.eps != null ? formatPrice(Math.round(f.eps)) : '-' },
    { label: 'BPS', value: f.bps != null ? formatPrice(Math.round(f.bps)) : '-' },
    { label: '배당수익률', value: fmtPctV(f.dividend_yield) },
    { label: 'ROE', value: fmtPctV(f.roe) },
    { label: '52주 최고', value: f.week52_high != null ? formatPrice(f.week52_high) : '-' },
    { label: '52주 최저', value: f.week52_low != null ? formatPrice(f.week52_low) : '-' },
  ] : []

  const tabBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
      active ? 'border-accent text-accent' : 'border-transparent text-zinc-400 hover:text-zinc-600'
    }`

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
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">{holding.name}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-xs text-zinc-400">{code} · {holding.exchange ?? ''}</p>
              {holding.kis_market === 'NXT' && (
                <span className="text-2xs px-1.5 py-0.5 rounded tag tag-tonal">NXT</span>
              )}
              {acct && (
                <span className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: acct.color }} />
                  {acct.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-1 flex-shrink-0">
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
          {/* ── 상단: 요약 / 기업정보 탭 ── */}
          <div>
            <div className="flex gap-1 mb-3 border-b border-zinc-100 dark:border-zinc-800">
              <button onClick={() => setTopTab('summary')} className={tabBtn(topTab === 'summary')}>요약</button>
              <button onClick={() => setTopTab('info')} className={tabBtn(topTab === 'info')}>기업정보</button>
            </div>

            {topTab === 'summary' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
                {summaryCells.map((c) => (
                  <div key={c.label}>
                    <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5">{c.label}</p>
                    <p className={`text-sm font-semibold tabular-nums ${
                      c.tone === 'up' ? 'text-up' : c.tone === 'down' ? 'text-down' : 'text-zinc-900 dark:text-zinc-100'
                    }`}>
                      {c.value}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              fundLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i}>
                      <Skeleton className="h-3 w-14 mb-1.5 rounded" />
                      <Skeleton className="h-4 w-16 rounded" />
                    </div>
                  ))}
                </div>
              ) : f && infoCells.some(c => c.value !== '-') ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
                    {infoCells.map((c) => (
                      <div key={c.label}>
                        <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5">{c.label}</p>
                        <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{c.value}</p>
                      </div>
                    ))}
                  </div>
                  {(f.sector || f.industry) && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.sector && <span className="tag tag-zinc">{f.sector}</span>}
                      {f.industry && <span className="tag tag-tonal">{f.industry}</span>}
                    </div>
                  )}
                  {f.summary && (
                    <p className="text-2xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-4">{f.summary}</p>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-zinc-400">기업 기초정보를 불러올 수 없습니다.</p>
                  <p className="text-2xs text-zinc-400 dark:text-zinc-500 mt-1">해외/일부 종목은 제공되지 않을 수 있습니다.</p>
                </div>
              )
            )}
          </div>

          {/* ── 차트 ── */}
          <StockChart
            data={chartData}
            avgPrice={holding.avg_price}
            period={period}
            onPeriodChange={setPeriod}
            loading={chartLoading}
            height={280}
          />

          {/* ── 외부 링크 ── */}
          <div>
            <h3 className="text-xs font-medium text-zinc-500 mb-2">외부 링크</h3>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://finance.naver.com/item/main.naver?code=${code}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg panel-inner-surface border text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent transition-colors"
              >
                <span className="font-bold text-accent">N</span> 네이버 금융
              </a>
              <a
                href={`https://finance.naver.com/item/board.naver?code=${code}`}
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
              {/^\d{6}$/.test(code) && (
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

          {/* ── 하단: 관련 뉴스 / 거래내역 탭 ── */}
          <div>
            <div className="flex gap-1 mb-3 border-b border-zinc-100 dark:border-zinc-800">
              <button onClick={() => setBottomTab('news')} className={tabBtn(bottomTab === 'news')}>관련 뉴스</button>
              <button onClick={() => setBottomTab('tx')} className={tabBtn(bottomTab === 'tx')}>거래내역</button>
            </div>

            {bottomTab === 'news' ? (
              newsLoading ? (
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
              )
            ) : (
              txLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-3 text-center">
                  <p className="text-xs text-zinc-400">거래내역이 없습니다.</p>
                  <p className="text-2xs text-zinc-400 dark:text-zinc-500 mt-1">최근 1년 내 매매 체결 내역이 없거나 조회할 수 없습니다.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                  {transactions.map((t, i) => {
                    const isBuy = t.type === '매수'
                    return (
                      <div key={i} className="flex items-center justify-between py-2.5 px-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-2xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 bg-zinc-100 dark:bg-zinc-800 ${
                            isBuy ? 'text-up' : 'text-down'
                          }`}>
                            {t.type}
                          </span>
                          <span className="text-2xs text-zinc-400 tabular-nums">{t.date}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-xs tabular-nums text-zinc-800 dark:text-zinc-200">
                            {t.quantity.toLocaleString()}주 @ {formatPrice(t.price)}
                          </p>
                          <p className="text-2xs text-zinc-400 tabular-nums">{formatPrice(t.amount)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default HoldingDrawer
