from __future__ import annotations

import json
import math
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, delete, select

from .db import get_session, init_db
from .geometry import GeometryError, polygon_contains_point, seats_along_path
from .models import Config, Level, Pitch, Row, Seat, SeatOverride, Section, SeatStatus, Venue
from .schemas import (
    ConfigCreate,
    GenerateSeatsRequest,
    LevelCreate,
    PitchUpsert,
    RowCreate,
    SeatOverrideUpsert,
    SectionCreate,
    Snapshot,
    VenueCreate,
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

    geom = json.dumps([[x, y] for (x, y) in payload.polygon.points])
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

    geom = json.dumps([[x, y] for (x, y) in payload.polygon.points])
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


@app.post("/rows/{row_id}/generate-seats")
def generate_seats(row_id: int, payload: GenerateSeatsRequest, session: Session = Depends(_session)) -> dict:
    row = session.get(Row, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="row not found")
    section = session.get(Section, row.section_id)
    if not section:
        raise HTTPException(status_code=404, detail="section not found")

    path = json.loads(row.geom_json)
    section_poly = [(float(x), float(y)) for [x, y] in json.loads(section.geom_json)]

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
        s = Seat(
            row_id=row_id,
            seat_number=seat_num,
            x_m=pt.x,
            y_m=pt.y,
            z_m=0.0,
            facing_deg=pt.tangent_deg,
            seat_type=payload.seat_type,
        )
        session.add(s)
        seat_num += 1
        created += 1
    session.commit()
    return {"created": created}


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


@app.put("/configs/{config_id}/overrides")
def upsert_override(config_id: int, payload: SeatOverrideUpsert, session: Session = Depends(_session)) -> dict:
    cfg = session.get(Config, config_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="config not found")
    seat = session.get(Seat, payload.seat_id)
    if not seat:
        raise HTTPException(status_code=404, detail="seat not found")

    existing = session.get(SeatOverride, (config_id, payload.seat_id))
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
        overrides=[o.model_dump() for o in overrides],
    )

