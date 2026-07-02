// Home dashboard data fetching (roadmap Phase 3, P3-3 deep decomposition).
// Extracted verbatim from HomeContent — the read-only API loads (portfolio/KIS,
// recommendations, news, diary, upcoming calendar events). No widget/DnD state.
import { useState, useEffect } from 'react'
import {
  portfolioApi, kisApi, recommendApi, newsApi, diaryApi, calendarApi,
  KISPortfolioAccount, RecommendItem, NewsItem, DiaryEntry, CalendarEventItem,
} from '../../api/client'
import { flattenRecommends } from './widgetGrid'

export function useHomeData() {
  const [kisAccounts, setKisAccounts] = useState<KISPortfolioAccount[]>([])
  const [itemCount, setItemCount] = useState(0)
  const [top3, setTop3] = useState<RecommendItem[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [diary, setDiary] = useState<DiaryEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEventItem[]>([])

  useEffect(() => {
    const fetchUpcoming = () =>
      calendarApi.getUpcoming(20).then(setUpcomingEvents).catch(() => setUpcomingEvents([]))
    fetchUpcoming()
    window.addEventListener('calendarUpdated', fetchUpcoming)
    const t = setInterval(fetchUpcoming, 60_000)
    return () => { window.removeEventListener('calendarUpdated', fetchUpcoming); clearInterval(t) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [kisRes, recommendRes, newsRes, diaryRes] = await Promise.all([
          kisApi.getPortfolio().catch(() => [] as KISPortfolioAccount[]),
          recommendApi.list(),
          newsApi.list({ page: 1, page_size: 8 }),
          diaryApi.latest().catch(() => null),
        ])
        if (cancelled) return
        setKisAccounts(kisRes)
        setItemCount(kisRes.reduce((s, b) => s + b.holdings.length, 0))
        setTop3(flattenRecommends(recommendRes.data))
        setNews(newsRes.data.items)
        setDiary(diaryRes)
      } catch {
        try {
          const portfolioRes = await portfolioApi.list()
          if (!cancelled) setItemCount(portfolioRes.data.length)
        } catch { /* ignore */ }
        if (!cancelled) setError('데이터를 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { kisAccounts, itemCount, top3, news, diary, loading, error, upcomingEvents }
}
