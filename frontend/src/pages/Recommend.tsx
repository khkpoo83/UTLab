import React, { useCallback, useEffect, useRef, useState } from 'react'
import { recommendApi, portfolioApi, RecommendGroup } from '../api/client'
import { getTonalPalette } from '../utils/theme'
import Skeleton from '../components/Skeleton'
import SectorDonut from '../components/SectorDonut'
import EmptyState from '../components/EmptyState'
import WeightBadge from '../components/WeightBadge'
import HoldingStackBar from '../components/HoldingStackBar'
import RecommendStockRow from '../components/RecommendStockRow'
import { Lightbulb, PieChart as PieChartIcon, LayoutList, RefreshCw } from 'lucide-react'
import Button from '../components/Button'
import { Card, fmtUpdated } from '../components/Card'

// 뉴스 섹터 → 주식 섹터 매핑
const SECTOR_REMAP: Record<string, string> = {
  'IT/반도체': '반도체/IT',
  '금융': '금융',
  '에너지': '에너지/화학',
  '바이오/헬스케어': '바이오/헬스케어',
  '소비재': '소비재/유통',
  '산업재': '산업재/기계',
  '통신': '통신',
  '유틸리티': '유틸리티',
  '부동산': '건설/부동산',
  '소재': '소재/철강',
  '자동차': '자동차/배터리',
  '방위산업': '방위산업',
  'AI/로봇': 'AI/로봇',
  '기타': '기타',
}

function remapSector(sector: string): string {
  return SECTOR_REMAP[sector] ?? sector
}

const Recommend: React.FC = () => {
  const [groups, setGroups] = useState<RecommendGroup[]>([])
  const [sectors, setSectors] = useState<Record<string, number>>({})
  const [portfolioValues, setPortfolioValues] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRateLimited, setAiRateLimited] = useState(false)
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [groupsRes, sectorsRes, portfolioRes, aiStatusRes] = await Promise.all([
        recommendApi.list(),
        recommendApi.sectors(),
        portfolioApi.list(),
        recommendApi.aiStatus(),
      ])
      setGroups(groupsRes.data)
      setSectors(sectorsRes.data.sectors)
      const valMap = new Map<string, number>()
      for (const item of portfolioRes.data) {
        valMap.set(item.ticker, item.avg_price * item.quantity)
      }
      setPortfolioValues(valMap)
      setAiRateLimited(aiStatusRes.data.rate_limited)
      setRateLimitSeconds(aiStatusRes.data.rate_limit_seconds_remaining)
      setLastFetched(new Date())
    } catch {
      // Handle error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 백그라운드 재계산 완료 폴링
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await recommendApi.refreshStatus()
        const { running, done, error } = res.data
        if (error) {
          setAiError(error)
          setRefreshing(false)
          setRefreshMsg(null)
          clearInterval(pollRef.current!)
          pollRef.current = null
        } else if (done) {
          await loadData()
          setRefreshing(false)
          setRefreshMsg('재계산 완료')
          clearInterval(pollRef.current!)
          pollRef.current = null
          setTimeout(() => setRefreshMsg(null), 3000)
        } else if (!running) {
          // 이미 종료됐지만 done/error 없는 경우
          setRefreshing(false)
          clearInterval(pollRef.current!)
          pollRef.current = null
        }
      } catch {
        // ignore poll errors
      }
    }, 8000)
  }, [loadData])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    setAiError(null)
    setRefreshMsg(null)
    try {
      const res = await recommendApi.refresh()
      if (res.data.error) {
        setAiError(res.data.error)
        setAiRateLimited(res.data.rate_limited ?? false)
        setRefreshing(false)
      } else if (res.data.running) {
        setRefreshMsg('AI 분석 중 (1~2분 소요)...')
        startPolling()
      }
    } catch {
      setAiError('AI 서버 연결 실패. 잠시 후 다시 시도해 주세요.')
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shadow-sm">
            <Lightbulb size={18} className="text-zinc-500 dark:text-zinc-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">주식 추천</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Gemini AI 분석 · 뉴스+차트+매크로 종합 · 매일 07:00/22:00 업데이트
            </p>
          </div>
        </div>
        <Button variant="secondary" size="md"
          onClick={handleRefresh} disabled={refreshing}
          loading={refreshing} loadingText="계산 중..."
          icon={<RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />}
        >재계산</Button>
      </div>

      {/* 재계산 진행 메시지 */}
      {refreshMsg && !aiError && (
        <div className="notice notice-accent text-xs flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {refreshMsg}
        </div>
      )}

      {/* AI 상태 배너 */}
      {aiRateLimited && !aiError && (
        <div className="notice notice-amber text-xs">
          AI 서비스 일시 사용 불가 (Rate Limit 초과)
          {rateLimitSeconds > 0 && ` · 약 ${Math.ceil(rateLimitSeconds / 60)}분 후 자동 복구`}
        </div>
      )}
      {aiError && (
        <div className="notice notice-amber text-xs">{aiError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sector Chart */}
        <Card
          collapsible
          id="recommend-sectors"
          icon={<PieChartIcon size={15} />}
          title="섹터 분포"
        >
          <SectorDonut sectors={sectors} loading={loading} />
        </Card>

        {/* Recommendations */}
        <Card
          collapsible
          id="recommend-list"
          icon={<LayoutList size={15} />}
          title="추천 종목"
          subtitle={lastFetched ? `업데이트 ${fmtUpdated(lastFetched)}` : undefined}
          contentClassName=""
          className="lg:col-span-2"
        >
          {loading ? (
            <div className="p-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-32 rounded" />
                  <Skeleton className="h-8 w-full rounded" />
                  <Skeleton className="h-8 w-full rounded" />
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState message="추천 데이터가 없습니다." hint="뉴스를 수집하고 재계산 버튼을 눌러보세요." />
          ) : (
            <div>
              {groups.map((group, groupIdx) => {
                const displaySector = remapSector(group.sector)
                const holdingItems = group.items.filter((i) => i.is_portfolio)
                const nonHoldingItems = group.items.filter((i) => !i.is_portfolio)
                const palette = getTonalPalette()
                return (
                  <div key={group.sector}>
                    {/* Sector Header */}
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800">
                      <LayoutList size={14} className="text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: palette[groupIdx % palette.length] }}
                      />
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {displaySector}
                      </span>
                      <WeightBadge weight={group.sector_weight ?? 0} />
                      <div className="flex-1" />
                      <span className="text-2xs text-zinc-400">
                        {group.items.length}개 종목
                      </span>
                    </div>
                    {/* 보유 종목: 스택 바만 표시 (행 나열 없음) */}
                    {holdingItems.length > 0 && (
                      <div className="px-4 pt-3">
                        <HoldingStackBar items={holdingItems} portfolioValues={portfolioValues} />
                      </div>
                    )}
                    {/* 추천 종목만 행으로 표시 */}
                    {nonHoldingItems.map((item) => (
                      <RecommendStockRow key={item.ticker} item={item} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export default Recommend
