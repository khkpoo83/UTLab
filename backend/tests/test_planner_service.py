"""Unit tests for services/planner_service.py PURE calc logic.

These lock the extracted arithmetic against regressions from the god-file
refactor.  The reference `PlannerContext` mirrors the values used in
`backend/test_planner_chat.py` ("검증된 snap 값"), and the assertions compare
the extracted `calc_full_snap` / `calc_full_snap_pp10` against that file's own
independent reimplementation (`_compute_expected_snaps`).

Note on the retirement-age snap: the test-file reimplementation deliberately
*excludes* DC income at the retirement-age snapshot when the DC receipt age
equals the retirement age (it models the AI treating DC start as a separate
event).  The server-side `calc_full_snap` has no such heuristic — it includes
DC as soon as `dc_receipt_age <= age`.  So the two agree at every age *except*
`retirement_age`; the assertions below skip that single age and additionally
lock its exact server value explicitly.
"""

import test_planner_chat as ref  # noqa: E402  (conftest sets env before import)
from services.planner_service import (
    PlannerContext,
    apply_monthly_corrections,
    calc_full_snap,
    calc_full_snap_pp10,
    hp_monthly,
    nps_months_to,
    nps_period_factor,
)


def _build_ctx() -> PlannerContext:
    return PlannerContext(**ref.TEST_CONTEXT)


def _derive_state(ctx: PlannerContext) -> dict:
    """Recompute the handler-local values the pure snap fns take as kwargs.

    Mirrors run_chat()'s derivation exactly for this rate=0 / gap=0 context.
    """
    isa_total = ctx.isa1_balance  # isa1_rate=0, monthly=0, isa2=0
    dc_receipt_age = ctx.dc_receipt_age if ctx.dc_receipt_age >= 55 else max(55, ctx.retirement_age)
    dc_payout_yrs = ctx.dc_payout_years if ctx.dc_payout_years >= 5 else 20
    dc_at_retire = ctx.dc_irp_balance
    gap_to_receipt = max(0, dc_receipt_age - ctx.retirement_age)
    dc_at_receipt = dc_at_retire * (1 + ctx.dc_irp_rate / 100) ** gap_to_receipt
    dc_monthly_val = dc_at_receipt / (dc_payout_yrs * 12)
    dc_end_age_val = dc_receipt_age + dc_payout_yrs

    retire_year_val = ctx.current_year + max(0, ctx.retirement_age - ctx.current_age)
    nps_60_year = ctx.current_year + max(0, 60 - ctx.current_age)
    P_retire = nps_period_factor(nps_months_to(retire_year_val, ctx.nps_join_year, ctx.nps_join_month))
    P_60 = nps_period_factor(nps_months_to(nps_60_year, ctx.nps_join_year, ctx.nps_join_month))
    nps_at_retire = round(ctx.nps_base_monthly * P_retire / P_60) if P_60 > 0 else round(ctx.nps_base_monthly)
    nps_adjusted = nps_at_retire  # receipt_age == 65

    return dict(
        ctx=ctx,
        isa_total=isa_total,
        dc_receipt_age=dc_receipt_age,
        dc_end_age_val=dc_end_age_val,
        dc_monthly_val=dc_monthly_val,
        nps_adjusted=nps_adjusted,
        mortgage_monthly_만_val=ctx.mortgage_monthly / 10000,
        nps_vol_만=0,
    )


def test_nps_period_factor_matches_reference():
    """The 240-month kink must be identical."""
    assert nps_period_factor(120) == 120 / 240
    assert nps_period_factor(240) == 1.0
    assert nps_period_factor(300) == 1.0 + 0.05 * (300 - 240) / 12
    # reference file's own inline impl
    for m in (0, 100, 189, 240, 249, 360):
        expected = (1.0 + 0.05 * (m - 240) / 12) if m >= 240 else m / 240
        assert nps_period_factor(m) == expected


def test_derived_headline_numbers():
    """Lock the derived DC / NPS / HP headline values (documented in test file)."""
    ctx = _build_ctx()
    st = _derive_state(ctx)
    # rate=0, gap_to_receipt=0 → DC does not grow: 203_621_000 / 240 months
    assert round(st["dc_monthly_val"] / 10000) == 85
    # NPS: 189/249 months × 158만 ≈ 120만
    assert round(st["nps_adjusted"] / 10000) == 120
    # HP 67세 신청 = house 6.52억 × 23.0
    assert round(hp_monthly(min(65, ctx.mortgage_paid_off_age), ctx.house_price) / 10000) == 150


def test_calc_full_snap_matches_reference_all_ages_except_retirement():
    """Extracted calc_full_snap == test-file _compute_expected_snaps for every
    snap age except the retirement age (see module docstring)."""
    ctx = _build_ctx()
    st = _derive_state(ctx)
    hp67 = round(hp_monthly(min(65, ctx.mortgage_paid_off_age), ctx.house_price) / 10000)

    expected, snap_ages, _meta = ref._compute_expected_snaps(ref.TEST_CONTEXT)

    for isa_p in (10, 15, 20):
        for age in snap_ages:
            if age == ctx.retirement_age:
                continue  # DC-at-retirement heuristic differs; locked separately

            # HP 없음
            got = calc_full_snap(age, isa_p, 0, **st)
            assert got == expected[(isa_p, "no_hp")][age], (
                f"no_hp ISA{isa_p} age{age}: {got} != {expected[(isa_p, 'no_hp')][age]}"
            )

            # HP 67세(완납 후) 신청
            hp = hp67 if age >= ctx.mortgage_paid_off_age else 0
            got_hp = calc_full_snap(age, isa_p, hp, **st)
            assert got_hp == expected[(isa_p, "hp67")][age], (
                f"hp67 ISA{isa_p} age{age}: {got_hp} != {expected[(isa_p, 'hp67')][age]}"
            )


def test_calc_full_snap_pp10_matches_reference():
    """PP-10-year variant matches the reference reimplementation."""
    ctx = _build_ctx()
    st = _derive_state(ctx)
    hp67 = round(hp_monthly(min(65, ctx.mortgage_paid_off_age), ctx.house_price) / 10000)
    expected, snap_ages, _meta = ref._compute_expected_snaps(ref.TEST_CONTEXT)

    for isa_p in (10, 15, 20):
        for age in snap_ages:
            if age == ctx.retirement_age:
                continue
            hp = hp67 if age >= ctx.mortgage_paid_off_age else 0
            got = calc_full_snap_pp10(age, isa_p, hp, **st)
            assert got == expected[(isa_p, "hp67_pp10")][age], (
                f"pp10 ISA{isa_p} age{age}: {got} != {expected[(isa_p, 'hp67_pp10')][age]}"
            )


def test_calc_full_snap_known_good_values():
    """Explicit lock of a few documented known-good cells (incl. retirement age)."""
    ctx = _build_ctx()
    st = _derive_state(ctx)
    hp67 = 150

    # ISA 15년 / HP 없음
    assert calc_full_snap(55, 15, 0, **st) == 457   # ISA484 + DC85 - mm112
    assert calc_full_snap(60, 15, 0, **st) == 523   # ISA484 + DC85 + PP66 - mm112
    assert calc_full_snap(65, 15, 0, **st) == 643   # + NPS120
    assert calc_full_snap(75, 15, 0, **st) == 186   # DC gone, ISA gone: PP66+NPS120

    # ISA 15년 / HP 67세 신청
    assert calc_full_snap(67, 15, hp67, **st) == 905  # DC85+PP66+NPS120+HP150+ISA484
    assert calc_full_snap(80, 15, hp67, **st) == 270  # NPS120 + HP150 (종신만)


def test_calc_full_snap_pp10_doubles_pension():
    """PP 10-year payout must be exactly 2× the 20-year monthly per product."""
    ctx = _build_ctx()
    st = _derive_state(ctx)
    # At 60 (all 3 PPs active), PP10 total = 2×(13+20+33) = 132 vs PP20 total 66
    v20 = calc_full_snap(60, 15, 0, **st)
    v10 = calc_full_snap_pp10(60, 15, 0, **st)
    assert v10 - v20 == 66  # extra doubling of the 66만 PP block


def test_apply_monthly_corrections_reconciles_income_expense():
    """income합 - expense합 != monthly_만 → monthly_만 rewritten + _corrections."""
    data = {
        "need_clarification": False,
        "scenarios": [
            {
                "name": "테스트",
                "age_snapshots": [
                    {
                        "age": 65,
                        "monthly_만": 999,  # wrong on purpose
                        "income": [{"amount_만": 484}, {"amount_만": 120}],
                        "expense": [{"amount_만": 112}],
                    },
                ],
            }
        ],
    }
    out = apply_monthly_corrections(data)
    snap = out["scenarios"][0]["age_snapshots"][0]
    assert snap["monthly_만"] == 484 + 120 - 112  # 492
    assert "_corrections" in out
    assert len(out["_corrections"]) == 1
    assert "999→492" in out["_corrections"][0]


def test_apply_monthly_corrections_within_tolerance_no_change():
    """Off-by-one is tolerated (>1 required to correct)."""
    data = {
        "need_clarification": False,
        "scenarios": [
            {
                "name": "t",
                "age_snapshots": [
                    {"age": 60, "monthly_만": 493,
                     "income": [{"amount_만": 492}], "expense": []},
                ],
            }
        ],
    }
    out = apply_monthly_corrections(data)
    assert out["scenarios"][0]["age_snapshots"][0]["monthly_만"] == 493
    assert "_corrections" not in out


def test_apply_monthly_corrections_skips_clarification():
    """need_clarification responses are never touched."""
    data = {"need_clarification": True, "questions": [{"text": "?"}]}
    out = apply_monthly_corrections(data)
    assert out == {"need_clarification": True, "questions": [{"text": "?"}]}
    assert "_corrections" not in out
