"""Domain entities — pure Python, no ORM, no framework."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from uuid import UUID, uuid4


class SessionType(StrEnum):
    SINGLE = "single"      # 1 player
    DOUBLE = "double"      # 2 players
    GROUP = "group"        # >=3 players


class TrainingCategory(StrEnum):
    """Art des Trainings, das ein Spieler braucht / ein Trainer abdeckt.

    Ein Spieler **und** ein Trainer können jeweils *mehrere* Kategorien
    haben. Die Zuteilung gilt als kompatibel, wenn die Mengen sich
    schneiden – oder wenn mindestens eine Seite leer ist (= "nicht
    zugewiesen" = Wildcard).

    ``OPEN`` ist die explizite Wildcard und wirkt wie eine leere Menge.
    Sie existiert nur noch aus Abwärtskompatibilität für vorhandene
    Daten und wird in :func:`effective_categories` zu ``frozenset()``
    normalisiert.
    """

    ADULTS = "adults"              # Erwachsene
    TEAM = "team"                  # Mannschaft
    FOERDERKADER = "foerderkader"  # Förderkader
    BALLSCHULE = "ballschule"      # Ballschule
    U8 = "u8"
    U9 = "u9"
    U10 = "u10"
    U12 = "u12"
    U15 = "u15"
    U18 = "u18"
    OPEN = "open"                  # frei / keine Einschränkung (== leere Menge)


def compute_age(birth_date: date, *, today: date | None = None) -> int:
    """Age in whole years as of ``today`` (defaults to the real today)."""
    today = today or date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def effective_categories(
    cats: "frozenset[TrainingCategory] | set[TrainingCategory] | None",
) -> frozenset["TrainingCategory"]:
    """Normalisiert: enthält OPEN -> leere Menge (Wildcard)."""
    if not cats:
        return frozenset()
    if TrainingCategory.OPEN in cats:
        return frozenset()
    return frozenset(cats)


def categories_compatible(
    a: "frozenset[TrainingCategory] | set[TrainingCategory] | None",
    b: "frozenset[TrainingCategory] | set[TrainingCategory] | None",
) -> bool:
    """True, wenn Trainer-Kategorien ``a`` und Spieler-Kategorien ``b``
    (oder umgekehrt) zusammenpassen — entscheidet, ob ein Trainer einen
    Spieler überhaupt nehmen darf.

    Regel: leere Menge auf einer Seite = Wildcard (passt zu allem); sonst
    muss die Schnittmenge nicht leer sein. Gilt uneingeschränkt auch für
    Ballschule/U8 — ein Trainer ohne gesetzte Kategorie darf jede
    Altersgruppe übernehmen, inklusive der Kleinsten.
    """
    ea = effective_categories(a)
    eb = effective_categories(b)
    if not ea or not eb:
        return True
    return not ea.isdisjoint(eb)


def players_can_share_session(
    a: "frozenset[TrainingCategory] | set[TrainingCategory] | None",
    b: "frozenset[TrainingCategory] | set[TrainingCategory] | None",
) -> bool:
    """True, wenn zwei *Spieler* (nicht Trainer!) zusammen in derselben
    Session sein dürfen.

    Gleiche Grundregel wie ``categories_compatible`` (leere Menge = "nicht
    zugewiesen" = passt zu allen anderen Spielern) — mit einer Ausnahme:

    ``BALLSCHULE`` und ``U8`` ("Zwerge"): für die Kleinsten gilt die
    Wildcard-Ausnahme nicht — ein Ballschule- oder U8-Kind trainiert
    *ausschließlich* mit anderen Kindern derselben dieser beiden
    Kategorien, auch nicht mit einem noch nicht kategorisierten (=
    Wildcard) Spieler. Das schließt auch Ballschule/U8 gegeneinander ein
    (unterschiedliche Kategorien, also nicht kompatibel, außer ein Kind
    hat ausnahmsweise beide gesetzt). Welcher *Trainer* die Session leitet,
    ist davon unberührt — dafür gilt weiterhin ``categories_compatible``.
    """
    ea = effective_categories(a)
    eb = effective_categories(b)
    _STRICT = {TrainingCategory.BALLSCHULE, TrainingCategory.U8}
    if ea & _STRICT or eb & _STRICT:
        return not ea.isdisjoint(eb)
    if not ea or not eb:
        return True
    return not ea.isdisjoint(eb)


@dataclass(frozen=True, slots=True)
class CoachConstraints:
    """Hard scheduling constraints for a coach.

    All times are expressed in *slots* of the active TimeGrid.
    """

    min_block_slots: int = 0          # mind. zusammenhängender Block (0 = aus)
    max_slots_per_day: int | None = None
    max_slots_per_week: int | None = None
    min_break_slots: int = 0          # mind. Pause zwischen zwei Blöcken am selben Tag
    max_break_slots: int | None = None  # max. Pause zwischen zwei Blöcken am selben Tag (None = unbegrenzt, 0 = keine Pause erlaubt)
    # Player-matching constraints (None = unrestricted on that side).
    accepts_lk_min: int | None = None     # smallest LK number = strongest player
    accepts_lk_max: int | None = None     # largest LK number = weakest player
    accepts_age_min: int | None = None
    accepts_age_max: int | None = None


@dataclass(slots=True)
class Coach:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    constraints: CoachConstraints = field(default_factory=CoachConstraints)
    max_group_size: int = 4
    # Welche Trainings-Kategorien deckt dieser Trainer ab?
    # Leere Menge oder {OPEN} = nimmt jeden Spieler.
    categories: frozenset[TrainingCategory] = field(default_factory=frozenset)
    # Pausierte/ausgeschiedene Trainer bleiben mit allen Daten erhalten,
    # werden aber von der Plan-Erstellung ignoriert (siehe
    # PATCH /coaches/{id}/active) — Alternative zum Löschen.
    active: bool = True


@dataclass(frozen=True, slots=True)
class PlayerPreferences:
    preferred_coach_ids: tuple[UUID, ...] = ()
    preferred_partner_ids: tuple[UUID, ...] = ()
    allowed_session_types: frozenset[SessionType] = frozenset(
        {SessionType.SINGLE, SessionType.DOUBLE, SessionType.GROUP}
    )
    notes: str = ""   # Freitext, vom Spieler gepflegt, von Trainern lesbar


@dataclass(frozen=True, slots=True)
class PlayerMate:
    """Ein Wunschspieler-Partner für einen Spieler.

    ``mandatory=True`` => muss in jeder Session dieses Spielers ebenfalls
    anwesend sein (hartes Constraint).
    ``mandatory=False`` => Solver bevorzugt diesen Partner, ist aber frei
    andere passende Spieler zu wählen.
    """

    player_id: UUID
    mandatory: bool = False


@dataclass(slots=True)
class Player:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    preferences: PlayerPreferences = field(default_factory=PlayerPreferences)
    min_slots_per_week: int = 2   # = 1 Std (2 Slots à 30 Min) — passt zur
    max_slots_per_week: int = 2   # bestehenden Mindest-Session-Länge von 60 Min
    age: int | None = None
    level_lk: int | None = None        # German LK 1..25 (1=strongest) – nur weicher Bonus
    mates: tuple[PlayerMate, ...] = () # Wunschspieler vom Trainer kuratiert
    # Welche Trainings-Kategorien braucht dieser Spieler? Leere Menge =
    # nicht zugewiesen = Wildcard. Mehrere Kategorien sind möglich
    # (z.B. ein 17-jähriger spielt im Jugend- und Mannschaftstraining).
    categories: frozenset[TrainingCategory] = field(default_factory=frozenset)
    # Pausierte/ausgeschiedene Spieler bleiben mit allen Daten erhalten,
    # werden aber von der Plan-Erstellung ignoriert (siehe
    # PATCH /players/{id}/active) — Alternative zum Löschen.
    active: bool = True


@dataclass(slots=True)
class Court:
    name: str
    id: UUID = field(default_factory=uuid4)
    availability: frozenset[int] = field(default_factory=frozenset)
    indoor: bool = False
    # Solver-Präferenz: bei mehreren gleich guten Optionen wird der Platz
    # mit der niedrigeren Zahl bevorzugt (0 = am liebsten). Nur ein
    # Tie-Breaker, kein hartes Constraint — echte Nachfrage/Präferenzen
    # wiegen immer schwerer. Reihenfolge gilt jeweils nur innerhalb von
    # Halle/Draußen, nicht platzübergreifend.
    priority: int = 0


@dataclass(frozen=True, slots=True)
class TrainingSession:
    """One scheduled training unit on the weekly grid."""

    coach_id: UUID
    court_id: UUID
    player_ids: tuple[UUID, ...]
    slot_indices: tuple[int, ...]   # consecutive
    session_type: SessionType
    # Freitext statt Spielerliste — für Einheiten, die nicht an einzelne
    # erfasste Spieler gebunden sind (z.B. eine Mannschaft "Damen 30").
    # Nur manuell im Plan-Editor gesetzt, der Solver befüllt das nie.
    label: str | None = None
    # Kurze Bezeichnung der Einheit (z.B. "U15", "Junioren"), die im Plan
    # neben dem Trainer steht. Anders als ``label`` ersetzt das die
    # Spielerliste NICHT, sondern ergänzt sie nur. Rein manuell.
    note: str | None = None
    # Weitere Trainer derselben Einheit — z.B. zwei Trainer, die sich eine
    # große Zwerge-Gruppe auf einem Platz teilen. ``coach_id`` bleibt der
    # hauptverantwortliche Trainer; der Solver plant immer nur mit diesem
    # einen und lässt das Feld leer, es wird ausschließlich im Plan-Editor
    # von Hand gefüllt.
    extra_coach_ids: tuple[UUID, ...] = ()
    # Kurznotiz hinter einzelnen Spielernamen, z.B. "Förderkader" oder
    # "gerade Wochen". Bewusst je (Einheit, Spieler) statt am Spieler
    # selbst: "gerade Wochen" gilt für genau diese Einheit, nicht generell
    # für den Spieler. Rein manuell im Plan-Editor.
    player_notes: dict[UUID, str] = field(default_factory=dict)


@dataclass(slots=True)
class Season:
    name: str                       # z. B. "Sommer 2026"
    valid_from: date
    valid_to: date
    id: UUID = field(default_factory=uuid4)


@dataclass(slots=True)
class WeeklyPlan:
    season_id: UUID
    sessions: tuple[TrainingSession, ...]
    score: float = 0.0
    id: UUID = field(default_factory=uuid4)
    explanation: str = ""
