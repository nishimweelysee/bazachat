from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


class SeatingChartError(Exception):
    pass


@dataclass(frozen=True)
class Seat:
    row: int
    col: int


class SeatingChart:
    """
    A simple row/column seating chart storing a person name per seat.
    """

    def __init__(self, rows: int, cols: int, chart: Optional[list[list[Optional[str]]]] = None):
        if rows <= 0 or cols <= 0:
            raise SeatingChartError("rows and cols must be positive integers")
        self.rows = rows
        self.cols = cols

        if chart is None:
            self.chart: list[list[Optional[str]]] = [[None for _ in range(cols)] for _ in range(rows)]
        else:
            if len(chart) != rows or any(len(r) != cols for r in chart):
                raise SeatingChartError("chart dimensions do not match rows/cols")
            self.chart = chart

    def _validate_seat(self, row: int, col: int) -> None:
        if not (0 <= row < self.rows and 0 <= col < self.cols):
            raise SeatingChartError(f"seat out of bounds: row={row}, col={col}")

    def get(self, row: int, col: int) -> Optional[str]:
        self._validate_seat(row, col)
        return self.chart[row][col]

    def is_available(self, row: int, col: int) -> bool:
        return self.get(row, col) is None

    def assign(self, row: int, col: int, person_name: str, *, overwrite: bool = False) -> None:
        self._validate_seat(row, col)
        person_name = (person_name or "").strip()
        if not person_name:
            raise SeatingChartError("person_name must be a non-empty string")

        if self.chart[row][col] is not None and not overwrite:
            raise SeatingChartError(f"seat R{row}C{col} is already occupied")
        self.chart[row][col] = person_name

    def remove(self, row: int, col: int) -> None:
        self._validate_seat(row, col)
        self.chart[row][col] = None

    def swap(self, row1: int, col1: int, row2: int, col2: int) -> None:
        self._validate_seat(row1, col1)
        self._validate_seat(row2, col2)
        self.chart[row1][col1], self.chart[row2][col2] = self.chart[row2][col2], self.chart[row1][col1]

    def find(self, person_name: str) -> Optional[Seat]:
        for r in range(self.rows):
            for c in range(self.cols):
                if self.chart[r][c] == person_name:
                    return Seat(r, c)
        return None

    def to_dict(self) -> dict:
        return {
            "rows": self.rows,
            "cols": self.cols,
            "chart": self.chart,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SeatingChart":
        try:
            rows = int(data["rows"])
            cols = int(data["cols"])
            chart = data["chart"]
        except Exception as e:  # noqa: BLE001 - CLI tool, keep errors readable
            raise SeatingChartError(f"invalid seating chart data: {e}") from e
        return cls(rows=rows, cols=cols, chart=chart)

