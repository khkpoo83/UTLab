import React, { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import PageTitle from '../components/PageTitle'
import { watchlistApi, portfolioApi, WatchlistItem } from '../api/client'
import { useWatchlist, useDeleteWatchlist, watchlistKey } from '../api/hooks/useWatchlist'
import Skeleton from '../components/Skeleton'
import { formatPrice } from '../utils/format'
import Modal, { ModalHeader } from '../components/Modal'
import { FormInput, FormTextarea } from '../components/FormField'
import Notice from '../components/Notice'
import Button from '../components/Button'

function exchangeBadgeClass(exchange: string): string {
  if (exchange === 'KOSPI') return 'tag tag-zinc'
  return 'tag tag-tonal'
}

interface SearchResult {
  ticker: string
  name: string
  exchange: string
}

interface AddEditModalProps {
  mode: 'add' | 'edit'
  initial?: Partial<WatchlistItem>
  onClose: () => void
  onSave: () => void
}

function AddEditModal({ mode, initial, onClose, onSave }: AddEditModalProps) {
  const [query, setQuery] = useState(initial?.ticker ?? '')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState<SearchResult | null>(
    initial?.ticker ? { ticker: initial.ticker, name: initial.name ?? '', exchange: initial.exchange ?? '' } : null
  )
  const [targetPrice, setTargetPrice] = useState<string>(
    initial?.target_price != null ? String(initial.target_price) : ''
  )
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (q: string) => {
    setQuery(q)
    setSelected(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.trim().length < 1) {
      setSearchResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await portfolioApi.search(q.trim())
        setSearchResults(res.data.slice(0, 8))
      } catch {
        setSearchResults([])
      }
    }, 300)
  }

  const handleSelect = (r: SearchResult) => {
    setSelected(r)
    setQuery(r.name)
    setSearchResults([])
  }

  const handleSave = async () => {
    if (mode === 'add' && !selected) {
      setError('종목을 선택해주세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'add' && selected) {
        await watchlistApi.create({
          ticker: selected.ticker,
          name: selected.name,
          exchange: selected.exchange,
          target_price: targetPrice ? Number(targetPrice) : undefined,
          memo: memo || undefined,
        })
      } else if (mode === 'edit' && initial?.id != null) {
        await watchlistApi.update(initial.id, {
          target_price: targetPrice ? Number(targetPrice) : undefined,
          memo: memo || undefined,
        })
      }
      onSave()
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <ModalHeader
        title={mode === 'add' ? '관심 종목 추가' : '관심 종목 수정'}
        onClose={onClose}
      />
      <div className="px-5 pb-5 pt-4 space-y-4">
        {/* Stock search (add mode only) */}
        {mode === 'add' && (
          <div className="relative">
            <FormInput
              label="종목 검색"
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="종목명 또는 티커 입력"
              autoFocus
            />
            {searchResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-800 border border-ink-5 rounded-lg shadow-lg overflow-hidden">
                {searchResults.map((r) => (
                  <button
                    key={r.ticker}
                    onClick={() => handleSelect(r)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center justify-between"
                  >
                    <span className="text-ink-0 font-medium">{r.name}</span>
                    <span className="text-2xs text-ink-4 tabular-nums">{r.ticker}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="mt-1 px-2 py-1 notice notice-accent rounded text-xs">
                선택됨: {selected.name} ({selected.ticker}) · {selected.exchange}
              </div>
            )}
          </div>
        )}

        <FormInput
          label="목표가 (선택)"
          type="number"
          value={targetPrice}
          onChange={(e) => setTargetPrice(e.target.value)}
          placeholder="목표 가격 입력"
        />

        <FormTextarea
          label="메모 (선택)"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 입력"
          rows={3}
        />

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" size="md" onClick={onClose}>취소</Button>
          <Button variant="primary" size="md" loading={saving} loadingText="저장 중..." onClick={handleSave}>저장</Button>
        </div>
      </div>
    </Modal>
  )
}

const Watchlist: React.FC = () => {
  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<WatchlistItem | null>(null)

  const qc = useQueryClient()
  const { data: items = [], isLoading: loading, isError } = useWatchlist()
  const deleteMut = useDeleteWatchlist()
  const error = isError ? '관심 종목을 불러오지 못했습니다.' : null

  const handleDelete = (id: number) => {
    if (!window.confirm('이 종목을 삭제하시겠습니까?')) return
    deleteMut.mutate(id, { onError: () => alert('삭제에 실패했습니다.') })
  }

  const handleSaved = () => {
    setShowAdd(false)
    setEditItem(null)
    qc.invalidateQueries({ queryKey: watchlistKey })
  }

  return (
    <div className="space-y-4">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <PageTitle
          sub="watchlist"
          title={`Watchlist${!loading && items.length > 0 ? ` (${items.length})` : ''}`}
        />
        <div style={{ paddingTop: 6, flexShrink: 0 }}>
          <Button
            variant="primary" size="md"
            onClick={() => setShowAdd(true)}
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>}
          >추가</Button>
        </div>
      </div>

      {error && <Notice variant="red" className="text-xs">{error}</Notice>}

      {/* List */}
      {loading ? (
        <div className="border rounded-xl overflow-hidden card-surface">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[var(--divide)] last:border-0">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
              <div className="flex-1" />
              <Skeleton className="h-4 w-12 rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed rounded-xl py-16 flex flex-col items-center gap-3 text-center card-surface">
          <svg className="w-10 h-10 text-ink-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <p className="text-sm text-ink-3">관심 종목을 추가해보세요</p>
          <Button
            variant="primary" size="md"
            onClick={() => setShowAdd(true)}
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>}
          >종목 추가</Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden card-surface">
          {items.map((item) => {
            const changeCls =
              (item.change_pct ?? 0) > 0 ? 'text-up' : (item.change_pct ?? 0) < 0 ? 'text-down' : 'text-flat'
            const targetGap =
              item.target_price != null && item.current_price != null
                ? ((item.current_price / item.target_price - 1) * 100)
                : null
            const targetGapCls =
              targetGap == null ? '' : targetGap >= 0 ? 'text-up' : 'text-down'

            return (
              <div
                key={item.id}
                className="flex items-start gap-3 px-4 py-3 border-b border-[var(--divide)] last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-ink-0">{item.name}</span>
                    <span className="text-2xs text-ink-4 tabular-nums">{item.ticker}</span>
                    <span className={exchangeBadgeClass(item.exchange)}>
                      {item.exchange}
                    </span>
                    {item.is_recommended && (
                      <span className="tag tag-tonal">AI추천</span>
                    )}
                  </div>

                  {/* Price row */}
                  <div className="flex items-center gap-3 text-xs tabular-nums mt-1">
                    <span className="text-ink-1 font-medium">
                      {formatPrice(item.current_price)}
                    </span>
                    {item.change_pct != null && (
                      <span className={changeCls}>
                        {(item.change_pct >= 0 ? '+' : '') + item.change_pct.toFixed(2) + '%'}
                      </span>
                    )}
                    {item.target_price != null && (
                      <span className="text-ink-4">
                        목표 <span className="text-ink-2">{formatPrice(item.target_price)}</span>
                        {targetGap != null && (
                          <span className={`ml-1 ${targetGapCls}`}>
                            ({targetGap >= 0 ? '+' : ''}{targetGap.toFixed(1)}%)
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Memo */}
                  {item.memo && (
                    <p className="text-2xs text-ink-4 mt-1 truncate max-w-sm">{item.memo}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                  <button
                    onClick={() => setEditItem(item)}
                    className="p-1.5 text-ink-4 hover:text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
                    title="수정"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deleteMut.isPending && deleteMut.variables === item.id}
                    className="p-1.5 text-ink-4 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                    title="삭제"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <AddEditModal
          mode="add"
          onClose={() => setShowAdd(false)}
          onSave={handleSaved}
        />
      )}

      {/* Edit Modal */}
      {editItem && (
        <AddEditModal
          mode="edit"
          initial={editItem}
          onClose={() => setEditItem(null)}
          onSave={handleSaved}
        />
      )}
    </div>
  )
}

export default Watchlist
