from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .chart import SeatingChart, SeatingChartError


def load_chart(path: str | Path) -> SeatingChart:
    p = Path(path)
    if not p.exists():
        raise SeatingChartError(f"chart file not found: {p}")

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise SeatingChartError(f"failed to read chart JSON: {e}") from e

    return SeatingChart.from_dict(data)


def save_chart(chart: SeatingChart, path: str | Path) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(chart.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def maybe_init_chart(
    path: str | Path,
    *,
    rows: Optional[int] = None,
    cols: Optional[int] = None,
    overwrite: bool = False,
) -> SeatingChart:
    p = Path(path)
    if p.exists() and not overwrite:
        return load_chart(p)

    if rows is None or cols is None:
        raise SeatingChartError("rows and cols are required to initialize a new chart")

    chart = SeatingChart(rows=rows, cols=cols)
    save_chart(chart, p)
    return chart

