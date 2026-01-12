import { Paper, Text } from '@mantine/core'
import { useMemo, useRef, useState } from 'react'

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

function boundsFromPolys(polys: Array<Array<[number, number]>>): Bounds | null {
  const pts = polys.flat()
  if (!pts.length) return null
  let minX = pts[0]![0]
  let minY = pts[0]![1]
  let maxX = pts[0]![0]
  let maxY = pts[0]![1]
  for (const [x, y] of pts) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

export function MiniMap(props: {
  width?: number
  height?: number
  pitchPoints: Array<[number, number]> | null
  sectionPolys: Array<Array<[number, number]>>
  // main view info
  viewW: number
  viewH: number
  pan: { x: number; y: number }
  scale: number
  onCenterWorld: (x: number, y: number) => void
}) {
  const w = props.width ?? 190
  const h = props.height ?? 190

  const bounds = useMemo(() => {
    const polys: Array<Array<[number, number]>> = []
    if (props.sectionPolys.length) polys.push(...props.sectionPolys)
    if (props.pitchPoints?.length) polys.push(props.pitchPoints)
    const b = boundsFromPolys(polys) ?? { minX: -10, minY: -10, maxX: 10, maxY: 10 }
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY)
    return padBounds(b, Math.max(1, span * 0.05))
  }, [props.sectionPolys, props.pitchPoints])

  const map = useMemo(() => {
    const spanX = Math.max(1e-6, bounds.maxX - bounds.minX)
    const spanY = Math.max(1e-6, bounds.maxY - bounds.minY)
    const sx = w / spanX
    const sy = h / spanY
    const s = Math.min(sx, sy)
    const ox = (w - spanX * s) / 2
    const oy = (h - spanY * s) / 2
    const worldToMini = (x: number, y: number) => ({
      x: ox + (x - bounds.minX) * s,
      y: oy + (y - bounds.minY) * s,
    })
    const miniToWorld = (x: number, y: number) => ({
      x: bounds.minX + (x - ox) / s,
      y: bounds.minY + (y - oy) / s,
    })
    return { s, ox, oy, worldToMini, miniToWorld }
  }, [bounds, w, h])

  const viewRect = useMemo(() => {
    // current visible world rect
    const left = (-props.pan.x) / props.scale
    const top = (-props.pan.y) / props.scale
    const right = (props.viewW - props.pan.x) / props.scale
    const bottom = (props.viewH - props.pan.y) / props.scale
    const a = map.worldToMini(left, top)
    const b = map.worldToMini(right, bottom)
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    }
  }, [props.pan, props.scale, props.viewW, props.viewH, map])

  const polyToPath = (poly: Array<[number, number]>) => {
    if (!poly.length) return ''
    const p0 = map.worldToMini(poly[0]![0], poly[0]![1])
    const parts = [`M ${p0.x} ${p0.y}`]
    for (let i = 1; i < poly.length; i++) {
      const p = map.worldToMini(poly[i]![0], poly[i]![1])
      parts.push(`L ${p.x} ${p.y}`)
    }
    parts.push('Z')
    return parts.join(' ')
  }

  const draggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const [, setDragPos] = useState<{ x: number; y: number } | null>(null)

  const panToClient = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const world = map.miniToWorld(mx, my)
    props.onCenterWorld(world.x, world.y)
  }

  return (
    <Paper
      shadow="md"
      radius="md"
      p="xs"
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 10,
        width: w + 16,
      }}
    >
      <Text size="xs" c="dimmed" mb={6}>
        Mini-map (click to pan)
      </Text>
      <svg
        width={w}
        height={h}
        style={{ display: 'block', borderRadius: 8, cursor: 'pointer' }}
        onMouseDown={(e) => {
          draggingRef.current = true
          setDragPos({ x: e.clientX, y: e.clientY })
          panToClient(e.clientX, e.clientY, e.currentTarget)
        }}
        onMouseMove={(e) => {
          if (!draggingRef.current) return
          setDragPos({ x: e.clientX, y: e.clientY })
          if (rafRef.current) return
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            if (!draggingRef.current) return
            panToClient(e.clientX, e.clientY, e.currentTarget)
          })
        }}
        onMouseUp={() => {
          draggingRef.current = false
          setDragPos(null)
        }}
        onMouseLeave={() => {
          draggingRef.current = false
          setDragPos(null)
        }}
        onClick={(e) => {
          // click-to-pan (still supported)
          panToClient(e.clientX, e.clientY, e.currentTarget)
        }}
      >
        <rect x={0} y={0} width={w} height={h} fill="rgba(15, 23, 42, 0.35)" />

        {props.pitchPoints?.length ? (
          <path d={polyToPath(props.pitchPoints)} fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.65)" strokeWidth={1} />
        ) : null}

        {props.sectionPolys.map((poly, idx) => (
          <path key={`sec-${idx}`} d={polyToPath(poly)} fill="rgba(148,163,184,0.06)" stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
        ))}

        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.w}
          height={viewRect.h}
          fill="rgba(167,139,250,0.08)"
          stroke="rgba(167,139,250,0.85)"
          strokeWidth={1.5}
        />
      </svg>
    </Paper>
  )
}

