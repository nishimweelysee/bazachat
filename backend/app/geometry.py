from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Literal, TypedDict

from shapely.geometry import Point, Polygon as ShapelyPolygon


class GeometryError(Exception):
    pass


def polygon_contains_point(poly_points: list[tuple[float, float]], x: float, y: float) -> bool:
    if len(poly_points) < 3:
        return False
    # close polygon if needed
    pts = poly_points
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    return ShapelyPolygon(pts).contains(Point(x, y))


@dataclass(frozen=True)
class EvalResult:
    x: float
    y: float
    tangent_deg: float


def _deg_to_rad(d: float) -> float:
    return d * math.pi / 180.0


def _rad_to_deg(r: float) -> float:
    return r * 180.0 / math.pi


def _norm_angle_rad(a: float) -> float:
    # normalize to [0, 2pi)
    t = a % (2 * math.pi)
    return t


def _cw_delta(start: float, end: float) -> float:
    # positive delta when moving clockwise from start to end
    # cw means decreasing angle; delta is (start - end) wrapped
    return (start - end) % (2 * math.pi)


def _ccw_delta(start: float, end: float) -> float:
    return (end - start) % (2 * math.pi)


def line_length(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def arc_length(r: float, start_deg: float, end_deg: float, cw: bool) -> float:
    s = _deg_to_rad(start_deg)
    e = _deg_to_rad(end_deg)
    delta = _cw_delta(s, e) if cw else _ccw_delta(s, e)
    return r * delta


def eval_line_at(x1: float, y1: float, x2: float, y2: float, dist: float) -> EvalResult:
    L = line_length(x1, y1, x2, y2)
    if L <= 0:
        raise GeometryError("zero-length line segment")
    t = dist / L
    t = max(0.0, min(1.0, t))
    x = x1 + (x2 - x1) * t
    y = y1 + (y2 - y1) * t
    tangent = _rad_to_deg(math.atan2(y2 - y1, x2 - x1))
    return EvalResult(x=x, y=y, tangent_deg=tangent)


def eval_arc_at(cx: float, cy: float, r: float, start_deg: float, end_deg: float, cw: bool, dist: float) -> EvalResult:
    s = _deg_to_rad(start_deg)
    e = _deg_to_rad(end_deg)
    delta = _cw_delta(s, e) if cw else _ccw_delta(s, e)
    L = r * delta
    if L <= 0:
        raise GeometryError("zero-length arc segment")
    t = max(0.0, min(1.0, dist / L))
    if cw:
        ang = _norm_angle_rad(s - delta * t)
        tangent = _rad_to_deg(ang - math.pi / 2.0)
    else:
        ang = _norm_angle_rad(s + delta * t)
        tangent = _rad_to_deg(ang + math.pi / 2.0)
    x = cx + r * math.cos(ang)
    y = cy + r * math.sin(ang)
    return EvalResult(x=x, y=y, tangent_deg=tangent)


def path_total_length(path: dict) -> float:
    total = 0.0
    for seg in path.get("segments", []):
        t = seg.get("type")
        if t == "line":
            total += line_length(seg["x1"], seg["y1"], seg["x2"], seg["y2"])
        elif t == "arc":
            total += arc_length(seg["r"], seg["start_deg"], seg["end_deg"], bool(seg.get("cw", True)))
        else:
            raise GeometryError(f"unknown segment type: {t}")
    return total


def eval_path_at_distance(path: dict, dist: float) -> EvalResult:
    if dist < 0:
        dist = 0
    remaining = dist
    for seg in path.get("segments", []):
        t = seg.get("type")
        if t == "line":
            L = line_length(seg["x1"], seg["y1"], seg["x2"], seg["y2"])
            if remaining <= L:
                return eval_line_at(seg["x1"], seg["y1"], seg["x2"], seg["y2"], remaining)
            remaining -= L
        elif t == "arc":
            L = arc_length(seg["r"], seg["start_deg"], seg["end_deg"], bool(seg.get("cw", True)))
            if remaining <= L:
                return eval_arc_at(
                    seg["cx"],
                    seg["cy"],
                    seg["r"],
                    seg["start_deg"],
                    seg["end_deg"],
                    bool(seg.get("cw", True)),
                    remaining,
                )
            remaining -= L
        else:
            raise GeometryError(f"unknown segment type: {t}")
    # Clamp to end
    # Evaluate at very end by walking again and returning last segment end.
    last = None
    for seg in path.get("segments", []):
        last = seg
    if last is None:
        raise GeometryError("path has no segments")
    if last["type"] == "line":
        return eval_line_at(last["x1"], last["y1"], last["x2"], last["y2"], line_length(last["x1"], last["y1"], last["x2"], last["y2"]))
    return eval_arc_at(last["cx"], last["cy"], last["r"], last["start_deg"], last["end_deg"], bool(last.get("cw", True)), arc_length(last["r"], last["start_deg"], last["end_deg"], bool(last.get("cw", True))))


def seats_along_path(
    path: dict,
    *,
    seat_pitch_m: float,
    start_offset_m: float,
    end_offset_m: float,
) -> list[EvalResult]:
    L = path_total_length(path)
    usable = L - start_offset_m - end_offset_m
    if usable <= 0:
        return []
    out: list[EvalResult] = []
    d = start_offset_m
    while d <= (L - end_offset_m) + 1e-9:
        out.append(eval_path_at_distance(path, d))
        d += seat_pitch_m
    return out

