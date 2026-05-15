"""Discrete weekly time grid used by the solver.

A week is divided into ``slots_per_day * 7`` slots of fixed length
(default 30 minutes). Slot 0 is Monday 00:00.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time, timedelta
from enum import IntEnum


class Weekday(IntEnum):
    MONDAY = 0
    TUESDAY = 1
    WEDNESDAY = 2
    THURSDAY = 3
    FRIDAY = 4
    SATURDAY = 5
    SUNDAY = 6


@dataclass(frozen=True, slots=True)
class TimeSlot:
    """A single slot in the weekly grid."""

    index: int
    weekday: Weekday
    start: time
    end: time

    def overlaps(self, other: "TimeSlot") -> bool:
        return self.index == other.index


@dataclass(frozen=True, slots=True)
class TimeGrid:
    """Discrete weekly grid.

    ``slot_minutes`` must divide 60 for clean hour calculations.
    ``day_start_minutes`` / ``day_end_minutes`` constrain the grid to
    realistic training hours (default 7:00 – 22:00).
    """

    slot_minutes: int = 30
    day_start_minutes: int = 7 * 60
    day_end_minutes: int = 22 * 60

    def __post_init__(self) -> None:
        if 60 % self.slot_minutes != 0:
            raise ValueError("slot_minutes must divide 60")
        if self.day_end_minutes <= self.day_start_minutes:
            raise ValueError("day_end_minutes must be > day_start_minutes")
        if (self.day_end_minutes - self.day_start_minutes) % self.slot_minutes != 0:
            raise ValueError("day window must be a multiple of slot_minutes")

    @property
    def slots_per_day(self) -> int:
        return (self.day_end_minutes - self.day_start_minutes) // self.slot_minutes

    @property
    def total_slots(self) -> int:
        return self.slots_per_day * 7

    def slots_per_hour(self) -> int:
        return 60 // self.slot_minutes

    def slot(self, index: int) -> TimeSlot:
        if not 0 <= index < self.total_slots:
            raise IndexError(index)
        day = index // self.slots_per_day
        within = index % self.slots_per_day
        start_min = self.day_start_minutes + within * self.slot_minutes
        end_min = start_min + self.slot_minutes
        return TimeSlot(
            index=index,
            weekday=Weekday(day),
            start=time(hour=start_min // 60, minute=start_min % 60),
            end=time(hour=(end_min // 60) % 24, minute=end_min % 60),
        )

    def index_for(self, weekday: Weekday, t: time) -> int:
        minutes = t.hour * 60 + t.minute
        if not self.day_start_minutes <= minutes < self.day_end_minutes:
            raise ValueError(f"{t} outside grid window")
        within = (minutes - self.day_start_minutes) // self.slot_minutes
        return int(weekday) * self.slots_per_day + within

    def slot_duration(self) -> timedelta:
        return timedelta(minutes=self.slot_minutes)

    def all_slots(self) -> list[TimeSlot]:
        return [self.slot(i) for i in range(self.total_slots)]

    def day_slot_ranges(self) -> list[range]:
        """Slot indices grouped by weekday — useful for per-day constraints."""
        return [
            range(d * self.slots_per_day, (d + 1) * self.slots_per_day) for d in range(7)
        ]
