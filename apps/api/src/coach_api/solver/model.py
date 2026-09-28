"""CP-SAT model for weekly tennis training scheduling.

The model assigns players to (coach, court, slot) triples on a discrete
weekly grid. It returns up to ``num_solutions`` distinct, scored plans.

Hard constraints:
  - Availability of coach, player, court.
  - A coach is on at most one court per slot.
  - A court hosts at most one coach per slot.
  - A player trains at most once per slot.
  - Group size limit per coach (capped solver-wide at SOLVER_MAX_GROUP_SIZE).
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
    TrainingCategory,
    TrainingSession,
    WeeklyPlan,
)
from coach_api.domain.time_grid import TimeGrid
from coach_api.solver.scoring import ObjectiveWeights

# Der Solver plant von sich aus nie mehr als so viele Spieler pro Platz/Slot
# ein — unabhängig von der "Max. Gruppe"-Einstellung eines Trainers (die
# wirkt sich nur noch nach unten aus, nie nach oben). Planer können danach
# im Plan-Editor manuell weitere Spieler zu einer Session hinzufügen, wenn
# das im Einzelfall gewünscht ist.
SOLVER_MAX_GROUP_SIZE = 4

# Ausnahme "Zwerge" == Kategorien BALLSCHULE und U8 (die jüngsten Kinder):
# dort sind reale Gruppen von bis zu 8 Kindern üblich (mehrere Trainer
# teilen sich informell eine große Gruppe — unser Modell kennt aber nur
# einen Trainer pro Session, die Gruppengröße selbst darf trotzdem bis 8
# gehen). Gilt nur für Sessions, in denen ausschließlich Ballschule-/
# U8-Kinder sitzen (siehe Kategorie-Ausnahme in ``players_can_share_session``
# — die sind ohnehin nie mit anderen Spieler-Kategorien kompatibel, das
# hier ist nur die Kapazitätsgrenze. Welcher Trainer die Session leitet,
# ist davon unberührt — ein Trainer ohne gesetzte Kategorie darf sie
# genauso übernehmen wie jede andere Gruppe).
ZWERGE_MAX_GROUP_SIZE = 8

# Ab dieser Slot-Zahl (4 = 2 Std.) pro Woche bringt ein weiterer Slot für
# denselben Trainer keinen Fairness-Bonus mehr — siehe coach_spread_bonus
# in scoring.py. Bewusst klein gehalten: es geht nur darum, dass jeder
# verfügbare Trainer überhaupt eine Grundauslastung bekommt, nicht darum,
# alle exakt gleich stark einzuplanen (das würde echte Präferenzen und
# Verfügbarkeitsunterschiede zwischen Trainern ignorieren).
#
# Per A/B-Test gegen echte Produktionsdaten geprüft: Schwankungen in der
# Wunschmitspieler-Erfüllung zwischen Testläufen (z.B. 66 vs. ~40 von 122
# erfüllten Paaren) traten identisch auch mit coach_spread_bonus=0 und
# sogar mit dem komplett unveränderten Solver-Code auf — reines
# CP-SAT-Rauschen bei einem Problem dieser Größe, das nur FEASIBLE (nicht
# bewiesen optimal) löst, nicht durch diesen Fairness-Term verursacht.
COACH_SPREAD_TARGET = 4


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


def solve(inp: SolverInput, season_id: UUID, relax=None, on_progress=None) -> SolverResult:
    """Run the solver. ``relax`` is an optional ``RelaxationConfig`` from
    ``solver.diagnostics``; ``None`` = strict mode (original behaviour).
    ``on_progress``, if given, is called as ``on_progress(done, total)``
    after each of the ``num_solutions`` solve attempts — used to report
    live progress for long-running generation jobs."""
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

    total_attempts = max(1, inp.num_solutions)
    for attempt in range(total_attempts):
        plan, status, wt, signature = _solve_once(
            inp, p_index, c_index, T, days, season_id, forbidden_signatures, rcfg
        )
        total_time += wt
        last_status = status
        if plan is None:
            break
        found_plans.append(plan)
        forbidden_signatures.append(signature)
        if on_progress:
            on_progress(attempt + 1, total_attempts)

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
    occ: dict[tuple[int, int], list] = {}
    for r_i in range(nR):
        for t in range(T):
            ys = [y[c_i, t, r_i] for c_i in range(nC) if (c_i, t, r_i) in y]
            if ys:
                m.Add(sum(ys) <= 1)
                occ[t, r_i] = ys

    # Platz-Reihenfolge HART erzwingen: innerhalb einer Gruppe (Halle bzw.
    # Draußen) darf ein Platz mit schlechterer `priority` zu einem Zeitpunkt
    # nur belegt sein, wenn alle Plätze mit besserer Priorität dann schon
    # belegt sind — also "erst Platz 1, dann 2, dann 3".
    #
    # Vorher war das nur eine weiche Strafe (court_priority_penalty, 2 Punkte
    # pro Slot). Die geht gegen fulfill_player_demand (10 Punkte pro
    # Spieler-Slot) unter, sobald der Solver das Optimum zeitlich nicht mehr
    # erreicht — real beobachtet: Platz 2 und 3 drei Stunden belegt, Platz 1
    # dieselbe Zeit leer, inklusive unnötigem Platzwechsel mittendrin.
    #
    # Als hartes Constraint bricht das zusätzlich die Symmetrie des Modells
    # (vorher waren alle Platz-Permutationen gleichwertige Lösungen, die der
    # Solver alle durchprobieren musste) — das verkleinert den Suchraum
    # deutlich und hilft damit auch allen anderen Zielen.
    for indoor_flag in (True, False):
        group = sorted(
            (r_i for r_i in range(nR) if courts[r_i].indoor == indoor_flag),
            key=lambda r_i: courts[r_i].priority,
        )
        levels: list[list[int]] = []
        for r_i in group:
            if levels and courts[levels[-1][0]].priority == courts[r_i].priority:
                levels[-1].append(r_i)   # gleiche Priorität = gleichrangig
            else:
                levels.append([r_i])
        for better, worse in zip(levels, levels[1:]):
            for t in range(T):
                for r_worse in worse:
                    if (t, r_worse) not in occ:
                        continue
                    for r_better in better:
                        # Ist der bevorzugte Platz gerade gar nicht nutzbar,
                        # darf er den schlechteren nicht blockieren.
                        if (t, r_better) not in occ:
                            continue
                        m.Add(sum(occ[t, r_worse]) <= sum(occ[t, r_better]))

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

    # Minimum 60 Min (2 Slots) pro Session — verhindert isolierte 30-Min-Slots.
    for p_i, p in enumerate(players):
        for c_i in range(nC):
            for r_i in range(nR):
                for day_range in days:
                    day_valid = {t for t in day_range if (c_i, p_i, t, r_i) in x}
                    for t in day_valid:
                        has_cprev = (t - 1) in day_valid
                        has_cnext = (t + 1) in day_valid
                        xv = x[c_i, p_i, t, r_i]
                        if not has_cprev and not has_cnext:
                            m.Add(xv == 0)
                        elif not has_cprev and has_cnext:
                            m.Add(xv <= x[c_i, p_i, t + 1, r_i])
                        elif has_cprev and not has_cnext:
                            m.Add(xv <= x[c_i, p_i, t - 1, r_i])
                        else:
                            m.Add(xv - x[c_i, p_i, t - 1, r_i] <= x[c_i, p_i, t + 1, r_i])

    # Feste Gruppenbesetzung: eine Trainingsgruppe bei (Coach, Platz) ist
    # über eine Slot-Grenze hinweg entweder komplett identisch oder
    # komplett neu — kein Teilwechsel (jemand kommt/geht) mitten in einer
    # laufenden Einheit. Ohne das könnte der Solver pro 30-Min-Slot
    # unabhängig optimieren und eine "durchgehende" Stunde in Wirklichkeit
    # aus zwei 30-Min-Blöcken mit unterschiedlicher, aber überlappender
    # Besetzung bestehen (z.B. 3 von 4 Spielern gleich, einer getauscht).
    for c_i in range(nC):
        for r_i in range(nR):
            for day_range in days:
                for t in day_range:
                    if t + 1 not in day_range:
                        continue
                    candidates = [
                        p_i for p_i in range(nP)
                        if (c_i, p_i, t, r_i) in x and (c_i, p_i, t + 1, r_i) in x
                    ]
                    if not candidates:
                        continue
                    stay_vars = []
                    for p_i in candidates:
                        va = x[c_i, p_i, t, r_i]
                        vb = x[c_i, p_i, t + 1, r_i]
                        stay = m.NewBoolVar(f"stay_p{p_i}_c{c_i}_r{r_i}_t{t}")
                        m.Add(stay <= va)
                        m.Add(stay <= vb)
                        m.Add(stay >= va + vb - 1)
                        stay_vars.append(stay)
                    any_stay = m.NewBoolVar(f"anystay_c{c_i}_r{r_i}_t{t}")
                    m.Add(sum(stay_vars) >= any_stay)
                    m.Add(sum(stay_vars) <= len(stay_vars) * any_stay)
                    # Sobald irgendjemand bleibt, muss JEDE Anwesenheit exakt
                    # gleich bleiben (keine Zu-/Abgänge in diesem Übergang).
                    for p_i in candidates:
                        va = x[c_i, p_i, t, r_i]
                        vb = x[c_i, p_i, t + 1, r_i]
                        m.Add(va - vb <= 1 - any_stay)
                        m.Add(vb - va <= 1 - any_stay)

    # Group size limit: when y is on, sum of players on it ≤ max_group_size
    # (never more than SOLVER_MAX_GROUP_SIZE, even if a coach's own setting
    # is higher — see module-level comment). Exception: a session made up
    # entirely of Zwerge-kids may go up to ZWERGE_MAX_GROUP_SIZE — this is
    # decided per (coach, court, slot) cell from who's actually assigned
    # there, not from the coach's category list (a coach may teach Zwerge
    # *and* other groups; only the Zwerge sessions get the higher cap).
    _ZWERGE_CATEGORIES = {TrainingCategory.BALLSCHULE, TrainingCategory.U8}
    zwerge_p_idx = {p_i for p_i, p in enumerate(players) if p.categories & _ZWERGE_CATEGORIES}
    for (c_i, t, r_i), yv in y.items():
        max_group = min(coaches[c_i].max_group_size, SOLVER_MAX_GROUP_SIZE)
        # Bewusst unabhängig von der "Max. Gruppe"-Einstellung des Trainers:
        # bei Ballschule/U8 sind bis zu ZWERGE_MAX_GROUP_SIZE Kinder erlaubt,
        # auch wenn der Trainer sonst 4 angegeben hat. Die Einstellung meint
        # die normalen Trainingsgruppen; für die Kleinsten gilt im Verein die
        # größere Gruppe (mehrere Betreuer teilen sich die Gruppe informell).
        zwerge_cap = ZWERGE_MAX_GROUP_SIZE
        ps = [
            x[c_i, p_i, t, r_i] for p_i in range(nP) if (c_i, p_i, t, r_i) in x
        ]
        if ps:
            zwerge_ps = [x[c_i, p_i, t, r_i] for p_i in zwerge_p_idx if (c_i, p_i, t, r_i) in x]
            if zwerge_ps and zwerge_cap > max_group:
                # is_zwerge_session = 1 iff at least one Zwerge-Kind hier sitzt
                # (die Kategorie-Kompatibilität sorgt ohnehin dafür, dass dann
                # NUR Zwerge-Kinder hier sitzen können, siehe Modul-Docstring).
                is_zwerge = m.NewBoolVar(f"zwerge_c{c_i}_t{t}_r{r_i}")
                m.Add(sum(zwerge_ps) >= is_zwerge)
                m.Add(sum(zwerge_ps) <= len(zwerge_ps) * is_zwerge)
                m.Add(sum(ps) <= max_group * yv + (zwerge_cap - max_group) * is_zwerge)
            else:
                m.Add(sum(ps) <= max_group * yv)
            # If coach occupies court, at least one player must be there.
            m.Add(sum(ps) >= yv)
        else:
            m.Add(yv == 0)

    # Kategorie-Gruppen-Constraint: zwei Spieler mit *disjunkten* Kategorien
    # dürfen nie zusammen in derselben (coach, slot, court)-Session sein.
    # Spieler mit leerer Kategorie ("nicht zugewiesen") sind Wildcards und
    # passen zu allen anderen Gruppen — AUSSER bei Ballschule/U8, siehe
    # ``players_can_share_session``.
    #
    # Aufgeteilt in zwei Töpfe:
    # - ``incompatible_hard`` (Ballschule/U8 betroffen): IMMER erzwungen,
    #   unabhängig von ``rcfg`` — diese Trennung darf kein Fallback-Tier
    #   aufweichen (Kleinkinder landen nie "als letzter Ausweg" bei
    #   viel älteren Kindern).
    # - ``incompatible_soft`` (alle anderen Kategorie-Konflikte, z.B. U12
    #   vs. U15): wird durch ``relax_category`` gelockert, zusammen mit
    #   ``_coach_accepts_player``.
    from coach_api.domain.entities import effective_categories, players_can_share_session

    _STRICT_CATS = {TrainingCategory.BALLSCHULE, TrainingCategory.U8}

    # Ausdrücklich gewünschte Mitspieler-Paare. Sie sind von der normalen
    # Kategorie-Trennung ausgenommen: wenn zwei Spieler (oder ihre Eltern)
    # sich gegenseitig als Wunschpartner eintragen, wiegt das schwerer als
    # die Alterskategorie — typischer Fall sind Geschwister wie U10 + U12,
    # die zusammen trainieren sollen. Die Kategorien bleiben dadurch eine
    # grobe Orientierung statt einer starren Mauer.
    # Ausnahme von der Ausnahme: Ballschule/U8 bleibt IMMER hart getrennt
    # (``incompatible_hard`` unten), ein Wunsch hebt das nicht auf.
    wish_pairs: set[tuple[int, int]] = set()
    for i, p in enumerate(players):
        partner_ids = set(p.preferences.preferred_partner_ids)
        partner_ids.update(mate.player_id for mate in p.mates)
        for partner_id in partner_ids:
            j = p_index.get(partner_id)
            if j is None or j == i:
                continue
            wish_pairs.add((min(i, j), max(i, j)))

    incompatible_hard: list[tuple[int, int]] = []
    incompatible_soft: list[tuple[int, int]] = []
    for i in range(nP):
        ci = players[i].categories
        for j in range(i + 1, nP):
            cj = players[j].categories
            if not ci and not cj:
                continue  # beide Wildcard - passt immer
            if players_can_share_session(ci, cj):
                continue
            if effective_categories(ci) & _STRICT_CATS or effective_categories(cj) & _STRICT_CATS:
                incompatible_hard.append((i, j))
            elif (i, j) in wish_pairs:
                continue  # Wunschpartner schlägt Kategorie-Trennung
            else:
                incompatible_soft.append((i, j))

    def _forbid_pairs(pairs: list[tuple[int, int]]) -> None:
        if not pairs:
            return
        for (c_i, t, r_i) in y:
            for (pi, pj) in pairs:
                vi = x.get((c_i, pi, t, r_i))
                vj = x.get((c_i, pj, t, r_i))
                if vi is not None and vj is not None:
                    m.Add(vi + vj <= 1)

    _forbid_pairs(incompatible_hard)
    if not rcfg.relax_category:
        _forbid_pairs(incompatible_soft)

    # Player weekly min/max slots — harte Min/Max-Schranke für alle Spieler.
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
        elif (
            p.availability
            and p.min_slots_per_week > 0
            and not rcfg.relax_player_min
        ):
            # Kein einziger möglicher Slot trotz eingetragener Verfügbarkeit
            # (z.B. kein passender Trainer zur Kategorie, oder Verfügbarkeit
            # überschneidet sich nie mit einem Trainer) — echtes
            # Konfigurationsproblem, wird vom Preflight-Diagnostik-Check
            # ebenfalls gemeldet, deshalb hart abbrechen statt still zu
            # ignorieren.
            return None, "INFEASIBLE_PLAYER_DEMAND", 0.0, set()
        # Spieler ganz ohne eingetragene Verfügbarkeit: einfach ignorieren
        # (0 Std. eingeplant) statt den ganzen Plan unlösbar zu machen — das
        # ist kein Fehler, sondern schlicht "hat sich noch nicht
        # eingetragen". Der Hinweis dazu kommt weiterhin über die
        # Preflight-Diagnose im Plan (siehe ``diagnostics.preflight``).

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
                    blk_start = m.NewBoolVar(f"blkstart_c{c_i}_t{t}")
                    # blk_start <=> busy[t] AND prev_busy_zero
                    m.AddBoolAnd([busy[c_i, t], prev_busy_zero]).OnlyEnforceIf(blk_start)
                    m.AddBoolOr([busy[c_i, t].Not(), prev_busy_zero.Not()]).OnlyEnforceIf(
                        blk_start.Not()
                    )
                    # If blk_start=1, the next mb slots within day must all be busy.
                    remaining = day_slots[idx : idx + mb]
                    if len(remaining) < mb:
                        # not enough room for a full block → forbid start here
                        m.Add(blk_start == 0)
                    else:
                        for tt in remaining:
                            m.Add(busy[c_i, tt] >= blk_start)

    # ------- Mandatory mates: gemeinsam für die überschneidenden Stunden -------
    # Pflicht-Partner müssen so oft zusammen trainieren, wie es beide
    # überhaupt können — also für die kleinere der beiden Wochenstunden-
    # Vorgaben (z.B. A=2h, B=1h → 1h gemeinsam Pflicht, A's zweite Stunde
    # ist frei/solo). Der Spieler mit mehr Wochenstunden wird für die
    # übrigen Stunden NICHT auf 0 gezwungen (das war vorher ein Bug: eine
    # harte Gleichheit x_a == x_b in jedem einzelnen Slot der ganzen Woche
    # hat effektiv beide auf das Stundenkontingent des kleineren gedeckelt).
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
        target = min(players[a].max_slots_per_week, players[b].max_slots_per_week)
        if target <= 0:
            continue
        together_vars: list[cp_model.IntVar] = []
        for c_i in range(nC):
            for r_i in range(nR):
                for t in range(T):
                    va = x.get((c_i, a, t, r_i))
                    vb = x.get((c_i, b, t, r_i))
                    if va is None or vb is None:
                        continue
                    # tog = va AND vb (Standard-AND-Linearisierung).
                    tog = m.NewBoolVar(f"mate_{a}_{b}_c{c_i}_t{t}_r{r_i}")
                    m.Add(tog <= va)
                    m.Add(tog <= vb)
                    m.Add(tog >= va + vb - 1)
                    together_vars.append(tog)
        if together_vars:
            m.Add(sum(together_vars) >= target)
        # Kein gemeinsam nutzbarer Slot gefunden (z.B. Verfügbarkeiten
        # überschneiden sich nie) → nichts erzwingbar, Constraint entfällt
        # statt das ganze Modell unlösbar zu machen.

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
    relevant_sizes: set[int] = set(range(1, ZWERGE_MAX_GROUP_SIZE + 1))

    size_ct: dict[tuple[int, int, int], cp_model.IntVar] = {}
    is_size: dict[tuple[int, int, int, int], cp_model.IntVar] = {}
    for (c_i, t, r_i), yv in y.items():
        max_group = min(coaches[c_i].max_group_size, SOLVER_MAX_GROUP_SIZE)
        ps = [
            x[c_i, p_i, t, r_i] for p_i in range(nP) if (c_i, p_i, t, r_i) in x
        ]
        if not ps:
            continue
        # Obergrenze für die Größen-Hilfsvariable — muss zur tatsächlichen
        # Kapazitätsgrenze oben passen (inkl. Zwerge-Ausnahme), sonst wäre
        # eine 5-8er Zwerge-Gruppe hier unmöglich darstellbar.
        has_zwerge_candidate = any(p_i in zwerge_p_idx and (c_i, p_i, t, r_i) in x for p_i in range(nP))
        cell_max = ZWERGE_MAX_GROUP_SIZE if has_zwerge_candidate else max_group
        sz = m.NewIntVar(0, cell_max, f"sz_c{c_i}_t{t}_r{r_i}")
        m.Add(sz == sum(ps))
        size_ct[c_i, t, r_i] = sz
        for k in relevant_sizes:
            if k > cell_max or k < 1:
                continue
            b = m.NewBoolVar(f"is{k}_c{c_i}_t{t}_r{r_i}")
            m.Add(sz == k).OnlyEnforceIf(b)
            m.Add(sz != k).OnlyEnforceIf(b.Not())
            is_size[c_i, t, r_i, k] = b

    # ------- Objective -------
    obj_terms: list[cp_model.LinearExpr] = []

    # Gruppenbildung belohnen: jeder Spieler ab dem zweiten in derselben
    # Einheit bringt einen Bonus, Einzelstunden bringen nichts.
    #
    # Ohne das war der Solver zwischen "vier Spieler einzeln" und "vier
    # Spieler zusammen" praktisch indifferent — fulfill_player_demand zählt
    # nur Spieler-Slots und ist in beiden Fällen gleich hoch. Ergebnis waren
    # viel zu viele Einzelstunden. Einzeltraining soll die Ausnahme sein,
    # die man bei Bedarf von Hand im Plan-Editor einträgt.
    #
    # Spieler, die ausdrücklich NUR Einzel wollen, sind davon geschützt:
    # group_size_mismatch_penalty (deutlich höher als dieser Bonus) greift
    # für sie, sobald sie in einer größeren Gruppe landen.
    # Umgesetzt über die ohnehin vorhandenen is_size-Indikatoren (Gruppe in
    # dieser Zelle hat genau k Spieler) — das bleibt linear und braucht
    # keine einzige zusätzliche Variable oder Nebenbedingung.
    for (c_i, t, r_i, k), b in is_size.items():
        if k >= 2:
            obj_terms.append(w.grouping_bonus * (k - 1) * b)

    # Reward demand fulfillment: pro belegtem Slot.
    for p_i, p in enumerate(players):
        for (c_i, pp_i, t, r_i), v in x.items():
            if pp_i == p_i:
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
    # Die Wunsch-Größen kommen aus den drei Checkboxen "Einzel/Zweier/
    # Gruppentraining" (``allowed_session_types``): Einzel→1, Zweier→2,
    # Gruppentraining→3..ZWERGE_MAX_GROUP_SIZE (die Zwerge-Ausnahme erlaubt
    # bis zu 8 — ohne die volle Spanne hier würde eine große, ansonsten
    # korrekte Zwerge-Gruppe fälschlich als "Gruppengrößen-Mismatch" bestraft).
    _type_to_sizes = {
        SessionType.SINGLE: {1},
        SessionType.DOUBLE: {2},
        SessionType.GROUP: set(range(3, ZWERGE_MAX_GROUP_SIZE + 1)),
    }
    for p_i, p in enumerate(players):
        pref_sizes: set[int] = set()
        for st in p.preferences.allowed_session_types:
            pref_sizes |= _type_to_sizes.get(st, set())
        # Alle drei angehakt (Standard) = keine echte Präferenz -> überspringen,
        # statt jeder Belegung überall einen (dann bedeutungslosen) Bonus zu geben.
        if not pref_sizes or pref_sizes >= relevant_sizes:
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

    # Trainer-Fairness: ohne diesen Term gibt es keinerlei Anreiz, einen
    # verfügbaren Trainer überhaupt einzusetzen — fulfill_player_demand ist
    # egal, WELCHER Trainer die Nachfrage deckt, also landet der Solver
    # leicht bei "wenige Trainer machen alles, andere bekommen nichts".
    # Belohnt jeden Trainer bis COACH_SPREAD_TARGET Slots mit abnehmendem
    # Grenznutzen danach (AddMinEquality kappt den Bonus), sodass der erste
    # Slot für einen noch ungenutzten Trainer mehr wert ist als ein
    # zusätzlicher Slot für einen bereits ausgelasteten.
    for c_i in range(nC):
        ys = [y[c_i, t, r_i] for t in range(T) for r_i in range(nR) if (c_i, t, r_i) in y]
        if not ys:
            continue
        total = m.NewIntVar(0, len(ys), f"coach_total_{c_i}")
        m.Add(total == sum(ys))
        capped = m.NewIntVar(0, COACH_SPREAD_TARGET, f"coach_spread_capped_{c_i}")
        m.AddMinEquality(capped, [total, m.NewConstant(COACH_SPREAD_TARGET)])
        obj_terms.append(w.coach_spread_bonus * capped)

    # Platzwechsel innerhalb eines Tages bestrafen — aber nur die Plätze
    # ZUSÄTZLICH zum ersten.
    #
    # Vorher wurde jeder benutzte Platz bestraft, also auch der erste. Ein
    # Trainer, der überhaupt anfing zu arbeiten, kostete damit
    # court_switch_penalty Punkte pro Tag, ohne jeden Wechsel — eine
    # versteckte Strafe aufs Arbeiten an sich, die direkt gegen das Ziel
    # arbeitete, alle verfügbaren Trainer einzubeziehen (siehe
    # coach_spread_bonus). Jetzt ist der erste Platz gratis und nur echtes
    # Wechseln kostet.
    for c_i in range(nC):
        for day_range in days:
            used_vars = []
            for r_i in range(nR):
                ys = [y[c_i, t, r_i] for t in day_range if (c_i, t, r_i) in y]
                if not ys:
                    continue
                used = m.NewBoolVar(f"used_c{c_i}_r{r_i}_d{day_range.start}")
                m.AddMaxEquality(used, ys)
                used_vars.append(used)
            if len(used_vars) < 2:
                continue   # höchstens ein möglicher Platz -> nie ein Wechsel
            if not rcfg.relax_one_court_per_day:
                # Harte Regel: ein Trainer bleibt den ganzen Tag auf einem
                # Platz. Als reine Strafe hat das nicht funktioniert — der
                # Solver ließ z.B. zwei Trainer am selben Tag gegenseitig die
                # Plätze tauschen, obwohl Bleiben für beide besser gewesen
                # wäre. Das ist eine Symmetrie, die er unter Zeitdruck nicht
                # auflöst; als hartes Constraint existiert sie gar nicht erst
                # und der Suchraum wird zusätzlich kleiner.
                # Wenn ein Plan damit unlösbar ist, lockert Stufe 1 der
                # Fallback-Tiers genau diese Regel wieder (siehe
                # diagnostics.FALLBACK_TIERS) — dann greift die Strafe unten.
                m.Add(sum(used_vars) <= 1)
            extra = m.NewIntVar(0, len(used_vars) - 1, f"extra_courts_c{c_i}_d{day_range.start}")
            m.Add(extra >= sum(used_vars) - 1)
            obj_terms.append(-w.court_switch_penalty * extra)

    # Platz-Präferenz (Tie-Breaker): Plätze mit niedrigerer `priority`-Zahl
    # werden bevorzugt genutzt, z.B. "in der Halle immer erst Platz 1, 2, 3"
    # oder "draußen erst 3, 4, dann 1, 2, dann Rest". Wirkt pro (Coach,
    # Platz, Slot) — je mehr Zeit auf einem hoch priorisierten (=
    # unerwünschteren) Platz verbracht wird, desto größer die Strafe.
    for (c_i, t, r_i), yv in y.items():
        prio = courts[r_i].priority
        if prio:
            obj_terms.append(-w.court_priority_penalty * prio * yv)

    # Fragmentierungs-Strafe (Tie-Breaker): eine unnötige Lücke im
    # Tagesplan eines Trainers (z.B. eine halbe Stunde Pause zwischen zwei
    # Blöcken, obwohl ein durchgehender Block möglich gewesen wäre) kostet
    # etwas. Anders als die harte Mindest-Blocklänge oben (die nur greift,
    # wenn ein Trainer explizit `min_block_slots > 1` eingestellt hat) gilt
    # das hier für JEDEN Trainer: der erste Arbeitsblock am Tag ist immer
    # "gratis", jeder weitere, vom ersten getrennte Block kostet.
    for c_i in range(nC):
        for day_range in days:
            day_slots = list(day_range)
            if not day_slots:
                continue
            block_starts = []
            for idx, t in enumerate(day_slots):
                prev_busy_zero = m.NewBoolVar(f"objprev0_c{c_i}_t{t}")
                if idx == 0:
                    m.Add(prev_busy_zero == 1)
                else:
                    m.Add(prev_busy_zero == 1 - busy[c_i, day_slots[idx - 1]])
                blk_start = m.NewBoolVar(f"objblkstart_c{c_i}_t{t}")
                m.AddBoolAnd([busy[c_i, t], prev_busy_zero]).OnlyEnforceIf(blk_start)
                m.AddBoolOr([busy[c_i, t].Not(), prev_busy_zero.Not()]).OnlyEnforceIf(blk_start.Not())
                block_starts.append(blk_start)
            used_day = m.NewBoolVar(f"objusedday_c{c_i}_d{day_range.start}")
            m.AddMaxEquality(used_day, [busy[c_i, t] for t in day_slots])
            # sum(block_starts) - used_day == 0, wenn nur ein Block (oder gar
            # keiner) — jeder zusätzliche Block erhöht die Differenz um 1.
            obj_terms.append(-w.coach_fragmentation_penalty * (sum(block_starts) - used_day))

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
