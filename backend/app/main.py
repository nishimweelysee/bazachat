from __future__ import annotations

import csv
import io
import json
import math
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlmodel import Session, delete, select

from .db import get_session, init_db
from .geometry import (
    GeometryError,
    angle_deg,
    path_total_length,
    polygon_area_m2,
    polygon_centroid,
    polygon_contains_point,
    seats_along_path,
    validate_polygon,
)
from .models import CapacityMode, Config, Level, Pitch, Row, Seat, SeatOverride, Section, SeatStatus, Venue, Zone
from .schemas import (
    ConfigCreate,
    GenerateSeatsRequest,
  GenerateSectionSeatsRequest,
    LevelCreate,
    PitchUpsert,
    RowCreate,
    RowMetrics,
    RowUpdate,
  SeatBulkCreate,
  SeatTypeBulkUpdate,
  SeatUpdate,
    SeatOverrideUpsert,
    SeatOverrideBulkUpsert,
    SeatOverrideBatchUpsert,
    SectionCreate,
    SectionUpdate,
    Snapshot,
    VenueCreate,
    ZoneCreate,
    ZoneUpdate,
)


app = FastAPI(title="Venue Seating Designer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _session() -> Session:
    return get_session()

def _delete_seat_overrides_for_seat_ids(session: Session, seat_ids: list[int]) -> None:
    if not seat_ids:
        return
    session.exec(delete(SeatOverride).where(SeatOverride.seat_id.in_(seat_ids)))


def _delete_seats_for_row_ids(session: Session, row_ids: list[int]) -> None:
    if not row_ids:
        return
    seat_ids = session.exec(select(Seat.id).where(Seat.row_id.in_(row_ids))).all()
    seat_ids_int = [int(x) for x in seat_ids if x is not None]
    _delete_seat_overrides_for_seat_ids(session, seat_ids_int)
    session.exec(delete(Seat).where(Seat.row_id.in_(row_ids)))


def _get_or_create_manual_row(session: Session, section_id: int, *, near_x: float, near_y: float) -> Row:
    """
    Seats are currently modeled as belonging to a Row.
    For manual seat design (drag/plot dots), we attach seats to a hidden row per section.
    """
    existing = session.exec(select(Row).where(Row.section_id == section_id, Row.label == "__MANUAL__")).first()
    if existing:
        return existing
    # Tiny non-zero line segment so the row can be visualized if needed.
    path = {"segments": [{"type": "line", "x1": near_x, "y1": near_y, "x2": near_x + 0.01, "y2": near_y}], "gaps": []}
    r = Row(section_id=section_id, label="__MANUAL__", order_index=-1000, geom_json=json.dumps(path))
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/venues")
def create_venue(payload: VenueCreate, session: Session = Depends(_session)) -> dict:
    v = Venue(**payload.model_dump())
    session.add(v)
    session.commit()
    session.refresh(v)
    return {"id": v.id, "name": v.name}


@app.get("/venues")
def list_venues(session: Session = Depends(_session)) -> list[dict]:
    venues = session.exec(select(Venue).order_by(Venue.created_at.desc())).all()
    return [{"id": v.id, "name": v.name} for v in venues]


@app.put("/venues/{venue_id}/pitch")
def upsert_pitch(venue_id: int, payload: PitchUpsert, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    pts = [(float(x), float(y)) for (x, y) in payload.polygon.points]
    try:
        validate_polygon(pts, name="pitch polygon")
    except GeometryError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    geom = json.dumps([[x, y] for (x, y) in pts])
    existing = session.exec(select(Pitch).where(Pitch.venue_id == venue_id)).first()
    if existing:
        existing.geom_json = geom
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return {"id": existing.id}
    p = Pitch(venue_id=venue_id, geom_json=geom)
    session.add(p)
    session.commit()
    session.refresh(p)
    return {"id": p.id}


@app.delete("/venues/{venue_id}/pitch")
def delete_pitch(venue_id: int, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")
    session.exec(delete(Pitch).where(Pitch.venue_id == venue_id))
    session.commit()
    return {"deleted": True}


@app.post("/venues/{venue_id}/levels")
def create_level(venue_id: int, payload: LevelCreate, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")
    lvl = Level(venue_id=venue_id, **payload.model_dump())
    session.add(lvl)
    session.commit()
    session.refresh(lvl)
    return {"id": lvl.id, "name": lvl.name}


@app.post("/levels/{level_id}/sections")
def create_section(level_id: int, payload: SectionCreate, session: Session = Depends(_session)) -> dict:
    lvl = session.get(Level, level_id)
    if not lvl:
        raise HTTPException(status_code=404, detail="level not found")

    pts = [(float(x), float(y)) for (x, y) in payload.polygon.points]
    try:
        validate_polygon(pts, name="section polygon")
    except GeometryError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    geom = json.dumps([[x, y] for (x, y) in pts])
    s = Section(
        level_id=level_id,
        code=payload.code,
        geom_json=geom,
        seat_direction=payload.seat_direction,
        row_direction=payload.row_direction,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return {"id": s.id, "code": s.code}


@app.put("/sections/{section_id}")
def update_section(section_id: int, payload: SectionUpdate, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    pts = [(float(x), float(y)) for (x, y) in payload.polygon.points]
    try:
        validate_polygon(pts, name="section polygon")
    except GeometryError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    sec.geom_json = json.dumps([[x, y] for (x, y) in pts])
    if payload.seat_direction is not None:
        sec.seat_direction = payload.seat_direction
    if payload.row_direction is not None:
        sec.row_direction = payload.row_direction
    session.add(sec)
    session.commit()
    return {"updated": True}


@app.post("/sections/{section_id}/rows")
def create_row(section_id: int, payload: RowCreate, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    r = Row(
        section_id=section_id,
        label=payload.label,
        order_index=payload.order_index,
        geom_json=payload.path.model_dump_json(),
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    return {"id": r.id, "label": r.label}


@app.put("/rows/{row_id}")
def update_row(row_id: int, payload: RowUpdate, session: Session = Depends(_session)) -> dict:
    row = session.get(Row, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="row not found")
    if payload.label is not None:
        row.label = payload.label
    if payload.order_index is not None:
        row.order_index = payload.order_index
    if payload.path is not None:
        row.geom_json = payload.path.model_dump_json()
    session.add(row)
    session.commit()
    return {"updated": True}


@app.get("/rows/{row_id}/metrics", response_model=RowMetrics)
def row_metrics(row_id: int, session: Session = Depends(_session)) -> RowMetrics:
    row = session.get(Row, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="row not found")
    try:
        path = json.loads(row.geom_json)
        L = float(path_total_length(path))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    return RowMetrics(row_id=row_id, total_length_m=L)


@app.post("/rows/{row_id}/generate-seats")
def generate_seats(row_id: int, payload: GenerateSeatsRequest, session: Session = Depends(_session)) -> dict:
    row = session.get(Row, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="row not found")
    section = session.get(Section, row.section_id)
    if not section:
        raise HTTPException(status_code=404, detail="section not found")
    level = session.get(Level, section.level_id)
    if not level:
        raise HTTPException(status_code=404, detail="level not found")
    pitch = session.exec(select(Pitch).where(Pitch.venue_id == level.venue_id)).first()

    path = json.loads(row.geom_json)
    section_poly = [(float(x), float(y)) for [x, y] in json.loads(section.geom_json)]
    pitch_centroid = None
    if pitch:
        try:
            pitch_poly = [(float(x), float(y)) for [x, y] in json.loads(pitch.geom_json)]
            pitch_centroid = polygon_centroid(pitch_poly)
        except Exception:
            pitch_centroid = None

    try:
        points = seats_along_path(
            path,
            seat_pitch_m=payload.seat_pitch_m,
            start_offset_m=payload.start_offset_m,
            end_offset_m=payload.end_offset_m,
        )
    except (GeometryError, KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if payload.overwrite:
        session.exec(delete(Seat).where(Seat.row_id == row_id))
        session.commit()
    else:
        existing = session.exec(select(Seat).where(Seat.row_id == row_id).limit(1)).first()
        if existing:
            raise HTTPException(status_code=409, detail="row already has seats; use overwrite=true")

    created = 0
    seat_num = payload.seat_number_start
    for pt in points:
        if not polygon_contains_point(section_poly, pt.x, pt.y):
            continue
        facing = pt.tangent_deg
        if pitch_centroid is not None:
            facing = angle_deg(pt.x, pt.y, pitch_centroid[0], pitch_centroid[1])
        s = Seat(
            row_id=row_id,
            seat_number=seat_num,
            x_m=pt.x,
            y_m=pt.y,
            z_m=0.0,
            facing_deg=facing,
            seat_type=payload.seat_type,
        )
        session.add(s)
        seat_num += 1
        created += 1
    session.commit()
    return {"created": created}


@app.post("/sections/{section_id}/generate-seats")
def generate_seats_in_section(section_id: int, payload: GenerateSectionSeatsRequest, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    level = session.get(Level, sec.level_id)
    if not level:
        raise HTTPException(status_code=404, detail="level not found")
    pitch = session.exec(select(Pitch).where(Pitch.venue_id == level.venue_id)).first()

    section_poly = [(float(x), float(y)) for [x, y] in json.loads(sec.geom_json)]
    xs = [p[0] for p in section_poly]
    ys = [p[1] for p in section_poly]
    if not xs or not ys:
        raise HTTPException(status_code=400, detail="section polygon missing")
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    pitch_centroid = None
    if pitch:
        try:
            pitch_poly = [(float(x), float(y)) for [x, y] in json.loads(pitch.geom_json)]
            pitch_centroid = polygon_centroid(pitch_poly)
        except Exception:
            pitch_centroid = None

    # Overwrite: remove prior auto-generated grid rows (label starts with GRID-)
    if payload.overwrite:
        grid_rows = session.exec(select(Row).where(Row.section_id == section_id, Row.label.like("GRID-%"))).all()
        row_ids = [int(r.id) for r in grid_rows if r.id is not None]
        if row_ids:
            _delete_seats_for_row_ids(session, row_ids)
            session.exec(delete(Row).where(Row.id.in_(row_ids)))
            session.commit()

    seat_pitch = float(payload.seat_pitch_m)
    row_pitch = float(payload.row_pitch_m)
    margin = float(payload.margin_m)
    start_num = int(payload.seat_number_start)

    rows_created = 0
    seats_created = 0
    max_seats = int(payload.max_seats)

    # Pre-flight estimate (area-based) to avoid long loops + late failure.
    try:
        area = polygon_area_m2(section_poly)
        est = int(round(area / max(1e-9, seat_pitch * row_pitch)))
        if est > max_seats:
            raise HTTPException(
                status_code=400,
                detail=f"too many seats (estimated ~{est} > max_seats={max_seats}); increase pitch/row_pitch/margins or raise max_seats",
            )
    except GeometryError:
        # fall back to runtime checks
        pass

    # Iterate horizontal rows (y increases)
    y = min_y + margin
    row_idx = 0
    while y <= (max_y - margin) + 1e-9:
        pts_in_row: list[tuple[float, float]] = []
        x = min_x + margin
        while x <= (max_x - margin) + 1e-9:
            if polygon_contains_point(section_poly, x, y):
                pts_in_row.append((x, y))
            x += seat_pitch

        if pts_in_row:
            row_idx += 1
            label = f"GRID-{row_idx}"
            order_index = 1000 + row_idx
            # Simple geometry line for visualization/selection; seats are filtered by polygon anyway.
            path = {"segments": [{"type": "line", "x1": min_x, "y1": y, "x2": max_x, "y2": y}], "gaps": []}
            r = Row(section_id=section_id, label=label, order_index=order_index, geom_json=json.dumps(path))
            session.add(r)
            session.commit()
            session.refresh(r)
            rows_created += 1

            seat_num = start_num
            for (sx, sy) in pts_in_row:
                if seats_created >= max_seats:
                    raise HTTPException(
                        status_code=400,
                        detail=f"too many seats (>{max_seats}); increase pitch/row_pitch/margins or raise max_seats",
                    )
                facing = 0.0
                if pitch_centroid is not None:
                    facing = angle_deg(sx, sy, pitch_centroid[0], pitch_centroid[1])
                session.add(
                    Seat(
                        row_id=int(r.id),
                        seat_number=seat_num,
                        x_m=float(sx),
                        y_m=float(sy),
                        z_m=0.0,
                        facing_deg=float(facing),
                        seat_type=payload.seat_type,
                    )
                )
                seat_num += 1
                seats_created += 1
        y += row_pitch

    session.commit()
    return {"rows_created": rows_created, "seats_created": seats_created}


@app.put("/seats/types/bulk")
def bulk_update_seat_type(payload: SeatTypeBulkUpdate, session: Session = Depends(_session)) -> dict:
    seat_ids = sorted(set(int(x) for x in payload.seat_ids))
    seats = session.exec(select(Seat).where(Seat.id.in_(seat_ids))).all()
    found = {int(s.id) for s in seats if s.id is not None}
    missing = [sid for sid in seat_ids if sid not in found]
    if missing:
        raise HTTPException(status_code=404, detail={"message": "some seats not found", "missing_seat_ids": missing[:50]})
    updated = 0
    for s in seats:
        s.seat_type = payload.seat_type
        session.add(s)
        updated += 1
    session.commit()
    return {"updated": updated}


@app.post("/sections/{section_id}/seats/bulk")
def create_seats_bulk(section_id: int, payload: SeatBulkCreate, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    section_poly = [(float(x), float(y)) for [x, y] in json.loads(sec.geom_json)]

    first = payload.items[0]
    manual_row = _get_or_create_manual_row(session, section_id, near_x=float(first.x_m), near_y=float(first.y_m))

    # Determine starting seat number: max(existing in this manual row)+1, unless seat_number_start is higher.
    existing_max = session.exec(select(Seat.seat_number).where(Seat.row_id == int(manual_row.id)).order_by(Seat.seat_number.desc()).limit(1)).first()
    auto_next = int(existing_max or 0) + 1
    next_num = max(auto_next, int(payload.seat_number_start))

    created_ids: list[int] = []
    for it in payload.items:
        x = float(it.x_m)
        y = float(it.y_m)
        if payload.enforce_inside and not polygon_contains_point(section_poly, x, y):
            raise HTTPException(status_code=400, detail=f"seat point outside section polygon: ({x}, {y})")
        seat_number = int(it.seat_number) if it.seat_number is not None else next_num
        if it.seat_number is None:
            next_num += 1
        s = Seat(
            row_id=int(manual_row.id),
            seat_number=seat_number,
            x_m=x,
            y_m=y,
            z_m=float(it.z_m or 0.0),
            facing_deg=float(it.facing_deg or 0.0),
            seat_type=it.seat_type,
        )
        session.add(s)
        session.commit()
        session.refresh(s)
        created_ids.append(int(s.id))
    return {"created": len(created_ids), "seat_ids": created_ids, "row_id": int(manual_row.id)}


@app.put("/seats/{seat_id}")
def update_seat(seat_id: int, payload: SeatUpdate, session: Session = Depends(_session)) -> dict:
    seat = session.get(Seat, seat_id)
    if not seat:
        raise HTTPException(status_code=404, detail="seat not found")
    if payload.x_m is not None:
        seat.x_m = float(payload.x_m)
    if payload.y_m is not None:
        seat.y_m = float(payload.y_m)
    if payload.z_m is not None:
        seat.z_m = float(payload.z_m)
    if payload.facing_deg is not None:
        seat.facing_deg = float(payload.facing_deg)
    if payload.seat_type is not None:
        seat.seat_type = payload.seat_type
    if payload.seat_number is not None:
        seat.seat_number = int(payload.seat_number)
    session.add(seat)
    session.commit()
    return {"updated": True}


@app.delete("/seats/{seat_id}")
def delete_seat(seat_id: int, session: Session = Depends(_session)) -> dict:
    seat = session.get(Seat, seat_id)
    if not seat:
        raise HTTPException(status_code=404, detail="seat not found")
    _delete_seat_overrides_for_seat_ids(session, [int(seat_id)])
    session.delete(seat)
    session.commit()
    return {"deleted": True}


@app.post("/venues/{venue_id}/configs")
def create_config(venue_id: int, payload: ConfigCreate, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")
    c = Config(venue_id=venue_id, name=payload.name)
    session.add(c)
    session.commit()
    session.refresh(c)
    return {"id": c.id, "name": c.name}


@app.get("/venues/{venue_id}/configs")
def list_configs(venue_id: int, session: Session = Depends(_session)) -> list[dict]:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")
    cfgs = session.exec(select(Config).where(Config.venue_id == venue_id).order_by(Config.created_at.desc())).all()
    return [{"id": c.id, "name": c.name} for c in cfgs]


@app.delete("/configs/{config_id}")
def delete_config(config_id: int, session: Session = Depends(_session)) -> dict:
    cfg = session.get(Config, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="config not found")
    session.exec(delete(SeatOverride).where(SeatOverride.config_id == config_id))
    session.exec(delete(Config).where(Config.id == config_id))
    session.commit()
    return {"deleted": True}


@app.put("/configs/{config_id}/overrides")
def upsert_override(config_id: int, payload: SeatOverrideUpsert, session: Session = Depends(_session)) -> dict:
    cfg = session.get(Config, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="config not found")
    seat = session.get(Seat, payload.seat_id)
    if not seat:
        raise HTTPException(status_code=404, detail="seat not found")

    existing = session.get(SeatOverride, (config_id, payload.seat_id))

    # Treat "sellable with no notes" as clearing override.
    if payload.status == SeatStatus.sellable and (payload.notes or "") == "":
        if existing:
            session.delete(existing)
            session.commit()
            return {"deleted": True}
        return {"noop": True}

    if existing:
        existing.status = payload.status
        existing.notes = payload.notes
        session.add(existing)
        session.commit()
        return {"updated": True}

    o = SeatOverride(config_id=config_id, seat_id=payload.seat_id, status=payload.status, notes=payload.notes)
    session.add(o)
    session.commit()
    return {"created": True}


@app.put("/configs/{config_id}/overrides/bulk")
def bulk_upsert_overrides(config_id: int, payload: SeatOverrideBulkUpsert, session: Session = Depends(_session)) -> dict:
    cfg = session.get(Config, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="config not found")

    seat_ids = sorted(set(int(x) for x in payload.seat_ids))
    existing_seats = session.exec(select(Seat.id).where(Seat.id.in_(seat_ids))).all()
    existing_set = set(int(x) for x in existing_seats)
    missing = [x for x in seat_ids if x not in existing_set]
    if missing:
        raise HTTPException(status_code=404, detail={"message": "some seats not found", "missing_seat_ids": missing[:50]})

    # Clear overrides fast when marking sellable (default) with no notes
    if payload.status == SeatStatus.sellable and (payload.notes or "") == "":
        session.exec(delete(SeatOverride).where(SeatOverride.config_id == config_id, SeatOverride.seat_id.in_(seat_ids)))
        session.commit()
        return {"deleted": len(seat_ids)}

    existing = session.exec(
        select(SeatOverride).where(SeatOverride.config_id == config_id, SeatOverride.seat_id.in_(seat_ids))
    ).all()
    by_seat = {int(o.seat_id): o for o in existing}

    updated = 0
    created = 0
    for sid in seat_ids:
        o = by_seat.get(sid)
        if o:
            o.status = payload.status
            o.notes = payload.notes
            session.add(o)
            updated += 1
        else:
            session.add(SeatOverride(config_id=config_id, seat_id=sid, status=payload.status, notes=payload.notes))
            created += 1
    session.commit()
    return {"updated": updated, "created": created}


@app.put("/configs/{config_id}/overrides/batch")
def batch_upsert_overrides(config_id: int, payload: SeatOverrideBatchUpsert, session: Session = Depends(_session)) -> dict:
    """
    Apply mixed override statuses in one request (used for undo/redo).
    Semantics match single upsert: sellable + empty notes deletes override.
    """
    cfg = session.get(Config, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="config not found")

    seat_ids = sorted(set(int(it.seat_id) for it in payload.items))
    existing_seats = session.exec(select(Seat.id).where(Seat.id.in_(seat_ids))).all()
    existing_set = set(int(x) for x in existing_seats)
    missing = [x for x in seat_ids if x not in existing_set]
    if missing:
        raise HTTPException(status_code=404, detail={"message": "some seats not found", "missing_seat_ids": missing[:50]})

    existing = session.exec(
        select(SeatOverride).where(SeatOverride.config_id == config_id, SeatOverride.seat_id.in_(seat_ids))
    ).all()
    by_seat = {int(o.seat_id): o for o in existing}

    deleted = 0
    updated = 0
    created = 0
    for it in payload.items:
        sid = int(it.seat_id)
        status = it.status
        notes = it.notes or ""
        cur = by_seat.get(sid)

        if status == SeatStatus.sellable and notes == "":
            if cur:
                session.delete(cur)
                deleted += 1
            continue

        if cur:
            cur.status = status
            cur.notes = notes
            session.add(cur)
            updated += 1
        else:
            session.add(SeatOverride(config_id=config_id, seat_id=sid, status=status, notes=notes))
            created += 1

    session.commit()
    return {"deleted": deleted, "updated": updated, "created": created}


@app.get("/venues/{venue_id}/snapshot", response_model=Snapshot)
def venue_snapshot(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> Snapshot:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    pitch = session.exec(select(Pitch).where(Pitch.venue_id == venue_id)).first()
    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_ids = [l.id for l in levels if l.id is not None]

    sections = []
    if level_ids:
        sections = session.exec(select(Section).where(Section.level_id.in_(level_ids))).all()
    section_ids = [s.id for s in sections if s.id is not None]

    rows = []
    if section_ids:
        rows = session.exec(select(Row).where(Row.section_id.in_(section_ids))).all()
    row_ids = [r.id for r in rows if r.id is not None]

    seats = []
    if row_ids:
        seats = session.exec(select(Seat).where(Seat.row_id.in_(row_ids))).all()

    zones = []
    if section_ids:
        zones = session.exec(select(Zone).where(Zone.section_id.in_(section_ids))).all()

    overrides = []
    if config_id is not None:
        overrides = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()

    return Snapshot(
        venue_id=venue_id,
        config_id=config_id,
        venue=venue.model_dump(),
        pitch=pitch.model_dump() if pitch else None,
        levels=[l.model_dump() for l in levels],
        sections=[s.model_dump() for s in sections],
        rows=[r.model_dump() for r in rows],
        seats=[s.model_dump() for s in seats],
        zones=[z.model_dump() for z in zones],
        overrides=[o.model_dump() for o in overrides],
    )


@app.get("/venues/{venue_id}/seats.csv")
def export_seats_csv(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> Response:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_by_id = {int(l.id): l for l in levels if l.id is not None}
    sections = session.exec(select(Section).where(Section.level_id.in_(list(level_by_id.keys())))).all() if level_by_id else []
    section_by_id = {int(s.id): s for s in sections if s.id is not None}
    rows = session.exec(select(Row).where(Row.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []
    row_by_id = {int(r.id): r for r in rows if r.id is not None}
    seats = session.exec(select(Seat).where(Seat.row_id.in_(list(row_by_id.keys())))).all() if row_by_id else []

    overrides_by_seat: dict[int, SeatOverride] = {}
    if config_id is not None:
        cfg = session.get(Config, config_id)
        if not cfg or cfg.venue_id != venue_id:
            raise HTTPException(status_code=404, detail="config not found for this venue")
        ovs = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()
        overrides_by_seat = {int(o.seat_id): o for o in ovs}

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(
        [
            "venue",
            "config_id",
            "level",
            "section",
            "row",
            "seat",
            "seat_code",
            "seat_type",
            "status",
            "notes",
            "x_m",
            "y_m",
            "z_m",
            "facing_deg",
        ]
    )

    for s in seats:
        r = row_by_id.get(int(s.row_id))
        if not r:
            continue
        sec = section_by_id.get(int(r.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue

        o = overrides_by_seat.get(int(s.id)) if s.id is not None else None
        status = (o.status if o else SeatStatus.sellable).value
        notes = o.notes if o else ""
        seat_code = f"{lvl.name}-{sec.code}-{r.label}-{s.seat_number}"

        w.writerow(
            [
                venue.name,
                config_id or "",
                lvl.name,
                sec.code,
                r.label,
                s.seat_number,
                seat_code,
                getattr(s.seat_type, "value", str(s.seat_type)),
                status,
                notes,
                s.x_m,
                s.y_m,
                s.z_m,
                s.facing_deg,
            ]
        )

    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="venue_{venue_id}_seats.csv"'},
    )


@app.get("/venues/{venue_id}/zones.csv")
def export_zones_csv(venue_id: int, session: Session = Depends(_session)) -> Response:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_by_id = {int(l.id): l for l in levels if l.id is not None}
    sections = session.exec(select(Section).where(Section.level_id.in_(list(level_by_id.keys())))).all() if level_by_id else []
    section_by_id = {int(s.id): s for s in sections if s.id is not None}
    zones = session.exec(select(Zone).where(Zone.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["venue", "level", "section", "zone_id", "zone_name", "zone_type", "capacity", "polygon"])
    for z in zones:
        sec = section_by_id.get(int(z.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue
        w.writerow(
            [
                venue.name,
                lvl.name,
                sec.code,
                z.id,
                z.name,
                getattr(z.zone_type, "value", str(z.zone_type)),
                z.capacity,
                z.geom_json,
            ]
        )

    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="venue_{venue_id}_zones.csv"'},
    )


@app.get("/venues/{venue_id}/summary")
def venue_summary(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_ids = [int(l.id) for l in levels if l.id is not None]
    sections = session.exec(select(Section).where(Section.level_id.in_(level_ids))).all() if level_ids else []
    section_ids = [int(s.id) for s in sections if s.id is not None]
    rows = session.exec(select(Row).where(Row.section_id.in_(section_ids))).all() if section_ids else []
    row_ids = [int(r.id) for r in rows if r.id is not None]
    seats = session.exec(select(Seat.id).where(Seat.row_id.in_(row_ids))).all() if row_ids else []
    seat_ids = [int(x) for x in seats]

    zones = session.exec(select(Zone).where(Zone.section_id.in_(section_ids))).all() if section_ids else []
    standing_capacity = sum(int(z.capacity or 0) for z in zones)

    overrides_by_seat: dict[int, SeatOverride] = {}
    if config_id is not None:
        cfg = session.get(Config, config_id)
        if not cfg or cfg.venue_id != venue_id:
            raise HTTPException(status_code=404, detail="config not found for this venue")
        ovs = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()
        overrides_by_seat = {int(o.seat_id): o for o in ovs}

    total = len(seat_ids)
    sellable = 0
    blocked = 0
    kill = 0
    for sid in seat_ids:
        o = overrides_by_seat.get(sid)
        status = (o.status if o else SeatStatus.sellable).value
        if status == SeatStatus.blocked.value:
            blocked += 1
        elif status == SeatStatus.kill.value:
            kill += 1
        else:
            sellable += 1

    return {
        "venue_id": venue_id,
        "config_id": config_id,
        "seats_total": total,
        "seats_sellable": sellable,
        "seats_blocked": blocked,
        "seats_kill": kill,
        "standing_capacity": standing_capacity,
    }


@app.get("/venues/{venue_id}/summary-breakdown")
def venue_summary_breakdown(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_by_id = {int(l.id): l for l in levels if l.id is not None}
    sections = session.exec(select(Section).where(Section.level_id.in_(list(level_by_id.keys())))).all() if level_by_id else []
    section_by_id = {int(s.id): s for s in sections if s.id is not None}
    rows = session.exec(select(Row).where(Row.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []
    row_by_id = {int(r.id): r for r in rows if r.id is not None}
    seats = session.exec(select(Seat).where(Seat.row_id.in_(list(row_by_id.keys())))).all() if row_by_id else []
    zones = session.exec(select(Zone).where(Zone.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []

    overrides_by_seat: dict[int, SeatOverride] = {}
    if config_id is not None:
        cfg = session.get(Config, config_id)
        if not cfg or cfg.venue_id != venue_id:
            raise HTTPException(status_code=404, detail="config not found for this venue")
        ovs = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()
        overrides_by_seat = {int(o.seat_id): o for o in ovs}

    def init_counts() -> dict:
        return {"total": 0, "sellable": 0, "blocked": 0, "kill": 0, "standing_capacity": 0}

    by_level: dict[int, dict] = {lid: init_counts() for lid in level_by_id.keys()}
    by_section: dict[int, dict] = {sid: init_counts() for sid in section_by_id.keys()}

    for z in zones:
        sec_id = int(z.section_id)
        sec = section_by_id.get(sec_id)
        if not sec:
            continue
        lvl_id = int(sec.level_id)
        cap = int(z.capacity or 0)
        by_section[sec_id]["standing_capacity"] += cap
        by_level[lvl_id]["standing_capacity"] += cap

    for s in seats:
        r = row_by_id.get(int(s.row_id))
        if not r:
            continue
        sec = section_by_id.get(int(r.section_id))
        if not sec:
            continue
        lvl_id = int(sec.level_id)
        sec_id = int(sec.id)

        o = overrides_by_seat.get(int(s.id)) if s.id is not None else None
        status = (o.status if o else SeatStatus.sellable).value

        for bucket in (by_level[lvl_id], by_section[sec_id]):
            bucket["total"] += 1
            if status == SeatStatus.blocked.value:
                bucket["blocked"] += 1
            elif status == SeatStatus.kill.value:
                bucket["kill"] += 1
            else:
                bucket["sellable"] += 1

    return {
        "venue_id": venue_id,
        "config_id": config_id,
        "levels": [
            {"level_id": lid, "level_name": level_by_id[lid].name, **by_level[lid]} for lid in sorted(by_level.keys())
        ],
        "sections": [
            {
                "section_id": sid,
                "level_id": int(section_by_id[sid].level_id),
                "level_name": level_by_id[int(section_by_id[sid].level_id)].name,
                "section_code": section_by_id[sid].code,
                **by_section[sid],
            }
            for sid in sorted(by_section.keys(), key=lambda x: (int(section_by_id[x].level_id), str(section_by_id[x].code)))
        ],
    }


@app.get("/venues/{venue_id}/summary-breakdown.csv")
def venue_summary_breakdown_csv(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> Response:
    data = venue_summary_breakdown(venue_id=venue_id, config_id=config_id, session=session)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["record_type", "venue_id", "config_id", "level_id", "level_name", "section_id", "section_code", "total", "sellable", "blocked", "kill", "standing_capacity"])

    for lvl in data.get("levels", []):
        w.writerow(
            [
                "level",
                venue_id,
                config_id or "",
                lvl.get("level_id"),
                lvl.get("level_name"),
                "",
                "",
                lvl.get("total", 0),
                lvl.get("sellable", 0),
                lvl.get("blocked", 0),
                lvl.get("kill", 0),
                lvl.get("standing_capacity", 0),
            ]
        )

    for sec in data.get("sections", []):
        w.writerow(
            [
                "section",
                venue_id,
                config_id or "",
                sec.get("level_id"),
                sec.get("level_name"),
                sec.get("section_id"),
                sec.get("section_code"),
                sec.get("total", 0),
                sec.get("sellable", 0),
                sec.get("blocked", 0),
                sec.get("kill", 0),
                sec.get("standing_capacity", 0),
            ]
        )

    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="venue_{venue_id}_breakdown.csv"'},
    )


@app.get("/venues/{venue_id}/package")
def export_package(venue_id: int, config_id: Optional[int] = None, session: Session = Depends(_session)) -> dict:
    """
    Export a portable JSON package for this venue.
    IDs are included for reference, but import will remap them.
    """
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    pitch = session.exec(select(Pitch).where(Pitch.venue_id == venue_id)).first()
    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_ids = [l.id for l in levels if l.id is not None]
    sections = session.exec(select(Section).where(Section.level_id.in_(level_ids))).all() if level_ids else []
    section_ids = [s.id for s in sections if s.id is not None]
    rows = session.exec(select(Row).where(Row.section_id.in_(section_ids))).all() if section_ids else []
    row_ids = [r.id for r in rows if r.id is not None]
    seats = session.exec(select(Seat).where(Seat.row_id.in_(row_ids))).all() if row_ids else []
    zones = session.exec(select(Zone).where(Zone.section_id.in_(section_ids))).all() if section_ids else []

    configs = session.exec(select(Config).where(Config.venue_id == venue_id)).all()
    overrides = []
    if config_id is not None:
        overrides = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()
    else:
        cfg_ids = [c.id for c in configs if c.id is not None]
        overrides = session.exec(select(SeatOverride).where(SeatOverride.config_id.in_(cfg_ids))).all() if cfg_ids else []

    return {
        "version": 1,
        "venue": venue.model_dump(),
        "pitch": ({"polygon": json.loads(pitch.geom_json)} if pitch else None),
        "levels": [l.model_dump() for l in levels],
        "sections": [{**s.model_dump(), "polygon": json.loads(s.geom_json)} for s in sections],
        "rows": [{**r.model_dump(), "path": json.loads(r.geom_json)} for r in rows],
        "seats": [s.model_dump() for s in seats],
        "zones": [{**z.model_dump(), "polygon": json.loads(z.geom_json)} for z in zones],
        "configs": [c.model_dump() for c in configs],
        "overrides": [o.model_dump() for o in overrides],
    }


@app.post("/venues/import")
def import_package(payload: dict, session: Session = Depends(_session)) -> dict:
    """
    Import a portable JSON package created by /venues/{id}/package.
    Creates a NEW venue and remaps all IDs.
    """
    if int(payload.get("version", 0)) != 1:
        raise HTTPException(status_code=400, detail="unsupported package version")

    src_venue = payload.get("venue") or {}
    v = Venue(
        name=str(src_venue.get("name", "Imported venue")),
        origin_x_m=float(src_venue.get("origin_x_m", 0.0)),
        origin_y_m=float(src_venue.get("origin_y_m", 0.0)),
        bearing_deg=float(src_venue.get("bearing_deg", 0.0)),
    )
    session.add(v)
    session.commit()
    session.refresh(v)

    id_map_level: dict[int, int] = {}
    id_map_section: dict[int, int] = {}
    id_map_row: dict[int, int] = {}
    id_map_seat: dict[int, int] = {}
    id_map_config: dict[int, int] = {}
    id_map_zone: dict[int, int] = {}

    pitch = payload.get("pitch")
    if pitch and pitch.get("polygon"):
        p = Pitch(venue_id=v.id, geom_json=json.dumps(pitch["polygon"]))
        session.add(p)

    for lvl in payload.get("levels", []):
        old_id = int(lvl.get("id"))
        nl = Level(venue_id=v.id, name=str(lvl.get("name", "")), z_base_m=float(lvl.get("z_base_m", 0.0)))
        session.add(nl)
        session.commit()
        session.refresh(nl)
        id_map_level[old_id] = int(nl.id)

    for sec in payload.get("sections", []):
        old_id = int(sec.get("id"))
        old_level_id = int(sec.get("level_id"))
        ns = Section(
            level_id=id_map_level[old_level_id],
            code=str(sec.get("code", "")),
            geom_json=json.dumps(sec.get("polygon") or []),
            seat_direction=str(sec.get("seat_direction", "lr")),
            row_direction=str(sec.get("row_direction", "front_to_back")),
        )
        session.add(ns)
        session.commit()
        session.refresh(ns)
        id_map_section[old_id] = int(ns.id)

    for row in payload.get("rows", []):
        old_id = int(row.get("id"))
        old_section_id = int(row.get("section_id"))
        nr = Row(
            section_id=id_map_section[old_section_id],
            label=str(row.get("label", "")),
            order_index=int(row.get("order_index", 0)),
            geom_json=json.dumps(row.get("path") or {}),
        )
        session.add(nr)
        session.commit()
        session.refresh(nr)
        id_map_row[old_id] = int(nr.id)

    for seat in payload.get("seats", []):
        old_id = int(seat.get("id"))
        old_row_id = int(seat.get("row_id"))
        ns = Seat(
            row_id=id_map_row[old_row_id],
            seat_number=int(seat.get("seat_number")),
            x_m=float(seat.get("x_m")),
            y_m=float(seat.get("y_m")),
            z_m=float(seat.get("z_m", 0.0)),
            facing_deg=float(seat.get("facing_deg", 0.0)),
            seat_type=seat.get("seat_type", "standard"),
        )
        session.add(ns)
        session.commit()
        session.refresh(ns)
        id_map_seat[old_id] = int(ns.id)

    for cfg in payload.get("configs", []):
        old_id = int(cfg.get("id"))
        nc = Config(venue_id=v.id, name=str(cfg.get("name", "")))
        session.add(nc)
        session.commit()
        session.refresh(nc)
        id_map_config[old_id] = int(nc.id)

    for z in payload.get("zones", []):
        old_id = int(z.get("id"))
        old_section_id = int(z.get("section_id"))
        nz = Zone(
            section_id=id_map_section[old_section_id],
            name=str(z.get("name", "")),
            zone_type=z.get("zone_type", "standing"),
            capacity=int(z.get("capacity", 0)),
            geom_json=json.dumps(z.get("polygon") or []),
        )
        session.add(nz)
        session.commit()
        session.refresh(nz)
        id_map_zone[old_id] = int(nz.id)

    for ov in payload.get("overrides", []):
        old_cfg_id = int(ov.get("config_id"))
        old_seat_id = int(ov.get("seat_id"))
        no = SeatOverride(
            config_id=id_map_config[old_cfg_id],
            seat_id=id_map_seat[old_seat_id],
            status=ov.get("status", "sellable"),
            notes=str(ov.get("notes", "")),
        )
        session.add(no)

    session.commit()
    return {"venue_id": v.id}


@app.post("/sections/{section_id}/zones")
def create_zone(section_id: int, payload: ZoneCreate, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    pts = [(float(x), float(y)) for (x, y) in payload.polygon.points]
    try:
        validate_polygon(pts, name="zone polygon")
    except GeometryError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    z = Zone(
        section_id=section_id,
        name=payload.name,
        zone_type=payload.zone_type,
        capacity=payload.capacity,
        capacity_mode=payload.capacity_mode,
        density_per_m2=payload.density_per_m2,
        geom_json=json.dumps([[x, y] for (x, y) in pts]),
    )
    session.add(z)
    session.commit()
    session.refresh(z)
    return {"id": z.id, "name": z.name}


@app.put("/zones/{zone_id}")
def update_zone(zone_id: int, payload: ZoneUpdate, session: Session = Depends(_session)) -> dict:
    z = session.get(Zone, zone_id)
    if not z:
        raise HTTPException(status_code=404, detail="zone not found")
    if payload.name is not None:
        z.name = payload.name
    if payload.zone_type is not None:
        z.zone_type = payload.zone_type
    if payload.capacity is not None:
        z.capacity = payload.capacity
    if payload.capacity_mode is not None:
        z.capacity_mode = payload.capacity_mode
    if payload.density_per_m2 is not None:
        z.density_per_m2 = payload.density_per_m2
    if payload.polygon is not None:
        pts = [(float(x), float(y)) for (x, y) in payload.polygon.points]
        try:
            validate_polygon(pts, name="zone polygon")
        except GeometryError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        z.geom_json = json.dumps([[x, y] for (x, y) in pts])

    # Auto capacity sync (area × density)
    if z.capacity_mode == CapacityMode.auto:
        try:
            poly = [(float(x), float(y)) for [x, y] in json.loads(z.geom_json)]
            area = polygon_area_m2(poly)
            z.capacity = max(0, int(round(area * float(z.density_per_m2 or 0.0))))
        except Exception:
            pass
    session.add(z)
    session.commit()
    return {"updated": True}


@app.delete("/zones/{zone_id}")
def delete_zone(zone_id: int, session: Session = Depends(_session)) -> dict:
    z = session.get(Zone, zone_id)
    if not z:
        raise HTTPException(status_code=404, detail="zone not found")
    session.delete(z)
    session.commit()
    return {"deleted": True}


@app.delete("/rows/{row_id}")
def delete_row(row_id: int, session: Session = Depends(_session)) -> dict:
    row = session.get(Row, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="row not found")
    _delete_seats_for_row_ids(session, [int(row_id)])
    session.exec(delete(Row).where(Row.id == row_id))
    session.commit()
    return {"deleted": True}


@app.delete("/sections/{section_id}")
def delete_section(section_id: int, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")

    # zones
    session.exec(delete(Zone).where(Zone.section_id == section_id))

    # rows -> seats -> overrides
    row_ids = session.exec(select(Row.id).where(Row.section_id == section_id)).all()
    row_ids_int = [int(x) for x in row_ids if x is not None]
    _delete_seats_for_row_ids(session, row_ids_int)
    session.exec(delete(Row).where(Row.section_id == section_id))

    session.exec(delete(Section).where(Section.id == section_id))
    session.commit()
    return {"deleted": True}


@app.delete("/levels/{level_id}")
def delete_level(level_id: int, session: Session = Depends(_session)) -> dict:
    lvl = session.get(Level, level_id)
    if not lvl:
        raise HTTPException(status_code=404, detail="level not found")

    section_ids = session.exec(select(Section.id).where(Section.level_id == level_id)).all()
    section_ids_int = [int(x) for x in section_ids if x is not None]
    for sid in section_ids_int:
        delete_section(sid, session)

    session.exec(delete(Level).where(Level.id == level_id))
    session.commit()
    return {"deleted": True}


@app.delete("/venues/{venue_id}")
def delete_venue(venue_id: int, session: Session = Depends(_session)) -> dict:
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")

    # pitch
    session.exec(delete(Pitch).where(Pitch.venue_id == venue_id))

    # configs + overrides
    cfg_ids = session.exec(select(Config.id).where(Config.venue_id == venue_id)).all()
    cfg_ids_int = [int(x) for x in cfg_ids if x is not None]
    if cfg_ids_int:
        session.exec(delete(SeatOverride).where(SeatOverride.config_id.in_(cfg_ids_int)))
        session.exec(delete(Config).where(Config.id.in_(cfg_ids_int)))

    # levels -> sections -> rows -> seats -> overrides
    level_ids = session.exec(select(Level.id).where(Level.venue_id == venue_id)).all()
    level_ids_int = [int(x) for x in level_ids if x is not None]
    for lid in level_ids_int:
        delete_level(lid, session)

    session.exec(delete(Venue).where(Venue.id == venue_id))
    session.commit()
    return {"deleted": True}


@app.get("/zones/{zone_id}/metrics")
def zone_metrics(zone_id: int, session: Session = Depends(_session)) -> dict:
    z = session.get(Zone, zone_id)
    if not z:
        raise HTTPException(status_code=404, detail="zone not found")
    try:
        poly = [(float(x), float(y)) for [x, y] in json.loads(z.geom_json)]
        area = polygon_area_m2(poly)
        cx, cy = polygon_centroid(poly)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"zone_id": zone_id, "area_m2": area, "centroid": [cx, cy]}


@app.post("/zones/{zone_id}/compute-capacity")
def zone_compute_capacity(zone_id: int, payload: dict, session: Session = Depends(_session)) -> dict:
    """
    Compute capacity from polygon area × density (people / m^2),
    then persist the resulting capacity back to the zone.
    """
    z = session.get(Zone, zone_id)
    if not z:
        raise HTTPException(status_code=404, detail="zone not found")
    try:
        density = float(payload.get("density_per_m2"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid density_per_m2: {e}") from e
    if density < 0:
        raise HTTPException(status_code=400, detail="density_per_m2 must be >= 0")

    try:
        poly = [(float(x), float(y)) for [x, y] in json.loads(z.geom_json)]
        area = polygon_area_m2(poly)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    capacity = int(round(area * density))
    z.capacity = max(0, capacity)
    z.density_per_m2 = density
    session.add(z)
    session.commit()
    return {"zone_id": zone_id, "area_m2": area, "density_per_m2": density, "capacity": z.capacity}


@app.get("/venues/{venue_id}/manifest.csv")
def export_manifest_csv(venue_id: int, config_id: int, session: Session = Depends(_session)) -> Response:
    """
    Single CSV "event manifest" for a chosen config:
    - summary row
    - seats rows (effective status)
    - zones rows (standing capacity)
    """
    venue = session.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="venue not found")
    cfg = session.get(Config, config_id)
    if not cfg or cfg.venue_id != venue_id:
        raise HTTPException(status_code=404, detail="config not found for this venue")

    levels = session.exec(select(Level).where(Level.venue_id == venue_id)).all()
    level_by_id = {int(l.id): l for l in levels if l.id is not None}
    sections = session.exec(select(Section).where(Section.level_id.in_(list(level_by_id.keys())))).all() if level_by_id else []
    section_by_id = {int(s.id): s for s in sections if s.id is not None}
    rows = session.exec(select(Row).where(Row.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []
    row_by_id = {int(r.id): r for r in rows if r.id is not None}
    seats = session.exec(select(Seat).where(Seat.row_id.in_(list(row_by_id.keys())))).all() if row_by_id else []
    zones = session.exec(select(Zone).where(Zone.section_id.in_(list(section_by_id.keys())))).all() if section_by_id else []

    ovs = session.exec(select(SeatOverride).where(SeatOverride.config_id == config_id)).all()
    overrides_by_seat = {int(o.seat_id): o for o in ovs}

    # compute summary
    total = len(seats)
    sellable = blocked = kill = 0
    for s in seats:
        o = overrides_by_seat.get(int(s.id)) if s.id is not None else None
        status = (o.status if o else SeatStatus.sellable).value
        if status == SeatStatus.blocked.value:
            blocked += 1
        elif status == SeatStatus.kill.value:
            kill += 1
        else:
            sellable += 1
    standing_capacity = sum(int(z.capacity or 0) for z in zones)

    # breakdown maps
    by_level: dict[str, dict] = {}
    by_section: dict[str, dict] = {}
    for s in seats:
        r = row_by_id.get(int(s.row_id))
        if not r:
            continue
        sec = section_by_id.get(int(r.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue
        lvl_key = lvl.name
        sec_key = f"{lvl.name}/{sec.code}"
        by_level.setdefault(lvl_key, {"total": 0, "sellable": 0, "blocked": 0, "kill": 0, "standing_capacity": 0})
        by_section.setdefault(
            sec_key,
            {"level": lvl.name, "section": sec.code, "total": 0, "sellable": 0, "blocked": 0, "kill": 0, "standing_capacity": 0},
        )
        o = overrides_by_seat.get(int(s.id)) if s.id is not None else None
        status = (o.status if o else SeatStatus.sellable).value
        for bucket in (by_level[lvl_key], by_section[sec_key]):
            bucket["total"] += 1
            if status == SeatStatus.blocked.value:
                bucket["blocked"] += 1
            elif status == SeatStatus.kill.value:
                bucket["kill"] += 1
            else:
                bucket["sellable"] += 1

    for z in zones:
        sec = section_by_id.get(int(z.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue
        lvl_key = lvl.name
        sec_key = f"{lvl.name}/{sec.code}"
        by_level.setdefault(lvl_key, {"total": 0, "sellable": 0, "blocked": 0, "kill": 0, "standing_capacity": 0})
        by_section.setdefault(
            sec_key,
            {"level": lvl.name, "section": sec.code, "total": 0, "sellable": 0, "blocked": 0, "kill": 0, "standing_capacity": 0},
        )
        cap = int(z.capacity or 0)
        by_level[lvl_key]["standing_capacity"] += cap
        by_section[sec_key]["standing_capacity"] += cap

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(
        [
            "record_type",
            "venue",
            "config_id",
            "config_name",
            "level",
            "section",
            "row",
            "seat",
            "seat_code",
            "seat_type",
            "seat_status",
            "seat_notes",
            "x_m",
            "y_m",
            "z_m",
            "facing_deg",
            "zone_id",
            "zone_name",
            "zone_type",
            "zone_capacity",
            "zone_polygon",
            "seats_total",
            "seats_sellable",
            "seats_blocked",
            "seats_kill",
            "standing_capacity",
        ]
    )
    w.writerow(
        [
            "summary",
            venue.name,
            config_id,
            cfg.name,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            total,
            sellable,
            blocked,
            kill,
            standing_capacity,
        ]
    )

    # breakdown records
    for lvl_name in sorted(by_level.keys()):
        b = by_level[lvl_name]
        w.writerow(
            [
                "level_summary",
                venue.name,
                config_id,
                cfg.name,
                lvl_name,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                b["total"],
                b["sellable"],
                b["blocked"],
                b["kill"],
                b["standing_capacity"],
            ]
        )

    for sec_key in sorted(by_section.keys(), key=lambda k: (by_section[k]["level"], by_section[k]["section"])):
        b = by_section[sec_key]
        w.writerow(
            [
                "section_summary",
                venue.name,
                config_id,
                cfg.name,
                b["level"],
                b["section"],
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                b["total"],
                b["sellable"],
                b["blocked"],
                b["kill"],
                b["standing_capacity"],
            ]
        )

    for s in seats:
        r = row_by_id.get(int(s.row_id))
        if not r:
            continue
        sec = section_by_id.get(int(r.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue

        o = overrides_by_seat.get(int(s.id)) if s.id is not None else None
        status = (o.status if o else SeatStatus.sellable).value
        notes = o.notes if o else ""
        seat_code = f"{lvl.name}-{sec.code}-{r.label}-{s.seat_number}"
        w.writerow(
            [
                "seat",
                venue.name,
                config_id,
                cfg.name,
                lvl.name,
                sec.code,
                r.label,
                s.seat_number,
                seat_code,
                getattr(s.seat_type, "value", str(s.seat_type)),
                status,
                notes,
                s.x_m,
                s.y_m,
                s.z_m,
                s.facing_deg,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]
        )

    for z in zones:
        sec = section_by_id.get(int(z.section_id))
        if not sec:
            continue
        lvl = level_by_id.get(int(sec.level_id))
        if not lvl:
            continue
        w.writerow(
            [
                "zone",
                venue.name,
                config_id,
                cfg.name,
                lvl.name,
                sec.code,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                z.id,
                z.name,
                getattr(z.zone_type, "value", str(z.zone_type)),
                z.capacity,
                z.geom_json,
                "",
                "",
                "",
                "",
                "",
            ]
        )

    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": f'attachment; filename="venue_{venue_id}_config_{config_id}_manifest.csv"'},
    )

