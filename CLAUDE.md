# UT.Lab — Claude Code 프로젝트 가이드

## 프로젝트 개요
개인 주식/자산 관리 웹 앱. 포트폴리오, 뉴스 요약, AI 추천, 재무 플래너, 다이어리, 캘린더 통합.

## 경로 및 실행
- 루트: `/home/ec2-user/Dev/Stock/`
- Frontend: `frontend/src/`
- Backend: `backend/`
- **빌드·배포**: `sudo docker-compose build --no-cache && sudo docker-compose up -d`
- **로그 확인**: `sudo docker-compose logs --tail=50 backend`
- **빠른 배포** (파일 1개): `sudo docker cp backend/routers/planner.py stock-backend-1:/app/routers/planner.py && sudo docker restart stock-backend-1`

## 기술 스택
- **Frontend**: React + TypeScript + Vite + TailwindCSS + Recharts + dnd-kit
- **Backend**: FastAPI + SQLAlchemy (async) + SQLite (aiosqlite) + APScheduler
- **AI**: Gemini 2.5 Flash (기본) / Groq (폴백)
- **배포**: Docker Compose + nginx reverse proxy

## 워크플로우 규칙
- 작업 시작 시: `TODO_YYYYMMDD_HHMM.md` 생성 (체크리스트)
- 작업 완료 후: `DONE_YYYYMMDD_HHMM.md` 생성
- 세션 재개 시: 최신 TODO/DONE 비교 → 미완료 항목 이어서 진행
- 승인 없이 바로 진행 (사용자가 명시적으로 요청)

---

## Frontend 핵심 파일

### 페이지 (`src/pages/`)
| 파일 | 설명 |
|------|------|
| `Home.tsx` | 홈 대시보드. 4컬럼 위젯 그리드 (`grid-cols-2 sm:grid-cols-4`), dnd-kit 드래그, WidgetSize(quarter/half/three-quarter/full) |
| `Portfolio.tsx` | 포트폴리오. IndexPanel 상단, 보유종목, 서머리, HoldingDrawer |
| `News.tsx` | 뉴스. 토픽별 섹션, 날짜 탭, 섹터 필터 |
| `Recommend.tsx` | AI 추천. 섹터 도넛차트 + 추천목록 |
| `Analytics.tsx` | 분석 차트. getTonalPalette 사용 |
| `Planner.tsx` | 재무 플래너. OCR 업로드, AI 챗봇, 은퇴 시뮬레이션 |
| `Watchlist.tsx` | 관심종목 |
| `Settings.tsx` | 설정. 뉴스 스케줄, AI 설정 |
| `Login.tsx` | 로그인 |

### 컴포넌트 (`src/components/`)
| 파일 | 설명 |
|------|------|
| `Card.tsx` | 통일 카드 컴포넌트. collapsible/onClick/dragHandle/right props. `card-surface` 클래스 부여 |
| `Modal.tsx` | 공통 모달 (backdrop + 컨테이너). `ModalHeader` 함께 export |
| `StepField.tsx` | +/− 스텝 입력 컴포넌트. Planner에서 추출 |
| `RangeSlider.tsx` | 범위 슬라이더. floating 뱃지 + 눈금. Planner AgeRangeSlider에서 추출 |
| `SortableItem.tsx` | dnd-kit SortableItem. isDragging 시 solid bg placeholder 렌더링 |
| `IndexPanel.tsx` | 글로벌 지수 패널 |
| `DataTable.tsx` | 필터/정렬 테이블 |
| `HoldingDrawer.tsx` | 포트폴리오 종목 드로어 |
| `OcrUploadModal.tsx` | OCR 이미지 업로드 모달 |
| `PlannerChat.tsx` | AI 챗봇 UI |

### API (`src/api/client.ts`)
- axios 클라이언트. JWT Bearer 토큰 자동 첨부.
- 주요 타입: `PortfolioItem`, `NewsItem`, `RecommendItem`, `PlannerContext`, `PlannerOcrItem`

---

## Backend 핵심 파일

### 라우터 (`backend/routers/`)
| 파일 | prefix | 설명 |
|------|--------|------|
| `auth.py` | `/api/auth` | JWT 로그인, 비밀번호 변경, 계정 잠금 (5회 실패 → 15분) |
| `portfolio.py` | `/api/portfolio` | CRUD + summary |
| `accounts.py` | `/api/accounts` | 계좌 관리 |
| `news.py` | `/api/news` | 뉴스 목록 (date 파라미터) |
| `recommend.py` | `/api/recommend` | AI 추천 |
| `watchlist.py` | `/api/watchlist` | 관심종목 |
| `settings.py` | `/api/settings` | 설정 GET/PUT |
| `planner.py` | `/api/planner` | 재무 플래너 + OCR + 챗봇 |
| `diary.py` | `/api/diary` | 투자 다이어리 |
| `calendar.py` | `/api/calendar` | Google Calendar 연동 |
| `profile.py` | `/api/profile` | 프로필 |
| `kis.py` | `/api/kis` | KIS API 연동 |

### 서비스 (`backend/services/`)
| 파일 | 설명 |
|------|------|
| `gemini_service.py` | Gemini API (뉴스 요약, 챗봇, OCR) |
| `groq_service.py` | Groq API (폴백 LLM) |
| `ollama_service.py` | AI 큐 워커 (이름과 달리 Gemini 기반 — Ollama 미사용). 뉴스 요약 BATCH_SIZE 단위 처리 |
| `news_service.py` | RSS 수집, 그루핑, KST 날짜 필터 |
| `recommend_service.py` | 추천 계산 (avg_price 기반) |
| `scheduler.py` | APScheduler 작업 (주가, 뉴스, AI 추천) |
| `stock_service.py` | 주가 조회 (KIS 캐시 우선, yfinance 폴백) |
| `stock_list_service.py` | 종목 DB 검색. `update_stock_industries()`는 네이버 API 제거로 stub (스킵) |
| `portfolio_snapshot_service.py` | 포트폴리오 히스토리 스냅샷 |
| `calendar_service.py` | Google Calendar push/incremental sync |
| `kis_service.py` | 키움증권 REST API. 잔고 조회(kt00004), KRX+NXT 병합, 토큰 캐시 (TTL: `KIS_CACHE_TTL` 환경변수, 기본 300초) |
| `kis_sync_service.py` | KIS 잔고 → Portfolio DB 동기화 + PortfolioSnapshot 저장 |
| `diary_service.py` | 다이어리 CRUD |
| `index_service.py` | 글로벌 지수 조회/캐시 |

---

## 디자인 시스템

### 색상 토큰 (`src/index.css`)
- `--c-accent-rgb`: 스페이스 구분 RGB (예: `59 130 246`)
- `--c-accent`: `rgb(var(--c-accent-rgb))`
- 시즌 테마: `[data-season="spring|summer|autumn|winter"]` on `<html>`
- **주식 색상 (국내 기준)**: 상승=빨간색(`text-up`), 하락=파란색(`text-down`)

### TailwindCSS (`src/tailwind.config.js`)
- `accent`: `rgb(var(--c-accent-rgb) / <alpha-value>)` — opacity modifier 지원
- `bg-accent/N` 동작하려면 이 형식 필수

### 유틸 (`src/utils/theme.ts`)
- `getTonalPalette()`: CSS `--c-accent-rgb` 읽어 opacity 계열 색상 배열 반환

### 클래스 규칙
```
태그/뱃지: .tag .tag-zinc / .tag-tonal / .tag-amber / .tag-red
선택 버튼: .chip / .chip-active
알림 박스: .notice .notice-accent / .notice-amber / .notice-zinc
카드: Card 컴포넌트 (collapsible/onClick/dragHandle/right)
```

### 배경 투명도 주의
- `applyBackground()`가 `document.body.style.backgroundImage`에 패턴 적용
- 반투명(`bg-accent/N`, `bg-zinc-50/70` 등) 요소는 배경 비침 발생
- 버튼/카드에 반드시 solid background: `bg-white dark:bg-zinc-900`

---

## Home.tsx 위젯 시스템

### WidgetSize
```ts
type WidgetSize = 'quarter' | 'half' | 'three-quarter' | 'full'
// col-span: quarter=1, half=1(sm:2), three-quarter=2(sm:3), full=2(sm:4)
```

### 그리드
```
grid-cols-2 sm:grid-cols-4
```

### DragOverlay 규칙
- DragOverlay: solid bg + accent dashed border + 위젯 이름
- `dropAnimation={null}`: 드롭 애니메이션 비활성화
- SortableItem placeholder: `bg-white dark:bg-zinc-900` + dashed border (반투명 금지)

---

## 모바일 스와이프 (App.tsx)
- `touchFromEdge`: 화면 엣지 20px 이내에서만 스와이프 인식
- 최소 이동 거리: 80px
- 수직/수평 비율: `Math.abs(dy) > Math.abs(dx) * 0.5` 이면 스크롤로 처리

---

## Planner 챗봇 (`backend/routers/planner.py`)

### 엔드포인트
- `POST /api/planner/chat?model=gemini` — `PlannerContext` 모델 수신

### 핵심 로직
- `calc_full_snap()`: ISA × HP 조합 사전계산 테이블을 prompt에 주입
- 후처리: income합 - expense합 ≠ monthly_만 시 자동 보정 + `_corrections` 반환
- **단위**: `house_price`=억원, `mortgage_balance/monthly`=원

### 종료 조건
- DC: `60 <= age < 80` (80세 이후 수령 없음)
- PP: `start_age <= age < start_age + payout_years`

### 테스트
```bash
sudo docker exec stock-backend-1 python test_planner_chat.py [번호] [groq|gemini]
```

---

## 보안 설정

### 환경변수 (`.env`)
```
JWT_SECRET=<강력한_랜덤_문자열>
APP_PASSWORD=<초기_관리자_비밀번호>
APP_USERNAME=admin
GEMINI_API_KEY=...
```

### auth.py 보안
- `SECRET_KEY = ""` (기본값 — 반드시 환경변수로 주입)
- 빈 키 상태에서 토큰 발급 시 RuntimeError
- 로그인 실패 5회 → 15분 잠금

### nginx 보안 헤더 (`frontend/nginx.conf`)
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

---

## 추천 재계산 (백그라운드 처리)
- `POST /api/recommend/refresh` → 즉시 응답, 백그라운드에서 R1→R2→R3 순차 실행
- `GET /api/recommend/refresh-status` → `{ running, done, error }` 상태 폴링용
- Frontend Recommend.tsx: 8초 간격 폴링, 완료 시 loadData() 자동 호출
- 단일 글로벌 플래그 `_refresh_running` 사용 (단일 사용자 앱)

## 포트폴리오 자동 리프레시
- Portfolio.tsx에서 5분 `setInterval`로 `loadData()` 자동 호출
- KIS API 조회로 현재가 자동 갱신

## 글래스 패널 시스템 (App.tsx)
- 양쪽 레이아웃 모두 `glass-panel` 클래스 부여된 `rounded-2xl bg-white/30 dark:bg-zinc-950/30` div가 콘텐츠 래퍼
- `card-surface` 안: 원래 텍스트 색상 유지 / `card-surface` 밖(글래스 위): gray 텍스트 → 흰색+쉐도우
- `bgFixed: true` 기본값 → 그라디언트 배경 뷰포트 고정

## 알려진 이슈 / 주의사항
- `main.py`에서 settings 이름 충돌 → `settings_router` alias 사용
- yfinance 한국 주식 섹터 조회 신뢰도 낮음 → avg_price 기반 직접 계산
- SQLite JSON 필드 (`related_stocks`) 검색: `.cast(String).contains()` 사용
- 뉴스 날짜 필터: KST→UTC 변환 적용
- Docker: `docker-compose`는 sudo 필요
- 네이버 주가 API 미사용 (제거됨) — 주가는 KIS 캐시 → yfinance 순으로 조회
- 네이버 Blog RSS 소스 제외 (광고/체험단 오염) — news_service.py RSS_FEEDS 목록에 미포함
