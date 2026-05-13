import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

/**
 * 드래그 핸들을 제공하는 sortable 래퍼 컴포넌트.
 * order prop 사용 시 CSS flex order로 위치 제어 (DOM 순서 유지).
 * isDragging 상태에서는 accent 색상 플레이스홀더를 표시.
 */
export function SortableItem({
  id,
  order,
  className,
  children,
}: {
  id: string
  order?: number
  className?: string
  children: (dragHandle: React.ReactNode) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(order !== undefined ? { order } : {}),
  }

  const dragHandle = (
    <span
      {...attributes}
      {...listeners}
      className="text-zinc-300 dark:text-zinc-600 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical size={13} />
    </span>
  )

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {isDragging ? (
        <div className="rounded-xl bg-white dark:bg-zinc-900 border-2 border-accent/60 border-dashed min-h-[60px] h-full flex items-center justify-center">
          <div className="w-8 h-1 rounded-full bg-accent/40" />
        </div>
      ) : (
        children(dragHandle)
      )}
    </div>
  )
}
