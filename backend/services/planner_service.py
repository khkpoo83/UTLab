"""플래너 서비스 - OCR 프롬프트, 은퇴 시나리오 계산 + LLM 오케스트레이션.

라우터(routers/planner.py)는 이 모듈의 얇은 HTTP 래퍼이며, 도메인 로직·프롬프트·
LLM 호출·후처리 보정은 모두 여기에 있다.

계산 헬퍼는 순수 함수로 모듈 레벨에 올려 단위 테스트가 가능하도록 했다. 기존
핸들러의 지역 클로저에 의존하던 값들은 명시적 인자로 전달한다(계산 결과 동일).
"""
import json
import logging
from typing import Optional

from pydantic import BaseModel

from services.gemini_service import call_gemini, call_gemini_with_image
from services.groq_service import call_groq

logger = logging.getLogger(__name__)

# 지원 MIME 타입
ALLOWED_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}

# 항목별 프롬프트
PROMPTS = {
    "dc_irp": """\
이 이미지는 퇴직연금(DC형) 앱 화면입니다.
다음 항목을 찾아서 JSON으로 반환하세요:
- balance: 총 평가금액(잔액) — 원 단위 정수 (예: 42013006)
- rate: 수익률 — % 숫자 (예: 7.2). 없으면 null
- date: 기준 날짜 — "YYYY-MM-DD" 형식. 없으면 오늘 날짜를 null로

찾을 수 없는 항목은 null로 반환.
예시: {"balance": 42013006, "rate": 7.2, "date": "2026-03-15"}
""",

    "nps": """\
이 이미지는 국민연금 앱 또는 내 연금 알아보기 화면입니다.
다음 항목을 찾아서 JSON으로 반환하세요:
- monthly_65: 65세 기준 예상 월수령액 — 원 단위 정수 (예: 1584470)
- monthly_60: 60세 조기수령 예상액 — 원 단위 정수. 없으면 null
- monthly_70: 70세 연기수령 예상액 — 원 단위 정수. 없으면 null
- date: 기준 날짜 — "YYYY-MM-DD". 없으면 null

찾을 수 없는 항목은 null로 반환.
예시: {"monthly_65": 1584470, "monthly_60": null, "monthly_70": null, "date": "2026-01-01"}
""",

    "mortgage": """\
이 이미지는 주택담보대출(주담대) 앱 화면 또는 대출 확인서입니다.
다음 항목을 찾아서 JSON으로 반환하세요:
- start_date: 대출 실행일(개시일) — "YYYY-MM-DD" 형식. 없으면 null
- principal: 대출 원금 — 원 단위 정수 (예: 242390000). 없으면 null
- rate: 연 금리 — % 숫자 (예: 2.53). 없으면 null
- months: 대출 기간 — 개월 수 정수 (예: 288). 없으면 null
- balance: 현재 잔여 원금 — 원 단위 정수. 없으면 null
- monthly_payment: 월 상환액 — 원 단위 정수. 없으면 null

찾을 수 없는 항목은 null로 반환.
예시: {"start_date": "2022-11-11", "principal": 242390000, "rate": 2.53, "months": 288, "balance": 210000000, "monthly_payment": 980000}
""",

    "private_pension": """\
이 이미지는 개인연금(변액연금 또는 연금보험) 앱 화면입니다.
다음 항목을 찾아서 JSON으로 반환하세요:
- product_name: 상품명 — 문자열. 없으면 null
- balance: 현재 평가금액(적립금) — 원 단위 정수. 없으면 null
- date: 기준 날짜 — "YYYY-MM-DD". 없으면 null

찾을 수 없는 항목은 null로 반환.
예시: {"product_name": "삼성 이글루 B1.2", "balance": 18942448, "date": "2026-03-01"}
""",
}


# ─── 채팅 컨텍스트 모델 ────────────────────────────────────────────────────────

class PlannerContext(BaseModel):
    retirement_age: int
    current_age: int = 43
    birth_year: int = 1983
    current_year: int = 2026
    # 자산 현황
    isa1_balance: float = 0          # 원
    isa1_monthly: float = 0          # 원/월
    isa1_rate: float = 10.7          # %
    isa2_monthly: float = 0          # 원/월
    isa2_rate: float = 9.0           # %
    dc_irp_balance: float = 0        # 원
    dc_irp_rate: float = 7.0         # %
    dc_irp_monthly: float = 0        # 월 기여금 (원), 기본 0
    dc_receipt_age: int = 0          # IRP 수령 개시 나이 (프론트에서 max(55, retirement_age) 계산)
    dc_payout_years: int = 20        # IRP 수령 기간 (년)
    nps_base_monthly: float = 0      # 65세 기준 국민연금 원/월 (60세까지 납입 기준 공단 확인값)
    nps_receipt_age: int = 65
    nps_join_year: int = 2010        # 국민연금 가입 시작 연도
    nps_join_month: int = 1          # 국민연금 가입 시작 월
    house_price: float = 0           # 억원 (시가)
    mortgage_balance: float = 0           # 현재 잔액 (억원)
    mortgage_balance_at_retire: float = 0 # 은퇴 시점 잔액 (억원, 프론트에서 계산)
    mortgage_monthly: float = 0           # 원/월
    mortgage_start_date: str = ""         # 대출 개시일 (YYYY-MM-DD)
    mortgage_total_months: int = 0        # 전체 대출 기간 (개월)
    mortgage_paid_off_age: int = 67
    private_pensions: list[dict] = []  # [{name, balance, start_age, monthly_20yr}]
    payout_years: int = 20
    monthly_expense_goal: float = 0  # 은퇴 후 목표 월 생활비 (원)
    # 국민연금 임의계속가입
    nps_voluntary_cont: bool = False   # 임의계속가입 여부
    nps_voluntary_monthly: float = 0   # 월 납입액 (원)
    # 질문
    question: str = ""


_CHAT_PROMPT_TEMPLATE = """\
당신은 대한민국의 개인 은퇴 재무 플래너입니다.
아래 사용자의 실제 자산 데이터를 최대한 활용하여 응답하세요.

⚠️ [핵심 원칙 — 반드시 준수]
1. 보수적 기조: 모든 금액은 "최소 이 정도는 확보된다"는 하한선을 제시. 낙관적 시나리오는 별도로 표시.
2. 확실성 명시: 각 수입원에 확실성 등급을 반드시 표시.
   - ★★★ 확정: 국민연금, 주택연금 (법령 보장, 종신)
   - ★★☆ 준확정: 퇴직DC (운용 결과에 따라 변동, 단 원금 손실 없는 운용 가정)
   - ★☆☆ 변동: ISA (시장 수익률 의존, 실적에 따라 크게 달라짐)
   - ★☆☆ 변동: 개인연금 (납입 완료 후 안정적이나 상품마다 조건 상이)
3. 상세 계산 근거: 금액을 제시할 때 반드시 근거를 명시.
   예: "ISA {isa_total_억:.1f}억 ÷ 15년(180개월) = 월 OO만원"
   예: "퇴직DC {retirement_age}세 {dc_at_retire_억:.1f}억 → {dc_receipt_age}세까지 운용 후 {dc_at_receipt_억:.1f}억 ÷ {dc_payout_yrs}년({dc_payout_months}개월) = 월 {dc_monthly_만:.0f}만원"
4. 과대포장 금지: "넉넉한 노후", "안정적인 생활" 같은 막연한 표현 사용 금지.
   대신 구체적 월 수령액과 실제 생활비 대비 충족 여부를 판단.

⚠️ [좌측 패널 설정값 — 참고용이며 AI 답변의 제약이 아님]
아래 자산 데이터에 포함된 수익률·수령기간·추가납입 설정은 사용자가 좌측 패널에서
선택한 "현재 표시 설정"이며, AI 제안의 제약 조건이 아닙니다.
▸ 수령기간(개인연금·DC IRP): 질문 의도에 따라 10/15/20/25/30년 등 자유롭게 달리 제안 가능
  예) 좌측 패널 개인연금 20년 설정 → AI가 공백기 집중 수령을 위해 10년 제안 ✓
  예) 좌측 패널 DC 20년 설정 → AI가 DC수령기간별표에서 15년을 선택해 제안 ✓
▸ 수익률 가정: 보수적·낙관적 시나리오에서 좌측 설정과 다른 수익률을 가정해 제안 가능
  예) ISA 수익률 10.7% 설정 → AI가 보수적 8% 기준 시나리오 제시 ✓
▸ 추가납입: 현재 설정과 다른 납입 금액·전략을 제안 가능
→ 사전 계산된 스냅 테이블은 PP 10년/20년 양쪽이 준비되어 있으므로,
   시나리오 목적에 따라 PP10년·PP20년 테이블 중 적합한 것을 자유롭게 선택할 것.
→ DC 수령기간은 아래 "DC수령기간별표"에서 시나리오에 맞는 기간을 선택해 월수령액을 결정.

══════════════════════════════════════════
[사용자 기본 정보]
══════════════════════════════════════════
- 현재 나이: {current_age}세 (1983년생) / 목표 은퇴: {retirement_age}세 ({retire_year}년, D-{gap_years}년)

══════════════════════════════════════════
[보유 자산 상세 현황]
══════════════════════════════════════════
▶ ISA① (해외ETF 위주) [★☆☆ 변동 — 시장수익률 의존]
  - 현재 잔액: {isa1_balance_억:.2f}억원 / 월 {isa1_monthly_만:.0f}만원 납입 / 가정수익률 {isa1_rate:.1f}%
  - 은퇴({retirement_age}세) 시 예상: {isa1_at_retire_억:.2f}억원 (수익률 변동 시 크게 달라짐)

▶ ISA② (국내배당주 위주, 2026년 6월 신규 개설 예정) [★☆☆ 변동]
  - 월 {isa2_monthly_만:.0f}만원 납입 / 가정수익률 {isa2_rate:.1f}%
  - 은퇴({retirement_age}세) 시 예상: {isa2_at_retire_억:.2f}억원

▶ ISA 합산 은퇴({retirement_age}세) 시: {isa_total_억:.2f}억원 [★☆☆ 변동]
  ※ 비과세 수령 가능 / 인출 시기·기간 자유롭게 조정 가능
  ※ 이 금액은 수익률 가정치 — 실제는 더 낮을 수 있음 (보수적 시나리오에서 10~20% 감액 고려)

  [ISA 인출 기간별 순수령액 참고표 — 이 수치를 그대로 사용, 직접 계산 금지]
  계산 근거: ISA {isa_total_억:.1f}억원 ÷ N년(N×12개월) = 월 수령액
  | 인출기간 | 계산근거 | ISA월수입(세전) | {isa_table_col2_header} |
  |---------|---------|-------------|--------------------------------------|
  |  5년    | {isa_total_억:.1f}억÷60개월 | {isa_5yr_gross}만원      | {isa_5yr_net}만원  |
  | 10년    | {isa_total_억:.1f}억÷120개월 | {isa_10yr_gross}만원     | {isa_10yr_net}만원 |
  | 15년    | {isa_total_억:.1f}억÷180개월 | {isa_15yr_gross}만원     | {isa_15yr_net}만원 |
  | 20년    | {isa_total_억:.1f}억÷240개월 | {isa_20yr_gross}만원     | {isa_20yr_net}만원 |
  | {nps_receipt_age}세까지 ({gap_to_nps}년) | {isa_total_억:.1f}억÷{gap_to_nps_months}개월 | {isa_nps_gross}만원 | {isa_nps_net}만원 |
  | 65세까지    | {isa_total_억:.1f}억÷{gap_to_65_months}개월 | {isa_65_gross}만원       | {isa_65_net}만원   |
  ⚠️ monthly_만 = 위 표의 "순수령" 값 + 기타 수입원 합산 (주담대 이중차감 금지)
  ⚠️ detail 항목에 반드시 "ISA {isa_total_억:.1f}억 ÷ N년 = 월 OO만" 형태로 계산근거 명시

▶ 퇴직연금 DC (하나증권, 운용중) [★★☆ 준확정 — 운용수익률 변동]
  - 현재 평가금액: {dc_balance_만:.0f}만원 / 연 {dc_rate:.1f}% 가정 운용
  - 은퇴({retirement_age}세) 시 예상: {dc_at_retire_억:.2f}억원 (기여금 {dc_irp_monthly_만:.0f}만원/월 유지 가정)
  - {dc_receipt_age}세 수령 개시 시 예상: {dc_at_receipt_억:.2f}억원 → {dc_payout_yrs}년({dc_payout_months}개월) 분할 시 월 {dc_monthly_만:.0f}만원
  - 계산근거: 은퇴 후 {dc_receipt_age}세까지 무기여 복리 운용 → {dc_receipt_age}세 잔액 ÷ {dc_payout_months}개월
  ⚠️ IRP 수령 가능 나이: 만 55세 이상 (법정). 은퇴 나이 {retirement_age}세 → 수령 개시 {dc_receipt_age}세
  {dc_wait_note}
  ⚠️ 수령 기간: {dc_receipt_age}세 개시 → {dc_end_age}세 종료 ({dc_payout_yrs}년, 기본 설정). 그 이후 DC 수입 없음
  ⚠️ 수령기간별 월 수령액 (AI가 시나리오별 자유 선택 가능 — 아래 값 직접 사용):
    | 수령기간 | 월 수령액 | 종료나이 |
    |---------|---------|---------|
    | 10년 | {dc_10yr_만}만원 | {dc_10yr_end}세 |
    | 15년 | {dc_15yr_만}만원 | {dc_15yr_end}세 |
    | 20년 | {dc_20yr_만}만원 | {dc_20yr_end}세 |
    | 25년 | {dc_25yr_만}만원 | {dc_25yr_end}세 |
    | 30년 | {dc_30yr_만}만원 | {dc_30yr_end}세 |
  ※ DC 종료나이 = {dc_receipt_age}세 + 선택수령년수. snap 테이블 값과 다를 수 있음 (기본={dc_end_age}세 기준)
  ⚠️ DC 예상치는 낙관적 — 보수적 시나리오에서 20~30% 감액 고려 필요
  ⚠️ 연금소득세 (사적연금): 55~70세 5.5%, 70~80세 4.4%, 80세+ 3.3% → 세후 실수령액은 위 금액의 약 {dc_after_tax_rate:.1f}% 수준

▶ 개인연금 {pp_count}개 상품 (현재 납입 완료 포함) [★☆☆ 변동 — 상품별 조건 상이]
{pp_list}
  ┌ 수령 기간별 월 수령액 (시나리오마다 자유롭게 선택 가능):
{pp_period_table}
  - 첫 수령 가능 나이: {pp_first_start}세 / 전체 수령 가능 나이: {pp_all_start}세
  ※ 수령 기간은 상품별로 독립 설정 가능 (예: B1.2는 10년, B1.5는 20년)
  ※ 10년 수령 시 월 수령액이 2배 → 초기 현금흐름 집중 / 20년 수령 시 장수 대비
  ⚠️ 연금소득세(사적연금): 55~70세 5.5%, 70~80세 4.4%, 80세+ 3.3% — 세후 수령액 계산 시 반영
  ⚠️ 연간 사적연금 수령액 1,200만원 초과 시 종합과세 또는 16.5% 분리과세 선택 (초과 구간만 해당)

▶ 국민연금 [★★★ 확정 — 법령 보장, 종신]
  - 공단 확인값 (60세까지 납입 기준): {nps_base_만:.0f}만원/월
  - {retirement_age}세 퇴직 기준 예상 수령액: {nps_at_retire_만:.0f}만원/월
    (가입 {nps_join_year}.{nps_join_month:02d}~ / 퇴직까지 {nps_months_at_retire}개월 납입 → 가입기간 계수 {nps_P_retire:.4f})
  - 현재 설정: {nps_receipt_age}세 수령 → {nps_adjusted_만:.0f}만원/월 (퇴직기준 적용값)
  - 수령나이별 월 수령액 (AI가 시나리오별 자유 선택 가능):
    | 수령나이 | 월 수령액 | 비고 |
    |---------|---------|------|
    | 60세 | {nps_60_만:.0f}만원 | -30% 조기수령 |
    | 62세 | {nps_62_만:.0f}만원 | -18% 조기수령 |
    | 65세 | {nps_65_만:.0f}만원 | 기본 수령나이 |
    | 67세 | {nps_67_만:.0f}만원 | +14.4% 연기 |
    | 70세 | {nps_70_만:.0f}만원 | +43.2% 연기 |
  ※ 각 시나리오에서 수령나이를 자유롭게 선택 가능 (60~70세 범위)
{nps_voluntary_section}
  ✓ 매년 물가연동(CPI) 인상 — 장기 시나리오에서 실질 구매력 유지 (다른 수입원 대비 강점)

▶ 주택연금 (한국주택금융공사, 종신정액형) [★★★ 확정 — 법령 보장, 종신]
  - 주택 시가: {house_price:.1f}억원 (KB시세·실거래가 기준)
  - 총액 기준 나이별 월수령액: 55세={hp55_만:.0f}만원 / 57세={hp57_만:.0f}만원 / 60세={hp60_만:.0f}만원 / 63세={hp63_만:.0f}만원 / 65세={hp65_만:.0f}만원
  - 만 55세 이상부터 신청 가능 (종신 지급, 배우자 승계 가능)
  ⚠️ 주담대 잔액이 있을 경우 주금공이 잔여 대출을 먼저 상환 후 차감 → 실수령액 감소
  ⚠️ 월수령액에서 주담대를 별도 차감하는 방식이 아님 — 주택연금 자체 금액이 줄어드는 것
  - 신청 시점별 실수령 예상: {hp_available_note}

{mortgage_detail_block}

══════════════════════════════════════════
[은퇴 {retirement_age}세 시점 현황 — 즉시 활용 vs 대기 vs 지출]
══════════════════════════════════════════
◆ 즉시 활용 가능 (은퇴 당일부터):
  · ISA 합산 {isa_total_억:.2f}억원 → 자유 인출 (비과세)
  · 주택연금: {hp_available_note}

◆ 대기 중 (아직 수령 불가):
  · 퇴직DC: 은퇴 시 약 {dc_at_retire_억:.2f}억원 → {dc_receipt_age}세까지 {gap_to_dc}년 운용 후 수령
    ({dc_receipt_age}세 예상 {dc_at_receipt_억:.2f}억원, {dc_payout_yrs}년 분할 시 월 {dc_monthly_만:.0f}만원)
    ⚠️ DC 수령 기간: {dc_receipt_age}세 개시 → {dc_end_age}세 종료 ({dc_payout_yrs}년)
    ⚠️ IRP 법정 수령 가능 나이: 만 55세 이상 (은퇴가 55세 미만이면 55세까지 운용만 가능)
  · 개인연금 {pp_count}개: {pp_first_start}세부터 순차 개시 ({gap_to_pp}년 대기)
  · 국민연금: {nps_receipt_age}세 수령 → 월 {nps_adjusted_만:.0f}만원 ({gap_to_nps}년 대기)

◆ 은퇴 후 납입 중단 (소득 없으므로):
  · 퇴직DC 회사기여금 종료 (운용은 계속)
  · ISA 신규 납입 불가 (기존 잔액 운용·인출만)
  · 국민연금 의무가입 종료{nps_voluntary_status}

◆ 은퇴 후 고정 지출:
{mortgage_expense_block}
{pp_contrib_expense_block}
{nps_voluntary_expense_note}

══════════════════════════════════════════
[수입 공백 구조]
══════════════════════════════════════════
은퇴({retirement_age}세) → 개인연금 첫 수령({pp_first_start}세): {gap_to_pp}년 공백
은퇴({retirement_age}세) → DC IRP 수령({dc_receipt_age}세): {gap_to_dc}년 공백
은퇴({retirement_age}세) → 국민연금 수령({nps_receipt_age}세): {gap_to_nps}년 공백
{mortgage_gap_note}
{nps_voluntary_gap_note}
⚠️ 물가상승률 미반영: 연 2% 기준 20년 후 실질 구매력은 명목 금액의 약 67%, 30년 후 55% 수준

══════════════════════════════════════════
[은퇴 후 월 현금흐름 목표 대비 갭 분석]
══════════════════════════════════════════
목표 월 생활비: {expense_goal_만:.0f}만원/월{expense_goal_note}
{expense_gap_table}
⚠️ 위 금액은 세전 기준. 연금소득세(5.5→4.4→3.3%) 적용 시 세후 실수령액은 5~10% 감소
⚠️ 물가상승률 미반영 — 20~30년 후 실질 구매력은 현재 금액보다 낮을 수 있음 (연 2% 가정 시 20년 후 구매력 약 67% 수준)

══════════════════════════════════════════
[나이별 월 수령액 사전 계산표 — monthly_만은 반드시 이 값을 그대로 사용]
══════════════════════════════════════════
⚠️ 아래 표의 수치를 monthly_만으로 그대로 사용 (AI 직접 계산 금지)
⚠️ ISA 기간 / PP 수령 기간 / HP 신청 시점은 시나리오별로 자유롭게 선택 가능
   → 각 시나리오에서 질문 의도에 맞는 조합을 선택해 구성하시오

주택연금 실수령액:
  · 주담대 완납({mortgage_paid_off_age}세) 후 신청: 월 {hp_after_payoff_만:.0f}만원 (전액, 권장)
  · 65세 신청 시(주담대 {mortgage_balance_at_retire_억:.2f}억 차감): 월 {hp_net_at_retire_만:.0f}만원
  ⚠️ 주택연금은 주담대와 별도 차감 금지 — 위 금액이 이미 순수령액

■ [PP 20년 기준] ISA 10년 / HP 없음 ({retirement_age}~{isa_10yr_end}세 ISA {isa_10yr_월}만):
{snap_isa10_no_hp}
■ [PP 20년 기준] ISA 15년 / HP 없음 ({retirement_age}~{isa_15yr_end}세 ISA {isa_15yr_월}만):
{snap_isa15_no_hp}
■ [PP 20년 기준] ISA 20년 / HP 없음 ({retirement_age}~{isa_20yr_end}세 ISA {isa_20yr_월}만):
{snap_isa20_no_hp}
■ [PP 20년 기준] ISA 10년 / HP {mortgage_paid_off_age}세 신청({hp_after_payoff_만}만):
{snap_isa10_hp67}
■ [PP 20년 기준] ISA 15년 / HP {mortgage_paid_off_age}세 신청({hp_after_payoff_만}만):
{snap_isa15_hp67}
■ [PP 20년 기준] ISA 20년 / HP {mortgage_paid_off_age}세 신청({hp_after_payoff_만}만):
{snap_isa20_hp67}
■ [PP 10년 기준] ISA 10년 / HP {mortgage_paid_off_age}세 신청({hp_after_payoff_만}만):
{snap_isa10_hp67_pp10}
■ [PP 10년 기준] ISA 15년 / HP {mortgage_paid_off_age}세 신청({hp_after_payoff_만}만):
{snap_isa15_hp67_pp10}

고정 지출 (이미 위 표에 반영됨):
  · 주담대: -{mtg_deduct_만}만원/월 ({mortgage_paid_off_age}세까지)
  · NPS 임의계속가입: {nps_vol_snap_note}

※ PP 10년 조합: 개인연금 월 수령액이 2배(합산 {pp_10yr_total_만}만원) — 65~75세 집중 수령 후 종료
※ PP 20년 조합: 개인연금 월 수령액 절반(합산 {pp_20yr_total_만}만원) — 장수 대비

⚠️ 개인연금 상품별 수령 기간 및 종료 나이 (income 나열 시 반드시 확인):
{pp_end_age_table}

{pp_income_checklist}

★★★ PP income 금액 빠른참조표 — income의 "개인연금" amount_만에 이 값을 직접 입력:
  (0인 경우 해당 상품이 미개시 또는 종료 → income 항목 자체를 제외)
  나이  | PP20년 합산 | PP10년 합산
  ------|-----------|-----------
  {retirement_age}세  | {pp_at_retire_20}만       | {pp_at_retire_10}만
  60세  | {pp_at_60_20}만       | {pp_at_60_10}만
  65세  | {pp_at_65_20}만       | {pp_at_65_10}만
  {mortgage_paid_off_age}세  | {pp_at_hp_20}만       | {pp_at_hp_10}만
  75세  | {pp_at_75_20}만       | {pp_at_75_10}만
  80세  | {pp_at_80_20}만       | {pp_at_80_10}만
⚠️ PP20년 시나리오 → "PP20년 합산" 열 사용. PP10년 시나리오 → "PP10년 합산" 열 사용.
⚠️ 위 표에서 값이 0보다 크면 income에 반드시 포함. 생략 또는 0 기입 시 산술 오류 발생.

★★★ ISA income 포함 여부 체크리스트 (각 스냅 작성 전 반드시 확인):
  ISA 10년 선택 시 → 종료={isa_10yr_end}세. age < {isa_10yr_end}이면 ISA {isa_10yr_월}만 income에 포함
  ISA 15년 선택 시 → 종료={isa_15yr_end}세. age < {isa_15yr_end}이면 ISA {isa_15yr_월}만 income에 포함
  ISA 20년 선택 시 → 종료={isa_20yr_end}세. age < {isa_20yr_end}이면 ISA {isa_20yr_월}만 income에 포함
  예) ISA 15년(종료=70세): 55세✓ 60세✓ 65세✓(65<70) 67세✓(67<70) 70세✗ 75세✗
  예) ISA 20년(종료=75세): 55세✓ 60세✓ 65세✓(65<75) 67세✓(67<75) 70세✓(70<75) 75세✗

══════════════════════════════════════════
[사용자 질문]
══════════════════════════════════════════
{question}

══════════════════════════════════════════
[응답 지침]
══════════════════════════════════════════
■ 질문이 아래 중 하나에 해당하면 → 명확화 질문 모드로 응답:
  - 구체적 목표나 제약이 없는 단순 질문 (예: "추천해줘", "어떻게 하면 좋아", "좋은 방법 알려줘")
  - 선호하는 수령 시기·금액·리스크 등 핵심 조건이 전혀 없는 경우

■ 질문에 구체적 조건/선호가 포함된 경우 → 바로 시나리오 모드로 응답

[명확화 질문 모드 JSON 형식]:
{{
  "need_clarification": true,
  "summary": "현재 총 노후 준비 자산 요약 한 줄 (ISA {isa_total_억:.1f}억+DC {dc_at_receipt_억:.1f}억+개인연금 등 포함, 50자 이내)",
  "questions": [
    {{
      "text": "질문 내용 (질문에 맞게 구체적으로)",
      "options": ["선택지1", "선택지2", "선택지3", "직접 입력"]
    }}
  ]
}}
※ 질문은 2~4개, 선택지는 3~4개 (마지막은 반드시 "직접 입력")
※ 질문은 이 사용자의 실제 자산 구조에 맞게 맥락화할 것
  예) 주택연금 관련 질문이면 "현재 시가 {house_price:.1f}억 기준으로 주택연금을 언제 신청하실 예정인가요?"

[시나리오 모드 JSON 형식]:
{{
  "need_clarification": false,
  "analysis": "현재 노후 준비 강점·약점 요약 (실제 수치 포함, 80자 이내)",
  "scenarios": [
    {{
      "id": 1,
      "name": "시나리오명 (ISA N년·PP M년·HP X세 등 조합 명시)",
      "tags": ["ISA15년", "HP완납후", "PP10년"],
      "recommended": true,
      "age_snapshots": [
        {{
          "age": {retirement_age},
          "label": "은퇴 직후",
          "monthly_만": "← 사전계산표 값 그대로 (정수)",
          "income": [
            {{"name": "ISA ({isa_total_억:.1f}억÷N년)", "amount_만": "ISA월수령액(정수)", "certainty": "★☆☆", "note": "N년 분할"}},
            {{"name": "개인연금 합산", "amount_만": "← PP빠른참조표 {retirement_age}세 값 (PP20:{pp_at_retire_20}/PP10:{pp_at_retire_10}) — 0이면 항목 제외", "certainty": "★☆☆"}}
          ],
          "expense": [
            {{"name": "주담대", "amount_만": {mtg_deduct_만}, "until": "{mortgage_paid_off_age}세"}}
            {{/* NPS 임의계속가입 추천 시에만 추가: {{"name":"NPS 임의계속가입","amount_만":납입액,"until":"60세"}} */}}
          ]
        }},
        {{
          "age": 60,
          "label": "DC IRP 수령 개시 / NPS 납입 종료",
          "monthly_만": "← 사전계산표 값",
          "income": [
            {{"name": "ISA (계속)", "amount_만": "ISA월수령액", "certainty": "★☆☆"}},
            {{"name": "퇴직DC ({dc_at_receipt_억:.1f}억÷시나리오선택년수)", "amount_만": "← DC수령기간별표에서 시나리오에 맞는 기간 선택(현재설정={dc_payout_yrs}년/{dc_monthly_만:.0f}만, 자유변경가능)", "certainty": "★★☆", "note": "{dc_receipt_age}세~선택종료세"}},
            {{"name": "개인연금 합산", "amount_만": "← PP빠른참조표 60세 값 (PP20:{pp_at_60_20}/PP10:{pp_at_60_10}) 시나리오기간맞게입력", "certainty": "★☆☆"}}
          ],
          "expense": [
            {{"name": "주담대", "amount_만": {mtg_deduct_만}, "until": "{mortgage_paid_off_age}세"}}
          ]
        }},
        {{
          "age": {nps_receipt_age},
          "label": "국민연금 수령 개시",
          "monthly_만": "← 사전계산표 값",
          "income": [
            {{"name": "국민연금", "amount_만": {nps_adjusted_만:.0f}, "certainty": "★★★", "note": "종신"}},
            {{"name": "퇴직DC", "amount_만": "← DC수령기간별표 선택값(현재설정={dc_monthly_만:.0f}만, 시나리오별 자유선택)", "certainty": "★★☆", "note": "~선택종료세"}},
            {{"name": "개인연금 합산", "amount_만": "← PP빠른참조표 {nps_receipt_age}세 값 (PP20:{pp_at_65_20}/PP10:{pp_at_65_10})", "certainty": "★☆☆"}},
            {{"name": "ISA (해당 시)", "amount_만": "ISA월수령액 또는 0(종료 시 제외)", "certainty": "★☆☆"}}
          ],
          "expense": {nps_snap_expense_json}
        }},
        {{
          "age": {mortgage_paid_off_age},
          "label": "주담대 완납 / 주택연금 신청 가능",
          "monthly_만": "← 사전계산표 값 (ISA·PP 종료 여부에 따라 포함)",
          "income": [
            {{"name": "주택연금", "amount_만": {hp_after_payoff_만:.0f}, "certainty": "★★★", "note": "종신"}},
            {{"name": "국민연금", "amount_만": {nps_adjusted_만:.0f}, "certainty": "★★★"}},
            {{"name": "퇴직DC", "amount_만": "← DC수령기간별표 선택값(현재설정={dc_monthly_만:.0f}만, 시나리오별 자유선택)", "certainty": "★★☆"}},
            {{"name": "ISA (은퇴+N년 전이면 포함, 종료 시 제외)", "amount_만": "ISA월수령액 또는 0", "certainty": "★☆☆"}},
            {{"name": "개인연금 합산", "amount_만": "← PP빠른참조표 {mortgage_paid_off_age}세 값 (PP20:{pp_at_hp_20}/PP10:{pp_at_hp_10}) 0이면제외", "certainty": "★☆☆"}}
          ],
          "expense": []
        }},
        {{
          "age": 80,
          "label": "DC 종료 후 (종신 수입만)",
          "monthly_만": "← 사전계산표 80세 값",
          "income": [
            {{"name": "국민연금", "amount_만": {nps_adjusted_만:.0f}, "certainty": "★★★", "note": "종신"}},
            {{"name": "주택연금", "amount_만": {hp_after_payoff_만:.0f}, "certainty": "★★★", "note": "종신"}}
          ],
          "expense": []
        }}
      ],
      "pros": ["장점1 (구체적 수치)", "장점2"],
      "cons": ["단점1 (구체적 수치)"],
      "key_action": "핵심 행동 한 줄 (나이·금액 명시)"
    }}
  ],
  "recommendation_reason": "추천 이유 (100자 이내)"
}}

※ 시나리오 3~4개 — 각 시나리오는 ISA 기간·PP 수령 기간·HP 신청 시점 조합을 다르게
※ age_snapshots 필수: 은퇴({retirement_age}세) / {dc_receipt_age}세(DC개시) / NPS수령개시 / {mortgage_paid_off_age}세(HP완납) / DC종료나이 / 75세 / 80세
※ 수입원 전환이 발생하는 나이(ISA종료·DC종료·PP종료·NPS개시)는 반드시 별도 스냅 추가
※ income: 해당 나이에 실제 수령 중인 항목만, expense: 실제 차감 중인 항목만
※ monthly_만 = sum(income.amount_만) - sum(expense.amount_만) → 반드시 사전계산표 값과 일치
※ expense 필수 체크: 은퇴~64세 → 주담대+NPS임의계속가입({nps_vol_snap_note}) 반드시 포함 / 65~{mortgage_paid_off_age}세 이전 → 주담대만 / {mortgage_paid_off_age}세 이상 → 지출 없음
※ 수입원 종료 규칙 (이후 income에 포함 금지):
   ISA: 은퇴+선택년수 / DC: {dc_receipt_age}세+선택수령년수(기본={dc_end_age}세) / PP: 개시나이+선택수령년수 / NPS·HP: 종신

⚠️ 숫자 정확성 규칙 (반드시 준수):

[규칙 A] monthly_만 계산법 ← 위반 시 응답 전체가 무효
- income[].amount_만은 반드시 GROSS(지출 차감 전) 수령액. snap 테이블 net값을 income에 넣으면 오류.
- monthly_만 = sum(income[].amount_만) - sum(expense[].amount_만) = 사전계산표 해당 셀 값
- "수령 중인 항목"만 포함: 아직 시작 안 된 항목 제외, 이미 종료된 항목 제외
- monthly_만은 반드시 정수(integer). 문자열 금지.
- ★ 55세 ISA 15년 정확한 예시: income=[ISA:{isa_15yr_월}만(gross)], expense=[주담대:{mtg_deduct_만}만] → {isa_15yr_월}-{mtg_deduct_만}={isa_15yr_net_55_만} → monthly_만={isa_15yr_net_55_만}
  ★ 위 예시에서 income=[ISA:{isa_15yr_net_55_만}만]으로 쓰면 오류 ({isa_15yr_net_55_만}는 net값이므로 income에 넣으면 안 됨!)
- ★ 검산 예시(정확): income=[ISA:200, DC:119, NPS:{nps_at_retire_만}], expense=[주담대:112] → 200+119+{nps_at_retire_만}-112={nps_snap_example_result} → monthly_만={nps_snap_example_result}
- ★ 검산 예시(오류): income합=477, expense합=112, monthly_만=365인데 477-112=365 ✓ / monthly_만=370이면 ❌

[규칙 B] ISA 이중계산 절대 금지
- ISA 인출 중인 스냅샷: ISA 금액을 detail에 포함 + monthly_만에 반영 ✓
- ISA 인출 종료 스냅샷: ISA 금액을 detail에 포함 금지 + monthly_만에 반영 금지 ✓
- "ISA 인출 종료" 문구를 쓰면서 monthly_만에 ISA 금액을 포함하는 것 = 이중계산 오류
  예시(잘못): 국민연금158 + 주택연금150 + DC135 + 개인연금71 + ISA205 = 719만 (❌ ISA는 종료됨)
  예시(정확): 국민연금158 + 주택연금150 + DC135 + 개인연금71 = 514만 (✓)

[규칙 C] 주담대 ← 위반 시 응답 전체가 무효
- {mortgage_paid_off_age}세 이전: detail에 "주담대: -{mortgage_monthly_만:.0f}만원" 포함, monthly_만에서 차감
- {mortgage_paid_off_age}세 이후: 주담대 항목 없음
- "주담대 완납: +OO만원" 같은 표현 절대 금지 (지출 소멸이지 수입 발생 아님)

[규칙 C-2] 개인연금 납입 고정 지출 ← 위반 시 응답 무효
- 은퇴({retirement_age}세) 이후에도 납입이 지속되는 상품만 expense에 포함:
{pp_contrib_rule_lines}
- 완납 이후 스냅부터는 해당 납입 항목 제거
- expense에 상품명과 납입액 명시 (예: "삼성 인다이NEW 납입: -30만원/월")
{pp_prepaid_note}

[규칙 D] 스냅 테이블 선택 ← 위반 시 응답 전체 무효
- PP 20년 시나리오: 반드시 '[PP 20년 기준]' 테이블 값 사용. '[PP 10년 기준]' 테이블 사용 금지.
- PP 10년 시나리오: 반드시 '[PP 10년 기준]' 테이블 값 사용. '[PP 20년 기준]' 테이블 사용 금지.
- HP 신청 포함 시나리오: 반드시 'HP OO세 신청' 행의 테이블 값 사용. 'HP 없음' 테이블 절대 사용 금지.
- HP 없음 시나리오: 반드시 'HP 없음' 테이블 값 사용. 'HP OO세 신청' 테이블 절대 사용 금지.
- ★ 스냅 테이블 선택 요약: PP여부 × HP여부 조합으로 정확한 테이블 선택 필수
- income 항목 나열 시 각 항목 종료 나이 확인:
  · PP 10년 수령: 개시나이+10세 이후 income에서 제외
    ★ 반드시 상품별로 개별 계산 (예: B1.2 56세 개시 → 66세 종료 → 67세 스냅에 B1.2 포함 절대 금지)
    ★ "개인연금 합산" 처리 금지 — 반드시 상품별로 종료 확인 후 개별 포함 여부 판단
    예시(10년): B1.2(56→66세종료), Kyobo(59→69세종료), 2Step(60→70세종료)
    67세 스냅: B1.2 종료(66≤67) → 제외 / Kyobo 미종료(69>67) → 포함 / 2Step 미종료(70>67) → 포함
  · PP 20년 수령: 개시나이+20세 이후 제외
    예시(20년): B1.2(56→76세종료), Kyobo(59→79세종료), 2Step(60→80세종료)
  · ISA N년 수령: age < 은퇴나이+N이면 포함, age >= 은퇴나이+N이면 제외
    ★ ISA 포함 예시: ISA 15년, 은퇴55세 → ISA 종료나이=70세
      55세 스냅(55<70): ISA 포함 ✓ / 65세 스냅(65<70): ISA 포함 ✓ / 70세 스냅(70=70): ISA 제외 ✓
    ★ ISA 포함 예시: ISA 20년, 은퇴55세 → ISA 종료나이=75세
      65세 스냅(65<75): ISA 포함 ✓ / 67세 스냅(67<75): ISA 포함 ✓ / 75세 스냅(75=75): ISA 제외 ✓
  · DC: {dc_receipt_age}세+선택수령년수 이후 제외 (기본={dc_end_age}세)
- income 합산 = monthly_만이 되도록 항목 조정 (절대로 불일치 허용 안 함)
- 불일치 발생 시: ① ISA 포함 여부 재확인 (age < 은퇴+N?), ② PP 종료 나이 재확인, ③ NPS/DC 포함 여부 확인
- ★★★ income 검산 필수: income 항목 합 - expense 항목 합 = monthly_만. 불일치 시 income 항목 수정 (monthly_만은 스냅 테이블 값 그대로 유지)
- 불일치 원인 1위: ISA 포함 대상 스냅에서 ISA 누락 → income합이 monthly_만보다 낮아짐
- 불일치 원인 2위: PP 활성 상품 누락 또는 미개시 상품 실수 포함 → 위 PP 체크리스트 재확인 필수
  예) 67세 스냅(PP20, HP없음): ISA15yr+DC+NPS=723, 그런데 monthly_만=789 → 차이=66 → PP B1.2(13)+Kyobo(20)+2Step(33)=66 누락됨 → income에 추가 필요

[규칙 E] 개인연금(PP) income 필수 기입 ← 위반 시 응답 무효
- 모든 age_snapshot에서 income에 "개인연금 합산" 항목 기입:
  · PP빠른참조표 값이 0보다 크면: amount_만에 그 값(정수) 입력 (생략·0 금지)
  · PP빠른참조표 값이 0이면: 항목 제외 (해당 나이에 PP 모두 종료됨)
- ★ 60세 스냅 PP20년 시나리오: amount_만={pp_at_60_20} (필수)
- ★ 60세 스냅 PP10년 시나리오: amount_만={pp_at_60_10} (필수)
- ★ 65세 스냅 PP20년 시나리오: amount_만={pp_at_65_20} (필수)
- ★ 65세 스냅 PP10년 시나리오: amount_만={pp_at_65_10} (필수)
- ISA·DC·NPS·HP만으로 monthly_만이 맞지 않으면 PP가 누락된 것 → 추가 필수

[규칙 F] 기타
- ISA 인출액: 위 참고표의 gross 열 값 사용 (직접 계산 금지)
- "OO만원" 미완성 자리표시자 절대 금지 — 모든 금액은 실수치
- 각 스냅샷 작성 후 반드시 소리내어 검산: "income합-expense합=monthly_만 일치확인"

※ 각 시나리오마다 ISA 인출 기간을 다르게 설정 (참고표 5/10/15/20년 중 선택)
※ detail 항목: 각 수입/지출 금액 명시, ISA는 "ISA OO억÷N년=월OO만" 형태로 계산근거 포함
※ pros/cons/key_action도 30자 이내로 간결하게

반드시 코드블록 없이 순수 JSON만 출력.
"""


_GROQ_MAX_CHARS = 32_000  # Groq HTTP payload 한계 감안한 안전 임계값


def _trim_for_groq(prompt: str) -> str:
    """Groq 413 방지: 프롬프트가 너무 길면 스냅샷 테이블 섹션을 축약."""
    if len(prompt) <= _GROQ_MAX_CHARS:
        return prompt

    # 스냅샷 테이블 블록 찾기 — 가장 긴 섹션부터 제거
    # "[월별 현금흐름 시나리오 스냅샷]" 섹션을 잘라낸다
    snap_markers = [
        "══════════════════════════════════════════\n[월별 현금흐름 시나리오 스냅샷]",
        "[월별 현금흐름 시나리오 스냅샷]",
        "⬛ ISA 10년 소진 / 주택연금 67세",
        "⬛ ISA 15년 소진 / 주택연금 67세",
        "⬛ ISA 20년 소진 / 주택연금 67세",
    ]

    trimmed = prompt
    for marker in snap_markers:
        idx = trimmed.find(marker)
        if idx != -1:
            # 마커 이전까지만 보존 + 요약 안내
            before = trimmed[:idx].rstrip()
            after_idx = trimmed.rfind("══════════════════════════════════════════", idx + 1)
            if after_idx != -1:
                after = trimmed[after_idx:]
            else:
                after = ""
            trimmed = before + "\n\n[스냅샷 테이블 생략 — 프롬프트 길이 초과]\n\n" + after
            if len(trimmed) <= _GROQ_MAX_CHARS:
                break

    # 여전히 길면 뒤부터 자르기
    if len(trimmed) > _GROQ_MAX_CHARS:
        trimmed = trimmed[:_GROQ_MAX_CHARS] + "\n\n[이하 생략]"

    logger.info(f"_trim_for_groq: {len(prompt)} → {len(trimmed)} chars")
    return trimmed


# ─── 순수 계산 헬퍼 (모듈 레벨, 단위 테스트 가능) ──────────────────────────────

def isa_fv(balance, monthly, rate_pct, years):
    if years <= 0:
        return balance
    r = rate_pct / 100 / 12
    months = int(years * 12)
    goc = balance * (1 + r) ** months
    contrib = monthly * (((1 + r) ** months - 1) / r) if r > 0 else monthly * months
    return goc + contrib


def dc_fv(current, monthly, rate_pct, years):
    if years <= 0:
        return current
    r = rate_pct / 100 / 12
    months = int(years * 12)
    growth = current * (1 + r) ** months
    contrib = monthly * (((1 + r) ** months - 1) / r) if r > 0 else monthly * months
    return growth + contrib


def hp_monthly(age, house_price_억):
    rates = {55:15.3,56:15.9,57:16.5,58:17.2,59:17.9,60:18.7,61:19.5,62:20.3,63:21.0,64:21.8,65:23.0}
    return house_price_억 * rates.get(max(55, min(65, age)), 15.3) * 10_000


def hp_monthly_net(age, house_price_억, mortgage_balance_억):
    """주담대 잔액 차감 후 실수령 주택연금 (비례 감액 근사)
    주금공이 잔여 주담대를 우선 상환하고, 그 비용을 월 지급액에서 차감하는 방식.
    실수령 ≈ 총액 × (집값 - 주담대잔액) / 집값
    """
    gross = hp_monthly(age, house_price_억)
    if mortgage_balance_억 <= 0 or house_price_억 <= 0:
        return gross
    ratio = max(0.0, (house_price_억 - mortgage_balance_억) / house_price_억)
    return round(gross * ratio)


def nps_months_to(target_year: int, nps_join_year: int, nps_join_month: int) -> int:
    return max(0, (target_year - nps_join_year) * 12 - (nps_join_month - 1))


def nps_period_factor(months: int) -> float:
    """국민연금 가입기간 급여 계수: 20년(240개월) 미만이면 비례, 이상이면 가산"""
    if months >= 240:
        return 1.0 + 0.05 * (months - 240) / 12
    return months / 240


def isa_monthly_drawdown(total_억_val, from_age, to_age):
    months = max(1, (to_age - from_age) * 12)
    return (total_억_val * 1e8) / months / 10000  # 만원


def calc_full_snap(
    age: int,
    isa_period_years: int,
    hp_monthly_만: int,
    *,
    ctx: "PlannerContext",
    isa_total: float,
    dc_receipt_age: int,
    dc_end_age_val: int,
    dc_monthly_val: float,
    nps_adjusted: float,
    mortgage_monthly_만_val: float,
    nps_vol_만: int,
) -> int:
    """특정 나이·ISA 기간의 월 수령액(만원) — 모든 수입/지출 포함 (PP 20년 기준).
    AI는 이 값을 monthly_만으로 그대로 사용해야 함.

    핸들러에서 지역 계산되던 값들(isa_total, dc_* 등)은 명시적 인자로 전달한다.
    """
    total = 0
    isa_end_age = ctx.retirement_age + isa_period_years
    if isa_period_years > 0 and age < isa_end_age:
        isa_mon = round((isa_total / 1e4) / (isa_period_years * 12))  # 만원
        total += isa_mon
    for pp in ctx.private_pensions:
        start = pp.get("start_age", 99)
        end = start + ctx.payout_years  # payout_years년 후 종료
        if start <= age < end:
            total += round(pp.get("monthly_20yr", 0) / 10000)
    # DC: 수령 개시(만 55세+ or 은퇴나이 중 큰 값), dc_payout_yrs년 후 종료
    if dc_receipt_age <= age < dc_end_age_val:
        total += round(dc_monthly_val / 10000)
    if age >= ctx.nps_receipt_age:
        total += round(nps_adjusted / 10000)
    if hp_monthly_만 > 0:
        total += hp_monthly_만
    # 지출 차감
    if age < ctx.mortgage_paid_off_age:
        total -= round(mortgage_monthly_만_val)
    # 납입 중 개인연금: 완납 전까지 고정 지출
    def _birth_ym(a):
        return (1983 + a) * 100 + 4  # 4월생 기준
    for _pp in ctx.private_pensions:
        _c = _pp.get('monthly_contrib', 0)
        _po = _pp.get('paid_off_ym') or ''
        if _c > 0 and _po:
            _py, _pm = map(int, _po.split('-'))
            if _birth_ym(age) <= _py * 100 + _pm:
                total -= round(_c / 10000)
    # NPS 임의계속가입: 은퇴~64세 구간 지출 (65세까지 가능)
    if ctx.nps_voluntary_cont and ctx.retirement_age <= age < 65:
        total -= nps_vol_만
    return total


def calc_full_snap_pp10(
    age: int,
    isa_period_years: int,
    hp_monthly_만: int,
    *,
    ctx: "PlannerContext",
    isa_total: float,
    dc_receipt_age: int,
    dc_end_age_val: int,
    dc_monthly_val: float,
    nps_adjusted: float,
    mortgage_monthly_만_val: float,
    nps_vol_만: int,
) -> int:
    """PP 10년 기준 스냅샷 (pp_payout_years=10, monthly = 2× 20년 기준)."""
    total = 0
    isa_end_age = ctx.retirement_age + isa_period_years
    if isa_period_years > 0 and age < isa_end_age:
        total += round((isa_total / 1e4) / (isa_period_years * 12))
    for pp in ctx.private_pensions:
        start = pp.get("start_age", 99)
        end = start + 10  # PP 10년
        if start <= age < end:
            total += round(pp.get("monthly_20yr", 0) / 10000 * 2)  # 10년 = 2× 20년
    dc_end_age = dc_end_age_val  # fixed: was hardcoded 60+20
    if dc_receipt_age <= age < dc_end_age:
        total += round(dc_monthly_val / 10000)
    if age >= ctx.nps_receipt_age:
        total += round(nps_adjusted / 10000)
    if hp_monthly_만 > 0:
        total += hp_monthly_만
    if age < ctx.mortgage_paid_off_age:
        total -= round(mortgage_monthly_만_val)
    def _birth_ym2(a):
        return (1983 + a) * 100 + 4
    for _pp in ctx.private_pensions:
        _c = _pp.get('monthly_contrib', 0)
        _po = _pp.get('paid_off_ym') or ''
        if _c > 0 and _po:
            _py, _pm = map(int, _po.split('-'))
            if _birth_ym2(age) <= _py * 100 + _pm:
                total -= round(_c / 10000)
    if ctx.nps_voluntary_cont and ctx.retirement_age <= age < 65:
        total -= nps_vol_만
    return total


def calc_snapshot_monthly(
    age: int,
    isa_monthly_gross: int,
    *,
    ctx: "PlannerContext",
    dc_monthly_val: float,
    nps_adjusted: float,
) -> dict:
    """참고용 — 기존 ISA 없는 기본 스냅샷"""
    items = []
    total = 0
    if isa_monthly_gross > 0:
        items.append(f"ISA: +{isa_monthly_gross}만")
        total += isa_monthly_gross
    for pp in ctx.private_pensions:
        if age >= pp.get("start_age", 99):
            pp_mon = round(pp.get("monthly_20yr", 0) / 10000)
            items.append(f"개인연금({pp['name']}): +{pp_mon}만")
            total += pp_mon
    if age >= 60:
        dc_mon = round(dc_monthly_val / 10000)
        items.append(f"퇴직DC: +{dc_mon}만")
        total += dc_mon
    if age >= ctx.nps_receipt_age:
        nps_mon = round(nps_adjusted / 10000)
        items.append(f"국민연금: +{nps_mon}만")
        total += nps_mon
    return {"total": total, "items": items}


def apply_monthly_corrections(data: dict) -> dict:
    """후처리 검증 & 자동 수정.

    income합 - expense합 = monthly_만 불일치 시 monthly_만을 계산값으로 수정
    (AI 산술 오류 방어: snap 테이블 값이 이미 프롬프트에 주입됐으므로 이를 신뢰).
    need_clarification 응답은 건드리지 않는다. 보정 발생 시 data["_corrections"]에 기록.
    """
    if not data.get("need_clarification"):
        corrections = []
        for sc in data.get("scenarios", []):
            for snap in sc.get("age_snapshots", []):
                income_sum = sum(item.get("amount_만", 0) for item in snap.get("income", []))
                expense_sum = sum(item.get("amount_만", 0) for item in snap.get("expense", []))
                computed = income_sum - expense_sum
                current = snap.get("monthly_만")
                if isinstance(current, (int, float)) and abs(computed - current) > 1:
                    corrections.append(
                        f"[{sc.get('name','?')}] {snap.get('age')}세: "
                        f"monthly_만 {current}→{computed} (income={income_sum}-expense={expense_sum})"
                    )
                    snap["monthly_만"] = computed
        if corrections:
            logger.warning(f"Planner auto-corrected {len(corrections)} monthly_만: " + " / ".join(corrections))
            data["_corrections"] = corrections
    return data


# ─── OCR ──────────────────────────────────────────────────────────────────────

async def run_ocr(item: str, content_type: str, image_bytes: bytes) -> dict:
    """스크린샷 이미지 → Gemini Vision → 필드 값 추출.

    검증 실패 시 ValueError(status_code, detail)를 던지지 않고, 라우터가 판단할 수
    있도록 여기서는 이미 검증을 통과했다고 가정한다(라우터가 400 검증 담당).
    LLM 실패/파싱 실패는 PlannerServiceError로 신호한다.
    """
    prompt = PROMPTS[item]
    result = await call_gemini_with_image(
        prompt=prompt,
        image_bytes=image_bytes,
        mime_type=content_type,
        max_tokens=512,
        use_llm_key=True,
    )

    if result is None:
        raise PlannerServiceError(503, "Gemini API unavailable")

    try:
        data = json.loads(result)
    except json.JSONDecodeError:
        logger.warning(f"Gemini vision non-JSON response: {result[:200]}")
        raise PlannerServiceError(500, "Failed to parse Gemini response")

    return {"item": item, "data": data}


class PlannerServiceError(Exception):
    """서비스 계층에서 HTTP 오류로 변환될 신호 (라우터가 HTTPException으로 재발생)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


# ─── 채팅 (프롬프트 빌드 + LLM 호출 + 후처리) ─────────────────────────────────

async def run_chat(ctx: PlannerContext, model: str = "gemini") -> dict:
    """플래너 LLM 채팅 - 명확화 질문 또는 은퇴 시나리오 3-4가지 생성

    model=gemini → Gemini 2.5 Flash (기본, 수치 정확도 우수)
    model=groq   → Groq llama-3.3-70b (폴백)
    """

    # ── 기본 계산 ───────────────────────────────────────────
    gap_years = ctx.retirement_age - ctx.current_age
    retire_year = ctx.current_year + gap_years

    isa2_years = max(0, gap_years - 3 / 12)
    r2 = ctx.isa2_rate / 100 / 12
    isa2_months = round(isa2_years * 12)
    isa2_at_retire = (
        ctx.isa2_monthly * (((1 + r2) ** isa2_months - 1) / r2)
        if r2 > 0 and isa2_months > 0
        else ctx.isa2_monthly * isa2_months
    )
    isa1_at_retire = isa_fv(ctx.isa1_balance, ctx.isa1_monthly, ctx.isa1_rate, gap_years)
    isa_total = isa1_at_retire + isa2_at_retire

    gap_to_retire = max(0, ctx.retirement_age - ctx.current_age)
    dc_at_retire = dc_fv(ctx.dc_irp_balance, ctx.dc_irp_monthly, ctx.dc_irp_rate, gap_to_retire)
    # IRP 수령 가능 나이: 만 55세 이상 (IRP법). 프론트에서 max(55, retirement_age) 계산해 전달
    dc_receipt_age = ctx.dc_receipt_age if ctx.dc_receipt_age >= 55 else max(55, ctx.retirement_age)
    dc_payout_yrs = ctx.dc_payout_years if ctx.dc_payout_years >= 5 else 20
    # 퇴직 후 수령 개시 나이까지: 기여금 없이 복리만 운용
    gap_to_receipt = max(0, dc_receipt_age - ctx.retirement_age)
    dc_at_receipt = dc_at_retire * (1 + ctx.dc_irp_rate / 100) ** gap_to_receipt
    dc_monthly_val = dc_at_receipt / (dc_payout_yrs * 12)
    dc_end_age_val = dc_receipt_age + dc_payout_yrs

    # DC 수령기간별 월 수령액 (AI가 시나리오별 자유 선택 가능)
    dc_10yr_만 = round(dc_at_receipt / (10 * 12) / 10000)
    dc_15yr_만 = round(dc_at_receipt / (15 * 12) / 10000)
    dc_20yr_만 = round(dc_at_receipt / (20 * 12) / 10000)
    dc_25yr_만 = round(dc_at_receipt / (25 * 12) / 10000)
    dc_30yr_만 = round(dc_at_receipt / (30 * 12) / 10000)

    pp_total_monthly = sum(p.get("monthly_20yr", 0) for p in ctx.private_pensions)
    pp_start_ages = sorted(set(p.get("start_age", 99) for p in ctx.private_pensions))
    pp_first_start = pp_start_ages[0] if pp_start_ages else 60
    pp_all_start = pp_start_ages[-1] if pp_start_ages else 60
    pp_count = len(ctx.private_pensions)
    pp_list_str = "\n".join(
        f"  · {p['name']}: {p['start_age']}세 개시 / 잔액 {p['balance']/10000:.0f}만원 / 월 {p['monthly_20yr']/10000:.0f}만원({ctx.payout_years}년)"
        + (f" / 납입중 {p.get('monthly_contrib',0)/10000:.0f}만원/월 (완납 {p.get('paid_off_ym','')})" if p.get('monthly_contrib', 0) > 0 else " / 납입완료")
        for p in ctx.private_pensions
    )

    # ── 국민연금 가입기간 기반 퇴직 시점 수령액 계산 ──────────────────────────
    nps_gap_years = max(0, 65 - ctx.retirement_age)
    retire_year_val = ctx.current_year + max(0, ctx.retirement_age - ctx.current_age)
    nps_60_year = ctx.current_year + max(0, 60 - ctx.current_age)

    nps_months_at_retire = nps_months_to(retire_year_val, ctx.nps_join_year, ctx.nps_join_month)
    nps_months_at_60 = nps_months_to(nps_60_year, ctx.nps_join_year, ctx.nps_join_month)

    P_retire = nps_period_factor(nps_months_at_retire)
    P_60 = nps_period_factor(nps_months_at_60)

    # 퇴직까지만 납입 시 65세 예상 수령액 (원) — snap 테이블·시나리오 기준값
    nps_at_retire = round(ctx.nps_base_monthly * P_retire / P_60) if P_60 > 0 else round(ctx.nps_base_monthly)

    # receipt_age 조정 적용 (조기/연기 수령)
    nps_adjusted = nps_at_retire
    if ctx.nps_receipt_age < 65:
        nps_adjusted = round(nps_at_retire * (1 - 0.06 * (65 - ctx.nps_receipt_age)))
    elif ctx.nps_receipt_age > 65:
        nps_adjusted = round(nps_at_retire * (1 + 0.072 * (ctx.nps_receipt_age - 65)))

    nps_60_val = round(nps_at_retire * (1 - 0.06 * 5))   # 60세 조기수령
    nps_62_val = round(nps_at_retire * (1 - 0.06 * 3))   # 62세 조기수령
    nps_65_val = nps_at_retire                             # 65세 정상수령
    nps_67_val = round(nps_at_retire * (1 + 0.072 * 2))  # 67세 연기수령
    nps_70_val = round(nps_at_retire * (1 + 0.072 * 5))  # 70세 연기수령

    # 임의계속가입 소득월액별 예상 NPS 표 생성 (AI 추천 참고용)
    # 기준: career_income 추정 = nps_at_retire / (0.4 × P_retire_normalized)
    # 여기서 P_retire_normalized = nps_months_at_retire/240 (단순화)
    _p_norm = nps_months_at_retire / 240 if nps_months_at_retire > 0 else 0.01
    career_income_만 = round((nps_at_retire / 10000) / (0.4 * _p_norm)) if _p_norm > 0 else 400
    career_income_만 = max(100, min(career_income_만, 1000))  # 합리적 범위 제한

    def build_nps_voluntary_table() -> str:
        if nps_gap_years <= 0:
            return "  (임의계속가입 해당 없음 — 65세 이후 은퇴)"
        vol_months = nps_gap_years * 12
        nps_at_retire_만_val = nps_at_retire / 10000
        nps_base_만_val = ctx.nps_base_monthly / 10000
        recovery = nps_base_만_val - nps_at_retire_만_val

        rows = [
            "  | 소득월액 | 월 납입(9%) | 총납입 | 65세 NPS 예상 |",
            "  |---------|-----------|------|------------|",
        ]
        for income in [100, 200, 300, 400]:
            if income > career_income_만 * 1.05:
                break
            pay = round(income * 0.09)
            total = pay * vol_months
            nps_est = round(nps_at_retire_만_val + recovery * income / career_income_만)
            rows.append(f"  | {income}만원 | {pay}만원 | {total}만원 | {nps_est}만원 |")
        max_pay = round(career_income_만 * 0.09)
        rows.append(f"  | {career_income_만}만원(기존수준) | {max_pay}만원 | {max_pay*vol_months}만원 | {round(nps_base_만_val)}만원 |")
        rows.append(f"  ※ 임의계속 없을 시(기본): {round(nps_at_retire_만_val)}만원 / 최대 회복 시: {round(nps_base_만_val)}만원")
        return "\n".join(rows)

    hp55 = hp_monthly(55, ctx.house_price)
    hp57 = hp_monthly(57, ctx.house_price)
    hp60 = hp_monthly(60, ctx.house_price)
    hp63 = hp_monthly(63, ctx.house_price)
    hp65 = hp_monthly(65, ctx.house_price)

    gap_to_pp = max(0, pp_first_start - ctx.retirement_age)
    gap_to_dc = max(0, dc_receipt_age - ctx.retirement_age)
    gap_to_nps = max(0, ctx.nps_receipt_age - ctx.retirement_age)
    mortgage_years_after_retire = max(0, ctx.mortgage_paid_off_age - ctx.retirement_age)

    mortgage_monthly_만_val = ctx.mortgage_monthly / 10000
    isa_total_억_val = isa_total / 1e8
    isa_monthly_to_nps_만 = isa_monthly_drawdown(isa_total_억_val, ctx.retirement_age, max(ctx.nps_receipt_age, ctx.retirement_age + 1))
    isa_monthly_to_65_만 = isa_monthly_drawdown(isa_total_억_val, ctx.retirement_age, max(65, ctx.retirement_age + 1))
    isa_monthly_to_70_만 = isa_monthly_drawdown(isa_total_억_val, ctx.retirement_age, max(70, ctx.retirement_age + 1))

    # ISA 인출 기간별 순수령액 참고표 (주담대 차감 후) — Gemini가 직접 계산하지 않도록 미리 제공
    def isa_net(years: int):
        gross = round((isa_total / 1e4) / (years * 12))  # 만원
        net = gross - round(mortgage_monthly_만_val) if mortgage_years_after_retire > 0 else gross
        return gross, net

    isa_5yr_gross, isa_5yr_net = isa_net(5)
    isa_10yr_gross, isa_10yr_net = isa_net(10)
    isa_15yr_gross, isa_15yr_net = isa_net(15)
    isa_20yr_gross, isa_20yr_net = isa_net(20)
    isa_nps_gross = round(isa_monthly_to_nps_만)
    isa_nps_net = isa_nps_gross - round(mortgage_monthly_만_val) if mortgage_years_after_retire > 0 else isa_nps_gross
    isa_65_gross = round(isa_monthly_to_65_만)
    isa_65_net = isa_65_gross - round(mortgage_monthly_만_val) if mortgage_years_after_retire > 0 else isa_65_gross
    gap_to_65 = max(1, 65 - ctx.retirement_age)
    gap_to_nps_months = max(1, gap_to_nps) * 12
    gap_to_65_months = gap_to_65 * 12

    # 주택연금: 은퇴 시점 주담대 잔액 차감 반영
    mortgage_balance_at_retire_억 = ctx.mortgage_balance_at_retire / 1e8
    if ctx.retirement_age >= 55:
        hp_gross_at_retire = hp_monthly(min(65, ctx.retirement_age), ctx.house_price)
        hp_net_at_retire = hp_monthly_net(min(65, ctx.retirement_age), ctx.house_price, mortgage_balance_at_retire_억)
        if mortgage_years_after_retire > 0:
            hp_available_note = (
                f"은퇴 즉시 신청 가능하나 주담대 잔액({mortgage_balance_at_retire_억:.2f}억) 차감으로 "
                f"실수령 월 {hp_net_at_retire/10000:.0f}만원 (총액 {hp_gross_at_retire/10000:.0f}만원의 "
                f"{int((ctx.house_price - mortgage_balance_at_retire_억)/ctx.house_price*100)}%)\n"
                f"  → 주담대 완납({ctx.mortgage_paid_off_age}세) 후 신청하면 월 {hp_monthly(min(65,ctx.mortgage_paid_off_age),ctx.house_price)/10000:.0f}만원 전액 수령 가능"
            )
        else:
            hp_net_at_retire = hp_gross_at_retire
            hp_available_note = f"은퇴 즉시 신청 가능 ({ctx.retirement_age}세 기준 월 {hp_gross_at_retire/10000:.0f}만원, 주담대 없음)"
    else:
        hp_gross_at_retire = 0
        hp_net_at_retire = 0
        hp_available_note = f"55세까지 {55 - ctx.retirement_age}년 대기 필요"

    # 추가 계산
    mortgage_total_remain = ctx.mortgage_monthly * max(0, ctx.mortgage_paid_off_age - ctx.retirement_age) * 12

    # 주담대 지출
    mtg_deduct_만 = round(mortgage_monthly_만_val) if mortgage_years_after_retire > 0 else 0

    nps_vol_만 = round(ctx.nps_voluntary_monthly / 10000) if ctx.nps_voluntary_cont else 0

    # calc_full_snap / calc_full_snap_pp10 / calc_snapshot_monthly에 공통 전달되는 상태
    _snap_kwargs = dict(
        ctx=ctx,
        isa_total=isa_total,
        dc_receipt_age=dc_receipt_age,
        dc_end_age_val=dc_end_age_val,
        dc_monthly_val=dc_monthly_val,
        nps_adjusted=nps_adjusted,
        mortgage_monthly_만_val=mortgage_monthly_만_val,
        nps_vol_만=nps_vol_만,
    )

    # ─── 시나리오별 나이 스냅샷 사전 계산 (AI 산수 오류 방지) ───────────────
    # 핵심 나이 목록 (개인연금 개시, DC 개시, NPS 개시, 주담대 완납 등)
    _pp_transition_ages = []
    for _pp in ctx.private_pensions:
        _s = _pp.get("start_age", 99)
        _pp_transition_ages.extend([_s, _s + 10, _s + 20])  # PP 개시, 10년 종료, 20년 종료

    _snap_ages = sorted(set([
        ctx.retirement_age,
        min(ctx.retirement_age + 1, 59),  # 1년 후
        59, 60, 65, ctx.mortgage_paid_off_age,
        ctx.nps_receipt_age,
        dc_receipt_age, dc_end_age_val,   # DC 개시·종료
        ctx.retirement_age + 10, ctx.retirement_age + 15, ctx.retirement_age + 20,  # ISA 종료 나이
        70, 75, 80,
    ] + _pp_transition_ages))
    _isa_periods = [10, 15, 20]

    # HP 기준: 주담대 완납 후 신청(full), 즉시 신청(net), 65세 신청(net or full)
    hp_at_67_만 = round(hp_monthly(min(65, ctx.mortgage_paid_off_age), ctx.house_price) / 10000)
    hp_at_65_net_만 = round(hp_monthly_net(65, ctx.house_price, mortgage_balance_at_retire_억) / 10000)
    hp_at_retire_net_만 = round(hp_net_at_retire / 10000)  # noqa: F841

    # 시나리오 테이블: isa_period → {age: monthly_만}
    # HP는 세 가지 케이스별 별도 항목으로 제공
    def build_snap_table(isa_period: int, hp_apply_age: int, hp_월: int) -> str:
        rows = []
        for age in _snap_ages:
            hp = hp_월 if age >= hp_apply_age else 0
            val = calc_full_snap(age, isa_period, hp, **_snap_kwargs)
            rows.append(f"  {age}세: {val}만원")
        return "\n".join(rows)

    # ISA 10/15/20년 × HP 신청 없음(0) 표 — HP는 별도 시나리오
    snap_tables = {}
    for isa_p in _isa_periods:
        snap_tables[isa_p] = build_snap_table(isa_p, 999, 0)

    # HP 67세(완납 후) 신청 시 추가 테이블
    snap_with_hp67 = {}
    for isa_p in _isa_periods:
        snap_with_hp67[isa_p] = build_snap_table(isa_p, ctx.mortgage_paid_off_age, hp_at_67_만)

    # HP 65세 신청(net=1.39억 차감 감액) 테이블
    snap_with_hp65 = {}
    for isa_p in _isa_periods:
        snap_with_hp65[isa_p] = build_snap_table(isa_p, 65, hp_at_65_net_만)

    def build_snap_table_pp10(isa_period: int, hp_apply_age: int, hp_월: int) -> str:
        rows = []
        for age in _snap_ages:
            hp = hp_월 if age >= hp_apply_age else 0
            val = calc_full_snap_pp10(age, isa_period, hp, **_snap_kwargs)
            rows.append(f"  {age}세: {val}만원")
        return "\n".join(rows)

    snap_isa10_hp67_pp10 = build_snap_table_pp10(10, ctx.mortgage_paid_off_age, hp_at_67_만)
    snap_isa15_hp67_pp10 = build_snap_table_pp10(15, ctx.mortgage_paid_off_age, hp_at_67_만)

    # PP 기간별 합산 월수령액
    pp_20yr_total_만 = round(sum(pp.get("monthly_20yr", 0) for pp in ctx.private_pensions) / 10000)
    # 10년 합산: 각 상품별 round(x*2) 합산 (스냅 테이블 calc_full_snap_pp10과 동일)
    pp_10yr_total_만 = sum(round(pp.get("monthly_20yr", 0) / 10000 * 2) for pp in ctx.private_pensions)

    # 나이별 PP 합산 (income 템플릿에 구체적 값 주입용)
    def pp_at_age(age: int, payout: int) -> int:
        total = 0
        for pp in ctx.private_pensions:
            s = pp["start_age"]
            end = s + payout
            if s <= age < end:
                total += round(pp.get("monthly_20yr", 0) / 10000 * (20 / payout))
        return total

    _pp_key_ages = [ctx.retirement_age, min(ctx.retirement_age + 1, 59),
                    59, 60, 65, ctx.mortgage_paid_off_age, ctx.nps_receipt_age, 70, 75, 80]  # noqa: F841
    pp_at_retire_20 = pp_at_age(ctx.retirement_age, 20)
    pp_at_60_20 = pp_at_age(60, 20)
    pp_at_65_20 = pp_at_age(65, 20)
    pp_at_hp_20 = pp_at_age(ctx.mortgage_paid_off_age, 20)
    pp_at_75_20 = pp_at_age(75, 20)
    pp_at_80_20 = pp_at_age(80, 20)
    pp_at_retire_10 = pp_at_age(ctx.retirement_age, 10)
    pp_at_60_10 = pp_at_age(60, 10)
    pp_at_65_10 = pp_at_age(65, 10)
    pp_at_hp_10 = pp_at_age(ctx.mortgage_paid_off_age, 10)
    pp_at_75_10 = pp_at_age(75, 10)
    pp_at_80_10 = pp_at_age(80, 10)

    # PP 기간별 상품 테이블 (프롬프트용)
    def build_pp_period_table() -> str:
        rows = ["  | 상품 | 개시 | 10년 월수령 | 15년 월수령 | 20년 월수령 |",
                "  |------|------|------------|------------|------------|"]
        for pp in ctx.private_pensions:
            raw = pp.get("monthly_20yr", 0)
            m20 = round(raw / 10000)
            m15 = round(raw / 10000 * 20 / 15)
            m10 = round(raw / 10000 * 2)  # 스냅 테이블과 동일한 반올림
            rows.append(f"  | {pp['name']} | {pp['start_age']}세 | {m10}만 | {m15}만 | {m20}만 |")
        pp10_total = sum(round(pp.get("monthly_20yr", 0) / 10000 * 2) for pp in ctx.private_pensions)
        rows.append(f"  | **합산** | | **{pp10_total}만** | **{round(pp_20yr_total_만*20/15)}만** | **{pp_20yr_total_만}만** |")
        return "\n".join(rows)

    def build_pp_end_age_table() -> str:
        """PP 상품별 수령기간 × 종료나이 테이블 (income 나열 시 참고용)"""
        rows = ["  | 상품명 | 개시 | 10년 종료 | 20년 종료 | 10년 월수령 | 20년 월수령 |",
                "  |--------|------|----------|----------|------------|------------|"]
        for pp in ctx.private_pensions:
            s = pp['start_age']
            raw = pp.get("monthly_20yr", 0)
            m20 = round(raw / 10000)
            m10 = round(raw / 10000 * 2)  # 스냅 테이블과 동일한 반올림
            rows.append(
                f"  | {pp['name']} | {s}세 | {s+10}세 | {s+20}세 | {m10}만 | {m20}만 |"
            )
        return "\n".join(rows)

    def build_pp_income_checklist() -> str:
        """PP 상품별 age별 포함/제외 체크리스트 (ISA 체크리스트와 동일 형식)"""
        check_ages = [a for a in _snap_ages]
        lines = [
            "★★★ PP income 포함 여부 체크리스트 (각 스냅 작성 전 반드시 확인):",
            "  ⚠️ age < start_age → 미개시(미포함) / start_age <= age < start_age+수령년수 → 포함 / 이후 → 종료(미포함)",
        ]
        for payout in [10, 20]:
            lines.append(f"  PP {payout}년 선택 시:")
            for pp in ctx.private_pensions:
                s = pp["start_age"]
                end = s + payout
                m = round(pp.get("monthly_20yr", 0) / 10000 * (20 / payout))
                checks = []
                for a in check_ages:
                    if a < s:
                        checks.append(f"{a}세✗(미개시)")
                    elif a < end:
                        checks.append(f"{a}세✓")
                    else:
                        checks.append(f"{a}세✗(종료)")
                lines.append(f"    {pp['name']}({s}세~{end}세, {m}만): " + " / ".join(checks))
        return "\n".join(lines)

    snap_retire_no_isa = calc_snapshot_monthly(
        ctx.retirement_age, 0, ctx=ctx, dc_monthly_val=dc_monthly_val, nps_adjusted=nps_adjusted
    )
    snap_nps_no_isa = calc_snapshot_monthly(
        ctx.nps_receipt_age, 0, ctx=ctx, dc_monthly_val=dc_monthly_val, nps_adjusted=nps_adjusted
    )

    # 국민연금 임의계속가입 — AI 추천 판단용 텍스트
    nps_at_retire_만_val = round(nps_at_retire / 10000)
    nps_base_만_val = round(ctx.nps_base_monthly / 10000)
    if nps_gap_years > 0:
        nps_voluntary_section = (
            f"\n▶ 국민연금 임의계속가입 (AI 추천 판단 구간) [★★☆ — 퇴직 후 선택 납부]\n"
            f"  - 가능 기간: {ctx.retirement_age}~65세 ({nps_gap_years}년, 이후 자동 종료)\n"
            f"  - 미납입 시 65세 예상: {nps_at_retire_만_val}만원/월 ← snap 테이블 기준값\n"
            f"  - 65세까지 기존 수준 납입 시: 최대 {nps_base_만_val}만원/월 (공단 확인값)\n"
            f"  납입액별 65세 NPS 예상 (근사):\n"
            f"{build_nps_voluntary_table()}\n"
            f"  ★ 추천 기준: {ctx.retirement_age}~65세 monthly_만 여유가 150만원 이상 → 임의계속 추천\n"
            f"  ⚠️ 임의계속 추천 시: expense에 반드시 추가, monthly_만 = snap값 - 납입액\n"
            f"  ⚠️ 임의계속 미추천 시: snap 테이블 값 그대로 사용 (nps={nps_at_retire_만_val}만원 기준)"
        )
        nps_voluntary_status = (
            f" → {ctx.retirement_age}~65세 납부 가능 ({nps_gap_years}년) — "
            f"65세 수령 {nps_at_retire_만_val}만원 (임의계속 없을 시)"
        )
        nps_voluntary_expense_note = (
            f"  · 국민연금: {ctx.retirement_age}세 퇴직 기준 65세 수령 {nps_at_retire_만_val}만원\n"
            f"    (임의계속가입 시 비용 발생 → AI가 시나리오별 추천)"
        )
        nps_voluntary_gap_note = (
            f"국민연금 납부 가능: {ctx.retirement_age}~65세 {nps_gap_years}년 → "
            f"65세 수령 {nps_at_retire_만_val}만원 (임의계속 없을 시 기준). "
            f"임의계속 추천 시 expense에 납입액 포함하고 snap값에서 차감 필수."
        )
    else:
        nps_voluntary_section = ""
        nps_voluntary_status = " (임의계속가입 해당 없음 — 65세 이후 은퇴)"
        nps_voluntary_expense_note = ""
        nps_voluntary_gap_note = ""

    # NPS 임의계속가입 snap 반영 여부 표시
    if ctx.nps_voluntary_cont and nps_vol_만 > 0 and nps_gap_years > 0:
        nps_vol_snap_note = f"-{nps_vol_만}만원/월 (은퇴~64세 snap에 이미 반영됨) → expense에 반드시 포함"
    elif nps_gap_years > 0:
        nps_vol_snap_note = "미설정 (snap에 미반영) — AI가 시나리오별 추천 시 expense에 추가"
    else:
        nps_vol_snap_note = "해당 없음 (65세 이후 은퇴)"

    # 납입 중 개인연금 — 은퇴 후에도 지속되는 고정 지출 목록
    _birth_year_val = 1983
    _birth_month_val = 4
    _retire_ym_num = (_birth_year_val + ctx.retirement_age) * 100 + _birth_month_val
    _pp_contrib_lines = []       # expense_block용 (은퇴 후 개요)
    _pp_post_retire_lines = []   # rule_lines용 (은퇴 후 납입 지속 상품)
    _pp_pre_retire_items = []    # 은퇴 전 완납 상품 (AI 혼동 방지용)
    for _p in ctx.private_pensions:
        _contrib = _p.get('monthly_contrib', 0)
        _paid_off = _p.get('paid_off_ym') or ''
        if _contrib > 0 and _paid_off:
            _y, _m = map(int, _paid_off.split('-'))
            if _y * 100 + _m > _retire_ym_num:
                _pp_contrib_lines.append(
                    f"  · {_p['name']} 납입: {_contrib/10000:.0f}만원/월 (은퇴 후~{_paid_off}까지)"
                )
                _pp_post_retire_lines.append(
                    f"  · {_p['name']}: {_contrib/10000:.0f}만원/월 ({_paid_off}완납 전까지)"
                )
            else:
                _pp_pre_retire_items.append(f"{_p['name']}({_paid_off}완납)")
    pp_contrib_expense_block = "\n".join(_pp_contrib_lines) if _pp_contrib_lines else ""
    pp_contrib_rule_lines_val = (
        "\n".join(_pp_post_retire_lines)
        if _pp_post_retire_lines
        else "  (없음 — 은퇴 전 모든 상품 납입 완료)"
    )
    pp_prepaid_note = (
        f"- ⚠️ 아래 상품은 은퇴({ctx.retirement_age}세) 전에 이미 납입 완료 → 은퇴 후 expense에 절대 포함 금지:\n"
        + "\n".join(f"    · {s}" for s in _pp_pre_retire_items)
        if _pp_pre_retire_items else ""
    )

    # 주담대 완납 여부에 따른 프롬프트 텍스트 분기
    if mortgage_years_after_retire == 0:
        mortgage_detail_block = (
            "▶ 주담대: 이미 완납됨 (은퇴 전 또는 은퇴 시점 완납)\n"
            "  - 은퇴 후 주담대 지출 없음 — 수입에서 차감 불필요"
        )
        mortgage_expense_block = "  · 없음 (주담대 이미 완납, 은퇴 후 추가 지출 없음)"
        mortgage_gap_note = "주담대: 이미 완납됨 — 은퇴 후 추가 지출 없음, monthly_만에서 차감하지 말 것"
        isa_table_col2_header = "순수령(주담대 완납됨=세전과 동일, 차감 없음)"
    else:
        loan_info = ""
        if ctx.mortgage_start_date:
            total_yrs = ctx.mortgage_total_months // 12 if ctx.mortgage_total_months else "?"
            loan_info = f"\n  - 대출 조건: {ctx.mortgage_start_date} 개시 / {total_yrs}년 원리금균등 / 중간 일부 상환으로 잔액 감소"
        mortgage_detail_block = (
            f"▶ 주담대 ⚠️ 은퇴 후 지속 지출 — 반드시 차감 필요\n"
            f"  - 현재 잔액(오늘): {ctx.mortgage_balance/1e8:.2f}억원"
            f"{loan_info}\n"
            f"  - 은퇴({ctx.retirement_age}세) 시점 잔액: {ctx.mortgage_balance_at_retire/1e8:.2f}억원 (현재~은퇴까지 상환 진행 반영)\n"
            f"  - 월 원리금 상환: {mortgage_monthly_만_val:.0f}만원 / 완납 예정: {ctx.mortgage_paid_off_age}세\n"
            f"  - 은퇴({ctx.retirement_age}세)부터 완납({ctx.mortgage_paid_off_age}세)까지 {mortgage_years_after_retire}년간 매월 {mortgage_monthly_만_val:.0f}만원 고정 지출\n"
            f"  ※ 각 나이별 순수령액 = 총수입 - 주담대 {mortgage_monthly_만_val:.0f}만원 ({ctx.mortgage_paid_off_age}세 이전까지)\n"
            f"  ⚠️ 주택연금 가입·순자산 계산 시 반드시 '은퇴 시점 잔액({ctx.mortgage_balance_at_retire/1e8:.2f}억원)' 기준 사용 (현재 잔액 사용 금지)"
        )
        mortgage_expense_block = (
            f"  · 주담대: 월 {mortgage_monthly_만_val:.0f}만원 × {mortgage_years_after_retire}년 ({ctx.mortgage_paid_off_age}세 완납)\n"
            f"    총 잔여 부담: 약 {mortgage_total_remain/1e8:.1f}억원"
        )
        mortgage_gap_note = (
            f"은퇴 후 주담대 상환: {mortgage_years_after_retire}년간 월 {mortgage_monthly_만_val:.0f}만원 **지출** (수입이 아님, 반드시 차감)"
        )
        isa_table_col2_header = f"주담대({ctx.mortgage_paid_off_age}세까지 -{mortgage_monthly_만_val:.0f}만) 차감 후 순수령"

    # nps_receipt_age 스냅샷 expense 블록: 주담대가 아직 활성이면 포함
    if ctx.nps_receipt_age < ctx.mortgage_paid_off_age and mortgage_years_after_retire > 0:
        nps_snap_expense_json = (
            f'[{{"name": "주담대", "amount_만": {mtg_deduct_만}, "until": "{ctx.mortgage_paid_off_age}세"}}]'
        )
    else:
        nps_snap_expense_json = "[]"

    # ── 목표 생활비 갭 분석 ─────────────────────────────────
    expense_goal_만 = ctx.monthly_expense_goal / 10000
    expense_goal_note = " (미설정 — 플래너에서 목표 생활비를 입력하세요)" if ctx.monthly_expense_goal <= 0 else ""

    # 은퇴 직후 예상 월 수입 (ISA 인출 기준)
    isa_retire_monthly_만 = round((isa_total / 1e4) / (max(1, gap_to_nps) * 12)) if gap_to_nps > 0 else round((isa_total / 1e4) / 12)

    if expense_goal_만 > 0:
        gap_at_retire = isa_retire_monthly_만- round(mortgage_monthly_만_val) - expense_goal_만
        gap_sign = "흑자" if gap_at_retire >= 0 else "적자"
        expense_gap_table = (
            f"  · 은퇴 직후({ctx.retirement_age}세): ISA 인출 약 {isa_retire_monthly_만:.0f}만원"
            f"(주담대 -{round(mortgage_monthly_만_val):.0f}만) → 목표 대비 {abs(gap_at_retire):.0f}만원 {gap_sign}\n"
            f"  · 국민연금 수령 후({ctx.nps_receipt_age}세): +{round(nps_adjusted/10000):.0f}만원 추가 → 수입 합산 후 판단 필요"
        )
    else:
        expense_gap_table = "  (목표 생활비 미설정)"

    # DC 세후 수령률 추정 (55~70세 구간 기준)
    dc_after_tax_rate = (1 - 0.055) * 100  # 55~70세 구간 기준 (단순화)

    # ── 프롬프트 생성 ───────────────────────────────────────
    prompt = _CHAT_PROMPT_TEMPLATE.format(
        current_age=ctx.current_age,
        retirement_age=ctx.retirement_age,
        retire_year=retire_year,
        gap_years=gap_years,
        isa1_balance_억=ctx.isa1_balance / 1e8,
        isa1_monthly_만=ctx.isa1_monthly / 10000,
        isa1_rate=ctx.isa1_rate,
        isa2_monthly_만=ctx.isa2_monthly / 10000,
        isa2_rate=ctx.isa2_rate,
        isa1_at_retire_억=isa1_at_retire / 1e8,
        isa2_at_retire_억=isa2_at_retire / 1e8,
        isa_total_억=isa_total / 1e8,
        isa_monthly_to_nps_만=isa_monthly_to_nps_만,
        isa_monthly_to_65_만=isa_monthly_to_65_만,
        isa_monthly_to_70_만=isa_monthly_to_70_만,
        isa_5yr_gross=isa_5yr_gross,
        isa_5yr_net=isa_5yr_net,
        isa_10yr_gross=isa_10yr_gross,
        isa_10yr_net=isa_10yr_net,
        isa_15yr_gross=isa_15yr_gross,
        isa_15yr_net=isa_15yr_net,
        isa_20yr_gross=isa_20yr_gross,
        isa_20yr_net=isa_20yr_net,
        isa_nps_gross=isa_nps_gross,
        isa_nps_net=isa_nps_net,
        isa_65_gross=isa_65_gross,
        isa_65_net=isa_65_net,
        dc_balance_만=ctx.dc_irp_balance / 10000,
        dc_rate=ctx.dc_irp_rate,
        dc_irp_monthly_만=ctx.dc_irp_monthly / 10000,
        dc_at_retire_억=dc_at_retire / 1e8,
        dc_at_receipt_억=dc_at_receipt / 1e8,
        dc_monthly_만=dc_monthly_val / 10000,
        dc_receipt_age=dc_receipt_age,
        dc_payout_yrs=dc_payout_yrs,
        dc_payout_months=dc_payout_yrs * 12,
        dc_end_age=dc_end_age_val,
        dc_10yr_만=dc_10yr_만,
        dc_15yr_만=dc_15yr_만,
        dc_20yr_만=dc_20yr_만,
        dc_25yr_만=dc_25yr_만,
        dc_30yr_만=dc_30yr_만,
        dc_10yr_end=dc_receipt_age + 10,
        dc_15yr_end=dc_receipt_age + 15,
        dc_20yr_end=dc_receipt_age + 20,
        dc_25yr_end=dc_receipt_age + 25,
        dc_30yr_end=dc_receipt_age + 30,
        dc_wait_note=(
            f"  ⚠️ 은퇴({ctx.retirement_age}세)~55세 구간 {55 - ctx.retirement_age}년: IRP 이전 후 운용만 가능, 수령 불가"
            if ctx.retirement_age < 55 else
            f"  ✓ 은퇴 나이({ctx.retirement_age}세) ≥ 55세 → 은퇴 즉시 수령 가능"
        ),
        pp_count=pp_count,
        pp_total_monthly_만=pp_total_monthly / 10000,
        payout_years=ctx.payout_years,
        pp_first_start=pp_first_start,
        pp_all_start=pp_all_start,
        pp_list=pp_list_str,
        nps_base_만=ctx.nps_base_monthly / 10000,
        nps_at_retire_만=nps_at_retire / 10000,
        nps_join_year=ctx.nps_join_year,
        nps_join_month=ctx.nps_join_month,
        nps_months_at_retire=nps_months_at_retire,
        nps_P_retire=P_retire,
        nps_receipt_age=ctx.nps_receipt_age,
        nps_adjusted_만=nps_adjusted / 10000,
        nps_60_만=nps_60_val / 10000,
        nps_62_만=nps_62_val / 10000,
        nps_65_만=nps_65_val / 10000,
        nps_67_만=nps_67_val / 10000,
        nps_70_만=nps_70_val / 10000,
        house_price=ctx.house_price,
        hp55_만=hp55 / 10000,
        hp57_만=hp57 / 10000,
        hp60_만=hp60 / 10000,
        hp63_만=hp63 / 10000,
        hp65_만=hp65 / 10000,
        mortgage_balance=ctx.mortgage_balance / 1e8,
        mortgage_monthly_만=mortgage_monthly_만_val,
        mortgage_paid_off_age=ctx.mortgage_paid_off_age,
        mortgage_years_after_retire=mortgage_years_after_retire,
        mortgage_total_remain_억=mortgage_total_remain / 1e8,
        mortgage_detail_block=mortgage_detail_block,
        mortgage_expense_block=mortgage_expense_block,
        pp_contrib_expense_block=pp_contrib_expense_block,
        pp_contrib_rule_lines=pp_contrib_rule_lines_val,
        pp_prepaid_note=pp_prepaid_note,
        mortgage_gap_note=mortgage_gap_note,
        isa_table_col2_header=isa_table_col2_header,
        nps_voluntary_section=nps_voluntary_section,
        nps_voluntary_status=nps_voluntary_status,
        nps_voluntary_expense_note=nps_voluntary_expense_note,
        nps_voluntary_gap_note=nps_voluntary_gap_note,
        hp_available_note=hp_available_note,
        gap_to_pp=gap_to_pp,
        gap_to_dc=gap_to_dc,
        gap_to_nps=gap_to_nps,
        gap_to_65=gap_to_65,
        gap_to_nps_months=gap_to_nps_months,
        gap_to_65_months=gap_to_65_months,
        hp_net_at_retire_만=hp_net_at_retire / 10000,
        hp_after_payoff_만=hp_monthly(min(65, ctx.mortgage_paid_off_age), ctx.house_price) / 10000,
        mortgage_balance_at_retire_억=mortgage_balance_at_retire_억,
        snap_retire_base=snap_retire_no_isa["total"],
        snap_retire_items=" / ".join(snap_retire_no_isa["items"]) or "없음",
        snap_nps_base=snap_nps_no_isa["total"],
        snap_nps_items=" / ".join(snap_nps_no_isa["items"]) or "없음",
        mtg_deduct_만=mtg_deduct_만,
        nps_snap_example_result=200 + 119 + round(nps_at_retire / 10000) - 112,
        nps_snap_example_result_vol=200 + 119 + round(nps_at_retire / 10000) - 112 - 20,
        # 사전 계산 스냅샷 테이블
        isa_10yr_월=round((isa_total / 1e4) / (10 * 12)),
        isa_15yr_월=round((isa_total / 1e4) / (15 * 12)),
        isa_20yr_월=round((isa_total / 1e4) / (20 * 12)),
        isa_15yr_net_55_만=round((isa_total / 1e4) / (15 * 12)) - mtg_deduct_만,
        isa_10yr_end=ctx.retirement_age + 10,
        isa_15yr_end=ctx.retirement_age + 15,
        isa_20yr_end=ctx.retirement_age + 20,
        snap_isa10_no_hp=snap_tables[10],
        snap_isa15_no_hp=snap_tables[15],
        snap_isa20_no_hp=snap_tables[20],
        snap_isa10_hp67=snap_with_hp67[10],
        snap_isa15_hp67=snap_with_hp67[15],
        snap_isa20_hp67=snap_with_hp67[20],
        snap_isa10_hp67_pp10=snap_isa10_hp67_pp10,
        snap_isa15_hp67_pp10=snap_isa15_hp67_pp10,
        pp_period_table=build_pp_period_table(),
        pp_end_age_table=build_pp_end_age_table(),
        pp_income_checklist=build_pp_income_checklist(),
        pp_10yr_total_만=pp_10yr_total_만,
        pp_20yr_total_만=pp_20yr_total_만,
        pp_at_retire_20=pp_at_retire_20,
        pp_at_60_20=pp_at_60_20,
        pp_at_65_20=pp_at_65_20,
        pp_at_hp_20=pp_at_hp_20,
        pp_at_75_20=pp_at_75_20,
        pp_at_80_20=pp_at_80_20,
        pp_at_retire_10=pp_at_retire_10,
        pp_at_60_10=pp_at_60_10,
        pp_at_65_10=pp_at_65_10,
        pp_at_hp_10=pp_at_hp_10,
        pp_at_75_10=pp_at_75_10,
        pp_at_80_10=pp_at_80_10,
        question=ctx.question.strip() or "현재 설정을 기반으로 최적의 은퇴 시나리오를 제안해주세요.",
        nps_snap_expense_json=nps_snap_expense_json,
        nps_vol_snap_note=nps_vol_snap_note,
        expense_goal_만=expense_goal_만,
        expense_goal_note=expense_goal_note,
        expense_gap_table=expense_gap_table,
        dc_after_tax_rate=dc_after_tax_rate,
    )

    system_prompt_str = (
        "You are a Korean retirement financial planning assistant. "
        "You MUST respond in Korean. "
        "Always respond with a valid JSON object only — no markdown, no code fences, no extra text."
    )

    # ── LLM 호출 ───────────────────────────────────────────
    result: Optional[str] = None
    if model == "gemini":
        # Gemini 2.5 Flash: thinking 토큰이 maxOutputTokens에 포함됨
        # 프롬프트 복잡도 감안해 넉넉하게 설정 (최대 65536)
        result = await call_gemini(
            prompt=prompt,
            max_tokens=24576,
            force_json_mime=True,
            use_llm_key=True,
            system_prompt=system_prompt_str,
            temperature=0.0,
            disable_thinking=True,
        )
        if result is None:
            # Gemini 실패(429/quota) 시 Groq로 자동 폴백
            logger.warning("Gemini returned None — falling back to Groq")
            result = await call_groq(system_prompt_str, _trim_for_groq(prompt), max_tokens=8192, json_mode=True)
    else:  # groq
        result = await call_groq(system_prompt_str, _trim_for_groq(prompt), max_tokens=8192, json_mode=True)

    if result is None:
        raise PlannerServiceError(503, "AI API 응답 없음. 잠시 후 다시 시도해주세요.")

    # JSON 파싱 — 코드블록 제거 후 시도
    cleaned = result.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.strip().rstrip("`").strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"Planner chat non-JSON (len={len(result)}): {result[:400]}")
        raise PlannerServiceError(500, f"AI 응답 파싱 실패: {str(e)[:80]}")

    # ── 후처리 검증 & 자동 수정 ────────────────────────────
    return apply_monthly_corrections(data)
