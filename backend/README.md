# Backend (FastAPI)

## Run

```bash
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app.main:app --reload --port 8000
```

## Run tests

```bash
python3 -m unittest discover -s backend/tests -q
```

## Data storage

By default, a SQLite database is created under `./data/venue_seating.db` (ignored by git).

Override with:

- `VENUE_SEATING_DATA_DIR=/some/path`
- `VENUE_SEATING_DB_URL=sqlite:////abs/path/to.db`

