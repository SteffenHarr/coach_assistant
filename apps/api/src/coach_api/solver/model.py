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
    relaxations: list[str] = field(default_factory=list)


def solve(inp: SolverInput, season_id: UUID, relax=None) -> SolverResult:
    """Run the solver. ``relax`` is an optional ``RelaxationConfig`` from
    ``solver.diagnostics``; ``None`` = strict mode (original behaviour)."""
    # Lazy import to avoid an import cycle (diagnostics imports from this
    # module for ``_coach_accepts_player``).
    from coach_api.solver.diagnostics import RelaxationConfig
    rcfg = relax or RelaxationConfig()
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
            inp, p_index, c_index, T, days, season_id, forbidden_signatures, rcfg
        )
        total_time += wt
        last_status = status
        if plan is None:
            break
        found_plans.append(plan)
        forbidden_signatures.append(signature)

    return SolverResult(
        plans=found_plans,
        status=last_status,
        wall_time_seconds=total_time,
        relaxations=[rcfg.label()] if rcfg.label() != "keine" else [],
    )


def _solve_once(
    inp: SolverInput,
    p_index: dict[UUID, int],
    c_index: dict[UUID, int],
    T: int,
    days: list[range],
    season_id: UUID,
    forbidden: list[set[tuple[int, int, int, int]]],
    rcfg=None,
) -> tuple[WeeklyPlan | None, str, float, set[tuple[int, int, int, int]]]:
    from coach_api.solver.diagnostics import RelaxationConfig
    if rcfg is None:
        rcfg = RelaxationConfig()
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
            if not rcfg.relax_category and not _coach_accepts_player(c, p):
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

    # Kategorie-Gruppen-Constraint: zwei Spieler mit *disjunkten* Kategorien
    # dürfen nie zusammen in derselben (coach, slot, court)-Session sein.
    # Spieler mit leerer Kategorie ("nicht zugewiesen") sind Wildcards und
    # passen zu allen Gruppen. Dieser Constraint wird zusammen mit
    # ``_coach_accepts_player`` durch ``relax_category`` gelockert.
    if not rcfg.relax_category:
        from coach_api.domain.entities import categories_compatible

        incompatible_pairs: list[tuple[int, int]] = []
        for i in range(nP):
            ci = players[i].categories
            if not ci:
                continue  # Wildcard - passt zu allen
            for j in range(i + 1, nP):
                cj = players[j].categories
                if not cj:
                    continue
                if not categories_compatible(ci, cj):
                    incompatible_pairs.append((i, j))

        if incompatible_pairs:
            for (c_i, t, r_i) in y:
                for (pi, pj) in incompatible_pairs:
                    vi = x.get((c_i, pi, t, r_i))
                    vj = x.get((c_i, pj, t, r_i))
                    if vi is not None and vj is not None:
                        m.Add(vi + vj <= 1)

    # Player weekly min/max slots.
    # ``relax_player_min`` macht die Min-Schranke weich: wir führen eine
    # Slack-Variable ein und bestrafen jeden fehlenden Slot stark im
    # Objective (siehe unten). Die Max-Schranke bleibt immer hart.
    shortfall_vars: dict[int, cp_model.IntVar] = {}
    for p_i, p in enumerate(players):
        xs = [v for k, v in x.items() if k[1] == p_i]
        if xs:
            if rcfg.relax_player_min and p.min_slots_per_week > 0:
                shortfall = m.NewIntVar(
                    0, p.min_slots_per_week, f"shortfall_p{p_i}"
                )
                m.Add(sum(xs) + shortfall >= p.min_slots_per_week)
                shortfall_vars[p_i] = shortfall
            else:
                m.Add(sum(xs) >= p.min_slots_per_week)
            m.Add(sum(xs) <= p.max_slots_per_week)
        elif p.min_slots_per_week > 0 and not rcfg.relax_player_min:
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
    if not rcfg.relax_coach_max:
        for c_i, c in enumerate(coaches):
            if c.constraints.max_slots_per_week is not None:
                m.Add(sum(busy[c_i, t] for t in range(T)) <= c.constraints.max_slots_per_week)
            if c.constraints.max_slots_per_day is not None:
                for day_range in days:
                    m.Add(
                        sum(busy[c_i, t] for t in day_range) <= c.constraints.max_slots_per_day
                    )

    # Min contiguous block per day.
    if not rcfg.relax_coach_block:
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

    # ------- Mandatory mates: harte Gleichheit pro (c,t,r) -------
    # Spiegelung wurde im Repository erzwungen, deshalb reicht es, die
    # Constraint einmal pro Paar zu setzen.
    mandatory_pairs: set[tuple[int, int]] = set()
    for p_i, p in enumerate(players):
        for mate in p.mates:
            if not mate.mandatory:
                continue
            q_i = p_index.get(mate.player_id)
            if q_i is None or q_i == p_i:
                continue
            a, b = sorted([p_i, q_i])
            mandatory_pairs.add((a, b))

    for a, b in mandatory_pairs:
        for c_i in range(nC):
            for r_i in range(nR):
                for t in range(T):
                    has_a = (c_i, a, t, r_i) in x
                    has_b = (c_i, b, t, r_i) in x
                    if has_a and has_b:
                        m.Add(x[c_i, a, t, r_i] == x[c_i, b, t, r_i])
                    elif has_a:
                        # Partner kann (c,t,r) nicht spielen → A darf hier auch nicht
                        m.Add(x[c_i, a, t, r_i] == 0)
                    elif has_b:
                        m.Add(x[c_i, b, t, r_i] == 0)

    # ------- Forbid previously found plans (no-good cuts) -------
    for sig in forbidden:
        # sum of (x_keys in sig that are 1) - (x_keys not in sig that are now 1) ≤ |sig|-1
        in_sig_vars = [x[k] for k in sig if k in x]
        if not in_sig_vars:
            continue
        m.Add(sum(in_sig_vars) <= len(in_sig_vars) - 1)

    # ------- Gruppengrößen-Helfer (für Bonus/Penalty im Objective) -------
    # size_ctr = Anzahl Spieler auf (Coach, Slot, Court).
    # is_size[c,t,r,k] = Boolean "size_ctr == k" für relevante k.
    relevant_sizes: set[int] = {1, 2, 3, 4}
    for p in players:
        for l in p.lessons:
            relevant_sizes.add(l.group_size)

    size_ct: dict[tuple[int, int, int], cp_model.IntVar] = {}
    is_size: dict[tuple[int, int, int, int], cp_model.IntVar] = {}
    for (c_i, t, r_i), yv in y.items():
        max_group = coaches[c_i].max_group_size
        ps = [
            x[c_i, p_i, t, r_i] for p_i in range(nP) if (c_i, p_i, t, r_i) in x
        ]
        if not ps:
            continue
        sz = m.NewIntVar(0, max_group, f"sz_c{c_i}_t{t}_r{r_i}")
        m.Add(sz == sum(ps))
        size_ct[c_i, t, r_i] = sz
        for k in relevant_sizes:
            if k > max_group or k < 1:
                continue
            b = m.NewBoolVar(f"is{k}_c{c_i}_t{t}_r{r_i}")
            m.Add(sz == k).OnlyEnforceIf(b)
            m.Add(sz != k).OnlyEnforceIf(b.Not())
            is_size[c_i, t, r_i, k] = b

    # ------- Objective -------
    obj_terms: list[cp_model.LinearExpr] = []

    # Reward demand fulfillment (each scheduled player-slot).
    for v in x.values():
        obj_terms.append(w.fulfill_player_demand * v)

    # Penalise shortfall when player-min-Constraint relaxed: jede unerfüllte
    # Mindeststunde kostet deutlich mehr als die Belohnung einer erfüllten,
    # damit der Solver Mindeststunden nur dann verfehlt, wenn es absolut
    # unvermeidbar ist.
    shortfall_penalty = max(50, 10 * w.fulfill_player_demand)
    for sv in shortfall_vars.values():
        obj_terms.append(-shortfall_penalty * sv)

    # Reward preferred coach matches.
    for p_i, p in enumerate(players):
        pref = {c_index[cid] for cid in p.preferences.preferred_coach_ids if cid in c_index}
        for (c_i, pp_i, t, r_i), v in x.items():
            if pp_i == p_i and c_i in pref:
                obj_terms.append(w.preferred_coach * v)

    # LK-Bonus: kleiner Reward, wenn die LK des Spielers im Wunschbereich
    # des Trainers liegt. LK ist *kein* Filter mehr (siehe
    # ``_coach_accepts_player``), nur noch eine weiche Präferenz.
    for c_i, c in enumerate(coaches):
        for p_i, p in enumerate(players):
            if not _lk_in_window(c, p):
                continue
            for (cc_i, pp_i, t, r_i), v in x.items():
                if cc_i == c_i and pp_i == p_i:
                    obj_terms.append(w.lk_match * v)

    # Alters-Bonus: analog zu LK - wenn das Alter des Spielers im
    # Wunschbereich des Trainers liegt, gibt es einen kleinen Bonus.
    # Auch das Alter ist seit dem Refactoring kein hartes Kriterium mehr.
    for c_i, c in enumerate(coaches):
        for p_i, p in enumerate(players):
            if not _age_in_window(c, p):
                continue
            for (cc_i, pp_i, t, r_i), v in x.items():
                if cc_i == c_i and pp_i == p_i:
                    obj_terms.append(w.age_match * v)

    # Gruppengrößen-Wunsch je Spieler (Bonus / Strafe):
    # ``pref_match`` = (Spieler ist im Slot UND Slot-Gruppengröße ist eine
    # seiner Wunsch-Größen). Wir belohnen Match und bestrafen Mismatch.
    for p_i, p in enumerate(players):
        pref_sizes = {l.group_size for l in p.lessons}
        if not pref_sizes:
            continue
        for (c_i, pp_i, t, r_i), xv in x.items():
            if pp_i != p_i:
                continue
            is_pref_terms = [
                is_size[c_i, t, r_i, k]
                for k in pref_sizes
                if (c_i, t, r_i, k) in is_size
            ]
            if not is_pref_terms:
                # In dieser (c,t,r)-Zelle ist keine der Wunschgrößen
                # darstellbar (z.B. max_group_size zu klein). Wir bestrafen
                # die Belegung dort direkt mit der Mismatch-Strafe.
                obj_terms.append(-w.group_size_mismatch_penalty * xv)
                continue
            sum_pref = sum(is_pref_terms)
            pm = m.NewBoolVar(f"pref_match_p{p_i}_c{c_i}_t{t}_r{r_i}")
            # pm = xv AND (sum_pref >= 1) -- AND linearization
            m.Add(pm <= xv)
            m.Add(pm <= sum_pref)
            m.Add(pm >= xv + sum_pref - 1)
            obj_terms.append(w.group_size_match * pm)
            # Strafe für nicht-präferierte Größe (xv - pm) ∈ {0,1}
            obj_terms.append(-w.group_size_mismatch_penalty * (xv - pm))

    # Reward preferred partner co-presence (per slot, per coach, per court).
    # pair_var[p1,p2,c,t,r] = x[c,p1,t,r] AND x[c,p2,t,r]
    # Quellen: legacy preferred_partner_ids + neue optionale mates.
    pair_keys: set[tuple[int, int]] = set()
    for p_i, p in enumerate(players):
        partner_ids: set[UUID] = set(p.preferences.preferred_partner_ids)
        for mate in p.mates:
            if not mate.mandatory:   # mandatory wird hart erzwungen, kein Doppelbonus
                partner_ids.add(mate.player_id)
        for partner_id in partner_ids:
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
    """Hard pre-filter: nur die **Trainings-Kategorie** wird hart geprüft.

    LK und Alter sind seit dem Refactoring rein *weiche* Vorgaben — sie
    fließen als Bonus ins Objective ein (siehe ``_lk_in_window`` /
    ``_age_in_window``), filtern hier aber nichts mehr aus. Das einzige
    harte Match-Kriterium ist die Kategorie: Trainer **und** Spieler
    können jeweils mehrere Kategorien haben, kompatibel ist die
    Zuteilung, sobald die Mengen sich schneiden – oder eine Seite leer
    ist (= "nicht zugewiesen" = Wildcard).
    """
    from coach_api.domain.entities import categories_compatible

    return categories_compatible(coach.categories, player.categories)


def _lk_in_window(coach: Coach, player: Player) -> bool:
    """True, wenn die LK des Spielers in den Wunschbereich des Trainers
    fällt. Wird im Objective als Bonus belohnt."""
    lk = player.level_lk
    if lk is None:
        return False
    k = coach.constraints
    if k.accepts_lk_min is not None and lk < k.accepts_lk_min:
        return False
    if k.accepts_lk_max is not None and lk > k.accepts_lk_max:
        return False
    return k.accepts_lk_min is not None or k.accepts_lk_max is not None


def _age_in_window(coach: Coach, player: Player) -> bool:
    """True, wenn das Alter des Spielers im Wunschbereich des Trainers
    fällt. Wird im Objective als Bonus belohnt (Alter ist seit dem
    letzten Refactoring kein hartes Filterkriterium mehr)."""
    age = player.age
    if age is None:
        return False
    k = coach.constraints
    if k.accepts_age_min is not None and age < k.accepts_age_min:
        return False
    if k.accepts_age_max is not None and age > k.accepts_age_max:
        return False
    return k.accepts_age_min is not None or k.accepts_age_max is not None
