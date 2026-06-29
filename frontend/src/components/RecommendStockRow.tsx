import React from 'react'
import { RecommendItem } from '../api/client'
import { formatPrice } from '../utils/format'
import { STRENGTH_CONFIG } from '../constants/stock'

interface RecommendStockRowProps {
  item: RecommendItem
}

const RecommendStockRow: React.FC<RecommendStockRowProps> = ({ item }) => {
  const strength = item.strength ? STRENGTH_CONFIG[item.strength] : null
  const changeCls =
    (item.change_pct ?? 0) > 0
      ? 'text-up'
      : (item.change_pct ?? 0) < 0
        ? 'text-down'
        : 'text-flat'

  const rowBg = item.is_portfolio
    ? 'bg-white dark:bg-zinc-900'
    : 'bg-zinc-50 dark:bg-zinc-800'

  const isAI = !!item.ai_session

  return (
    <div className={`flex flex-col gap-1 py-2.5 pl-5 pr-4 ${rowBg} hover:brightness-95 transition-colors border-b border-[var(--divide)] last:border-0`}>
      {/* Top row: name + price */}
      <div className="flex items-center gap-3">
        <span className="text-ink-5 text-xs flex-shrink-0">└</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-ink-0">{item.name}</span>
            <span className="text-2xs text-ink-4 tabular-nums">{item.ticker}</span>
            {item.is_portfolio && (
              <span className="tag tag-tonal font-medium">
                보유중
              </span>
            )}
            {isAI && item.confidence === 'high' && (
              <span className="tag tag-amber font-medium">
                확실
              </span>
            )}
            {isAI && item.confidence === 'medium' && (
              <span className="tag tag-zinc font-medium">
                보통
              </span>
            )}
            {isAI && item.ai_session && (
              <span className="text-2xs px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-ink-4 rounded">
                AI·{item.ai_session === 'morning' ? '아침' : '저녁'}
              </span>
            )}
            {item.political_theme && (
              <span className={`tag ${
                item.political_theme === 'ruling' ? 'tag-red' :
                item.political_theme === 'opposition' ? 'tag-zinc' :
                'tag-tonal'
              } font-medium`}>
                {item.political_theme === 'ruling' ? '여당테마' : item.political_theme === 'opposition' ? '야당테마' : '방산/공통'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums flex-shrink-0">
          <span className="text-ink-1">
            {formatPrice(item.latest_price)}
          </span>
          {item.news_count > 0 && (
            <span className="text-ink-4">뉴스 {item.news_count}건</span>
          )}
          {item.change_pct != null && (
            <span className={changeCls}>
              {(item.change_pct >= 0 ? '+' : '') + item.change_pct.toFixed(2) + '%'}
            </span>
          )}
          {strength && !item.is_portfolio && (
            <span className={`text-xs ${strength.cls}`} title={strength.label}>
              {strength.stars}
            </span>
          )}
        </div>
      </div>

      {/* AI reason */}
      {item.reason && (
        <div className="ml-5 pl-0">
          <p className="text-2xs text-ink-3 leading-relaxed">{item.reason}</p>
        </div>
      )}

      {/* Technical summary */}
      {item.technical_summary && (
        <div className="ml-5">
          <p className="text-2xs text-ink-4 italic">{item.technical_summary}</p>
        </div>
      )}

      {/* Price strategy */}
      {item.entry_price != null && (
        <div className="ml-5 flex flex-wrap gap-x-4 gap-y-0.5 text-2xs tabular-nums">
          <span className="text-ink-4">
            진입 <span className="text-ink-2">{formatPrice(item.entry_range_low)}~{formatPrice(item.entry_range_high)}</span>
          </span>
          <span className="text-ink-4">
            목표 <span className="text-up font-medium">{formatPrice(item.target_price)}</span>
            {item.target_return_pct != null && <span className="text-up opacity-70"> (+{item.target_return_pct.toFixed(1)}%)</span>}
          </span>
          <span className="text-ink-4">
            손절 <span className="text-down">{formatPrice(item.stop_loss_price)}</span>
            {item.stop_loss_pct != null && <span className="text-down opacity-70"> ({item.stop_loss_pct.toFixed(1)}%)</span>}
          </span>
        </div>
      )}

      {/* Latest news fallback (only if no reason) */}
      {!item.reason && item.latest_news_title && (
        <div className="ml-5">
          <p className="text-2xs text-ink-4 truncate leading-snug">
            {item.latest_news_title}
          </p>
        </div>
      )}
    </div>
  )
}

export default RecommendStockRow
