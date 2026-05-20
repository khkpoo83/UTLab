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
import { Settings2, Eye, EyeOff, RefreshCw } from 'lucide-react'
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
import PortfolioHistoryChart from '../components/PortfolioHistoryChart'
import PageTitle from '../components/PageTitle'

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

// ── Weight Treemap ────────────────────────────────────────────────────────────
const TREEMAP_TONE = ['#0a0a0b', '#1f1f22', '#3a3a3e', '#5a5a5e', '#84827c', '#a8a6a0']

function WeightTreemap({ holdings, privacyMode }: { holdings: PortfolioItem[]; privacyMode: boolean }) {
  const sorted = holdings.filter(h => (h.weight ?? 0) > 0).slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  if (sorted.length === 0) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>보유 종목 없음</span>
    </div>
  )

  const THRESHOLD = 3
  const main = sorted.filter(h => (h.weight ?? 0) >= THRESHOLD)
  const etcItems = sorted.filter(h => (h.weight ?? 0) < THRESHOLD)
  const etcWeight = etcItems.reduce((s, h) => s + (h.weight ?? 0), 0)
  type EtcItem = { ticker: string; name: string; weight: number; _isEtc: true }
  const data: (PortfolioItem | EtcItem)[] = [
    ...main,
    ...(etcWeight > 0 ? [{ ticker: '__etc__', name: '기타', weight: etcWeight, _isEtc: true as const }] : []),
  ]

  const big = data.slice(0, 2)
  const mid = data.slice(2, 4)
  const small = data.slice(4)

  const totalW = data.reduce((s, h) => s + (h.weight ?? 0), 0)
  const pctH = (items: typeof data) => {
    const w = items.reduce((s, h) => s + (h.weight ?? 0), 0)
    return totalW > 0 && w > 0 ? (w / totalW) * 100 : 0
  }

  const TOTAL_H = 160
  const renderRow = (items: typeof data, heightPct: number, startIdx: number) => {
    if (items.length === 0 || heightPct < 0.5) return null
    const rowHeightPx = heightPct / 100 * TOTAL_H
    const rowTotal = items.reduce((s, x) => s + (x.weight ?? 0), 0)
    return (
      <div style={{ display: 'flex', height: `${heightPct}%`, gap: 2 }}>
        {items.map((h, i) => {
          const wPct = rowTotal > 0 ? ((h.weight ?? 0) / rowTotal) * 100 : 100 / items.length
          const cellIsDark = (startIdx + i) < 3
          const pad = wPct > 14 ? 8 : wPct > 7 ? 5 : 3
          const isEtc = '_isEtc' in h
          const dayPct = isEtc ? null : (h as PortfolioItem).day_change_pct
          const isUp = dayPct !== null && dayPct > 0
          const isDown = dayPct !== null && dayPct < 0
          const textColor = cellIsDark ? 'rgba(255,255,255,0.88)' : 'rgba(30,30,35,0.88)'
          // 행이 너무 얇으면(< 40px) 이름 숨김 — 텍스트 겹침 방지 (9px이름+11px퍼센트+패딩 = ~36px 이상 필요)
          const showName = wPct > 9 && rowHeightPx >= 40

          return (
            <div key={h.ticker} style={{
              flex: wPct, minWidth: 0,
              background: TREEMAP_TONE[Math.min(startIdx + i, TREEMAP_TONE.length - 1)],
              color: textColor,
              display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-start',
              padding: pad, borderRadius: 4, overflow: 'hidden',
              boxSizing: 'border-box',
            }}>
              {/* 상단: 종목명(좌) + 등락 badge(우) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, minHeight: 0 }}>
                {showName && (
                  <div style={{
                    fontSize: wPct > 20 ? 11 : 9, fontWeight: 600, lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1, minWidth: 0,
                  }}>
                    {privacyMode ? '···' : (h.name.length > 6 && wPct < 22 ? h.name.slice(0, 5) + '…' : h.name)}
                  </div>
                )}
                {dayPct !== null && !isEtc && wPct > 5 && rowHeightPx >= 16 && (
                  <div style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0, marginTop: 1,
                    background: isUp ? '#f87171' : isDown ? '#60a5fa' : 'rgba(128,128,128,0.4)',
                  }} />
                )}
              </div>
              {/* 하단: % (좌) — mt-auto로 셀 아래로 밀기 */}
              {wPct > 4 && (
                <div className="ut-mono" style={{
                  fontSize: wPct > 18 ? 14 : wPct > 9 ? 11 : 9,
                  fontWeight: 700, letterSpacing: '-0.02em',
                  marginTop: 'auto',
                }}>
                  {privacyMode ? '··%' : `${(h.weight ?? 0).toFixed(wPct > 9 ? 1 : 0)}%`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {renderRow(big, pctH(big), 0)}
      {renderRow(mid, pctH(mid), 2)}
      {renderRow(small, pctH(small), 4)}
    </div>
  )
}

function getAccountStripColor(name: string): string {
  if (/ISA/i.test(name)) return 'var(--dot)'
  if (/연금/.test(name)) return 'rgba(215,74,74,0.38)'
  if (/노후|IRP/i.test(name)) return 'var(--ink-4)'
  if (/장기/.test(name)) return 'var(--ink-3)'
  return 'var(--ink-2)'
}

const PORTFOLIO_CARD_IDS = ['portfolio-summary', 'portfolio-holdings']
const PORTFOLIO_CARD_TITLES: Record<string, string> = {
  'portfolio-summary': 'Summary',
  'portfolio-holdings': 'Holdings',
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
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const [kisAccountsData, setKisAccountsData] = useState<KISPortfolioAccount[]>([])
  const [kisSyncing, setKisSyncing] = useState(false)

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

  const autoRefreshStartRef = useRef<number>(Date.now())
  const [refreshCountdown, setRefreshCountdown] = useState(300)
  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const [privacyMode, setPrivacyMode] = useState(false)
  const [nxtMode, setNxtMode] = useState(true)

  const [showAliasModal, setShowAliasModal] = useState(false)
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({})
  const [colorInputs, setColorInputs] = useState<Record<string, string>>({})
  const [aliasSaving, setAliasSaving] = useState(false)

  const [serverColState, setServerColState] = useState<PersistedState | null | undefined>(undefined)

  const [portfolioCardOrder, setPortfolioCardOrder] = useState(loadPortfolioOrder)
  const [activePortfolioCardId, setActivePortfolioCardId] = useState<string | null>(null)
  const [histPeriod, setHistPeriod] = useState<'7'|'30'|'90'|'180'|'365'>('30')
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

  const KIS_ACCOUNT_COLORS = useMemo((): Record<string, string> => {
    const p = getTonalPalette()
    return {
      GENERAL:      p[0],
      ISA:          p[1],
      PENSION:      p[2],
      IRP_PERSONAL: p[3],
      IRP_COMPANY:  p[4],
    }
  }, [])

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

  const displaySummary = React.useMemo(() => {
    if (!kisAccountsData.length && !holdings.length) return null

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
      if (document.hidden) return
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

  const pBlur = privacyMode ? 'blur-sm select-none' : ''
  const maxWeight = useMemo(() =>
    Math.max(...filteredHoldings.map(h => h.weight ?? 0), 1),
  [filteredHoldings])
  const portfolioCols = useMemo((): DtColDef<PortfolioItem>[] => [
    {
      key: 'name', label: '종목명', width: 180, minWidth: 120,
      render: (h) => {
        const { market, marketClass } = getMarketBadge(h)
        const acct = selectedAccountId === null && h.account_id
          ? accounts.find(a => a.id === h.account_id) : null
        const stripColor = acct ? getAccountStripColor(acct.name) : null
        return (
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {stripColor && (
              <div style={{ width: 3, borderRadius: 2, background: stripColor, flexShrink: 0, marginRight: 10, alignSelf: 'stretch', minHeight: 32 }} />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={pBlur} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-0)', lineHeight: 1.3 }}>
                {h.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                <span className={`ut-mono${pBlur ? ` ${pBlur}` : ''}`} style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {h.ticker}
                </span>
                {h.kis_market === 'NXT' && (
                  <span style={{ fontSize: 9, color: 'var(--ink-4)' }}>NXT</span>
                )}
                {market && <span className={marketClass}>{market}</span>}
                {h.memo && <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-4)' }} className={pBlur}>{h.memo}</span>}
              </div>
            </div>
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
      key: 'weight', label: '비중', width: 120, type: 'pct-bar',
      getValue: (h) => h.weight ?? 0,
      barMax: maxWeight,
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

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <PageTitle
          sub="investments"
          title="Portfolio"
          subtitle={lastFetched ? fmtUpdated(lastFetched) : undefined}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          {/* NXT / KRX segmented toggle */}
          <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em' }}>
            {[
              { label: 'KRX', active: !nxtMode, onClick: () => setNxtMode(false) },
              { label: 'NXT', active: nxtMode,  onClick: () => setNxtMode(true)  },
            ].map(({ label, active, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                style={{
                  padding: '5px 12px', border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: active ? 'var(--dot)' : 'transparent',
                  color: active ? '#fff' : 'var(--ink-3)',
                  boxShadow: active ? 'inset 0 1px 2px rgba(0,0,0,0.12)' : 'none',
                }}
              >{label}</button>
            ))}
          </div>
          <ToggleChip
            active={privacyMode} size="sm"
            onClick={() => setPrivacyMode(v => !v)}
            title={privacyMode ? '금액 표시' : '금액 숨기기'}
            icon={privacyMode ? <EyeOff size={12} /> : <Eye size={12} />}
          />
          <ToggleChip
            active={autoRefresh} size="sm"
            onClick={toggleAutoRefresh}
            title={autoRefresh ? `자동갱신 켜짐 — ${fmtCountdown(refreshCountdown)} 후 갱신` : '자동갱신 꺼짐'}
            icon={<RefreshCw size={12} className={autoRefresh ? 'animate-spin-slow' : ''} />}
          >{autoRefresh
            ? <span style={{ color: 'var(--dot)', fontVariantNumeric: 'tabular-nums' }}>{fmtCountdown(refreshCountdown)}</span>
            : '자동'
          }</ToggleChip>
          <Button
            variant={kisSyncing ? 'tint' : 'secondary'} size="sm"
            onClick={handleKisSync}
            disabled={kisSyncing}
            title="KIS API 강제 재조회 (캐시 무시)"
            icon={<svg className={`w-3 h-3 ${kisSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
          >{kisSyncing ? '동기화 중' : 'Sync'}</Button>
        </div>
      </div>

      {/* ── Account Chips ─────────────────────────────────────────────────────── */}
      {(accounts.length > 0 || !loading) && (
        <div className="flex items-center gap-1.5 flex-wrap">
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
        </div>
      )}

      {/* ── Global Index ──────────────────────────────────────────────────────── */}
      <IndexPanel />

      {/* ── DnD Cards ─────────────────────────────────────────────────────────── */}
      <DndContext
        sensors={portfolioSensors}
        collisionDetection={closestCenter}
        onDragStart={e => setActivePortfolioCardId(e.active.id as string)}
        onDragEnd={handlePortfolioCardDragEnd}
      >
        <SortableContext items={portfolioCardOrder} strategy={rectSortingStrategy}>
          <div className="flex flex-col gap-4">

            {/* Summary Card */}
            <SortableItem id="portfolio-summary" order={portfolioCardOrder.indexOf('portfolio-summary')}>{(dragHandle) => (
              <Card
                collapsible
                id="portfolio-summary"
                dragHandle={dragHandle}
                title="Summary"
                contentClassName="p-0"
              >
                {displaySummary ? (
                  <>
                    {/* ── Hero: 2-column layout ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr]">
                      {/* Left: big total value */}
                      <div
                        style={{ padding: '24px 28px' }}
                      >
                        <div className="ut-eyebrow" style={{ marginBottom: 10, color: 'var(--ink-4)' }}>총 평가액</div>
                        <div className={pBlur} style={{
                          fontSize: 'clamp(40px, 5.5vw, 64px)', fontWeight: 800,
                          color: 'var(--ink-0)', letterSpacing: '-0.04em', lineHeight: 1,
                          marginBottom: 16, fontVariantNumeric: 'tabular-nums',
                        }}>
                          {Math.round(displaySummary.total_value).toLocaleString('ko-KR')}
                          <span style={{ fontSize: '0.28em', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 6, letterSpacing: 0 }}>원</span>
                        </div>
                        {displaySummary.day_pnl != null && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '5px 12px', borderRadius: 999, marginBottom: 10,
                            background: (displaySummary.day_pnl ?? 0) >= 0 ? 'rgba(229,72,77,0.18)' : 'rgba(42,111,219,0.18)',
                            color: (displaySummary.day_pnl ?? 0) >= 0 ? 'var(--up)' : 'var(--down)',
                            fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          }}>
                            {(displaySummary.day_pnl ?? 0) >= 0 ? '▲' : '▼'}
                            <span className={pBlur}>{(displaySummary.day_pnl ?? 0) >= 0 ? '+' : ''}{Math.round(displaySummary.day_pnl).toLocaleString('ko-KR')}</span>
                            {displaySummary.day_pnl_pct != null && (
                              <span style={{ opacity: 0.8 }}>({(displaySummary.day_pnl_pct ?? 0) >= 0 ? '+' : ''}{displaySummary.day_pnl_pct?.toFixed(2)}%)</span>
                            )}
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                          총 수익률{' '}
                          <span style={{
                            fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                            color: (displaySummary.total_pnl_pct ?? 0) >= 0 ? 'var(--up)' : 'var(--down)',
                          }}>
                            {(displaySummary.total_pnl_pct ?? 0) >= 0 ? '+' : ''}{displaySummary.total_pnl_pct?.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Right: KPI grid + TreeMap */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {/* KPI 2×2 */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                          {[
                            { label: '총 투자금', value: formatPrice(displaySummary.total_cost), suffix: undefined, tone: undefined as string | undefined, blurred: true },
                            { label: '예수금', value: displaySummary.deposit != null ? formatPrice(displaySummary.deposit) : '-', suffix: undefined, tone: undefined as string | undefined, blurred: true },
                            { label: '어제 대비', value: displaySummary.day_pnl != null ? formatPrice(displaySummary.day_pnl) : '-', suffix: displaySummary.day_pnl_pct != null ? formatPct(displaySummary.day_pnl_pct) : undefined, tone: (displaySummary.day_pnl ?? 0) >= 0 ? 'up' : 'down', blurred: true },
                            { label: '종목 수', value: `${displaySummary.count}`, suffix: '종목', tone: undefined as string | undefined, blurred: false },
                          ].map((item) => (
                            <div key={item.label} style={{
                              padding: '12px 14px',
                            }}>
                              <div className="ut-eyebrow" style={{ marginBottom: 6 }}>{item.label}</div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                                <span
                                  className={`ut-mono${item.blurred && pBlur ? ` ${pBlur}` : ''}`}
                                  style={{
                                    fontSize: 15, fontWeight: 800, letterSpacing: '-0.03em',
                                    color: item.tone === 'up' ? 'var(--up)' : item.tone === 'down' ? 'var(--down)' : 'var(--ink-0)',
                                  }}
                                >
                                  {item.value}
                                </span>
                                {item.suffix && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{item.suffix}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* WeightTreemap */}
                        <div style={{ padding: '12px 14px', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                          <div className="ut-eyebrow" style={{ marginBottom: 8, color: 'var(--ink-4)' }}>비중 분포</div>
                          <WeightTreemap holdings={filteredHoldings} privacyMode={privacyMode} />
                        </div>
                      </div>
                    </div>

                    {/* ── Return history chart ── */}
                    {(() => {
                      const acct = selectedAccountId !== null ? accounts.find(a => a.id === selectedAccountId) : null
                      const kisAcct = acct?.account_no ? kisAccountsData.find(b => b.account_no === acct.account_no) : null
                      const histLabels: Record<string, string> = { '7': '1W', '30': '1M', '90': '3M', '180': '6M', '365': '1Y' }
                      return (
                        <div style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <span className="ut-eyebrow">{`수익률 추이 ${acct ? `(${acct.name})` : '(전체)'}`}</span>
                            <div style={{ display: 'inline-flex', gap: 2 }}>
                              {(['7', '30', '90', '180', '365'] as const).map(v => (
                                <button
                                  key={v}
                                  onClick={() => setHistPeriod(v)}
                                  style={{
                                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                    fontSize: 11, fontWeight: 600,
                                    background: histPeriod === v ? 'var(--ink-0)' : 'transparent',
                                    color: histPeriod === v ? 'var(--paper)' : 'var(--ink-3)',
                                    transition: 'all 0.12s ease',
                                  }}
                                >
                                  {histLabels[v]}
                                </button>
                              ))}
                            </div>
                          </div>
                          <PortfolioHistoryChart
                            accountNo={acct?.account_no}
                            todayPnlPct={acct ? kisAcct?.total_pnl_pct : displaySummary?.total_pnl_pct}
                            period={parseInt(histPeriod) as 7|30|90|180|365}
                          />
                        </div>
                      )
                    })()}
                  </>
                ) : loading ? (
                  <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i}>
                        <Skeleton className="h-3 w-16 mb-1.5 rounded" />
                        <Skeleton className="h-5 w-24 rounded" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400 text-center py-8">
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
                title={`Holdings${!loading ? ` (${filteredHoldings.length})` : ''}`}
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
