"""OR-Tools CP-SAT solver for weekly tennis training plans."""

from coach_api.solver.model import SolverInput, SolverResult, solve
from coach_api.solver.scoring import ObjectiveWeights

__all__ = ["ObjectiveWeights", "SolverInput", "SolverResult", "solve"]
