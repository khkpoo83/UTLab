import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('제목과 children을 렌더링한다', () => {
    render(
      <Card title="테스트 카드">
        <p>본문 콘텐츠</p>
      </Card>,
    )
    expect(screen.getByText('테스트 카드')).toBeInTheDocument()
    expect(screen.getByText('본문 콘텐츠')).toBeInTheDocument()
  })

  it('collapsible=true 이면 토글 버튼을 렌더링한다', () => {
    render(
      <Card title="접이식" collapsible>
        <p>접히는 콘텐츠</p>
      </Card>,
    )
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
