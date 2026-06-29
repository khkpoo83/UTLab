import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { plannerApi, PlannerOcrItem, DcIrpOcrResult, NpsOcrResult, MortgageOcrResult, PrivatePensionOcrResult } from '../api/client'

interface Props {
  item: PlannerOcrItem
  title: string
  hint?: string
  onApply: (data: Record<string, number | string | null>) => void
  onClose: () => void
}

const ITEM_LABELS: Record<string, string> = {
  dc_irp: '퇴직연금 DC',
  nps: '국민연금',
  mortgage: '주담대',
  private_pension: '개인연금',
}

function fmt(v: number | null | undefined, unit = '원'): string {
  if (v == null) return '-'
  if (unit === '억') return `${(v / 1e8).toFixed(2)}억`
  if (unit === '만원/월') return `${Math.round(v / 10000).toLocaleString()}만원/월`
  if (unit === '%') return `${v}%`
  return `${v.toLocaleString()}${unit}`
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[var(--divide)] last:border-0">
      <span className="text-xs text-ink-3">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${value === '-' ? 'text-ink-4' : 'text-ink-0'}`}>{value}</span>
    </div>
  )
}

function renderResult(item: PlannerOcrItem, data: Record<string, number | string | null>) {
  if (item === 'dc_irp') {
    const d = data as unknown as DcIrpOcrResult
    return (
      <>
        <ResultRow label="잔액" value={fmt(d.balance as number | null)} />
        <ResultRow label="수익률" value={fmt(d.rate as number | null, '%')} />
        <ResultRow label="기준일" value={d.date as string ?? '-'} />
      </>
    )
  }
  if (item === 'nps') {
    const d = data as unknown as NpsOcrResult
    return (
      <>
        <ResultRow label="65세 기준 월수령액" value={fmt(d.monthly_65 as number | null, '만원/월')} />
        <ResultRow label="60세 조기수령" value={fmt(d.monthly_60 as number | null, '만원/월')} />
        <ResultRow label="70세 연기수령" value={fmt(d.monthly_70 as number | null, '만원/월')} />
        <ResultRow label="기준일" value={d.date as string ?? '-'} />
      </>
    )
  }
  if (item === 'mortgage') {
    const d = data as unknown as MortgageOcrResult
    return (
      <>
        <ResultRow label="대출 개시일" value={d.start_date as string ?? '-'} />
        <ResultRow label="원금" value={fmt(d.principal as number | null)} />
        <ResultRow label="연 금리" value={fmt(d.rate as number | null, '%')} />
        <ResultRow label="기간" value={d.months != null ? `${d.months}개월 (${Math.round((d.months as number) / 12)}년)` : '-'} />
        <ResultRow label="현재 잔액" value={fmt(d.balance as number | null)} />
        <ResultRow label="월 상환액" value={fmt(d.monthly_payment as number | null)} />
      </>
    )
  }
  if (item === 'private_pension') {
    const d = data as unknown as PrivatePensionOcrResult
    return (
      <>
        <ResultRow label="상품명" value={d.product_name as string ?? '-'} />
        <ResultRow label="평가금액" value={fmt(d.balance as number | null)} />
        <ResultRow label="기준일" value={d.date as string ?? '-'} />
      </>
    )
  }
  return null
}

export default function OcrUploadModal({ item, title, hint, onApply, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, number | string | null> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = (file: File) => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    setResult(null)
    setError(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleAnalyze = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const res = await plannerApi.ocr(item, file)
      setResult(res.data as unknown as Record<string, number | string | null>)
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? '인식 실패. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  const hasValues = result && Object.values(result).some(v => v != null)

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm panel-surface border rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--divide)]">
          <div>
            <p className="text-sm font-semibold text-ink-0">스크린샷으로 업데이트</p>
            <p className="text-xs text-ink-4">{ITEM_LABELS[item]} · {title}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {hint && (
            <p className="text-xs text-ink-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2">{hint}</p>
          )}

          {/* 업로드 영역 */}
          <div
            className="border-2 border-dashed border-ink-5 rounded-xl overflow-hidden cursor-pointer hover:border-accent transition-colors"
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="preview" className="w-full max-h-48 object-contain bg-zinc-50 dark:bg-zinc-800" />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <svg className="w-8 h-8 text-ink-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xs text-ink-4">탭하여 이미지 선택 또는 드래그</p>
                <p className="text-2xs text-ink-4">JPG · PNG · WebP</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {/* 분석 버튼 */}
          {preview && !result && (
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI 인식 중...
                </>
              ) : 'AI로 자동인식'}
            </button>
          )}

          {/* 에러 */}
          {error && (
            <div className="notice notice-amber text-xs">{error}</div>
          )}

          {/* 인식 결과 */}
          {result && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-2">인식 결과</p>
              <div className="card-inner px-3 py-1">
                {renderResult(item, result)}
              </div>
              {!hasValues && (
                <p className="text-xs text-ink-4 text-center">인식된 항목이 없습니다. 더 선명한 이미지를 시도해주세요.</p>
              )}
            </div>
          )}

          {/* 적용 버튼 */}
          {result && hasValues && (
            <div className="flex gap-2">
              <button
                onClick={() => { setResult(null); setPreview(null) }}
                className="flex-1 py-2 rounded-xl border border-ink-5 bg-white dark:bg-zinc-900 text-xs text-ink-3 font-medium"
              >
                다시 찍기
              </button>
              <button
                onClick={() => { onApply(result); onClose() }}
                className="flex-1 py-2 rounded-xl bg-accent text-white text-xs font-semibold"
              >
                적용하기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
