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

---

# Venue Seating Designer (Stadium/Arena Layout Tool)

This repository also includes an early **venue seating designer** for stadiums/arenas with:

- **Pitch/Stage** polygon (reference geometry)
- **Levels → Sections → Rows → Seats**
- **Mixed row geometry** (line segments + arc segments)
- **Meter-accurate drawing space**
- **Configurations** (event layouts) with per-seat **blocked/kill/sellable** overrides

## Run the backend (FastAPI)

```bash
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app.main:app --reload --port 8000
```

Then open the API docs at `http://localhost:8000/docs`.

## Run the frontend (React)

```bash
cd frontend
npm install
npm run dev
```

The UI expects the backend at `http://localhost:8000` (override with `VITE_API_BASE`).

## UI basics

- **Draw pitch**: pick “Draw pitch”, click points, then **double-click** to save.
- **Draw section**: select a level, pick “Draw section”, click points, **double-click**, then enter a section code.
- **Draw row (line)**: select a section, pick “Draw row (line)”, click points, **double-click**, then save row label.
- **Draw row (arc)**: pick “Draw row (arc)”, click **3 points** (start/mid/end), then save.
- **Generate seats**: select a row → “Generate seats”.
- **Configurations**: create/select a config in the top bar, then “Paint blocked/kill” and click seats.
- **Export/Import**: use the top-bar buttons to copy a JSON package to clipboard and import it into a new venue.
- **Bulk paint**: with a config selected, drag a rectangle on the canvas to paint many seats at once.
- **Export CSV**: downloads `seats.csv` including effective status per config.