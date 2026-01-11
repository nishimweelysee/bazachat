# Seating Chart Management System (CLI)

A lightweight seating chart management system you can run locally from the command line.

For a system overview, requirements, and tools used, see `DOCUMENTATION.md`.

## Requirements

- Python 3.10+ (standard library only)

## Quick start

Create a new chart:

```bash
python3 -m seating_chart init --rows 4 --cols 6
```

Assign people to seats:

```bash
python3 -m seating_chart assign --row 0 --col 0 --name "Alice"
python3 -m seating_chart assign --row 0 --col 1 --name "Bob"
python3 -m seating_chart assign --row 1 --col 2 --name "Charlie"
```

Show the chart:

```bash
python3 -m seating_chart show
```

Swap seats:

```bash
python3 -m seating_chart swap --row1 0 --col1 0 --row2 0 --col2 1
```

Find a person:

```bash
python3 -m seating_chart find --name "Charlie"
```

## File format

By default, the CLI reads/writes `seating_chart.json` in the current directory. You can override this with `--file`.

## CSV import/export

Export assigned seats (only occupied seats are written):

```bash
python3 -m seating_chart export-csv --output assignments.csv
```

Import assignments from a CSV with headers `row,col,name`:

```bash
python3 -m seating_chart import-csv --input assignments.csv --rows 4 --cols 6
```