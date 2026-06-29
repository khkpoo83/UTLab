import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// --- Request deduplication: same GET URL -> share the same in-flight promise ---
const _inFlight = new Map<string, Promise<AxiosResponse<any>>>()

function deduplicatedGet<T>(url: string, config?: object): Promise<AxiosResponse<T>> {
  const key = url + (config ? JSON.stringify(config) : '')
  const existing = _inFlight.get(key)
  if (existing) return existing as Promise<AxiosResponse<T>>
  const req = apiClient.get<T>(url, config as any).finally(() => _inFlight.delete(key))
  _inFlight.set(key, req)
  return req
}

// --- Retry helper for GET requests (max 2 retries, 1s delay) ---
async function retryGet<T>(url: string, config?: object, maxRetries = 2): Promise<AxiosResponse<T>> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await deduplicatedGet<T>(url, config)
    } catch (err: any) {
      lastError = err
      // Don't retry on 401/403/404
      const status = err?.response?.status
      if (status === 401 || status === 403 || status === 404) throw err
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1000))
      }
    }
  }
  throw lastError
}

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error.config?.url ?? ''
    // /api/calendar/* 의 401은 Google 토큰 문제이므로 로그아웃 제외
    if (error.response?.status === 401 && !url.includes('/api/calendar/')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default apiClient

// Profile types
export interface UserProfile {
  display_name: string | null
  birth_date: string | null   // "YYYY-MM-DD"
  profile_icon: string        // 이모지
  job: string | null
  retire_age: number
  monthly_income_만: number | null
  age: number | null
  birth_year: number | null
}

// Auth
export const authApi = {
  login: (username: string, password: string) => {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    return apiClient.post<{ access_token: string; token_type: string }>(
      '/api/auth/login',
      form,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
  },
  me: () => apiClient.get<{ id: number; username: string }>('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.put<{ message: string }>('/api/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
}

// Profile API
export const profileApi = {
  get: () => retryGet<UserProfile>('/api/profile').then(r => r.data),
  update: (data: Partial<Omit<UserProfile, 'age' | 'birth_year'>>) =>
    apiClient.put<UserProfile>('/api/profile', data).then(r => r.data),
}

// Account types
export interface Account {
  id: number
  name: string
  color: string
  created_at: string
  account_no?: string  // KIS 계좌번호 (히스토리 필터용)
}

export const accountsApi = {
  list: () => retryGet<Account[]>('/api/accounts'),
  create: (data: { name: string; color?: string }) => apiClient.post<Account>('/api/accounts', data),
  update: (id: number, data: { name?: string; color?: string }) => apiClient.put<Account>(`/api/accounts/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/accounts/${id}`),
}

// Portfolio types
export interface PortfolioItem {
  id: number
  ticker: string
  name: string
  exchange: string | null
  avg_price: number
  quantity: number
  memo: string | null
  bought_at: string | null
  sector: string | null
  created_at: string
  source: string
  current_price: number | null
  pnl: number | null
  pnl_pct: number | null
  current_value: number | null
  day_change: number | null
  day_change_pct: number | null
  weight: number | null
  sparkline: number[]
  account_id: number | null
  account_name: string | null
  kis_market?: string
}

export interface PortfolioSummary {
  total_value: number
  total_cost: number
  total_pnl: number
  total_pnl_pct: number
  count: number
  day_pnl: number | null
  day_pnl_pct: number | null
  up_count: number
  down_count: number
}

export interface ChartPoint {
  time: string | number // 일봉="YYYY-MM-DD" / 분봉(1d·1w)=unix초
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface PortfolioHistoryPoint {
  date: string        // "YYYY-MM-DD"
  total_value: number
  total_cost: number
  pnl: number         // 미실현 손익
  pnl_pct: number
  realized_pnl: number  // 누적 실현 손익
  net_deposits: number  // 앵커 이후 누적 순입금 (0 = 앵커 이전 or 입출금 내역 없음)
  cash_balance: number  // 예수금
  equity: number        // 평가자산 = total_value + cash_balance
  unrealized_pnl: number // 미실현 손익 (= total_value - total_cost)
}

export interface DepositEventItem {
  id: number
  account_no: string
  date: string
  amount: number       // 양수=입금, 음수=출금
  remark: string | null
  balance_after: number | null
}

// Portfolio Analysis types
export interface PortfolioAnalysisItem {
  ticker: string
  name: string
  outlook: 'bullish' | 'neutral' | 'bearish'
  recommendation: 'buy_more' | 'hold' | 'reduce' | 'sell'
  short_term_forecast: string
  key_points: string[]
  risks: string
  confidence: 'high' | 'medium' | 'low'
}

export interface PortfolioAnalysisGroup {
  account_id: number | null
  account_name: string
  session_date: string
  generated_at: string
  items: PortfolioAnalysisItem[]
}

// Portfolio API
export const portfolioApi = {
  list: (opts?: { skip_price?: boolean }) =>
    retryGet<PortfolioItem[]>('/api/portfolio', opts?.skip_price ? { params: { skip_price: true } } : undefined),
  summary: () => retryGet<PortfolioSummary>('/api/portfolio/summary'),
  history: (days?: number, accountNo?: string) =>
    retryGet<PortfolioHistoryPoint[]>('/api/portfolio/history', {
      params: {
        ...(days && { days }),
        ...(accountNo && { account_no: accountNo }),
      },
    }),
  todayNetDeposits: (accountNo?: string) =>
    retryGet<{ date: string; net_deposits: number }>('/api/portfolio/net-deposits', {
      params: { ...(accountNo && { account_no: accountNo }) },
    }),
  analysis: () => retryGet<PortfolioAnalysisGroup[]>('/api/portfolio/analysis').then(r => r.data),
  refreshAnalysis: () => apiClient.post<{ message: string; count: number }>('/api/portfolio/analysis/refresh').then(r => r.data),
  create: (data: {
    ticker: string
    name: string
    exchange?: string
    avg_price: number
    quantity: number
    memo?: string
    bought_at?: string
    sector?: string
    account_id?: number | null
  }) => apiClient.post<PortfolioItem>('/api/portfolio', data),
  update: (
    id: number,
    data: Partial<{
      avg_price: number
      quantity: number
      memo: string
      bought_at: string
      sector: string
      name: string
      account_id: number | null
    }>
  ) => apiClient.put<PortfolioItem>(`/api/portfolio/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/portfolio/${id}`),
  chart: (id: number, period: string) =>
    retryGet<ChartPoint[]>(`/api/portfolio/${id}/chart?period=${period}`),
  news: (id: number) => retryGet<NewsItem[]>(`/api/portfolio/${id}/news`),
  search: (q: string) =>
    retryGet<{ ticker: string; name: string; exchange: string }[]>(
      `/api/portfolio/search?q=${encodeURIComponent(q)}`
    ),
  chartByTicker: (ticker: string, period: string, before?: number) =>
    retryGet<ChartPoint[]>(
      `/api/portfolio/by-ticker/${ticker}/chart?period=${period}` +
      (before != null ? `&before=${before}` : '')
    ),
  newsByTicker: (ticker: string, name?: string) =>
    retryGet<NewsItem[]>(`/api/portfolio/by-ticker/${ticker}/news${name ? `?name=${encodeURIComponent(name)}` : ''}`),
  infoByTicker: (ticker: string) =>
    retryGet<StockFundamentals>(`/api/portfolio/by-ticker/${ticker}/info`),
}

export interface StockFundamentals {
  name: string | null
  currency: string | null
  market_cap: number | null
  market_cap_display: string | null
  per: number | null
  forward_per: number | null
  pbr: number | null
  eps: number | null
  bps: number | null
  dividend_yield: number | null
  roe: number | null
  week52_high: number | null
  week52_low: number | null
  sector: string | null
  industry: string | null
  summary: string | null
}

export interface StockTransaction {
  date: string
  type: string          // "매수" | "매도"
  quantity: number
  price: number
  amount: number
  remark: string
  account_no?: string
}

// News types
export interface NewsItem {
  id: number
  title: string
  url: string
  source: string | null
  published_at: string | null
  summary: string | null
  sector: string | null
  related_stocks: string[] | null
  group_id: string | null
  status: 'pending' | 'summarizing' | 'done' | 'failed'
  created_at: string
}

export interface NewsList {
  total: number
  page: number
  page_size: number
  items: NewsItem[]
}

// News API
export const newsApi = {
  list: (params?: { page?: number; page_size?: number; sector?: string; status?: string; date?: string }) =>
    retryGet<NewsList>('/api/news', { params }),
  get: (id: number) => retryGet<NewsItem>(`/api/news/${id}`),
  refresh: () => apiClient.post<{ message: string; count: number }>('/api/news/refresh'),
  queueStatus: () => retryGet<{
    queue_size: number
    worker_running: boolean
    pending: number
    summarizing: number
    done: number
  }>('/api/news/queue/status'),
}

// Recommend types
export interface RecommendItem {
  id: number | null
  ticker: string
  name: string
  sector: string | null
  sector_weight: number | null
  news_count: number
  latest_price: number | null
  change_pct: number | null
  strength: 'strong' | 'normal' | 'watch' | null
  is_portfolio: boolean
  source: 'portfolio' | 'news'
  created_at: string | null
  latest_news_title: string | null
  reason?: string | null
  confidence?: 'high' | 'medium' | null
  ai_session?: 'morning' | 'evening' | null
  entry_price?: number | null
  entry_range_low?: number | null
  entry_range_high?: number | null
  target_price?: number | null
  target_return_pct?: number | null
  stop_loss_price?: number | null
  stop_loss_pct?: number | null
  technical_summary?: string | null
  generated_at?: string | null
  community_sentiment?: string | null
  political_theme?: 'ruling' | 'opposition' | 'common' | null
  political_weight?: number | null
}

export interface RecommendGroup {
  sector: string
  sector_weight: number
  items: RecommendItem[]
}

// Recommend API
export const recommendApi = {
  list: () => retryGet<RecommendGroup[]>('/api/recommend'),
  sectors: () => retryGet<{ sectors: Record<string, number> }>('/api/recommend/sectors'),
  refresh: () => apiClient.post<{ message?: string; error?: string; rate_limited?: boolean; running?: boolean }>('/api/recommend/refresh'),
  refreshStatus: () => apiClient.get<{ running: boolean; done: boolean; error: string | null }>('/api/recommend/refresh-status'),
  aiStatus: () => retryGet<{ available: boolean; rate_limited: boolean; rate_limit_seconds_remaining: number; rpd_used: number; rpd_limit: number }>('/api/recommend/ai-status'),
}

// MockTrade types
export interface MockTrade {
  id: number
  ticker: string
  name: string
  mock_price: number | null
  quantity: number
  total_amount: number | null
  entry_reason: string | null
  target_return: number | null
  target_price: number | null
  stop_loss_price: number | null
  status: 'analyzing' | 'pending' | 'holding' | 'closed' | 'rejected' | 'failed'
  user_accepted: boolean | null
  pnl: number | null
  pnl_pct: number | null
  closed_at: string | null
  close_price: number | null
  close_reason: string | null
  created_at: string
  current_price?: number | null
  current_pnl?: number | null
  current_pnl_pct?: number | null
}

export interface MockStats {
  total_proposals: number
  accepted_count: number
  accept_rate: number | null
  closed_count: number
  win_rate: number | null
  avg_return: number | null
  holding_count: number
  seed_money: number
}

// MockTrade API
export const mockApi = {
  proposals: () => retryGet<MockTrade[]>('/api/mock/proposals'),
  holdings: () => retryGet<MockTrade[]>('/api/mock/holdings'),
  history: (params?: { limit?: number; accepted?: boolean }) =>
    retryGet<MockTrade[]>('/api/mock/history', { params }),
  stats: () => retryGet<MockStats>('/api/mock/stats'),
  accept: (id: number) => apiClient.post<MockTrade>(`/api/mock/proposals/${id}/accept`),
  reject: (id: number) => apiClient.post<{ message: string }>(`/api/mock/proposals/${id}/reject`),
  refresh: () => apiClient.post<{ message: string; enqueued: number }>('/api/mock/refresh'),
}

// Settings API
export interface AiUsageStats {
  model: string
  rpm_used: number
  rpm_limit: number
  rpm_remaining: number
  rpd_used: number
  rpd_limit: number
  rpd_remaining: number
  tokens_in_today: number
  tokens_out_today: number
  failed_total: number
}

export const settingsApi = {
  get: () => retryGet<Record<string, any>>('/api/settings'),
  update: (settings: Record<string, any>) => apiClient.put<Record<string, any>>('/api/settings', { settings }),
  aiUsage: () => retryGet<AiUsageStats>('/api/settings/ai-usage'),
  publicGet: () => apiClient.get<Record<string, any>>('/api/settings/public'),
}

// Watchlist types
export interface WatchlistItem {
  id: number
  ticker: string
  name: string
  exchange: string
  target_price: number | null
  memo: string | null
  current_price: number | null
  change_pct: number | null
  is_recommended: boolean
  added_at: string
}

// Backtest types
export interface BacktestStats {
  total_evaluated: number
  hit_target_count: number
  hit_target_rate: number
  hit_stop_count: number
  hit_stop_rate: number
  expired_count: number
  avg_return_pct: number
  by_sector: Record<string, { count: number; hit_rate: number; avg_return: number }>
  by_session: Record<string, { count: number; hit_rate: number; avg_return: number }>
}

// Portfolio analytics types
export interface PortfolioSnapshot {
  date: string
  total_value: number
  total_cost: number
  pnl: number
  pnl_pct: number
}

// Watchlist API
export const watchlistApi = {
  list: () => retryGet<WatchlistItem[]>('/api/watchlist').then(r => r.data),
  create: (data: { ticker: string; name: string; exchange: string; target_price?: number; memo?: string }) =>
    apiClient.post<WatchlistItem>('/api/watchlist', data).then(r => r.data),
  update: (id: number, data: { target_price?: number; memo?: string; name?: string }) =>
    apiClient.put<WatchlistItem>(`/api/watchlist/${id}`, data).then(r => r.data),
  remove: (id: number) => apiClient.delete(`/api/watchlist/${id}`),
}

// Backtest API
export const backtestApi = {
  stats: () => retryGet<BacktestStats>('/api/backtest/stats').then(r => r.data),
  evaluate: () => apiClient.post('/api/backtest/evaluate').then(r => r.data),
}

// Index types
export interface MarketIndex {
  symbol: string
  name: string
  price: number | null
  change: number | null
  change_pct: number | null
  updated_at: string | null
}

// Index API
export const indicesApi = {
  get: () => retryGet<MarketIndex[]>('/api/indices'),
}

// ─── KIS API 타입 ─────────────────────────────────────────────────────────────

export interface KISHolding {
  ticker: string
  name: string
  quantity: number
  avg_price: number
  current_price: number
  eval_amount: number
  pnl_amount: number
  pnl_pct: number
  purchase_amount: number
  market?: string           // "KRX" | "NXT"
  krx_current_price?: number  // NXT 종목의 KRX 기준 가격 (NXT 토글 OFF 시 사용)
  krx_eval_amount?: number    // NXT 종목의 KRX 기준 평가금액
}

export interface KISAccountBalance {
  account_no: string
  account_type: string  // GENERAL, ISA, IRP_PERSONAL, IRP_COMPANY
  alias: string
  holdings: KISHolding[]
  total_eval_amount: number
  total_purchase_amount: number
  total_pnl_amount: number
  total_pnl_pct: number
  krx_total_eval_amount?: number   // NXT 미포함 평가금액
  krx_total_pnl_amount?: number    // NXT 미포함 손익
  krx_total_pnl_pct?: number       // NXT 미포함 수익률
  deposit: number
  total_assets: number
  fetched_at?: number
  error?: string
}

export interface KISAccountInfo {
  account_no: string
  account_type: string
  alias: string
}

// KIS 포트폴리오 holding (price_detail + sparkline 보강된 형태)
export interface KISPortfolioHolding {
  ticker: string
  name: string
  exchange: string
  avg_price: number
  quantity: number
  current_price: number | null
  krx_current_price?: number | null   // NXT 종목의 KRX 기준 가격
  current_value: number
  krx_eval_amount?: number | null      // NXT 종목의 KRX 기준 평가금액
  pnl: number
  pnl_pct: number
  day_change: number | null
  day_change_pct: number | null
  weight: number | null
  sparkline: number[]
  sector: string | null
  kis_market?: string                  // "KRX" | "NXT"
  source: 'kiwoom'
  memo: null
  bought_at: null
}

// KIS 계좌별 포트폴리오
export interface KISPortfolioAccount {
  account_no: string
  account_type: string
  alias: string
  total_eval_amount: number
  total_purchase_amount: number
  total_pnl_amount: number
  total_pnl_pct: number
  krx_total_eval_amount?: number
  krx_total_pnl_amount?: number
  krx_total_pnl_pct?: number
  deposit: number
  holdings: KISPortfolioHolding[]
}

export const kisApi = {
  getAccounts: (): Promise<KISAccountInfo[]> =>
    apiClient.get('/api/kis/accounts').then(r => r.data),

  getAllBalance: (): Promise<KISAccountBalance[]> =>
    apiClient.get('/api/kis/balance').then(r => r.data),

  getAccountBalance: (accountNo: string): Promise<KISAccountBalance> =>
    apiClient.get(`/api/kis/balance/${accountNo}`).then(r => r.data),

  getPortfolio: (force = false): Promise<KISPortfolioAccount[]> =>
    apiClient.get('/api/kis/portfolio', force ? { params: { force: true } } : undefined).then(r => r.data),

  sync: (): Promise<{ status: string; accounts: number }> =>
    apiClient.post('/api/kis/sync').then(r => r.data),

  getAliases: (): Promise<Record<string, string>> =>
    apiClient.get('/api/kis/aliases').then(r => r.data),

  updateAliases: (aliases: Record<string, string>): Promise<Record<string, string>> =>
    apiClient.put('/api/kis/aliases', aliases).then(r => r.data),

  getColors: (): Promise<Record<string, string>> =>
    apiClient.get('/api/kis/colors').then(r => r.data),

  updateColors: (colors: Record<string, string>): Promise<Record<string, string>> =>
    apiClient.put('/api/kis/colors', colors).then(r => r.data),

  getDepositHistory: (accountNo = 'TOTAL'): Promise<DepositEventItem[]> =>
    retryGet<DepositEventItem[]>('/api/kis/deposit-history', { params: { account_no: accountNo } }).then(r => r.data),

  getTransactions: (ticker: string, accountNo?: string): Promise<StockTransaction[]> =>
    retryGet<StockTransaction[]>('/api/kis/transactions', {
      params: { ticker, ...(accountNo && { account_no: accountNo }) },
    }).then(r => r.data),

  syncDepositHistory: (): Promise<{ synced: number; by_account: Record<string, number> }> =>
    apiClient.post('/api/kis/deposit-history/sync').then(r => r.data),
}

// ─── Planner OCR API ──────────────────────────────────────────────────────────

export type PlannerOcrItem = 'dc_irp' | 'nps' | 'mortgage' | 'private_pension'

export interface DcIrpOcrResult {
  balance: number | null
  rate: number | null
  date: string | null
}
export interface NpsOcrResult {
  monthly_65: number | null
  monthly_60: number | null
  monthly_70: number | null
  date: string | null
}
export interface MortgageOcrResult {
  start_date: string | null
  principal: number | null
  rate: number | null
  months: number | null
  balance: number | null
  monthly_payment: number | null
}
export interface PrivatePensionOcrResult {
  product_name: string | null
  balance: number | null
  date: string | null
}

export type PlannerOcrResult = DcIrpOcrResult | NpsOcrResult | MortgageOcrResult | PrivatePensionOcrResult

export interface IncomeItem {
  name: string         // "ISA (15년 인출)", "국민연금", ...
  amount_만: number    // 양수 정수
  certainty?: string   // "★★★", "★★☆", "★☆☆"
  note?: string        // "15년 분할", "종신" 등 부가 설명
}

export interface ExpenseItem {
  name: string         // "주담대", "NPS 임의계속가입"
  amount_만: number    // 양수 정수 (화면에서 마이너스 표시)
  until?: string       // "67세까지", "60세까지"
}

export interface AgeSnapshot {
  age: number
  label: string
  monthly_만: number
  income: IncomeItem[]
  expense: ExpenseItem[]
}

export interface PlannerScenario {
  id: number
  name: string
  tags: string[]
  recommended?: boolean
  age_snapshots: AgeSnapshot[]
  pros: string[]
  cons: string[]
  key_action: string
}

export interface ClarificationQuestion {
  text: string
  options: string[]
}

export interface PlannerChatResponse {
  // 명확화 모드
  need_clarification?: boolean
  summary?: string
  questions?: ClarificationQuestion[]
  // 시나리오 모드
  analysis?: string
  scenarios?: PlannerScenario[]
  recommendation_reason?: string
}

export interface PlannerChatRequest {
  retirement_age: number
  current_age?: number
  birth_year?: number
  current_year?: number
  isa1_balance: number
  isa1_monthly: number
  isa1_rate: number
  isa2_monthly: number
  isa2_rate: number
  dc_irp_balance: number
  dc_irp_rate: number
  dc_irp_monthly?: number
  dc_receipt_age?: number
  dc_payout_years?: number
  nps_base_monthly: number
  nps_receipt_age: number
  nps_voluntary_cont?: boolean | null
  nps_voluntary_monthly?: number
  house_price: number
  mortgage_balance: number
  mortgage_balance_at_retire?: number
  mortgage_monthly: number
  mortgage_start_date?: string
  mortgage_total_months?: number
  mortgage_paid_off_age: number
  private_pensions: { name: string; balance: number; start_age: number; monthly_20yr: number }[]
  payout_years: number
  monthly_expense_goal?: number
  question: string
}

// ─── Google Calendar API ──────────────────────────────────────────────────────

export interface CalendarStatus {
  connected: boolean
  google_email: string | null
  event_count: number
  push_enabled: boolean
  channel_id: string | null
  channel_expires: string | null   // ISO
  last_synced: string | null        // ISO
  needs_reconnect?: boolean
}

export interface CalendarEventItem {
  id: number
  google_event_id: string
  summary: string | null
  description: string | null
  location: string | null
  start_dt: string | null   // ISO UTC
  end_dt: string | null
  all_day: boolean
  status: string | null
  html_link: string | null
  color_id: string | null
  recurrence: string[] | null
}

export const calendarApi = {
  status: (): Promise<CalendarStatus> =>
    apiClient.get<CalendarStatus>('/api/calendar/status').then(r => r.data),

  connect: (): Promise<{ auth_url: string; state: string }> =>
    apiClient.get<{ auth_url: string; state: string }>('/api/calendar/auth/connect').then(r => r.data),

  disconnect: (): Promise<{ message: string }> =>
    apiClient.delete<{ message: string }>('/api/calendar/auth/disconnect').then(r => r.data),

  sync: (): Promise<{ synced: number; message: string }> =>
    apiClient.post<{ synced: number; message: string }>('/api/calendar/sync').then(r => r.data),

  registerWatch: (): Promise<{ push_enabled: boolean; message: string }> =>
    apiClient.post<{ push_enabled: boolean; message: string }>('/api/calendar/watch/register').then(r => r.data),

  getEvents: (params?: { from_date?: string; to_date?: string; days?: number }): Promise<CalendarEventItem[]> =>
    apiClient.get<CalendarEventItem[]>('/api/calendar/events', { params }).then(r => r.data),

  getUpcoming: (limit = 10): Promise<CalendarEventItem[]> =>
    apiClient.get<CalendarEventItem[]>('/api/calendar/events/upcoming', { params: { limit } }).then(r => r.data),

  createEvent: (data: {
    summary: string; description?: string; location?: string
    start: string; end: string; all_day?: boolean; color_id?: string
    calendar_id?: string; recurrence?: string[]
  }): Promise<{ google_event_id: string; html_link: string }> =>
    apiClient.post('/api/calendar/events', data).then(r => r.data),

  updateEvent: (googleEventId: string, data: {
    summary?: string; description?: string; location?: string
    start?: string; end?: string; color_id?: string; recurrence?: string[]
  }): Promise<{ google_event_id: string; updated: boolean }> =>
    apiClient.patch(`/api/calendar/events/${googleEventId}`, data).then(r => r.data),

  deleteEvent: (googleEventId: string): Promise<{ deleted: boolean }> =>
    apiClient.delete(`/api/calendar/events/${googleEventId}`).then(r => r.data),
}

// ── 투자 일기 ─────────────────────────────────────────────────────────────────

export interface DiaryEntry {
  diary_date: string        // "YYYY-MM-DD"
  content: string
  generated_at: string
  raw_data?: {
    total_value?: number
    pnl?: number
    pnl_pct?: number
    true_daily_pnl?: number
    deposit_total?: number
    withdraw_total?: number
    buy_count?: number
    sell_count?: number
  }
}

export interface DiaryEventCreate {
  event_type: 'buy' | 'sell' | 'deposit' | 'withdraw'
  amount: number
  event_date?: string
  ticker?: string
  name?: string
  price?: number
  quantity?: number
  pnl?: number
  pnl_pct?: number
  note?: string
}

export const diaryApi = {
  latest: (): Promise<DiaryEntry | null> =>
    retryGet<DiaryEntry | Record<string, never>>('/api/diary/latest')
      .then(r => (Object.keys(r.data).length === 0 ? null : r.data as DiaryEntry)),

  generate: (date?: string, overwrite = false): Promise<{ diary_date: string; content: string }> =>
    apiClient.post('/api/diary/generate', null, { params: { date, overwrite } }).then(r => r.data),

  createEvent: (ev: DiaryEventCreate) =>
    apiClient.post('/api/diary/events', ev).then(r => r.data),

  listEvents: (date?: string) =>
    apiClient.get('/api/diary/events', { params: { date } }).then(r => r.data),
}

// ── Blog ──────────────────────────────────────────────────────────────────────
export interface BlogPost {
  id: number
  title: string
  content: string | null
  cover_image: string | null
  visibility: 'public' | 'private'
  tags: string[]
  ai_generated: boolean
  word_count: number
  created_at: string
  updated_at: string
  excerpt: string
}

export interface BlogPostCreate {
  title: string
  content?: string
  cover_image?: string
  visibility: 'public' | 'private'
  tags: string[]
  ai_generated?: boolean
}

export const blogApi = {
  list: (params?: { visibility?: string; q?: string; tag?: string; limit?: number; offset?: number }) =>
    apiClient.get<BlogPost[]>('/api/blog/posts', { params }),
  get: (id: number) => apiClient.get<BlogPost>(`/api/blog/posts/${id}`),
  create: (data: BlogPostCreate) => apiClient.post<BlogPost>('/api/blog/posts', data),
  update: (id: number, data: Partial<BlogPostCreate>) => apiClient.put<BlogPost>(`/api/blog/posts/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/blog/posts/${id}`),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const token = localStorage.getItem('token')
    // apiClient 기본 Content-Type: application/json 을 우회하기 위해 순수 axios 사용
    // FormData 전송 시 브라우저가 boundary 포함 multipart/form-data 자동 설정
    return axios.post<{ filename: string; url: string }>(
      `${BASE_URL}/api/blog/upload`,
      fd,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    )
  },
  generate: (data: {
    title: string; topic?: string; style?: string; length?: string
    language?: string; keywords?: string; audience?: string; structure?: string
    include_examples?: boolean; append_mode?: boolean; current_content?: string
  }) => apiClient.post<{ content: string }>('/api/blog/generate', data),
  generateCover: (data: { title: string; tags?: string[]; excerpt?: string }) =>
    apiClient.post<{ url: string; filename: string; prompt: string }>('/api/blog/generate-cover', data),
  publicList: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<BlogPost[]>('/api/public/blog', { params }),
  publicGet: (id: number) => apiClient.get<BlogPost>(`/api/public/blog/${id}`),
}

// ── 투자 이벤트 마커 ───────────────────────────────────────────────────────────

export interface InvestmentMark {
  id: number
  date: string              // "YYYY-MM-DD"
  title: string
  google_event_id: string | null
  google_calendar_id: string | null
  created_at: string
}

export const investmentMarksApi = {
  list: (params?: { from_date?: string; to_date?: string }): Promise<InvestmentMark[]> =>
    apiClient.get<InvestmentMark[]>('/api/portfolio/marks', { params }).then(r => r.data),

  create: (data: { date: string; title: string }): Promise<InvestmentMark> =>
    apiClient.post<InvestmentMark>('/api/portfolio/marks', data).then(r => r.data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/portfolio/marks/${id}`).then(() => undefined),

  syncGcal: (): Promise<{ synced: number }> =>
    apiClient.post<{ synced: number }>('/api/portfolio/marks/sync-gcal').then(r => r.data),

  syncUnsynced: (): Promise<{ synced: number; failed: number; error?: string }> =>
    apiClient.post<{ synced: number; failed: number; error?: string }>('/api/portfolio/marks/sync-unsynced').then(r => r.data),
}

// ── 메모(포스트잇) ─────────────────────────────────────────────────────────────

export interface Memo {
  id: number
  title: string
  body: string | null
  color: string | null
  created_at: string
  updated_at: string
}

export const memoApi = {
  list: (q?: string): Promise<Memo[]> =>
    apiClient.get<Memo[]>('/api/memos', { params: q ? { q } : undefined }).then(r => r.data),

  get: (id: number): Promise<Memo> =>
    apiClient.get<Memo>(`/api/memos/${id}`).then(r => r.data),

  create: (data: { title: string; body?: string; color?: string }): Promise<Memo> =>
    apiClient.post<Memo>('/api/memos', data).then(r => r.data),

  update: (id: number, data: { title?: string; body?: string; color?: string }): Promise<Memo> =>
    apiClient.put<Memo>(`/api/memos/${id}`, data).then(r => r.data),

  delete: (id: number): Promise<void> =>
    apiClient.delete(`/api/memos/${id}`).then(() => undefined),
}

export const plannerApi = {
  ocr: (item: PlannerOcrItem, file: File): Promise<{ item: string; data: PlannerOcrResult }> => {
    const form = new FormData()
    form.append('item', item)
    form.append('file', file)
    return apiClient.post('/api/planner/ocr', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  chat: (req: PlannerChatRequest): Promise<PlannerChatResponse> =>
    apiClient.post('/api/planner/chat?model=gemini', req).then(r => r.data),
}

