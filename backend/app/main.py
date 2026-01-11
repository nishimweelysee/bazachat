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
from .geometry import GeometryError, angle_deg, path_total_length, polygon_centroid, polygon_contains_point, seats_along_path
from .models import Config, Level, Pitch, Row, Seat, SeatOverride, Section, SeatStatus, Venue, Zone
from .schemas import (
    ConfigCreate,
    GenerateSeatsRequest,
    LevelCreate,
    PitchUpsert,
    RowCreate,
    RowMetrics,
    RowUpdate,
    SeatOverrideUpsert,
    SeatOverrideBulkUpsert,
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


@app.put("/sections/{section_id}")
def update_section(section_id: int, payload: SectionUpdate, session: Session = Depends(_session)) -> dict:
    sec = session.get(Section, section_id)
    if not sec:
        raise HTTPException(status_code=404, detail="section not found")
    sec.geom_json = json.dumps([[x, y] for (x, y) in payload.polygon.points])
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
    z = Zone(
        section_id=section_id,
        name=payload.name,
        zone_type=payload.zone_type,
        capacity=payload.capacity,
        geom_json=json.dumps([[x, y] for (x, y) in payload.polygon.points]),
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
    if payload.polygon is not None:
        z.geom_json = json.dumps([[x, y] for (x, y) in payload.polygon.points])
    session.add(z)
    session.commit()
    return {"updated": True}

