"""
플래너 챗봇 자동화 테스트 스크립트
- 5가지 시나리오 질문으로 API 호출
- monthly_만 산술 검증 (snap 테이블 일치, income-expense 일치)
- ISA/DC/PP 종료 나이 규칙 검증
- 실행: python test_planner_chat.py  (backend 컨테이너 내 또는 localhost:8000 접근 가능한 환경)
"""

import json
import math
import sys
import asyncio
import httpx

BASE_URL = "http://localhost:8000"
USERNAME = "admin"
PASSWORD = "utlab1234"

# ─── 테스트용 PlannerContext (검증된 snap 값 기준) ───────────────────────
# 검증된 스냅 값 (DONE_20260323_0816 확인):
#   55세(ISA15yr): 352 = ISA484 - 주담대112 - NPS임의20
#   60세: 557 = ISA484 + DC119 + PP66 - 주담대112
#   65세: 715 = ISA484 + DC119 + PP66 + NPS158 - 주담대112
#   67세(HP포함): 977 = ISA484 + DC119 + PP66 + NPS158 + HP150
#   75세(ISA종료, HP포함): 493 = DC119 + PP66 + NPS158 + HP150
#   80세(DC·PP종료, HP포함): 308 = NPS158 + HP150

TEST_CONTEXT = {
    "retirement_age": 55,
    "current_age": 55,      # gap=0 (이미 은퇴 시점)
    "birth_year": 1971,
    "current_year": 2026,
    # ISA: isa_total = 8.712억 (15년 기준 484만/월 = 484×180×10000)
    "isa1_balance": 871_200_000,
    "isa1_monthly": 0,
    "isa1_rate": 0.0,       # rate=0 → 예측 가능한 고정값
    "isa2_monthly": 0,
    "isa2_rate": 0.0,
    # DC: dc_at_retire = 203621000 → 60세 dc_at_60 ≈ 2.856억 → 119만/월
    "dc_irp_balance": 203_621_000,
    "dc_irp_monthly": 0,
    "dc_irp_rate": 7.0,
    # NPS
    "nps_base_monthly": 1_580_000,   # 60세까지 납입 기준 공단 확인값
    "nps_receipt_age": 65,
    "nps_join_year": 2010,           # 가입 시작 연도
    "nps_join_month": 4,             # 가입 시작 월
    # 주택 (house_price=6.52억 → hp65 = 6.52×23.0×10000 ≈ 150만)
    "house_price": 6.52,
    "mortgage_balance": 139_000_000,
    "mortgage_balance_at_retire": 139_000_000,
    "mortgage_monthly": 1_120_000,       # 112만/월
    "mortgage_start_date": "2022-11-11",
    "mortgage_total_months": 288,
    "mortgage_paid_off_age": 67,
    # 개인연금 3개 (합산 20yr=66만)
    "private_pensions": [
        {"name": "B1.2",   "balance": 18_942_000, "start_age": 56, "monthly_20yr": 130_000},
        {"name": "Kyobo",  "balance": 15_000_000, "start_age": 59, "monthly_20yr": 200_000},
        {"name": "2Step",  "balance": 10_000_000, "start_age": 60, "monthly_20yr": 330_000},
    ],
    "payout_years": 20,
    "question": "",  # 각 테스트마다 덮어씌움
}

TEST_QUESTIONS = [
    "55세 퇴직, 65세 국민연금 풀수령을 위해 ISA를 어떻게 배분할까?",
    "주택연금은 67세 이후에 받고 싶은데 그 전에 생활비를 어떻게 충당하나?",
    "60세 이전 소득 공백을 최소화하려면?",
    "개인연금 수령 기간을 10년으로 줄이고 초기에 집중적으로 받으면?",
    "ISA 인출 기간을 달리 가져갈 때 장단점 비교해줘",
]

# ─── Python으로 사전계산 (planner.py calc_full_snap 동일 로직) ────────────
def _compute_expected_snaps(ctx: dict) -> dict:
    """
    planner.py의 calc_full_snap() 동일 로직으로 snap 테이블 계산.
    반환: {(isa_period, hp_apply_age): {age: monthly_만}}
    """
    retirement_age = ctx["retirement_age"]
    dc_irp_rate = ctx["dc_irp_rate"]
    pensions = ctx["private_pensions"]
    payout_years = ctx["payout_years"]
    nps_receipt_age = ctx["nps_receipt_age"]
    mortgage_paid_off_age = ctx["mortgage_paid_off_age"]
    mortgage_monthly_만 = ctx["mortgage_monthly"] / 10000

    # NPS 가입기간 기반 퇴직 시점 수령액 계산
    nps_join_year = ctx.get("nps_join_year", 2010)
    nps_join_month = ctx.get("nps_join_month", 1)
    retire_year_val = ctx["current_year"] + max(0, retirement_age - ctx["current_age"])
    nps_60_year = ctx["current_year"] + max(0, 60 - ctx["current_age"])

    def _nps_months_to(target_year):
        return max(0, (target_year - nps_join_year) * 12 - (nps_join_month - 1))

    def _nps_period_factor(months):
        return (1.0 + 0.05 * (months - 240) / 12) if months >= 240 else months / 240

    _P_retire = _nps_period_factor(_nps_months_to(retire_year_val))
    _P_60 = _nps_period_factor(_nps_months_to(nps_60_year))
    nps_at_retire = round(ctx["nps_base_monthly"] * _P_retire / _P_60) if _P_60 > 0 else ctx["nps_base_monthly"]
    nps_adjusted = nps_at_retire  # receipt_age=65이면 추가 조정 없음

    # ISA total
    isa_total = ctx["isa1_balance"]  # rate=0, monthly=0이므로

    # DC: 수령 개시 = max(55, retirement_age), 종료 = 개시 + payout_years(20)
    dc_receipt_age_val = max(55, retirement_age)
    dc_at_retire = ctx["dc_irp_balance"]  # gap=0 (retirement_age == dc_receipt_age 가정)
    gap_to_receipt = max(0, dc_receipt_age_val - retirement_age)
    dc_at_receipt = dc_at_retire * (1 + dc_irp_rate / 100) ** gap_to_receipt
    dc_payout_yrs = ctx.get("dc_payout_years", 20)
    dc_monthly_val = dc_at_receipt / (dc_payout_yrs * 12)
    dc_end_age_val = dc_receipt_age_val + dc_payout_yrs

    # HP monthly (67세 신청 기준 = mortgage_paid_off_age)
    hp_rates = {55:15.3,56:15.9,57:16.5,58:17.2,59:17.9,60:18.7,
                61:19.5,62:20.3,63:21.0,64:21.8,65:23.0}
    hp_at_67_만 = round(ctx["house_price"] * hp_rates[min(65, mortgage_paid_off_age)] * 10000 / 10000)

    snap_ages = sorted({retirement_age, min(retirement_age+1, 59), 59, 60, 65,
                        mortgage_paid_off_age, nps_receipt_age, 70, 75, 80})

    def calc_snap(age, isa_period, hp_apply_age, hp_월, pp_payout=20):
        total = 0
        isa_end_age = retirement_age + isa_period
        if isa_period > 0 and age < isa_end_age:
            total += round((isa_total / 1e4) / (isa_period * 12))
        for pp in pensions:
            s = pp["start_age"]
            end = s + pp_payout
            if s <= age < end:
                factor = 20 / pp_payout  # 10년이면 2×
                total += round(pp["monthly_20yr"] / 10000 * factor)
        # retirement_age==dc_receipt_age일 때 AI는 DC를 retirement 스냅 income에 포함하지 않음
        # (DC 시작을 별도 이벤트로 처리). 60세부터는 정상 포함.
        dc_same_age = (dc_receipt_age_val == retirement_age)
        if dc_receipt_age_val <= age < dc_end_age_val and not (dc_same_age and age == retirement_age):
            total += round(dc_monthly_val / 10000)
        if age >= nps_receipt_age:
            total += round(nps_adjusted / 10000)
        if age >= hp_apply_age:
            total += hp_월
        if age < mortgage_paid_off_age:
            total -= round(mortgage_monthly_만)
        return total

    results = {}
    for isa_p in [10, 15, 20]:
        # HP 없음
        results[(isa_p, "no_hp")] = {age: calc_snap(age, isa_p, 999, 0) for age in snap_ages}
        # HP 67세(완납 후)
        results[(isa_p, "hp67")] = {age: calc_snap(age, isa_p, mortgage_paid_off_age, hp_at_67_만) for age in snap_ages}
        # PP 10년 + HP 67
        results[(isa_p, "hp67_pp10")] = {age: calc_snap(age, isa_p, mortgage_paid_off_age, hp_at_67_만, pp_payout=10) for age in snap_ages}

    return results, snap_ages, {
        "isa_total": isa_total,
        "dc_monthly_만": dc_monthly_val / 10000,
        "dc_receipt_age": dc_receipt_age_val,
        "dc_end_age": dc_end_age_val,
        "nps_adjusted_만": nps_adjusted / 10000,
        "hp_at_67_만": hp_at_67_만,
        "mortgage_paid_off_age": mortgage_paid_off_age,
        "nps_receipt_age": nps_receipt_age,
        "retirement_age": retirement_age,
        "pout_years": payout_years,
        "pensions": pensions,
    }


def _verify_response(resp: dict, expected_snaps: dict, snap_ages: list, meta: dict, question: str) -> list[str]:
    """응답 검증. 오류 목록 반환 (빈 리스트 = 모두 통과)"""
    errors = []

    if resp.get("need_clarification"):
        # 명확화 질문 모드 — 산술 검증 불가, 구조만 확인
        if "questions" not in resp:
            errors.append("need_clarification=true인데 questions 필드 없음")
        return errors

    scenarios = resp.get("scenarios", [])
    if not scenarios:
        errors.append("scenarios 필드 없음 또는 빈 배열")
        return errors

    retirement_age = meta["retirement_age"]
    mortgage_paid_off_age = meta["mortgage_paid_off_age"]
    nps_receipt_age = meta["nps_receipt_age"]
    pensions = meta["pensions"]

    for sc in scenarios:
        sc_name = sc.get("name", f"id={sc.get('id','?')}")
        tags = sc.get("tags", [])

        # 시나리오에서 ISA 기간 추출 (태그 or 이름에서)
        # 긴 숫자부터 체크해야 "5년" in "15년" 오탐 방지
        isa_period = None
        search_text = " ".join(tags) + " " + sc_name
        for n in [20, 15, 10, 5]:  # 내림차순으로 체크
            if f"ISA{n}년" in search_text or f"ISA {n}년" in search_text:
                isa_period = n
                break

        hp_included = (
            any(("HP" in t and "없음" not in t) or "주택연금" in t for t in tags)
            or ("HP" in sc_name and "없음" not in sc_name)
            or ("주택연금" in sc_name and "없음" not in sc_name)
        )
        # PP10 감지: "개인연금 10년" or "PP10년" 명시적 패턴만 (ISA10년 오탐 방지)
        pp10 = any("PP10년" in t or "PP 10년" in t for t in tags) or (
            "개인연금 10년" in sc_name or "PP 10년" in sc_name or "PP10년" in sc_name
        )

        snap_key = None
        if isa_period:
            if hp_included:
                snap_key = (isa_period, "hp67_pp10") if pp10 else (isa_period, "hp67")
            else:
                snap_key = (isa_period, "no_hp")

        age_snaps = sc.get("age_snapshots", [])
        if not age_snaps:
            errors.append(f"[{sc_name}] age_snapshots 없음")
            continue

        for snap in age_snaps:
            age = snap.get("age")
            monthly = snap.get("monthly_만")
            income = snap.get("income", [])
            expense = snap.get("expense", [])

            if age is None or monthly is None:
                errors.append(f"[{sc_name}] age 또는 monthly_만 누락")
                continue

            # 검증 1: income - expense == monthly_만 (±1 허용)
            income_sum = sum(item.get("amount_만", 0) for item in income)
            expense_sum = sum(item.get("amount_만", 0) for item in expense)
            computed = income_sum - expense_sum
            if abs(computed - monthly) > 1:
                errors.append(
                    f"[{sc_name}] {age}세: income({income_sum})-expense({expense_sum})={computed} ≠ monthly_만={monthly} (차이={computed-monthly})"
                )

            # 검증 2: snap 테이블 값과 비교 (±3 허용)
            # AI가 NPS 임의계속가입을 expense로 추가한 경우 snap값에서 차감하여 비교
            if snap_key and snap_key in expected_snaps and age in expected_snaps[snap_key]:
                expected = expected_snaps[snap_key][age]
                nps_vol_deduct = sum(
                    item.get("amount_만", 0) for item in expense
                    if "임의계속" in item.get("name", "") or "NPS" in item.get("name", "") and "임의" in item.get("name", "")
                )
                expected_adj = expected - nps_vol_deduct
                if abs(monthly - expected_adj) > 3:
                    errors.append(
                        f"[{sc_name}] {age}세: monthly_만={monthly}, 사전계산표={expected}"
                        f"{'(임의계속-'+str(nps_vol_deduct)+')' if nps_vol_deduct else ''}={expected_adj} (차이={monthly-expected_adj}, 허용±3)"
                    )

            # 검증 3: ISA 종료 이후에 ISA income 없어야 함
            if isa_period:
                isa_end = retirement_age + isa_period
                if age >= isa_end:
                    for item in income:
                        if "ISA" in item.get("name", ""):
                            amt = item.get("amount_만", 0)
                            if amt > 0:
                                errors.append(
                                    f"[{sc_name}] {age}세: ISA 종료({isa_end}세) 후 ISA income 포함 ({item['name']}={amt}만)"
                                )

            # 검증 4: DC는 dc_end_age_val(dc_receipt_age + 20) 이후 없어야 함
            dc_end_check = meta.get("dc_end_age", 80)
            if age >= dc_end_check:
                for item in income:
                    name = item.get("name", "")
                    if "DC" in name or "퇴직" in name or "IRP" in name:
                        amt = item.get("amount_만", 0)
                        if amt > 0:
                            errors.append(
                                f"[{sc_name}] {age}세: DC/IRP는 {dc_end_check}세 이후 수령 불가 ({name}={amt}만)"
                            )

            # 검증 5: PP 종료 나이 이후 포함 금지
            pp_payout_yrs = 10 if pp10 else 20
            for pp in pensions:
                pp_start = pp["start_age"]
                pp_end = pp_start + pp_payout_yrs
                if age >= pp_end:
                    for item in income:
                        name = item.get("name", "")
                        if pp["name"] in name:
                            amt = item.get("amount_만", 0)
                            if amt > 0:
                                errors.append(
                                    f"[{sc_name}] {age}세: {pp['name']} 종료({pp_end}세) 후 income 포함 ({amt}만)"
                                )

            # 검증 6: 주담대 완납 이후 expense에 주담대 없어야 함
            if age >= mortgage_paid_off_age:
                for item in expense:
                    if "주담대" in item.get("name", ""):
                        amt = item.get("amount_만", 0)
                        if amt > 0:
                            errors.append(
                                f"[{sc_name}] {age}세: 주담대 완납({mortgage_paid_off_age}세) 후 expense 포함 ({amt}만)"
                            )

    return errors


async def get_token(client: httpx.AsyncClient) -> str:
    resp = await client.post(
        f"{BASE_URL}/api/auth/login",
        data={"username": USERNAME, "password": PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


async def call_chat(client: httpx.AsyncClient, token: str, question: str, model: str = "groq") -> dict:
    ctx = {**TEST_CONTEXT, "question": question}
    resp = await client.post(
        f"{BASE_URL}/api/planner/chat?model={model}",
        json=ctx,
        headers={"Authorization": f"Bearer {token}"},
        timeout=180,
    )
    resp.raise_for_status()
    return resp.json()


async def run_tests(only_index: int | None = None, model: str = "groq"):
    expected_snaps, snap_ages, meta = _compute_expected_snaps(TEST_CONTEXT)

    # 사전계산 테이블 출력 (검증 기준값 확인)
    print("=" * 60)
    print("[사전계산 테이블 검증]")
    print(f"ISA total: {meta['isa_total']/1e8:.3f}억")
    print(f"DC 60세 이후 월수령: {meta['dc_monthly_만']:.0f}만")
    print(f"NPS 65세 월수령: {meta['nps_adjusted_만']:.0f}만")
    print(f"HP 67세 월수령: {meta['hp_at_67_만']}만")
    print()
    for key, table in expected_snaps.items():
        print(f"  [{key}]: " + " / ".join(f"{a}세:{v}만" for a, v in table.items()))
    print("=" * 60)
    print()

    # 알려진 기준값 체크 (NPS=120만 기준, 임의계속가입 snap 제외 후 재계산)
    # nps_at_retire=120만 (189개월/249개월×158만), voluntary deduct 없음
    known = {
        (15, "no_hp"): {55: 372, 60: 557, 65: 677, 75: 305},  # 75세: DC119+PP66+NPS120
        (15, "hp67"):  {55: 372, 60: 557, 65: 677, 67: 939, 75: 455, 80: 270},
        # 67세: ISA484+DC119+PP66+NPS120+HP150=939 / 80세: NPS120+HP150=270
    }
    known_errors = []
    for (isa_p, hp_key), checks in known.items():
        for age, expected_val in checks.items():
            actual = expected_snaps.get((isa_p, hp_key), {}).get(age)
            if actual is None:
                known_errors.append(f"  [{isa_p}yr,{hp_key}] {age}세: snap 없음")
            elif abs(actual - expected_val) > 1:
                known_errors.append(f"  [{isa_p}yr,{hp_key}] {age}세: 계산={actual}, 기대={expected_val}")
    if known_errors:
        print("⚠️  사전계산 기준값 불일치 (Python 로직 오류 가능성):")
        for e in known_errors:
            print(e)
    else:
        print("✅ 사전계산 기준값 일치 (Python 로직 정상)")
    print()

    # 모델별 대기 시간 (Groq 12K TPM 제한 vs Gemini 10 RPM)
    inter_test_sleep = 5 if model == "gemini" else 70

    async with httpx.AsyncClient() as client:
        print("🔐 로그인 중...")
        try:
            token = await get_token(client)
            print(f"✅ 로그인 성공  [모델: {model}]")
        except Exception as e:
            print(f"❌ 로그인 실패: {e}")
            return

        total_pass = 0
        total_fail = 0

        questions_to_run = [(i, q) for i, q in enumerate(TEST_QUESTIONS, 1)
                            if only_index is None or i - 1 == only_index]
        for idx, (i, question) in enumerate(questions_to_run):
            print(f"\n{'─'*60}")
            print(f"[테스트 {i}/{len(TEST_QUESTIONS)}] {question}")

            if idx > 0:
                print(f"⏳ {inter_test_sleep}초 대기 중 (레이트 리밋)...")
                await asyncio.sleep(inter_test_sleep)
            print("⏳ API 호출 중...")

            try:
                resp = await call_chat(client, token, question, model=model)
            except httpx.HTTPStatusError as e:
                print(f"  ❌ HTTP 오류: {e.response.status_code} {e.response.text[:300]}")
                total_fail += 1
                continue
            except httpx.ReadTimeout:
                print(f"  ❌ 타임아웃 (120초 초과)")
                total_fail += 1
                continue
            except Exception as e:
                print(f"  ❌ 요청 실패: {type(e).__name__}: {e}")
                total_fail += 1
                continue

            need_clarification = resp.get("need_clarification", False)
            if need_clarification:
                print(f"  ℹ️  명확화 질문 모드 (시나리오 없음)")
                qs = resp.get("questions", [])
                for q in qs:
                    print(f"     - {q.get('text','')}")
                errors = _verify_response(resp, expected_snaps, snap_ages, meta, question)
                if errors:
                    print(f"  ❌ 구조 오류:")
                    for e in errors:
                        print(f"    • {e}")
                    total_fail += 1
                else:
                    print(f"  ✅ 구조 OK")
                    total_pass += 1
                continue

            scenarios = resp.get("scenarios", [])
            print(f"  📋 시나리오 {len(scenarios)}개 생성")

            for sc in scenarios:
                sc_id = sc.get("id", "?")
                sc_name = sc.get("name", "")
                recommended = "⭐" if sc.get("recommended") else "  "
                print(f"  {recommended} [{sc_id}] {sc_name}")
                snaps = sc.get("age_snapshots", [])
                for snap in snaps:
                    age = snap.get("age", "?")
                    monthly = snap.get("monthly_만", "?")
                    inc = sum(x.get("amount_만", 0) for x in snap.get("income", []))
                    exp = sum(x.get("amount_만", 0) for x in snap.get("expense", []))
                    diff = inc - exp - monthly if isinstance(monthly, (int, float)) else "?"
                    flag = "✓" if isinstance(diff, (int, float)) and abs(diff) <= 1 else f"❌(차이={diff})"
                    print(f"       {age}세: {monthly}만 [income={inc}, expense={exp}] {flag}")

            # 후처리 자동 수정 내역 표시
            corrections = resp.get("_corrections", [])
            if corrections:
                print(f"\n  ⚠️  서버 자동수정 {len(corrections)}건 (monthly_만 보정):")
                for c in corrections:
                    print(f"    ~ {c}")

            errors = _verify_response(resp, expected_snaps, snap_ages, meta, question)

            if errors:
                print(f"\n  ❌ 검증 실패 ({len(errors)}건):")
                for e in errors:
                    print(f"    • {e}")
                total_fail += 1
            else:
                print(f"\n  ✅ 모든 검증 통과")
                total_pass += 1

        print(f"\n{'='*60}")
        total_run = len(questions_to_run)
        print(f"최종 결과: 통과 {total_pass}/{total_run}, 실패 {total_fail}/{total_run}")

        if total_fail > 0:
            print("\n⚠️  오류 패턴 분석:")
            print("  → income-expense ≠ monthly_만: AI가 snap 테이블 무시하고 직접 계산한 경우")
            print("  → snap 테이블 불일치: monthly_만 자체가 다른 시나리오 테이블 값을 사용한 경우")
            print("  → ISA/DC/PP 종료 후 포함: 수령 기간 규칙을 AI가 잘못 적용한 경우")
            print("  → prompt 강화 검토 필요")
        else:
            print("\n🎉 모든 테스트 통과!")


if __name__ == "__main__":
    # 사용법:
    #   python test_planner_chat.py              → Groq 전체 테스트
    #   python test_planner_chat.py 1            → Groq 테스트 1만
    #   python test_planner_chat.py 1 gemini     → Gemini 테스트 1만
    #   python test_planner_chat.py all gemini   → Gemini 전체 테스트
    args = sys.argv[1:]
    _model = "groq"
    _index = None

    for a in args:
        if a in ("groq", "gemini"):
            _model = a
        elif a != "all":
            try:
                _index = int(a) - 1
            except ValueError:
                pass

    asyncio.run(run_tests(_index, _model))
