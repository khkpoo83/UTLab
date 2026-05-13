import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  kisApi,
  settingsApi,
  Account,
  KISPortfolioAccount,
  PortfolioItem,
} from '../api/client'
import type { PersistedState } from '../components/DataTable'
import Skeleton from '../components/Skeleton'
import { LayoutDashboard, Briefcase, Settings2, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Card, fmtUpdated } from '../components/Card'
import { DataTable, ColDef as DtColDef } from '../components/DataTable'
import IndexPanel from '../components/IndexPanel'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { SortableItem } from '../components/SortableItem'
import { getTonalPalette } from '../utils/theme'
import { formatPrice, formatPct } from '../utils/format'
import Button from '../components/Button'
import ToggleChip from '../components/ToggleChip'
import Sparkline from '../components/Sparkline'
import HoldingDrawer from '../components/HoldingDrawer'
import WeightBar from '../components/WeightBar'
import PortfolioHistoryChart from '../components/PortfolioHistoryChart'

function getMarketBadge(h: PortfolioItem): { market: string; marketClass: string; premarket: boolean } {
  const ticker = h.ticker
  const exchange = h.exchange ?? ''
  const name = h.name ?? ''

  if (/^(TIGER|KODEX|KBSTAR|HANARO|ARIRANG|FOCUS|SOL|ACE|KOSEF|TIMEFOLIO|KISEF|RISE|SMART|TREX|PLUS)\b/i.test(name) || exchange === 'ETF') {
    return { market: 'ETF', marketClass: 'tag tag-tonal', premarket: false }
  }
  if (ticker.endsWith('.KS') || exchange === 'KOSPI' || exchange === 'KRX' || exchange === 'KONEX' || /^\d{6}$/.test(ticker)) {
    return { market: '코스피', marketClass: 'tag tag-zinc', premarket: false }
  }
  if (ticker.endsWith('.KQ') || exchange === 'KOSDAQ') {
    return { market: '코스닥', marketClass: 'tag tag-tonal', premarket: false }
  }
  if (exchange === 'NASDAQ') {
    return { market: 'NASDAQ', marketClass: 'tag tag-tonal', premarket: true }
  }
  if (exchange === 'NYSE') {
    return { market: 'NYSE', marketClass: 'tag tag-tonal', premarket: true }
  }
  if (!ticker.includes('.')) {
    return { market: 'US', marketClass: 'tag tag-tonal', premarket: true }
  }
  return { market: exchange || '', marketClass: 'tag tag-zinc', premarket: false }
}



const PORTFOLIO_CARD_IDS = ['portfolio-summary', 'portfolio-holdings']
const PORTFOLIO_CARD_TITLES: Record<string, string> = {
  'portfolio-summary': '포트폴리오 요약',
  'portfolio-holdings': '보유 종목',
}
const PORTFOLIO_ORDER_KEY = 'portfolio_card_order'

function loadPortfolioOrder(): string[] {
  try {
    const saved = localStorage.getItem(PORTFOLIO_ORDER_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      if (Array.isArray(parsed) && parsed.length === PORTFOLIO_CARD_IDS.length &&
          PORTFOLIO_CARD_IDS.every(id => parsed.includes(id))) return parsed
    }
  } catch {}
  return [...PORTFOLIO_CARD_IDS]
}

const Portfolio: React.FC = () => {
  const [holdings, setHoldings] = useState<PortfolioItem[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedHolding, setSelectedHolding] = useState<PortfolioItem | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  // KIS 계좌 원본 데이터 (계좌 레벨 요약용)
  const [kisAccountsData, setKisAccountsData] = useState<KISPortfolioAccount[]>([])

  // KIS 동기화 상태
  const [kisSyncing, setKisSyncing] = useState(false)

  // 자동갱신 토글 (localStorage 영속)
  const [autoRefresh, setAutoRefresh] = useState(() =>
    localStorage.getItem('kis_auto_refresh') !== 'false'
  )
  const toggleAutoRefresh = useCallback(() => {
    setAutoRefresh(v => {
      const next = !v
      localStorage.setItem('kis_auto_refresh', next ? 'true' : 'false')
      return next
    })
  }, [])

  // 자동갱신 카운트다운
  const autoRefreshStartRef = useRef<number>(Date.now())
  const [refreshCountdown, setRefreshCountdown] = useState(300)
  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  // 프라이버시 모드
  const [privacyMode, setPrivacyMode] = useState(false)

  // NXT 토글: true=NXT 가격 포함, false=KRX 정규장 가격만
  const [nxtMode, setNxtMode] = useState(true)

  // 계좌 별명/색상 편집 모달
  const [showAliasModal, setShowAliasModal] = useState(false)
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({})
  const [colorInputs, setColorInputs] = useState<Record<string, string>>({})
  const [aliasSaving, setAliasSaving] = useState(false)

  // 테이블 컬럼 서버 설정 (null = 로딩 전, undefined = 서버에 없음)
  const [serverColState, setServerColState] = useState<PersistedState | null | undefined>(undefined)

  // 카드 순서 (드래그앤드랍)
  const [portfolioCardOrder, setPortfolioCardOrder] = useState(loadPortfolioOrder)
  const [activePortfolioCardId, setActivePortfolioCardId] = useState<string | null>(null)
  const portfolioSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  function handlePortfolioCardDragEnd(event: DragEndEvent) {
    setActivePortfolioCardId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPortfolioCardOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string))
      localStorage.setItem(PORTFOLIO_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const kisColorPalette = getTonalPalette()
  const KIS_ACCOUNT_COLORS: Record<string, string> = {
    GENERAL:      kisColorPalette[0],
    ISA:          kisColorPalette[1],
    PENSION:      kisColorPalette[2],
    IRP_PERSONAL: kisColorPalette[3],
    IRP_COMPANY:  kisColorPalette[4],
  }

  const loadData = useCallback(async (force = false) => {
    try {
      const [kisAccounts, savedColors]: [KISPortfolioAccount[], Record<string, string>] = await Promise.all([
        kisApi.getPortfolio(force),
        kisApi.getColors().catch(() => ({})),
      ])
      setKisAccountsData(kisAccounts)
      const accts: Account[] = kisAccounts.map((b, i) => ({
        id: i + 1,
        name: b.alias,
        color: savedColors[b.account_no] || KIS_ACCOUNT_COLORS[b.account_type] || '#6B7280',
        created_at: new Date().toISOString(),
        account_no: b.account_no,
      }))
      setAccounts(accts)

      let idx = 1
      const allHoldings: PortfolioItem[] = []
      for (const [i, b] of kisAccounts.entries()) {
        const accountId = i + 1
        for (const h of b.holdings) {
          allHoldings.push({
            id: idx++,
            ticker: h.ticker,
            name: h.name,
            exchange: h.exchange,
            avg_price: h.avg_price,
            quantity: h.quantity,
            memo: null,
            bought_at: null,
            sector: h.sector,
            created_at: new Date().toISOString(),
            source: h.source,
            current_price: h.current_price,
            pnl: h.pnl,
            pnl_pct: h.pnl_pct,
            current_value: h.current_value,
            day_change: h.day_change,
            day_change_pct: h.day_change_pct,
            weight: h.weight,
            sparkline: h.sparkline,
            account_id: accountId,
            account_name: b.alias,
            kis_market: h.kis_market,
          })
        }
      }
      setHoldings(allHoldings)
      setLastUpdated(new Date())
      setLastFetched(new Date())
    } catch {
      // Handle error
    } finally {
      setLoading(false)
    }
  }, [])

  const handleKisSync = useCallback(async () => {
    setKisSyncing(true)
    autoRefreshStartRef.current = Date.now()
    setRefreshCountdown(300)
    try {
      await kisApi.sync()
    } catch {
      // sync 실패해도 loadData는 반드시 실행
    }
    try {
      await loadData(true)
    } catch {
      // ignore
    } finally {
      setKisSyncing(false)
    }
  }, [loadData])

  // 계좌별 필터링 + 현재 뷰 기준으로 비중 재계산
  const filteredHoldings = React.useMemo(() => {
    const filtered = selectedAccountId === null
      ? holdings
      : holdings.filter(h => h.account_id === selectedAccountId)
    const totalValue = filtered.reduce((s, h) => s + (h.current_value ?? (h.avg_price * h.quantity)), 0)
    if (totalValue <= 0) return filtered
    return filtered.map(h => ({
      ...h,
      weight: ((h.current_value ?? (h.avg_price * h.quantity)) / totalValue) * 100,
    }))
  }, [holdings, selectedAccountId])

  // summary 계산: KIS 계좌 레벨 데이터 우선 사용
  const displaySummary = React.useMemo(() => {
    if (!kisAccountsData.length && !holdings.length) return null

    // 어제대비: holding의 day_change(KIS 현재가 - yfinance prev_close) 합산
    const calcDayChange = (hs: PortfolioItem[]) => {
      let day_pnl = 0, day_pnl_valid = true, up_count = 0, down_count = 0
      for (const h of hs) {
        if (h.day_change === null) { day_pnl_valid = false }
        else {
          day_pnl += h.day_change * h.quantity
          if (h.day_change > 0) up_count++
          else if (h.day_change < 0) down_count++
        }
      }
      return { day_pnl, day_pnl_valid, up_count, down_count }
    }

    if (selectedAccountId !== null) {
      const acct = accounts.find(a => a.id === selectedAccountId)
      const kisAcct = kisAccountsData.find(b => b.account_no === acct?.account_no)
      if (!kisAcct) return null

      const eval_amount = nxtMode
        ? kisAcct.total_eval_amount
        : (kisAcct.krx_total_eval_amount ?? kisAcct.total_eval_amount)
      const pnl_amount = nxtMode
        ? kisAcct.total_pnl_amount
        : (kisAcct.krx_total_pnl_amount ?? kisAcct.total_pnl_amount)
      const pnl_pct = nxtMode
        ? kisAcct.total_pnl_pct
        : (kisAcct.krx_total_pnl_pct ?? kisAcct.total_pnl_pct)

      const { day_pnl, day_pnl_valid, up_count, down_count } = calcDayChange(filteredHoldings)
      const prev_value = eval_amount - day_pnl
      const day_pnl_pct = day_pnl_valid && prev_value > 0 ? (day_pnl / prev_value) * 100 : null

      return {
        total_value: eval_amount,
        total_cost: kisAcct.total_purchase_amount,
        total_pnl: pnl_amount,
        total_pnl_pct: pnl_pct,
        count: filteredHoldings.length,
        day_pnl: day_pnl_valid ? Math.round(day_pnl * 100) / 100 : null,
        day_pnl_pct: day_pnl_pct !== null ? Math.round(day_pnl_pct * 100) / 100 : null,
        up_count,
        down_count,
        deposit: kisAcct.deposit,
      }
    } else {
      const total_value = kisAccountsData.length
        ? kisAccountsData.reduce((s, b) => s + (nxtMode
            ? b.total_eval_amount
            : (b.krx_total_eval_amount ?? b.total_eval_amount)), 0)
        : holdings.reduce((s, h) => s + (h.current_value ?? h.avg_price * h.quantity), 0)
      const total_cost = kisAccountsData.length
        ? kisAccountsData.reduce((s, b) => s + b.total_purchase_amount, 0)
        : holdings.reduce((s, h) => s + h.avg_price * h.quantity, 0)
      const total_pnl = total_value - total_cost
      const total_pnl_pct = total_cost > 0 ? (total_pnl / total_cost) * 100 : 0
      const deposit = kisAccountsData.reduce((s, b) => s + b.deposit, 0)

      const { day_pnl, day_pnl_valid, up_count, down_count } = calcDayChange(holdings)
      const prev_value = total_value - day_pnl
      const day_pnl_pct = day_pnl_valid && prev_value > 0 ? (day_pnl / prev_value) * 100 : null

      return {
        total_value: Math.round(total_value),
        total_cost: Math.round(total_cost),
        total_pnl: Math.round(total_pnl),
        total_pnl_pct: Math.round(total_pnl_pct * 100) / 100,
        count: holdings.length,
        day_pnl: day_pnl_valid ? Math.round(day_pnl * 100) / 100 : null,
        day_pnl_pct: day_pnl_pct !== null ? Math.round(day_pnl_pct * 100) / 100 : null,
        up_count,
        down_count,
        deposit,
      }
    }
  }, [selectedAccountId, accounts, kisAccountsData, filteredHoldings, holdings, nxtMode])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!autoRefresh) { setRefreshCountdown(300); return }
    autoRefreshStartRef.current = Date.now()
    setRefreshCountdown(300)
    const interval = setInterval(() => {
      autoRefreshStartRef.current = Date.now()
      setRefreshCountdown(300)
      loadData()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData, autoRefresh])

  useEffect(() => {
    if (!autoRefresh) return
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - autoRefreshStartRef.current) / 1000)
      setRefreshCountdown(Math.max(0, 300 - elapsed))
    }, 1000)
    return () => clearInterval(tick)
  }, [autoRefresh])

  // 마운트 시 서버에서 컬럼 설정 로드
  useEffect(() => {
    settingsApi.get().then(({ data }) => {
      setServerColState(data.ui_portfolio_cols ?? null)
    }).catch(() => setServerColState(null))
  }, [])

  const handleColPersist = useCallback((s: PersistedState) => {
    settingsApi.update({ ui_portfolio_cols: s }).catch(() => {})
  }, [])

  const holdDays = useCallback((h: PortfolioItem) =>
    h.bought_at ? Math.floor((Date.now() - new Date(h.bought_at).getTime()) / 86400000) : 0, [])
  const holdCost = useCallback((h: PortfolioItem) => h.avg_price * h.quantity, [])

  // ── DataTable 컬럼 정의 ──────────────────────────────────────────────────
  const pBlur = privacyMode ? 'blur-sm select-none' : ''
  const portfolioCols = useMemo((): DtColDef<PortfolioItem>[] => [
    {
      key: 'name', label: '종목명', width: 180, minWidth: 120,
      render: (h) => {
        const { market, marketClass, premarket } = getMarketBadge(h)
        return (
          <div>
            <div className="flex items-center gap-1.5">
              <p className={`font-medium text-zinc-900 dark:text-zinc-100 leading-tight ${pBlur}`}>{h.name}</p>
              {h.source === 'kiwoom' && (
                <span className="text-2xs px-1 py-0.5 rounded font-medium shrink-0 text-down" style={{ backgroundColor: 'rgb(var(--c-accent-rgb) / 0.12)' }}>키움</span>
              )}
              {h.kis_market === 'NXT' && (
                <span className="text-2xs px-1 py-0.5 rounded font-medium shrink-0" style={{ backgroundColor: 'rgb(var(--c-accent-rgb) / 0.12)', color: 'rgb(var(--c-accent-rgb))' }}>NXT</span>
              )}
            </div>
            <p className="text-2xs text-zinc-400 dark:text-zinc-500 mt-0.5 leading-tight flex items-center flex-wrap gap-1">
              <span className={`tabular-nums ${pBlur}`}>{h.ticker}</span>
              {market && <span className={marketClass}>{market}</span>}
              {premarket && <span className="tag tag-amber">프리마켓</span>}
              {h.sector && <span className={`text-zinc-400 ${pBlur}`}>{h.sector}</span>}
              {h.memo && <span className={`italic text-zinc-400 ${pBlur}`}>{h.memo}</span>}
              {selectedAccountId === null && h.account_id && (() => {
                const acct = accounts.find(a => a.id === h.account_id)
                return acct ? (
                  <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs font-semibold ${pBlur}`} style={{ border: `1px solid ${acct.color}`, color: acct.color }}>
                    {acct.name}
                  </span>
                ) : null
              })()}
            </p>
          </div>
        )
      },
    },
    {
      key: 'current_price', label: '현재가', width: 100, align: 'right',
      getValue: (h) => h.current_price ?? 0,
      render: (h) => (
        <div className="text-right">
          <p className={`tabular-nums font-medium text-zinc-900 dark:text-zinc-100 leading-tight ${pBlur}`}>
            {h.current_price != null ? formatPrice(h.current_price) : '-'}
          </p>
          <p className={`text-2xs text-zinc-400 mt-0.5 tabular-nums leading-tight ${pBlur}`}>{h.quantity.toLocaleString()}주</p>
        </div>
      ),
    },
    {
      key: 'day_change_pct', label: '당일등락', width: 88, type: 'pnl-pct',
      getValue: (h) => h.day_change_pct ?? 0,
    },
    {
      key: 'pnl_pct', label: '수익률', width: 88, type: 'pnl-pct',
      getValue: (h) => h.pnl_pct ?? 0,
    },
    {
      key: 'pnl', label: '평가손익', width: 110, align: 'right',
      getValue: (h) => h.pnl ?? 0,
      render: (h) => {
        const n = h.pnl ?? 0
        return <span className={`tabular-nums font-semibold ${n >= 0 ? 'text-up' : 'text-down'} ${pBlur}`}>
          {n >= 0 ? '+' : ''}{n.toLocaleString('ko-KR')}
        </span>
      },
    },
    {
      key: 'cost', label: '매수금액', width: 110, align: 'right',
      getValue: (h) => holdCost(h),
      render: (h) => <span className={`tabular-nums text-zinc-600 dark:text-zinc-400 ${pBlur}`}>{formatPrice(holdCost(h))}</span>,
    },
    {
      key: 'weight', label: '비중', width: 80, type: 'pct-bar',
      getValue: (h) => h.weight ?? 0,
    },
    {
      key: 'account', label: '계좌', width: 90, sortable: false, visible: false,
      render: (h) => {
        const acct = h.account_id ? accounts.find(a => a.id === h.account_id) : null
        return acct ? (
          <span className="flex items-center gap-1 text-xs">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: acct.color }} />
            <span className="text-zinc-600 dark:text-zinc-400">{acct.name}</span>
          </span>
        ) : <span className="text-2xs text-zinc-400 dark:text-zinc-500">미지정</span>
      },
    },
    {
      key: 'avg_price', label: '평균단가', width: 100, align: 'right', sortable: false, visible: false,
      render: (h) => <span className={`tabular-nums text-zinc-500 dark:text-zinc-400 ${pBlur}`}>{formatPrice(h.avg_price)}</span>,
    },
    {
      key: 'current_value', label: '평가금액', width: 110, align: 'right', visible: false,
      getValue: (h) => h.current_value ?? 0,
      render: (h) => <span className={`tabular-nums text-zinc-700 dark:text-zinc-300 ${pBlur}`}>{h.current_value != null ? formatPrice(h.current_value) : '-'}</span>,
    },
    {
      key: 'quantity', label: '수량', width: 70, align: 'right', sortable: false, visible: false,
      render: (h) => <span className={`tabular-nums text-zinc-500 ${pBlur}`}>{h.quantity.toLocaleString()}</span>,
    },
    {
      key: 'day_change', label: '등락금액', width: 100, align: 'right', visible: false,
      getValue: (h) => h.day_change ?? 0,
      render: (h) => {
        const n = h.day_change ?? 0
        return <span className={`tabular-nums font-semibold ${n >= 0 ? 'text-up' : 'text-down'} ${pBlur}`}>
          {n >= 0 ? '+' : ''}{n.toLocaleString('ko-KR')}
        </span>
      },
    },
    {
      key: 'hold_days', label: '보유일수', width: 80, align: 'right', visible: false,
      getValue: (h) => holdDays(h),
      render: (h) => <span className="tabular-nums text-zinc-500">{h.bought_at ? `${holdDays(h)}일` : '-'}</span>,
    },
    {
      key: 'sparkline', label: '추세', width: 80, sortable: false,
      render: (h) => <Sparkline data={h.sparkline} />,
    },
  ], [accounts, selectedAccountId, holdCost, holdDays, pBlur])

  return (
    <div className="space-y-4">
      {/* 글로벌 지수 */}
      <IndexPanel />

      {/* 계좌 탭 + KIS 동기화 버튼 */}
      {(accounts.length > 0 || !loading) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 왼쪽: 계좌 탭 */}
          <ToggleChip
            active={selectedAccountId === null}
            size="sm"
            onClick={() => setSelectedAccountId(null)}
            count={holdings.length > 0 ? holdings.length : undefined}
          >전체</ToggleChip>
          {accounts.map(a => {
            const count = holdings.filter(h => h.account_id === a.id).length
            const isActive = selectedAccountId === a.id
            return (
              <button
                key={a.id}
                onClick={() => setSelectedAccountId(a.id)}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 text-xs rounded-lg font-medium transition-colors ${
                  isActive
                    ? 'border border-transparent text-white'
                    : 'surface border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                style={isActive ? { backgroundColor: a.color } : {}}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.7)' : a.color }} />
                {a.name}
                {count > 0 && <span className="opacity-60">({count})</span>}
              </button>
            )
          })}
          {accounts.length > 0 && (
            <Button
              variant="secondary" size="sm"
              onClick={() => {
                const inputs: Record<string, string> = {}
                const clrs: Record<string, string> = {}
                accounts.forEach(a => {
                  if (a.account_no) {
                    inputs[a.account_no] = a.name
                    clrs[a.account_no] = a.color
                  }
                })
                setAliasInputs(inputs)
                setColorInputs(clrs)
                setShowAliasModal(true)
              }}
              title="계좌 별명 편집"
              icon={<Settings2 size={12} />}
            />
          )}
          <ToggleChip
            active={privacyMode}
            size="sm"
            onClick={() => setPrivacyMode(v => !v)}
            title={privacyMode ? '금액 표시' : '금액 숨기기'}
            icon={privacyMode ? <EyeOff size={12} /> : <Eye size={12} />}
          />

          {/* 스페이서 */}
          <div className="flex-1 min-w-0" />

          {/* 오른쪽: 자동갱신 + 수동동기화 */}
          <ToggleChip
            active={autoRefresh}
            size="sm"
            onClick={toggleAutoRefresh}
            title={autoRefresh ? `자동갱신 켜짐 — ${fmtCountdown(refreshCountdown)} 후 갱신` : '자동갱신 꺼짐'}
            icon={<RefreshCw size={12} className={autoRefresh ? 'animate-spin-slow' : ''} />}
          >{autoRefresh ? fmtCountdown(refreshCountdown) : '자동'}</ToggleChip>
          <Button
            variant={kisSyncing ? 'tint' : 'secondary'} size="sm"
            onClick={handleKisSync}
            disabled={kisSyncing}
            title="KIS API 강제 재조회 (캐시 무시)"
            icon={<svg className={`w-3 h-3 ${kisSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
          >{kisSyncing ? '동기화 중' : '수동동기화'}</Button>
        </div>
      )}

      <DndContext
        sensors={portfolioSensors}
        collisionDetection={closestCenter}
        onDragStart={e => setActivePortfolioCardId(e.active.id as string)}
        onDragEnd={handlePortfolioCardDragEnd}
      >
        <SortableContext items={portfolioCardOrder} strategy={rectSortingStrategy}>
          <div className="flex flex-col gap-4">
            {/* Summary Bar */}
            <SortableItem id="portfolio-summary" order={portfolioCardOrder.indexOf('portfolio-summary')}>{(dragHandle) => (
            <Card
              collapsible
              id="portfolio-summary"
              dragHandle={dragHandle}
              icon={<LayoutDashboard size={15} />}
              title="포트폴리오 요약"
              subtitle={lastFetched ? `업데이트 ${fmtUpdated(lastFetched)}` : undefined}
              contentClassName="p-4 space-y-3"
            >
        {displaySummary ? (
          <>
            {/* NXT 토글 */}
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={nxtMode}
                  onClick={() => setNxtMode(v => !v)}
                  className={`relative w-8 h-4 rounded-full transition-colors duration-200 ${
                    nxtMode ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${nxtMode ? 'translate-x-4' : ''}`} />
                </button>
                <span className={`text-2xs font-medium transition-colors ${nxtMode ? 'text-accent' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  NXT 시간외 가격 반영
                </span>
              </div>
            </div>
            {/* 선택된 계좌 표시 */}
            {selectedAccountId !== null && (() => {
              const acct = accounts.find(a => a.id === selectedAccountId)
              return acct ? (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 pb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: acct.color }} />
                  <span className="font-medium" style={{ color: acct.color }}>{acct.name}</span>
                  <span>계좌</span>
                </div>
              ) : null
            })()}
            {/* 1행: 기본 요약 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5 font-medium">총 평가액</p>
                <p className={`text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 ${pBlur}`}>{formatPrice(displaySummary.total_value)}</p>
              </div>
              <div>
                <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5 font-medium">총 투자금</p>
                <p className={`text-sm tabular-nums text-zinc-700 dark:text-zinc-300 ${pBlur}`}>{formatPrice(displaySummary.total_cost)}</p>
              </div>
              <div>
                <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5 font-medium">총 손익</p>
                <p className={`text-sm font-semibold tabular-nums ${(displaySummary.total_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'} ${pBlur}`}>
                  {formatPrice(displaySummary.total_pnl)}
                </p>
              </div>
              <div>
                <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-0.5 font-medium">수익률</p>
                <p className={`text-sm font-semibold tabular-nums ${(displaySummary.total_pnl_pct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                  {formatPct(displaySummary.total_pnl_pct)}
                </p>
              </div>
            </div>
            {/* 2행: 당일 변동 */}
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-2xs text-zinc-500 mb-0.5 font-medium">어제 대비</p>
                <p className={`text-sm font-semibold tabular-nums ${(displaySummary.day_pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                  <span className={pBlur}>{displaySummary.day_pnl != null ? formatPrice(displaySummary.day_pnl) : '-'}</span>
                  {displaySummary.day_pnl_pct != null && (
                    <span className="text-xs ml-1">({formatPct(displaySummary.day_pnl_pct)})</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-2xs text-zinc-500 mb-0.5 font-medium">예수금</p>
                <p className={`text-sm tabular-nums text-zinc-700 dark:text-zinc-300 ${pBlur}`}>
                  {(displaySummary as any).deposit != null ? formatPrice((displaySummary as any).deposit) : '-'}
                </p>
                <p className="text-2xs text-zinc-400">{displaySummary.count}종목</p>
              </div>
              <div className="col-span-2">
                <p className="text-2xs text-zinc-500 mb-0.5 font-medium">비중 분포</p>
                <WeightBar holdings={filteredHoldings} privacyMode={privacyMode} />
              </div>
            </div>
            {(() => {
              const acct = selectedAccountId !== null ? accounts.find(a => a.id === selectedAccountId) : null
              const kisAcct = acct?.account_no ? kisAccountsData.find(b => b.account_no === acct.account_no) : null
              return (
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
                  <p className="text-2xs text-zinc-500 font-medium mb-2">
                    수익률 추이 {acct ? `(${acct.name})` : '(전체)'}
                  </p>
                  <PortfolioHistoryChart
                    accountNo={acct?.account_no}
                    todayPnlPct={acct ? kisAcct?.total_pnl_pct : displaySummary?.total_pnl_pct}
                  />
                </div>
              )
            })()}
          </>
        ) : loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-16 mb-1.5 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-400 text-center py-4">
            {selectedAccountId !== null ? '이 계좌에 종목이 없습니다' : '보유 종목이 없습니다'}
          </p>
        )}
            </Card>
            )}</SortableItem>

            {/* Holdings Table */}
            <SortableItem id="portfolio-holdings" order={portfolioCardOrder.indexOf('portfolio-holdings')}>{(dragHandle) => (
            <Card
              collapsible
              id="portfolio-holdings"
              dragHandle={dragHandle}
              icon={<Briefcase size={15} />}
              title={`보유 종목${!loading ? ` (${filteredHoldings.length})` : ''}`}
              subtitle={lastUpdated ? `주가 ${lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : undefined}
              contentClassName=""
      >
        <DataTable
          id="portfolio-holdings"
          columns={portfolioCols}
          data={filteredHoldings}
          rowKey={(h) => h.id}
          onRowClick={privacyMode ? undefined : (h) => setSelectedHolding(h)}
          selectedKey={selectedHolding?.id}
          loading={loading}
          emptyMessage={selectedAccountId !== null ? '이 계좌에 종목이 없습니다.' : '보유 종목이 없습니다. 종목을 추가하세요.'}
          serverState={serverColState}
          onPersist={handleColPersist}
        />
            </Card>
            )}</SortableItem>

          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activePortfolioCardId && (
            <div className="rounded-xl bg-accent/20 border-2 border-accent/60 border-dashed flex items-center justify-center h-14 min-w-[160px] px-4 shadow-lg">
              <span className="text-accent text-xs font-medium">
                {PORTFOLIO_CARD_TITLES[activePortfolioCardId]}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Drawer */}
      {selectedHolding && (
        <HoldingDrawer
          holding={selectedHolding}
          onClose={() => setSelectedHolding(null)}
          accounts={accounts}
        />
      )}

      {/* 계좌 별명 편집 모달 */}
      {showAliasModal && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
          onClick={() => setShowAliasModal(false)}
        >
          <div className="w-full max-w-sm mx-4 panel-surface border rounded-2xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">계좌 별명 · 색상 편집</h3>
              <button onClick={() => setShowAliasModal(false)} className="text-zinc-400 hover:text-zinc-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {accounts.filter(a => a.account_no).map(a => (
                <div key={a.account_no} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={colorInputs[a.account_no!] ?? a.color}
                    onChange={e => setColorInputs(prev => ({ ...prev, [a.account_no!]: e.target.value }))}
                    className="w-7 h-7 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer flex-shrink-0 p-0.5 bg-white dark:bg-zinc-800"
                    title="계좌 색상"
                  />
                  <span className="text-2xs text-zinc-400 w-20 flex-shrink-0 tabular-nums">{a.account_no}</span>
                  <input
                    type="text"
                    value={aliasInputs[a.account_no!] ?? a.name}
                    onChange={e => setAliasInputs(prev => ({ ...prev, [a.account_no!]: e.target.value }))}
                    className="flex-1 text-xs px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent"
                    maxLength={20}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="md" fullWidth onClick={() => setShowAliasModal(false)}>취소</Button>
              <Button
                variant="primary" size="md" fullWidth
                loading={aliasSaving} loadingText="저장 중..."
                onClick={async () => {
                  setAliasSaving(true)
                  try {
                    await Promise.all([
                      kisApi.updateAliases(aliasInputs),
                      kisApi.updateColors(colorInputs),
                    ])
                    setShowAliasModal(false)
                    await loadData()
                  } catch { /* ignore */ } finally {
                    setAliasSaving(false)
                  }
                }}
              >저장</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}

export default Portfolio
