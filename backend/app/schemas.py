from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

from .models import CapacityMode, SeatStatus, SeatType, ZoneType


class Point2D(BaseModel):
    x: float
    y: float


class Polygon(BaseModel):
    # List of [x,y] pairs
    points: list[tuple[float, float]] = Field(min_length=3)

    @field_validator("points")
    @classmethod
    def _closed_or_closeable(cls, v: list[tuple[float, float]]) -> list[tuple[float, float]]:
        # Allow open polygons; backend will close for geometric operations.
        return v


class LineSeg(BaseModel):
    type: Literal["line"]
    x1: float
    y1: float
    x2: float
    y2: float


class ArcSeg(BaseModel):
    type: Literal["arc"]
    cx: float
    cy: float
    r: float = Field(gt=0)
    start_deg: float
    end_deg: float
    cw: bool = True


PathSeg = Annotated[Union[LineSeg, ArcSeg], Field(discriminator="type")]


class Path(BaseModel):
    segments: list[PathSeg] = Field(min_length=1)
    # Optional skip intervals along the path length (meters), used for aisles/vomitories.
    gaps: list[tuple[float, float]] = Field(default_factory=list)


class VenueCreate(BaseModel):
    name: str
    origin_x_m: float = 0.0
    origin_y_m: float = 0.0
    bearing_deg: float = 0.0


class LevelCreate(BaseModel):
    name: str
    z_base_m: float = 0.0


class PitchUpsert(BaseModel):
    polygon: Polygon


class SectionCreate(BaseModel):
    code: str
    polygon: Polygon
    seat_direction: str = "lr"
    row_direction: str = "front_to_back"


class RowCreate(BaseModel):
    label: str
    order_index: int = 0
    path: Path


class SectionUpdate(BaseModel):
    polygon: Polygon
    seat_direction: Optional[str] = None
    row_direction: Optional[str] = None


class RowUpdate(BaseModel):
    label: Optional[str] = None
    order_index: Optional[int] = None
    path: Optional[Path] = None


class RowMetrics(BaseModel):
    row_id: int
    total_length_m: float


class ZoneCreate(BaseModel):
    name: str
    zone_type: ZoneType = ZoneType.standing
    capacity: int = Field(ge=0, default=0)
    capacity_mode: CapacityMode = CapacityMode.manual
    density_per_m2: float = Field(ge=0, default=0.0)
    polygon: Polygon


class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    zone_type: Optional[ZoneType] = None
    capacity: Optional[int] = Field(default=None, ge=0)
    capacity_mode: Optional[CapacityMode] = None
    density_per_m2: Optional[float] = Field(default=None, ge=0)
    polygon: Optional[Polygon] = None


class GenerateSeatsRequest(BaseModel):
    seat_pitch_m: float = Field(gt=0.1, default=0.5)
    start_offset_m: float = Field(ge=0, default=0.2)
    end_offset_m: float = Field(ge=0, default=0.2)
    seat_number_start: int = Field(ge=1, default=1)
    seat_type: SeatType = SeatType.standard
    overwrite: bool = False


class ConfigCreate(BaseModel):
    name: str


class SeatOverrideUpsert(BaseModel):
    seat_id: int
    status: SeatStatus
    notes: str = ""


class SeatOverrideBulkUpsert(BaseModel):
    seat_ids: list[int] = Field(min_length=1)
    status: SeatStatus
    notes: str = ""


class Snapshot(BaseModel):
    venue_id: int
    config_id: Optional[int] = None

    venue: dict
    pitch: Optional[dict] = None
    levels: list[dict]
    sections: list[dict]
    rows: list[dict]
    seats: list[dict]
    zones: list[dict]
    overrides: list[dict]

