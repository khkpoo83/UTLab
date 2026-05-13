import { useState, useRef } from 'react'
import { plannerApi, PlannerChatRequest, PlannerScenario, PlannerChatResponse, ClarificationQuestion, AgeSnapshot } from '../api/client'

// ─── 빠른 질문 템플릿 (AI 테스트 결과 기반으로 자동 업데이트됨) ───────────────
// QUICK_QUESTIONS_AUTO_UPDATE: 이 배열은 백그라운드 테스트 에이전트가 관리합니다

const QUICK_QUESTIONS = [
  { label: '안정적 기본안', q: '현재 설정을 기반으로 안정적인 은퇴 시나리오 3-4가지를 제안해주세요. 월 250만원 이상 수령을 목표로 합니다.' },
  { label: '주택연금 최후', q: '주택연금은 최대한 늦게(67세 주담대 완납 후) 수령하되 은퇴 직후부터 안정적으로 생활할 수 있는 방법을 알려주세요.' },
  { label: '최대 현금흐름', q: '은퇴 직후부터 가능한 많은 월 현금흐름을 확보하는 시나리오를 알려주세요.' },
  { label: '장수 대비', q: '90세까지 월수령액이 유지되는 장수 대비 시나리오를 중심으로 제안해주세요.' },
  { label: '공백기 최소화', q: '55세 퇴직 후 65세 국민연금 수령까지 10년 공백을 가장 안정적으로 채우는 방법을 알려주세요.' },
]

// ─── 색상 헬퍼 ───────────────────────────────────────────────────────────────

function amountColor(monthly_만: number): string {
  if (monthly_만 >= 400) return 'text-accent font-bold'
  if (monthly_만 >= 250) return 'text-accent'
  return 'text-zinc-400 dark:text-zinc-500'
}

function amountBg(monthly_만: number): string {
  if (monthly_만 >= 400) return 'bg-accent/10 dark:bg-accent/15 border-accent/30'
  if (monthly_만 >= 250) return 'bg-accent/5 dark:bg-accent/10 border-accent/20'
  return 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
}

function certaintyColor(c?: string): string {
  if (!c) return 'text-zinc-400'
  if (c.startsWith('★★★')) return 'text-accent'
  if (c.startsWith('★★')) return 'text-accent/70'
  return 'text-zinc-400'
}

// ─── 나이 스냅샷 행 (수입/지출 좌우 분리) ────────────────────────────────────

function AgeSnapshotRow({ snap, nextAge, isFirst }: { snap: AgeSnapshot; nextAge?: number; isFirst: boolean }) {
  const [open, setOpen] = useState(isFirst)

  const income = snap.income ?? []
  const expense = snap.expense ?? []
  const totalIncome = income.reduce((s, i) => s + i.amount_만, 0)
  const totalExpense = expense.reduce((s, e) => s + e.amount_만, 0)

  return (
    <div className={`rounded-lg border transition-all ${open ? amountBg(snap.monthly_만) : 'border-zinc-100 dark:border-zinc-800'}`}>
      {/* 헤더 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${open ? amountColor(snap.monthly_만) : 'text-zinc-500'}`}>
            {snap.age}{nextAge ? `~${nextAge}` : ''}세 <span className="text-2xs font-normal opacity-70">({1983 + snap.age})</span>
          </span>
          <span className={`text-xs truncate ${open ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
            {snap.label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className={`text-sm tabular-nums font-semibold ${amountColor(snap.monthly_만)}`}>
            월 {snap.monthly_만}만원
          </span>
          <svg
            className={`w-3.5 h-3.5 text-zinc-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (income.length > 0 || expense.length > 0) && (
        <div className="px-3 pb-3">
          <div className="w-full h-px bg-zinc-100 dark:bg-zinc-800 mb-2" />

          {/* 수입 / 지출 2컬럼 */}
          <div className="grid grid-cols-2 gap-2">
            {/* 수입 */}
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-2xs font-bold text-accent uppercase tracking-wide">수입</span>
                <span className="text-2xs text-zinc-400 tabular-nums">+{totalIncome}만</span>
              </div>
              <div className="space-y-1">
                {income.map((item, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="text-accent text-2xs flex-shrink-0 mt-0.5">+</span>
                    <div className="min-w-0">
                      <span className="text-2xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {item.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tabular-nums">
                          {item.amount_만}만
                        </span>
                        {item.certainty && (
                          <span className={`text-2xs ${certaintyColor(item.certainty)}`}>
                            {item.certainty}
                          </span>
                        )}
                      </div>
                      {item.note && (
                        <span className="text-2xs text-zinc-400 leading-tight block">{item.note}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 지출 */}
            <div className="border-l border-zinc-100 dark:border-zinc-800 pl-2">
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-2xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">지출</span>
                {totalExpense > 0 && (
                  <span className="text-2xs text-zinc-400 tabular-nums">-{totalExpense}만</span>
                )}
              </div>
              {expense.length > 0 ? (
                <div className="space-y-1">
                  {expense.map((item, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <span className="text-zinc-400 text-2xs flex-shrink-0 mt-0.5">−</span>
                      <div className="min-w-0">
                        <span className="text-2xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 tabular-nums">
                            {item.amount_만}만
                          </span>
                        </div>
                        {item.until && (
                          <span className="text-2xs text-zinc-400 leading-tight block">{item.until}까지</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-2xs text-zinc-400">없음</p>
              )}
            </div>
          </div>

          {/* 순 수령액 합계 바 */}
          <div className={`mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center`}>
            <span className="text-2xs text-zinc-500">순 수령액</span>
            <span className={`text-xs font-bold tabular-nums ${amountColor(snap.monthly_만)}`}>
              {totalExpense > 0 ? `${totalIncome} − ${totalExpense} = ` : ''}{snap.monthly_만}만원/월
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 시나리오 카드 ────────────────────────────────────────────────────────────

function ScenarioCard({ s, selected, onSelect }: { s: PlannerScenario; selected: boolean; onSelect: () => void }) {
  const [showDetail, setShowDetail] = useState(false)
  const snapshots = s.age_snapshots ?? []

  // 대표 수령액: 국민연금 개시 나이 스냅샷 or 첫 스냅
  const peakSnap = snapshots.find(sn => sn.age >= 65) ?? snapshots[0]

  return (
    <div className={`card overflow-hidden transition-all ${selected ? 'border-accent' : ''}`}>
      {/* 헤더 */}
      <div
        onClick={onSelect}
        className={`px-4 py-3 cursor-pointer flex items-start justify-between gap-2 ${
          selected ? 'bg-accent/5 dark:bg-accent/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{s.name}</span>
            {s.recommended && (
              <span className="px-1.5 py-0.5 rounded-md text-2xs font-bold bg-accent text-white">★추천</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {s.tags.map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded-md text-2xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700">{t}</span>
            ))}
          </div>
          {/* 핵심 지표 미리보기 */}
          {peakSnap && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-2xs text-zinc-400">{peakSnap.age}세({1983 + peakSnap.age})~</span>
              <span className={`text-xs font-bold tabular-nums ${amountColor(peakSnap.monthly_만)}`}>
                월 {peakSnap.monthly_만}만원
              </span>
            </div>
          )}
        </div>
        {selected && (
          <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* 나이별 스냅샷 */}
      <div className="px-3 py-2 space-y-1.5">
        {snapshots.map((snap, i) => (
          <AgeSnapshotRow key={snap.age} snap={snap} nextAge={snapshots[i + 1]?.age} isFirst={i === 0} />
        ))}
      </div>

      {/* 핵심 행동 */}
      <div className="px-4 pb-2">
        <p className="text-xs text-accent font-medium">→ {s.key_action}</p>
      </div>

      {/* 장단점 토글 */}
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <span>{showDetail ? '접기' : '장단점 보기'}</span>
          <svg className={`w-3.5 h-3.5 transition-transform ${showDetail ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showDetail && (
          <div className="px-4 pb-3 space-y-1">
            {s.pros.map((p, i) => (
              <div key={i} className="flex gap-1.5 text-xs">
                <span className="text-accent flex-shrink-0">✓</span>
                <span className="text-zinc-600 dark:text-zinc-400">{p}</span>
              </div>
            ))}
            {s.cons.map((c, i) => (
              <div key={i} className="flex gap-1.5 text-xs">
                <span className="text-zinc-400 flex-shrink-0">✗</span>
                <span className="text-zinc-600 dark:text-zinc-400">{c}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 명확화 질문 UI ───────────────────────────────────────────────────────────

interface ClarificationState {
  summary: string
  questions: ClarificationQuestion[]
  answers: Record<number, string>
  customInputs: Record<number, string>
}

function ClarificationPanel({
  state, onAnswerSelect, onCustomInput, onSubmit, onSkip, loading,
}: {
  state: ClarificationState
  onAnswerSelect: (qi: number, ans: string) => void
  onCustomInput: (qi: number, val: string) => void
  onSubmit: () => void
  onSkip: () => void
  loading: boolean
}) {
  const answeredCount = Object.keys(state.answers).length

  return (
    <div className="space-y-4">
      <div className="notice notice-accent text-xs">
        <span className="font-semibold">현재 준비 상황: </span>{state.summary}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        더 정확한 시나리오를 위해 몇 가지 여쭤볼게요. 선택하거나 직접 입력하세요.
      </p>

      {state.questions.map((q, qi) => {
        const selected = state.answers[qi]
        const isCustom = selected === '직접 입력'
        return (
          <div key={qi} className="space-y-2">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Q{qi + 1}. {q.text}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(opt => (
                <button
                  key={opt}
                  onClick={() => onAnswerSelect(qi, opt)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    selected === opt
                      ? 'bg-accent text-white border-accent'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-accent hover:text-accent'
                  }`}
                >
                  {opt === '직접 입력' ? '✏️ 직접 입력' : opt}
                </button>
              ))}
            </div>
            {isCustom && (
              <input
                type="text"
                placeholder="직접 입력하세요..."
                value={state.customInputs[qi] ?? ''}
                onChange={e => onCustomInput(qi, e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-accent/50 bg-white dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-accent"
                autoFocus
              />
            )}
          </div>
        )
      })}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={loading || answeredCount === 0}
          className="flex-1 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 hover:bg-accent/90 transition-opacity"
        >
          {loading ? '분석 중...' : `선택한 조건으로 분석 (${answeredCount}/${state.questions.length})`}
        </button>
        <button
          onClick={onSkip}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          그냥 분석
        </button>
      </div>
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

interface Props {
  request: PlannerChatRequest
  suggestedQuestions?: string[]  // 백그라운드 테스트 에이전트가 주입하는 추천 질문
}

export default function PlannerChat({ request, suggestedQuestions }: Props) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PlannerChatResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [clarification, setClarification] = useState<ClarificationState | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const callApi = async (q: string) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(null)
    setClarification(null)
    try {
      const res = await plannerApi.chat({ ...request, question: q })
      if (res.need_clarification) {
        setPendingQuestion(q)
        setClarification({ summary: res.summary ?? '', questions: res.questions ?? [], answers: {}, customInputs: {} })
      } else {
        setResult(res)
        const recommended = res.scenarios?.find(s => s.recommended)
        setSelected(recommended?.id ?? res.scenarios?.[0]?.id ?? null)
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'AI 응답 실패. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  const handleSend = (q?: string) => {
    const text = q ?? question
    if (!text.trim() || loading) return
    callApi(text)
  }

  const handleQuick = (q: string) => { setQuestion(q); callApi(q) }

  const handleAnswerSelect = (qi: number, ans: string) =>
    setClarification(prev => prev ? { ...prev, answers: { ...prev.answers, [qi]: ans } } : prev)

  const handleCustomInput = (qi: number, val: string) =>
    setClarification(prev => prev ? { ...prev, customInputs: { ...prev.customInputs, [qi]: val } } : prev)

  const handleClarificationSubmit = () => {
    if (!clarification) return
    const parts: string[] = [pendingQuestion]
    clarification.questions.forEach((q, qi) => {
      const ans = clarification.answers[qi]
      if (!ans) return
      const actualAns = ans === '직접 입력' ? (clarification.customInputs[qi] ?? '').trim() : ans
      if (actualAns) parts.push(`${q.text}: ${actualAns}`)
    })
    const enriched = parts.join('\n\n추가 조건: ')
    setQuestion(enriched)
    callApi(enriched)
  }

  const handleClarificationSkip = () =>
    callApi((pendingQuestion || question) + '\n\n(조건 불문, 현재 데이터 기반으로 최선의 시나리오를 제안해주세요.)')

  const handleReset = () => {
    setResult(null); setClarification(null); setQuestion(''); setSelected(null)
    setPendingQuestion(''); setError(null)
  }

  const showInitial = !loading && !result && !clarification

  // 빠른 질문: 기본 + 백그라운드 에이전트 추천 질문 합치기
  const allQuickQuestions = [
    ...QUICK_QUESTIONS,
    ...(suggestedQuestions ?? []).map(q => ({ label: q.slice(0, 8) + '…', q })),
  ]

  return (
    <div className="space-y-3">
      {/* 빠른 질문 */}
      {showInitial && (
        <div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">빠른 질문으로 시작하거나 직접 입력하세요</p>
          <div className="flex flex-wrap gap-1.5">
            {allQuickQuestions.map(q => (
              <button
                key={q.label}
                onClick={() => handleQuick(q.q)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-accent/10 hover:text-accent transition-colors border border-zinc-200 dark:border-zinc-700"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 입력창 */}
      {!clarification && !result && (
        <div className="card overflow-hidden">
          <div className="flex items-end gap-2 p-3">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={`예: 55세 은퇴, 주택연금은 최대한 늦게 받으면서\n공백기를 안정적으로 버티는 방법은?`}
              rows={2}
              className="flex-1 resize-none text-xs bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600"
            />
            <button
              onClick={() => handleSend()}
              disabled={!question.trim() || loading}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-40 transition-opacity hover:bg-accent/90"
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="card p-6 flex flex-col items-center gap-3">
          <div className="flex gap-1">
            {[0,1,2].map(i => (
              <span key={i} className="w-2 h-2 rounded-full bg-accent" style={{ animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <p className="text-xs text-zinc-400">AI가 노후 시나리오를 분석 중입니다...</p>
          <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="space-y-2">
          <div className="notice notice-amber text-xs">{error}</div>
          <button onClick={handleReset} className="w-full py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
            다시 질문하기
          </button>
        </div>
      )}

      {/* 명확화 질문 */}
      {clarification && !loading && (
        <div className="space-y-3">
          <ClarificationPanel
            state={clarification}
            onAnswerSelect={handleAnswerSelect}
            onCustomInput={handleCustomInput}
            onSubmit={handleClarificationSubmit}
            onSkip={handleClarificationSkip}
            loading={loading}
          />
          <button onClick={handleReset} className="w-full py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
            처음부터
          </button>
        </div>
      )}

      {/* 결과 */}
      {result && !loading && (
        <div className="space-y-3">
          <div className="notice notice-accent text-xs">
            <span className="font-semibold">AI 분석: </span>{result.analysis}
          </div>

          <div className="space-y-3">
            {(result.scenarios ?? []).map(s => (
              <ScenarioCard
                key={s.id}
                s={s}
                selected={selected === s.id}
                onSelect={() => setSelected(s.id)}
              />
            ))}
          </div>

          {result.recommendation_reason && (
            <div className="card-inner px-3 py-2">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                <span className="font-semibold text-zinc-500 dark:text-zinc-400">추천 근거: </span>
                {result.recommendation_reason}
              </p>
            </div>
          )}

          <button
            onClick={handleReset}
            className="w-full py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            다시 질문하기
          </button>
        </div>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
        본 시뮬레이션은 참고용입니다. 실제 세금·물가·수익률 변동에 따라 달라질 수 있습니다.
      </p>
    </div>
  )
}
