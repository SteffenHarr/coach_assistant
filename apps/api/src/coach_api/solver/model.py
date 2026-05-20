"""CP-SAT model for weekly tennis training scheduling.

The model assigns players to (coach, court, slot) triples on a discrete
weekly grid. It returns up to ``num_solutions`` distinct, scored plans.

Hard constraints:
  - Availability of coach, player, court.
  - A coach is on at most one court per slot.
  - A court hosts at most one coach per slot.
  - A player trains at most once per slot.
  - Group size limit per coach.
  - Player weekly min/max slots.
  - Coach max slots per day / week.
  - Coach minimum contiguous block length (per day).

Soft objective (maximised):
  + reward fulfilling player demand
  + reward preferred coach matches
  + reward preferred partner co-presence
  - small penalty for coach court-switches within the same day
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable
from uuid import UUID

from ortools.sat.python import cp_model

from coach_api.domain.entities import (
    Coach,
    Court,
    Player,
    SessionType,
    TrainingSession,
    WeeklyPlan,
)
from coach_api.domain.time_grid import TimeGrid
from coach_api.solver.scoring import ObjectiveWeights


@dataclass(slots=True)
class SolverInput:
    grid: TimeGrid
    coaches: list[Coach]
    players: list[Player]
    courts: list[Court]
    weights: ObjectiveWeights = field(default_factory=ObjectiveWeights)
    num_solutions: int = 3
    time_limit_seconds: float = 30.0


@dataclass(slots=True)
class SolverResult:
    plans: list[WeeklyPlan]
    status: str
    wall_time_seconds: float


def solve(inp: SolverInput, season_id: UUID) -> SolverResult:
    grid = inp.grid
    T = grid.total_slots
    days = grid.day_slot_ranges()

    coaches = inp.coaches
    players = inp.players
    courts = inp.courts

    if not coaches or not players or not courts:
        return SolverResult(plans=[], status="EMPTY_INPUT", wall_time_seconds=0.0)

    p_index = {p.id: i for i, p in enumerate(players)}
    c_index = {c.id: i for i, c in enumerate(coaches)}

    # ---- Solve repeatedly with no-good cuts to gather K distinct solutions. ----
    found_plans: list[WeeklyPlan] = []
    forbidden_signatures: list[set[tuple[int, int, int, int]]] = []
    last_status = "UNKNOWN"
    total_time = 0.0

    for _ in range(max(1, inp.num_solutions)):
        plan, status, wt, signature = _solve_once(
            inp, p_index, c_index, T, days, season_id, forbidden_signatures
        )
        total_time += wt
        last_status = status
        if plan is None:
            break
        found_plans.append(plan)
        forbidden_signatures.append(signature)

    return SolverResult(plans=found_plans, status=last_status, wall_time_seconds=total_time)


def _solve_once(
    inp: SolverInput,
    p_index: dict[UUID, int],
    c_index: dict[UUID, int],
    T: int,
    days: list[range],
    season_id: UUID,
    forbidden: list[set[tuple[int, int, int, int]]],
) -> tuple[WeeklyPlan | None, str, float, set[tuple[int, int, int, int]]]:
    m = cp_model.CpModel()
    coaches = inp.coaches
    players = inp.players
    courts = inp.courts
    w = inp.weights

    nC, nP, nR = len(coaches), len(players), len(courts)

    # x[c,p,t,r]: player p trained by coach c on court r at slot t
    x: dict[tuple[int, int, int, int], cp_model.IntVar] = {}
    # y[c,t,r]: coach c is on court r at slot t (any player)
    y: dict[tuple[int, int, int], cp_model.IntVar] = {}

    for c_i, c in enumerate(coaches):
        for r_i, court in enumerate(courts):
            for t in range(T):
                if t in c.availability and t in court.availability:
                    y[c_i, t, r_i] = m.NewBoolVar(f"y_c{c_i}_t{t}_r{r_i}")

    for c_i, c in enumerate(coaches):
        for p_i, p in enumerate(players):
            if not _coach_accepts_player(c, p):
                continue
            for t in range(T):
                if t not in c.availability or t not in p.availability:
                    continue
                for r_i, court in enumerate(courts):
                    if (c_i, t, r_i) not in y:
                        continue
                    x[c_i, p_i, t, r_i] = m.NewBoolVar(f"x_c{c_i}_p{p_i}_t{t}_r{r_i}")
                    # x implies y
                    m.Add(x[c_i, p_i, t, r_i] <= y[c_i, t, r_i])

    # Coach on at most one court per slot.
    for c_i in range(nC):
        for t in range(T):
            ys = [y[c_i, t, r_i] for r_i in range(nR) if (c_i, t, r_i) in y]
            if ys:
                m.Add(sum(ys) <= 1)

    # Court hosts at most one coach per slot.
    for r_i in range(nR):
        for t in range(T):
            ys = [y[c_i, t, r_i] for c_i in range(nC) if (c_i, t, r_i) in y]
            if ys:
                m.Add(sum(ys) <= 1)

    # Player at most one session per slot.
    for p_i in range(nP):
        for t in range(T):
            xs = [
                x[c_i, p_i, t, r_i]
                for c_i in range(nC)
                for r_i in range(nR)
                if (c_i, p_i, t, r_i) in x
            ]
            if xs:
                m.Add(sum(xs) <= 1)

    # Group size limit: when y is on, sum of players on it ≤ max_group_size.
    for (c_i, t, r_i), yv in y.items():
        max_group = coaches[c_i].max_group_size
        ps = [
            x[c_i, p_i, t, r_i] for p_i in range(nP) if (c_i, p_i, t, r_i) in x
        ]
        if ps:
            m.Add(sum(ps) <= max_group * yv)
            # If coach occupies court, at least one player must be there.
            m.Add(sum(ps) >= yv)
        else:
            m.Add(yv == 0)

    # Player weekly min/max slots.
    for p_i, p in enumerate(players):
        xs = [v for k, v in x.items() if k[1] == p_i]
        if xs:
            m.Add(sum(xs) >= p.min_slots_per_week)
            m.Add(sum(xs) <= p.max_slots_per_week)
        elif p.min_slots_per_week > 0:
            return None, "INFEASIBLE_PLAYER_DEMAND", 0.0, set()

    # Coach busy[c,t] = sum_r y[c,t,r]   (∈{0,1})
    busy: dict[tuple[int, int], cp_model.IntVar] = {}
    for c_i in range(nC):
        for t in range(T):
            ys = [y[c_i, t, r_i] for r_i in range(nR) if (c_i, t, r_i) in y]
            b = m.NewBoolVar(f"busy_c{c_i}_t{t}")
            if ys:
                m.Add(b == sum(ys))
            else:
                m.Add(b == 0)
            busy[c_i, t] = b

    # Coach max per day / week.
    for c_i, c in enumerate(coaches):
        if c.constraints.max_slots_per_week is not None:
            m.Add(sum(busy[c_i, t] for t in range(T)) <= c.constraints.max_slots_per_week)
        if c.constraints.max_slots_per_day is not None:
            for day_range in days:
                m.Add(
                    sum(busy[c_i, t] for t in day_range) <= c.constraints.max_slots_per_day
                )

    # Min contiguous block per day.
    for c_i, c in enumerate(coaches):
        mb = c.constraints.min_block_slots
        if mb <= 1:
            continue
        for day_range in days:
            day_slots = list(day_range)
            for idx, t in enumerate(day_slots):
                # detect "start": busy[t]=1 and (t is first of day OR busy[t-1]=0)
                prev_busy_zero = m.NewBoolVar(f"prev0_c{c_i}_t{t}")
                if idx == 0:
                    m.Add(prev_busy_zero == 1)
                else:
                    t_prev = day_slots[idx - 1]
                    # prev_busy_zero == 1 - busy[c,t_prev]
                    m.Add(prev_busy_zero == 1 - busy[c_i, t_prev])
                start = m.NewBoolVar(f"start_c{c_i}_t{t}")
                # start <=> busy[t] AND prev_busy_zero
                m.AddBoolAnd([busy[c_i, t], prev_busy_zero]).OnlyEnforceIf(start)
                m.AddBoolOr([busy[c_i, t].Not(), prev_busy_zero.Not()]).OnlyEnforceIf(
                    start.Not()
                )
                # If start=1, the next mb slots within day must all be busy.
                remaining = day_slots[idx : idx + mb]
                if len(remaining) < mb:
                    # not enough room for a full block → forbid start here
                    m.Add(start == 0)
                else:
                    for tt in remaining:
                        m.Add(busy[c_i, tt] >= start)

    # ------- Forbid previously found plans (no-good cuts) -------
    for sig in forbidden:
        # sum of (x_keys in sig that are 1) - (x_keys not in sig that are now 1) ≤ |sig|-1
        in_sig_vars = [x[k] for k in sig if k in x]
        if not in_sig_vars:
            continue
        m.Add(sum(in_sig_vars) <= len(in_sig_vars) - 1)

    # ------- Objective -------
    obj_terms: list[cp_model.LinearExpr] = []

    # Reward demand fulfillment (each scheduled player-slot).
    for v in x.values():
        obj_terms.append(w.fulfill_player_demand * v)

    # Reward preferred coach matches.
    for p_i, p in enumerate(players):
        pref = {c_index[cid] for cid in p.preferences.preferred_coach_ids if cid in c_index}
        for (c_i, pp_i, t, r_i), v in x.items():
            if pp_i == p_i and c_i in pref:
                obj_terms.append(w.preferred_coach * v)

    # Reward preferred partner co-presence (per slot, per coach, per court).
    # pair_var[p1,p2,c,t,r] = x[c,p1,t,r] AND x[c,p2,t,r]
    pair_keys: set[tuple[int, int]] = set()
    for p_i, p in enumerate(players):
        for partner_id in p.preferences.preferred_partner_ids:
            q_i = p_index.get(partner_id)
            if q_i is None or q_i == p_i:
                continue
            a, b = sorted([p_i, q_i])
            pair_keys.add((a, b))

    for a, b in pair_keys:
        for c_i in range(nC):
            for r_i in range(nR):
                for t in range(T):
                    if (c_i, a, t, r_i) in x and (c_i, b, t, r_i) in x:
                        pv = m.NewBoolVar(f"pair_{a}_{b}_c{c_i}_t{t}_r{r_i}")
                        m.AddBoolAnd(
                            [x[c_i, a, t, r_i], x[c_i, b, t, r_i]]
                        ).OnlyEnforceIf(pv)
                        m.AddBoolOr(
                            [x[c_i, a, t, r_i].Not(), x[c_i, b, t, r_i].Not()]
                        ).OnlyEnforceIf(pv.Not())
                        obj_terms.append(w.preferred_partner * pv)

    # Penalise court switches within a day (different court used by coach across day).
    for c_i in range(nC):
        for r_i in range(nR):
            for day_range in days:
                used = m.NewBoolVar(f"used_c{c_i}_r{r_i}_d{day_range.start}")
                ys = [
                    y[c_i, t, r_i] for t in day_range if (c_i, t, r_i) in y
                ]
                if ys:
                    m.AddMaxEquality(used, ys)
                else:
                    m.Add(used == 0)
                # subtract one per used court; penalty pays for >1 used
                obj_terms.append(-w.court_switch_penalty * used)

    m.Maximize(sum(obj_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = inp.time_limit_seconds
    solver.parameters.num_search_workers = 8

    status_int = solver.Solve(m)
    status = solver.StatusName(status_int)
    if status_int not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, status, solver.WallTime(), set()

    signature: set[tuple[int, int, int, int]] = {
        k for k, v in x.items() if solver.Value(v) == 1
    }
    plan = _build_plan(
        signature, inp, p_index, c_index, season_id, score=solver.ObjectiveValue()
    )
    return plan, status, solver.WallTime(), signature


def _build_plan(
    signature: Iterable[tuple[int, int, int, int]],
    inp: SolverInput,
    p_index: dict[UUID, int],
    c_index: dict[UUID, int],
    season_id: UUID,
    score: float,
) -> WeeklyPlan:
    """Group active x-cells into coach/court/slot bundles, then merge consecutive
    slots per (coach, court, exact-player-set) into TrainingSession objects."""
    # Group by (coach, court, slot) → set of player indices
    by_ccts: dict[tuple[int, int, int], frozenset[int]] = {}
    for c_i, p_i, t, r_i in signature:
        by_ccts.setdefault((c_i, r_i, t), set()).add(p_i)  # type: ignore[arg-type]

    # Convert sets to frozensets
    by_ccts = {k: frozenset(v) for k, v in by_ccts.items()}

    # Group by (coach, court, player-set) and find consecutive slot runs
    runs: dict[tuple[int, int, frozenset[int]], list[int]] = {}
    for (c_i, r_i, t), pset in by_ccts.items():
        runs.setdefault((c_i, r_i, pset), []).append(t)

    coach_ids = list(c_index.keys())
    player_ids = list(p_index.keys())
    court_ids = [court.id for court in inp.courts]

    sessions: list[TrainingSession] = []
    for (c_i, r_i, pset), slot_list in runs.items():
        slot_list.sort()
        # split into consecutive runs (also breaking across day boundaries)
        run: list[int] = []
        for t in slot_list:
            if not run or t == run[-1] + 1:
                # ensure same day
                if run and t // inp.grid.slots_per_day != run[-1] // inp.grid.slots_per_day:
                    sessions.append(_make_session(c_i, r_i, pset, run, coach_ids, player_ids, court_ids))
                    run = [t]
                else:
                    run.append(t)
            else:
                sessions.append(_make_session(c_i, r_i, pset, run, coach_ids, player_ids, court_ids))
                run = [t]
        if run:
            sessions.append(_make_session(c_i, r_i, pset, run, coach_ids, player_ids, court_ids))

    return WeeklyPlan(
        season_id=season_id,
        sessions=tuple(sessions),
        score=score,
    )


def _make_session(
    c_i: int,
    r_i: int,
    pset: frozenset[int],
    run: list[int],
    coach_ids: list[UUID],
    player_ids: list[UUID],
    court_ids: list[UUID],
) -> TrainingSession:
    n = len(pset)
    if n == 1:
        st = SessionType.SINGLE
    elif n == 2:
        st = SessionType.DOUBLE
    else:
        st = SessionType.GROUP
    return TrainingSession(
        coach_id=coach_ids[c_i],
        court_id=court_ids[r_i],
        player_ids=tuple(player_ids[p] for p in sorted(pset)),
        slot_indices=tuple(run),
        session_type=st,
    )


def _coach_accepts_player(coach: Coach, player: Player) -> bool:
    """Hard pre-filter: skip (coach, player) pairs that fail the coach's
    declared player-acceptance window. Missing values mean unrestricted on
    that side / unknown on the player's side (allowed)."""
    k = coach.constraints
    lk = player.level_lk
    age = player.age
    if lk is not None:
        if k.accepts_lk_min is not None and lk < k.accepts_lk_min:
            return False
        if k.accepts_lk_max is not None and lk > k.accepts_lk_max:
            return False
    if age is not None:
        if k.accepts_age_min is not None and age < k.accepts_age_min:
            return False
        if k.accepts_age_max is not None and age > k.accepts_age_max:
            return False
    return True
