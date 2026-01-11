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


def init_db() -> None:
    from . import models  # noqa: F401 - ensure models are registered

    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)

