from __future__ import annotations

import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine


def _default_db_url() -> str:
    # Keep data out of git by default.
    data_dir = Path(os.environ.get("VENUE_SEATING_DATA_DIR", Path.cwd() / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "venue_seating.db"
    return f"sqlite:///{db_path}"


engine = create_engine(
    os.environ.get("VENUE_SEATING_DB_URL", _default_db_url()),
    echo=False,
    connect_args={"check_same_thread": False},
)

def _maybe_migrate() -> None:
    # Minimal SQLite migrations for local dev; avoids requiring Alembic.
    # Only adds new columns if missing.
    try:
        with engine.connect() as conn:
            res = conn.exec_driver_sql("PRAGMA table_info('zone')").fetchall()
            if not res:
                return
            cols = {r[1] for r in res}  # name is index 1
            if "capacity_mode" not in cols:
                conn.exec_driver_sql("ALTER TABLE zone ADD COLUMN capacity_mode VARCHAR DEFAULT 'manual'")
            if "density_per_m2" not in cols:
                conn.exec_driver_sql("ALTER TABLE zone ADD COLUMN density_per_m2 FLOAT DEFAULT 0.0")
            conn.commit()
    except Exception:
        # If anything goes wrong, keep startup resilient; dev can delete ./data DB.
        return


def init_db() -> None:
    from . import models  # noqa: F401 - ensure models are registered

    SQLModel.metadata.create_all(engine)
    _maybe_migrate()


def get_session() -> Session:
    return Session(engine)

