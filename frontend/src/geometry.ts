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

