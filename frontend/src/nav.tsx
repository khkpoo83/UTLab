import {
  Home, TrendingUp, CalendarDays, Newspaper, Calculator, Settings,
  Briefcase, BarChart2, Star, Lightbulb, CalendarCheck, FileText,
  Globe, PenLine, LayoutTemplate,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavLeaf {
  to: string
  label: string
  Icon: LucideIcon
}

export interface NavGroup {
  id: string
  label: string
  Icon: LucideIcon
  to?: string
  href?: string
  hideInSidebar?: boolean  // 사이드바 메인 nav에서 숨기고 하단 바에서만 노출
  children?: NavLeaf[]
}

export const NAV_GROUPS: NavGroup[] = [
  { id: 'home', label: '홈', Icon: Home, to: '/home' },
  {
    id: 'stock', label: '주식', Icon: TrendingUp,
    children: [
      { to: '/portfolio', label: '포트폴리오', Icon: Briefcase },
      { to: '/analytics',  label: '분석',      Icon: BarChart2 },
      { to: '/watchlist',  label: '관심종목',   Icon: Star      },
      { to: '/recommend',  label: '추천',      Icon: Lightbulb },
    ],
  },
  {
    id: 'schedule', label: '일정', Icon: CalendarDays,
    children: [
      { to: '/calendar', label: '캘린더', Icon: CalendarCheck },
    ],
  },
  { id: 'news',    label: '뉴스',   Icon: Newspaper,  to: '/news'    },
  { id: 'planner', label: '플래너', Icon: Calculator, to: '/planner' },
  {
    id: 'site', label: '홈페이지 관리', Icon: Globe,
    children: [
      { to: '/blog',        label: '블로그 관리',  Icon: PenLine        },
      { to: '/site-manage', label: '메인화면 관리', Icon: LayoutTemplate },
    ],
  },
  { id: 'docs',     label: '명세서', Icon: FileText, href: '/docs/',   hideInSidebar: true },
  { id: 'settings', label: '설정',   Icon: Settings, to: '/settings', hideInSidebar: true },
]

/** 현재 경로에 해당하는 그룹 반환 */
export function getActiveGroup(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find(g =>
    g.to
      ? pathname.startsWith(g.to)
      : g.children?.some(c => pathname.startsWith(c.to))
  )
}

/** 그룹의 첫 번째 목적지 경로 */
export function getFirstRoute(group: NavGroup): string {
  return group.to ?? group.href ?? group.children?.[0]?.to ?? '/home'
}

/** 스와이프용 전체 라우트 순서 */
export const ALL_ROUTES = [
  '/home',
  '/portfolio', '/analytics', '/watchlist', '/recommend',
  '/calendar',
  '/news', '/planner', '/blog', '/site-manage', '/settings',
]
