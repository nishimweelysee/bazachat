from __future__ import annotations

import argparse
import csv
from pathlib import Path

from .chart import SeatingChart, SeatingChartError
from .render import render_ascii
from .storage import load_chart, maybe_init_chart, save_chart


DEFAULT_FILE = "seating_chart.json"


def _add_common_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--file",
        default=DEFAULT_FILE,
        help=f"Path to chart JSON file (default: {DEFAULT_FILE})",
    )


def cmd_init(args: argparse.Namespace) -> int:
    maybe_init_chart(args.file, rows=args.rows, cols=args.cols, overwrite=args.overwrite)
    print(f"Initialized chart at {args.file} ({args.rows} rows x {args.cols} cols)")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    print(render_ascii(chart, cell_width=args.width))
    return 0


def cmd_assign(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    chart.assign(args.row, args.col, args.name, overwrite=args.overwrite)
    save_chart(chart, args.file)
    print(f"Assigned {args.name!r} to R{args.row}C{args.col}")
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    chart.remove(args.row, args.col)
    save_chart(chart, args.file)
    print(f"Cleared R{args.row}C{args.col}")
    return 0


def cmd_swap(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    chart.swap(args.row1, args.col1, args.row2, args.col2)
    save_chart(chart, args.file)
    print(f"Swapped R{args.row1}C{args.col1} <-> R{args.row2}C{args.col2}")
    return 0


def cmd_find(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    seat = chart.find(args.name)
    if seat is None:
        print("Not found")
        return 1
    print(f"Found at R{seat.row}C{seat.col}")
    return 0


def cmd_export_csv(args: argparse.Namespace) -> int:
    chart = load_chart(args.file)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["row", "col", "name"])
        for r in range(chart.rows):
            for c in range(chart.cols):
                name = chart.chart[r][c]
                if name is not None:
                    w.writerow([r, c, name])
    print(f"Exported assigned seats to {out}")
    return 0


def cmd_import_csv(args: argparse.Namespace) -> int:
    chart = maybe_init_chart(args.file, rows=args.rows, cols=args.cols, overwrite=args.overwrite)
    inp = Path(args.input)
    with inp.open("r", newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        required = {"row", "col", "name"}
        if not required.issubset(set(r.fieldnames or [])):
            raise SeatingChartError(f"CSV must have headers: {sorted(required)}")
        for row in r:
            rr = int(row["row"])
            cc = int(row["col"])
            name = str(row["name"])
            chart.assign(rr, cc, name, overwrite=True)
    save_chart(chart, args.file)
    print(f"Imported assignments from {inp} into {args.file}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="seating_chart", description="Seating chart management system (CLI).")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="Create a new seating chart JSON file")
    _add_common_args(p_init)
    p_init.add_argument("--rows", type=int, required=True)
    p_init.add_argument("--cols", type=int, required=True)
    p_init.add_argument("--overwrite", action="store_true", help="Overwrite existing chart file")
    p_init.set_defaults(func=cmd_init)

    p_show = sub.add_parser("show", help="Print the current seating chart")
    _add_common_args(p_show)
    p_show.add_argument("--width", type=int, default=10, help="Cell width for display")
    p_show.set_defaults(func=cmd_show)

    p_assign = sub.add_parser("assign", help="Assign a person to a seat")
    _add_common_args(p_assign)
    p_assign.add_argument("--row", type=int, required=True)
    p_assign.add_argument("--col", type=int, required=True)
    p_assign.add_argument("--name", required=True)
    p_assign.add_argument("--overwrite", action="store_true", help="Overwrite if seat is occupied")
    p_assign.set_defaults(func=cmd_assign)

    p_remove = sub.add_parser("remove", help="Remove a person from a seat")
    _add_common_args(p_remove)
    p_remove.add_argument("--row", type=int, required=True)
    p_remove.add_argument("--col", type=int, required=True)
    p_remove.set_defaults(func=cmd_remove)

    p_swap = sub.add_parser("swap", help="Swap two seats")
    _add_common_args(p_swap)
    p_swap.add_argument("--row1", type=int, required=True)
    p_swap.add_argument("--col1", type=int, required=True)
    p_swap.add_argument("--row2", type=int, required=True)
    p_swap.add_argument("--col2", type=int, required=True)
    p_swap.set_defaults(func=cmd_swap)

    p_find = sub.add_parser("find", help="Find a person in the chart")
    _add_common_args(p_find)
    p_find.add_argument("--name", required=True)
    p_find.set_defaults(func=cmd_find)

    p_export = sub.add_parser("export-csv", help="Export assigned seats to a CSV file")
    _add_common_args(p_export)
    p_export.add_argument("--output", required=True)
    p_export.set_defaults(func=cmd_export_csv)

    p_import = sub.add_parser("import-csv", help="Import assignments from a CSV file (row,col,name)")
    _add_common_args(p_import)
    p_import.add_argument("--input", required=True)
    p_import.add_argument("--rows", type=int, help="Rows (required if creating new file)")
    p_import.add_argument("--cols", type=int, help="Cols (required if creating new file)")
    p_import.add_argument("--overwrite", action="store_true", help="Overwrite existing chart file when creating")
    p_import.set_defaults(func=cmd_import_csv)

    return p


def main() -> int:
    p = build_parser()
    args = p.parse_args()
    try:
        return int(args.func(args))
    except SeatingChartError as e:
        print(f"Error: {e}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

