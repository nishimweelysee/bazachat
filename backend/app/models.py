from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.utcnow()


class SeatStatus(str, Enum):
    sellable = "sellable"
    blocked = "blocked"
    kill = "kill"  # exists physically, not used for an event layout


class SeatType(str, Enum):
    standard = "standard"
    aisle = "aisle"
    wheelchair = "wheelchair"
    companion = "companion"
    standing = "standing"
    rail = "rail"


class ZoneType(str, Enum):
    standing = "standing"


class CapacityMode(str, Enum):
    manual = "manual"
    auto = "auto"  # capacity derived from area_m2 * density_per_m2


class Venue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str

    # Local planar CRS in meters. A pitch/stage can still be added separately.
    origin_x_m: float = 0.0
    origin_y_m: float = 0.0
    bearing_deg: float = 0.0

    created_at: datetime = Field(default_factory=_utc_now)


class Pitch(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    venue_id: int = Field(index=True, foreign_key="venue.id")

    # JSON polygon: [[x,y], [x,y], ...]
    geom_json: str

    created_at: datetime = Field(default_factory=_utc_now)

    def geom(self) -> list[list[float]]:
        return json.loads(self.geom_json)


class Level(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    venue_id: int = Field(index=True, foreign_key="venue.id")
    name: str
    z_base_m: float = 0.0

    created_at: datetime = Field(default_factory=_utc_now)


class Section(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    level_id: int = Field(index=True, foreign_key="level.id")
    code: str

    # JSON polygon: [[x,y], [x,y], ...]
    geom_json: str

    # Numbering metadata (minimal; can expand later)
    seat_direction: str = "lr"  # lr/rl
    row_direction: str = "front_to_back"

    created_at: datetime = Field(default_factory=_utc_now)

    def geom(self) -> list[list[float]]:
        return json.loads(self.geom_json)


class Row(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    section_id: int = Field(index=True, foreign_key="section.id")
    label: str
    order_index: int = 0

    # JSON path segments; see app/schemas.py for shape.
    geom_json: str

    created_at: datetime = Field(default_factory=_utc_now)


class Seat(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    row_id: int = Field(index=True, foreign_key="row.id")
    seat_number: int

    x_m: float
    y_m: float
    z_m: float = 0.0
    facing_deg: float = 0.0

    seat_type: SeatType = SeatType.standard

    created_at: datetime = Field(default_factory=_utc_now)


class Config(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    venue_id: int = Field(index=True, foreign_key="venue.id")
    name: str
    created_at: datetime = Field(default_factory=_utc_now)


class SeatOverride(SQLModel, table=True):
    config_id: int = Field(primary_key=True, foreign_key="config.id")
    seat_id: int = Field(primary_key=True, foreign_key="seat.id")

    status: SeatStatus = SeatStatus.sellable
    notes: str = ""

    updated_at: datetime = Field(default_factory=_utc_now)


class Zone(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    section_id: int = Field(index=True, foreign_key="section.id")
    name: str
    zone_type: ZoneType = ZoneType.standing
    capacity: int = 0
    capacity_mode: CapacityMode = CapacityMode.manual
    density_per_m2: float = 0.0

    # JSON polygon: [[x,y], ...]
    geom_json: str
    created_at: datetime = Field(default_factory=_utc_now)


