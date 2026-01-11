# Seating Chart Management System — Documentation

## Overview

This project is a lightweight **seating chart management system** implemented as a **Python command-line application**. It lets you create a seating chart (rows × columns), assign/remove people to/from seats, swap seats, find where a person is seated, and import/export assignments via CSV.

The system stores chart state in a local **JSON file** (default: `seating_chart.json`) so it can be edited over time and shared.

## Features

- **Create/initialize** a new chart file (`init`)
- **Assign** a person to a seat (`assign`)
- **Remove** a person from a seat (`remove`)
- **Swap** two seats (`swap`)
- **Find** a person by name (`find`)
- **Display** the chart as an ASCII grid (`show`)
- **CSV export** of occupied seats only (`export-csv`)
- **CSV import** of assignments (`import-csv`)

## Requirements

- **OS**: Linux/macOS/Windows (any OS that can run Python)
- **Python**: **Python 3.10+** (tested here with Python 3.12)
- **Dependencies**: **None** (standard library only)

## Tools and libraries used

This project intentionally uses only Python’s standard library:

- **argparse**: CLI parsing and help text
- **json**: persistence of the chart in `seating_chart.json`
- **csv**: import/export of seat assignments
- **pathlib**: file path handling
- **dataclasses / typing**: clean, typed internal models
- **unittest**: unit tests

## Project structure

- `seating_chart/`
  - `chart.py`: core `SeatingChart` model and operations (assign/remove/swap/find)
  - `storage.py`: load/save chart JSON
  - `render.py`: ASCII grid rendering for `show`
  - `__main__.py`: CLI entrypoint (`python3 -m seating_chart ...`)
- `tests/`: unit tests (`python3 -m unittest discover -s tests`)

## Data formats

### JSON (chart file)

The chart is stored as:

- `rows`: integer
- `cols`: integer
- `chart`: 2D array (`rows × cols`) of either `null` or a string name

### CSV (assignments)

Import/export CSV uses headers:

- `row` (integer)
- `col` (integer)
- `name` (string)

Only occupied seats are exported.

## How to run

See `README.md` for copy/paste commands, or run:

```bash
python3 -m seating_chart --help
```

## How to run tests

```bash
python3 -m unittest discover -s tests -q
```

