export type Pt = { x: number; y: number }

export function dist(a: Pt, b: Pt): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export function pointOnArc(seg: { cx: number; cy: number; r: number; start_deg: number; end_deg: number; cw: boolean }, t01: number): Pt {
  const toRad = (d: number) => (d * Math.PI) / 180
  const norm = (r: number) => ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const s = norm(toRad(seg.start_deg))
  const e = norm(toRad(seg.end_deg))
  const cwDelta = (s: number, e: number) => (s - e + 2 * Math.PI) % (2 * Math.PI)
  const ccwDelta = (s: number, e: number) => (e - s + 2 * Math.PI) % (2 * Math.PI)
  const delta = seg.cw ? cwDelta(s, e) : ccwDelta(s, e)
  const t = Math.max(0, Math.min(1, t01))
  const ang = seg.cw ? norm(s - delta * t) : norm(s + delta * t)
  return { x: seg.cx + seg.r * Math.cos(ang), y: seg.cy + seg.r * Math.sin(ang) }
}

export function closestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const ab2 = abx * abx + aby * aby
  if (ab2 <= 1e-12) return a
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + abx * t, y: a.y + aby * t }
}

export function polygonCentroid(points: Array<[number, number]>): Pt | null {
  // polygon centroid formula; works for non-self-intersecting polygons
  if (points.length < 3) return null
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!
    const [x1, y1] = points[(i + 1) % points.length]!
    const a = x0 * y1 - x1 * y0
    area2 += a
    cx += (x0 + x1) * a
    cy += (y0 + y1) * a
  }
  if (Math.abs(area2) < 1e-12) return null
  const factor = 1 / (3 * area2)
  return { x: cx * factor, y: cy * factor }
}

export function polygonArea(points: Array<[number, number]>): number {
  if (points.length < 3) return 0
  let area2 = 0
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!
    const [x1, y1] = points[(i + 1) % points.length]!
    area2 += x0 * y1 - x1 * y0
  }
  return Math.abs(area2) / 2
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  // cross((b-a),(c-a))
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number, eps = 1e-9): boolean {
  return px >= Math.min(ax, bx) - eps && px <= Math.max(ax, bx) + eps && py >= Math.min(ay, by) - eps && py <= Math.max(ay, by) + eps
}

function segmentIntersectionPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  eps = 1e-9,
): [number, number] | null {
  // Proper intersection (non-parallel). Collinear/overlap returns null (we treat shared endpoints as ok).
  const rpx = bx - ax
  const rpy = by - ay
  const spx = dx - cx
  const spy = dy - cy

  const denom = rpx * spy - rpy * spx
  if (Math.abs(denom) < eps) return null

  const qpx = cx - ax
  const qpy = cy - ay
  const t = (qpx * spy - qpy * spx) / denom
  const u = (qpx * rpy - qpy * rpx) / denom

  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null

  return [ax + t * rpx, ay + t * rpy]
}

export function polygonSelfIntersection(points: Array<[number, number]>): [number, number] | null {
  // Returns an approximate intersection point if polygon edges self-intersect.
  const n = points.length
  if (n < 4) return null

  // edges: (i -> i+1), plus closing edge (n-1 -> 0)
  const get = (i: number) => points[(i + n) % n]!

  for (let i = 0; i < n; i++) {
    const [ax, ay] = get(i)
    const [bx, by] = get(i + 1)
    for (let j = i + 1; j < n; j++) {
      // skip adjacent edges and the wrap-around adjacency
      if (Math.abs(i - j) <= 1) continue
      if (i === 0 && j === n - 1) continue

      const [cx, cy] = get(j)
      const [dx, dy] = get(j + 1)

      // quick reject using orientation test + bounding
      const o1 = orient(ax, ay, bx, by, cx, cy)
      const o2 = orient(ax, ay, bx, by, dx, dy)
      const o3 = orient(cx, cy, dx, dy, ax, ay)
      const o4 = orient(cx, cy, dx, dy, bx, by)
      const eps = 1e-9

      const general = (o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)
      const general2 = (o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps)

      let intersects = general && general2

      // handle touching (rare with snapping but possible)
      if (!intersects) {
        if (Math.abs(o1) <= eps && onSegment(ax, ay, bx, by, cx, cy)) intersects = true
        else if (Math.abs(o2) <= eps && onSegment(ax, ay, bx, by, dx, dy)) intersects = true
        else if (Math.abs(o3) <= eps && onSegment(cx, cy, dx, dy, ax, ay)) intersects = true
        else if (Math.abs(o4) <= eps && onSegment(cx, cy, dx, dy, bx, by)) intersects = true
      }

      if (!intersects) continue

      const p = segmentIntersectionPoint(ax, ay, bx, by, cx, cy, dx, dy)
      return p ?? [cx, cy]
    }
  }
  return null
}

// Create an arc segment from 3 points (start, mid, end).
// Returns null if the points are collinear / circle can't be determined.
export function arcFrom3Points(a: Pt, b: Pt, c: Pt):
  | { cx: number; cy: number; r: number; start_deg: number; end_deg: number; cw: boolean }
  | null {
  const ax = a.x,
    ay = a.y
  const bx = b.x,
    by = b.y
  const cx = c.x,
    cy = c.y

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return null

  const ax2ay2 = ax * ax + ay * ay
  const bx2by2 = bx * bx + by * by
  const cx2cy2 = cx * cx + cy * cy

  const ux = (ax2ay2 * (by - cy) + bx2by2 * (cy - ay) + cx2cy2 * (ay - by)) / d
  const uy = (ax2ay2 * (cx - bx) + bx2by2 * (ax - cx) + cx2cy2 * (bx - ax)) / d

  const r = Math.hypot(ax - ux, ay - uy)
  const start = (Math.atan2(ay - uy, ax - ux) * 180) / Math.PI
  const end = (Math.atan2(cy - uy, cx - ux) * 180) / Math.PI
  const mid = (Math.atan2(by - uy, bx - ux) * 180) / Math.PI

  // Decide cw/ccw so the arc from start->end passes through mid.
  const norm = (deg: number) => ((deg % 360) + 360) % 360
  const s = norm(start)
  const e = norm(end)
  const m = norm(mid)

  const ccwDelta = (s: number, e: number) => (e - s + 360) % 360
  const cwDelta = (s: number, e: number) => (s - e + 360) % 360

  const inCCW = ccwDelta(s, m) <= ccwDelta(s, e)
  const inCW = cwDelta(s, m) <= cwDelta(s, e)

  // Prefer the direction that includes midpoint.
  const cw = inCW && !inCCW ? true : !inCW && inCCW ? false : ccwDelta(s, e) > cwDelta(s, e)

  return { cx: ux, cy: uy, r, start_deg: start, end_deg: end, cw }
}

