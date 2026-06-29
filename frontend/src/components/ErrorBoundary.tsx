import React from 'react'

interface Props { children: React.ReactNode; fallback?: React.ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 p-6 text-center">
          <p className="text-sm font-medium text-ink-1">이 영역을 불러오는 데 문제가 발생했습니다.</p>
          <p className="text-xs text-ink-4">{this.state.error?.message}</p>
          <button
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-ink-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
