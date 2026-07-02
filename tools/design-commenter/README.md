# Design Commenter

Figma/“Claude 디자인” 식의 **비주얼 피드백 도구**. 편집 모드를 켜면 실제 화면
위에서 마우스가 올라간 요소가 하이라이트되고, 클릭하면 코멘트를 남길 수 있습니다.
다 끝나면 **한 번의 클릭으로 모든 코멘트를 Claude Code에 붙여넣기 좋은 마크다운**
으로 복사합니다.

의존성 없음 · 빌드 불필요 · 단일 파일(`design-commenter.js`). UI는 Shadow DOM
안에서 동작하므로 **어떤 페이지에 붙여도 호스트 페이지 CSS와 충돌하지 않습니다.**

## 무엇을 캡처하나
요소마다 다음을 코멘트에 자동 첨부합니다.
- **Source** `파일:라인:열` — React dev 빌드(`@vitejs/plugin-react` 또는
  `babel-plugin-transform-react-jsx-source`)면 fiber `_debugSource`에서 추출.
  → Claude가 추측 없이 그 위치를 수정.
- **Selector** — 견고한 CSS 경로(일반 HTML/소스맵 없을 때 폴백).
- **Text / 태그·클래스 요약** — 사람이 어떤 요소였는지 식별.
- 자유 입력 **Comment**.

## 사용법 A — 내장 브라우저 앱 (권장, 로컬 서버)

주소창 달린 "내장 브라우저"에서 로컬 파일이나 URL을 열고, 그 위에서 바로
코멘트를 남긴 뒤 마크다운으로 내보냅니다. **의존성 0 · Node만 있으면 됩니다.**

```bash
node tools/design-commenter/server.js        # 기본 4700, 127.0.0.1 전용
# → http://127.0.0.1:4700 을 브라우저로 연다
```

1. 상단 주소창에 **로컬 절대경로**(예: `/home/ec2-user/Dev/Stock/tools/design-commenter/index.html`)
   또는 **URL**(`https://…`)을 입력하고 **열기**.
2. **✎ 편집 모드** 토글 → iframe 화면 위에서 요소 클릭 → 코멘트 저장(핀이 찍힘).
3. **완료 · 내보내기** → 우측 드로어에 마크다운 → **복사** → Claude Code에 붙여넣기.
4. 최근 연 주소는 칩으로 저장(localStorage).

구성: `server.js`(셸/오버레이 서빙 + 대상 페이지에 `<base>`+오버레이 주입, 프레이밍
헤더 제거) · `app.html`(주소창·편집토글·완료·iframe·결과 드로어) · `design-commenter.js`
(오버레이, `?embedded=1`이면 postMessage로 셸과 통신). 정적 HTML·목업·아티팩트에
가장 잘 동작 — CSP 강한 사이트/무거운 SPA는 아래 단독 모드(북마클릿)가 더 안전.

## 사용법 B — 단독 (script/북마클릿/콘솔, 3가지)

### 1) `<script>` 태그 — 내가 만든 HTML/정적 페이지
```html
<script src="design-commenter.js"></script>
```
`design-commenter.js`를 HTML 옆에 두면 끝. 데모는 `index.html`을 브라우저로 열면 됩니다.

### 2) 북마클릿 — 떠 있는 아무 페이지에나 (우리 React dev 앱 포함)
파일을 dev 서버가 서빙하도록 두고(예: `frontend/public/design-commenter.js`로
복사하면 Vite가 `/design-commenter.js`로 제공) 아래를 북마크 URL로 저장:
```
javascript:(function(){if(window.__designCommenterLoaded){window.__designCommenter.toggleToolbar();return;}var s=document.createElement('script');s.src='/design-commenter.js';document.body.appendChild(s);})();
```
다른 호스트의 JS를 불러오려면 `s.src`를 절대 URL로 바꾸면 됩니다
(예: `http://localhost:5173/design-commenter.js`).

### 3) 콘솔 붙여넣기 — 호스팅 없이 임의 사이트에서
DevTools 콘솔을 열고 `design-commenter.js` 전체 내용을 붙여넣어 실행.
(소스맵이 없는 외부 사이트에선 Source 대신 Selector만 잡힙니다.)

## 조작
- **✎ 편집 모드** 토글 → hover 하이라이트, 클릭으로 코멘트.
- 코멘트 입력 후 **저장** (또는 `⌘/Ctrl + Enter`).
- 요소에 **핀(번호)** 이 찍힘. 핀이나 목록 항목을 클릭하면 다시 편집.
- **📋 Claude Code로 복사** → 마크다운이 클립보드로.
- `Esc` = 팝업 닫기 / 편집 모드 종료. 패널 헤더의 `—` = 접기.
- 코멘트는 **localStorage에 페이지별로 저장**되어 새로고침에도 유지.

## 내보내기 형식 (예)
```markdown
# 디자인 수정 요청 (2건)
페이지: U.T Lab — http://localhost:5173/

> 아래는 실제 화면 위에서 요소별로 남긴 수정 요청입니다 …

## 1. <button .btn.primary>
- Source: /home/ec2-user/Dev/Stock/frontend/src/pages/Home.tsx:42:6
- Selector: `main > div.card:nth-of-type(2) > button.btn.primary`
- Text: "기본 버튼"
- Comment: 이 버튼을 accent 색으로 바꾸고 라운드를 키워줘
```

## 이 프로젝트(React 앱)에서 쓰기
1. `cp tools/design-commenter/design-commenter.js frontend/public/`
2. `npm run dev` (Vite dev — 소스 매핑 활성).
3. 위 **북마클릿**을 dev 앱에서 클릭 → 코멘트 → 복사 → Claude Code에 붙여넣기.
- 운영 빌드엔 포함하지 않습니다(파일을 import하지 않으므로 자동 제외; `public/`에
  둘 경우 배포에서 빼고 싶으면 dev 전용 위치로 관리).

## 제약 / 다음 단계
- Source 매핑은 **dev 빌드 전용**(운영 minify 빌드엔 `_debugSource` 없음).
- `server.js`의 `/fs/`는 로컬 파일시스템 노출 → **127.0.0.1 바인드**, 로컬 전용.
- URL 프록시는 상단 HTML만 대체 + `<base>`로 원본 에셋 로드 → 정적 HTML·목업·아티팩트엔
  좋으나, CSP 강한 사이트/same-origin XHR 하는 무거운 SPA는 완전동작 안 할 수 있음(단독 북마클릿 권장).
- 로컬(localStorage) + 클립보드 내보내기까지 완성. 풀버전(코멘트 API 영속화, 해결/적용완료
  상태, 스레드)은 `.work/DESIGN_비주얼코멘트도구_스펙_20260630.md`의 "풀버전(선택)" 참조.
