from __future__ import annotations

from typing import Optional

from .chart import SeatingChart


def _cell(text: Optional[str], width: int) -> str:
    if not text:
        return ".".center(width)
    t = str(text)
    if len(t) > width:
        t = t[: max(0, width - 1)] + "…"
    return t.center(width)


def render_ascii(chart: SeatingChart, *, cell_width: int = 10) -> str:
    cell_width = max(3, int(cell_width))

    header = " " * (cell_width + 2) + " ".join(f"C{c}".center(cell_width) for c in range(chart.cols))
    lines = [header]
    for r in range(chart.rows):
        row_cells = " ".join(_cell(chart.chart[r][c], cell_width) for c in range(chart.cols))
        lines.append(f"R{r}".ljust(cell_width + 2) + row_cells)
    return "\n".join(lines)

