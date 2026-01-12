import { useMemo } from 'react'
import { Circle, Layer, Line, Rect, Stage, Text as KText } from 'react-konva'
import type { Id, PathSeg } from '../api'
import { CanvasControls } from './CanvasControls'
import { polygonCentroid } from '../geometry'
import { MiniMap } from './MiniMap'
import { SelectionToolbar } from './SelectionToolbar'

function toPoints(arr: Array<[number, number]>): number[] {
  const out: number[] = []
  for (const [x, y] of arr) out.push(x, y)
  return out
}

function sampleArc(seg: { cx: number; cy: number; r: number; start_deg: number; end_deg: number; cw: boolean }, steps = 48): Array<[number, number]> {
  const toRad = (d: number) => (d * Math.PI) / 180
  const norm = (r: number) => ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const s = norm(toRad(seg.start_deg))
  const e = norm(toRad(seg.end_deg))
  const cwDelta = (s: number, e: number) => (s - e + 2 * Math.PI) % (2 * Math.PI)
  const ccwDelta = (s: number, e: number) => (e - s + 2 * Math.PI) % (2 * Math.PI)
  const delta = seg.cw ? cwDelta(s, e) : ccwDelta(s, e)

  const pts: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const ang = seg.cw ? norm(s - delta * t) : norm(s + delta * t)
    pts.push([seg.cx + seg.r * Math.cos(ang), seg.cy + seg.r * Math.sin(ang)])
  }
  return pts
}

export function CanvasView(props: {
  stageRef: any
  stageW: number
  stageH: number

  tool: string
  scale: number
  pan: { x: number; y: number }
  setPan: (p: { x: number; y: number }) => void

  onZoomIn: () => void
  onZoomOut: () => void
  onScaleChange: (v: number) => void
  onFitVenue: () => void
  onFitSelection: () => void
  onResetView: () => void

  onStageClick: (e: any) => void
  onStageDblClick: (e: any) => void
  onWheel: (e: any) => void
  onMouseDown: (e: any) => void
  onMouseMove: (e: any) => void
  onMouseUp: (e: any) => void

  gridStep: number

  pitchPoints: Array<[number, number]> | null
  draftPts: Array<{ x: number; y: number }>
  draftZonePts: Array<{ x: number; y: number }>
  draftRowPts: Array<{ x: number; y: number }>
  draftArcPts: Array<{ x: number; y: number }>
  cursorWorld: { x: number; y: number } | null
  draftPolygonInvalid: boolean
  draftZoneInvalid: boolean
  draftSeatDots: Array<{ x: number; y: number }>
  draftSeatPath: Array<{ x: number; y: number }>
  seatDragEnabled: boolean
  onSeatDragEnd: (seatId: Id, x: number, y: number) => void

  sections: any[]
  zones: any[]
  rows: any[]
  seats: any[]

  activeSectionId: Id | null
  activeRowId: Id | null
  selectedZoneId: Id | null
  selectedSeatIds: Set<Id>

  hoverSeatInfo: { code: string; x: number; y: number } | null
  onSeatHover: (seatId: Id | null) => void

  // click handlers
  onSelectSection: (levelId: Id, sectionId: Id) => void
  onSelectZone: (zoneId: Id) => void
  onSelectRow: (sectionId: Id, rowId: Id) => void
  onSelectSeat: (seatId: Id) => void
  seatColor: (seatId: Id) => string

  // edit handles
  activeSectionPoints: Array<[number, number]> | null
  onDragSectionPoint: (idx: number, x: number, y: number) => void
  selectedZonePoints: Array<[number, number]> | null
  onDragZonePoint: (idx: number, x: number, y: number) => void
  activeRowLineVertices: Array<[number, number]> | null
  onDragRowVertex: (idx: number, x: number, y: number) => void
  activeArcHandlePoints: Array<{ x: number; y: number }> | null
  onDragArcHandle: (idx: number, x: number, y: number) => void

  // selection rectangle
  selecting: boolean
  selStart: { x: number; y: number } | null
  selEnd: { x: number; y: number } | null

  // selection toolbar
  showSelectionToolbar: boolean
  selectedSeatsCount: number
  configSelected: boolean
  onBlockSelected: () => void
  onKillSelected: () => void
  onClearOverridesSelected: () => void
  onClearSelection: () => void

  // minimap
  showMiniMap: boolean
  onCenterWorld: (x: number, y: number) => void
}) {
  const dash = useMemo(() => [0.45, 0.35] as number[], [])

  const gridLines = useMemo(() => {
    const step = Math.max(0.5, props.gridStep * 10)
    const lines: any[] = []
    const w = 200
    const h = 200
    for (let x = -w; x <= w; x += step) lines.push(<Line key={`gx-${x}`} points={[x, -h, x, h]} stroke="rgba(148,163,184,0.08)" strokeWidth={0.02} />)
    for (let y = -h; y <= h; y += step) lines.push(<Line key={`gy-${y}`} points={[-w, y, w, y]} stroke="rgba(148,163,184,0.08)" strokeWidth={0.02} />)
    return lines
  }, [props.gridStep])

  return (
    <div ref={props.stageRef} style={{ width: '100%', height: 'calc(100vh - 120px)', position: 'relative' }}>
      <CanvasControls
        tool={props.tool}
        scale={props.scale}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        onScaleChange={props.onScaleChange}
        onFitVenue={props.onFitVenue}
        onFitSelection={props.onFitSelection}
        onResetView={props.onResetView}
      />

      <SelectionToolbar
        visible={props.showSelectionToolbar}
        selectedSeats={props.selectedSeatsCount}
        configSelected={props.configSelected}
        onFitSelection={props.onFitSelection}
        onClearSelection={props.onClearSelection}
        onBlockSelected={props.onBlockSelected}
        onKillSelected={props.onKillSelected}
        onClearOverridesSelected={props.onClearOverridesSelected}
      />

      {props.showMiniMap && (
        <MiniMap
          pitchPoints={props.pitchPoints}
          sectionPolys={props.sections.map((s) => {
            try {
              return JSON.parse(s.geom_json as string) as Array<[number, number]>
            } catch {
              return []
            }
          })}
          viewW={Math.max(300, props.stageW)}
          viewH={Math.max(300, props.stageH)}
          pan={props.pan}
          scale={props.scale}
          onCenterWorld={props.onCenterWorld}
        />
      )}

      <Stage
        width={Math.max(300, props.stageW)}
        height={Math.max(300, props.stageH)}
        onClick={props.onStageClick}
        onDblClick={props.onStageDblClick}
        onWheel={props.onWheel}
        onMouseDown={props.onMouseDown}
        onMouseMove={props.onMouseMove}
        onMouseUp={props.onMouseUp}
        draggable={props.tool === 'select'}
        x={props.pan.x}
        y={props.pan.y}
        scaleX={props.scale}
        scaleY={props.scale}
        onDragEnd={(e) => props.setPan({ x: e.target.x(), y: e.target.y() })}
      >
        <Layer>
          {gridLines}

          {props.pitchPoints && <Line points={toPoints(props.pitchPoints)} closed stroke="#22c55e" strokeWidth={2} />}
          {/* Draft previews (dashed) */}
          {props.draftPts.length >= 1 && (
            <Line
              points={toPoints(
                props.cursorWorld ? [...props.draftPts.map((p) => [p.x, p.y] as [number, number]), [props.cursorWorld.x, props.cursorWorld.y]] : props.draftPts.map((p) => [p.x, p.y]),
              )}
              stroke={props.draftPolygonInvalid ? '#fb7185' : '#a78bfa'}
              strokeWidth={2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {(props.tool === 'draw-pitch' || props.tool === 'draw-section') && props.cursorWorld && props.draftPts.length >= 2 && (
            <Line
              points={[props.draftPts[0]!.x, props.draftPts[0]!.y, props.cursorWorld.x, props.cursorWorld.y]}
              stroke={props.draftPolygonInvalid ? 'rgba(251, 113, 133, 0.7)' : 'rgba(167, 139, 250, 0.55)'}
              strokeWidth={1.2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {props.draftZonePts.length >= 1 && (
            <Line
              points={toPoints(
                props.cursorWorld
                  ? [...props.draftZonePts.map((p) => [p.x, p.y] as [number, number]), [props.cursorWorld.x, props.cursorWorld.y]]
                  : props.draftZonePts.map((p) => [p.x, p.y]),
              )}
              stroke={props.draftZoneInvalid ? '#fb7185' : '#34d399'}
              strokeWidth={2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {props.tool === 'draw-zone' && props.cursorWorld && props.draftZonePts.length >= 2 && (
            <Line
              points={[props.draftZonePts[0]!.x, props.draftZonePts[0]!.y, props.cursorWorld.x, props.cursorWorld.y]}
              stroke={props.draftZoneInvalid ? 'rgba(251, 113, 133, 0.7)' : 'rgba(52, 211, 153, 0.55)'}
              strokeWidth={1.2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {props.sections.map((s) => {
            const pts = JSON.parse(s.geom_json as string) as Array<[number, number]>
            const isActive = props.activeSectionId === (s.id as Id)
            return (
              <Line
                key={`sec-${s.id}`}
                points={toPoints(pts)}
                closed
                stroke={isActive ? '#60a5fa' : '#334155'}
                fill={isActive ? 'rgba(96, 165, 250, 0.08)' : 'rgba(51, 65, 85, 0.05)'}
                strokeWidth={isActive ? 2.5 : 1.5}
                onClick={(e) => {
                  e.cancelBubble = true
                  props.onSelectSection(s.level_id as Id, s.id as Id)
                }}
              />
            )
          })}

          {props.zones.map((z) => {
            const pts = JSON.parse(z.geom_json as string) as Array<[number, number]>
            const isActive = props.selectedZoneId === (z.id as Id)
            const centroid = polygonCentroid(pts)
            return (
              <>
                <Line
                  key={`zone-${z.id}`}
                  points={toPoints(pts)}
                  closed
                  stroke={isActive ? '#86efac' : '#34d399'}
                  fill="rgba(52, 211, 153, 0.15)"
                  strokeWidth={isActive ? 2.5 : 1.5}
                  onClick={(e) => {
                    e.cancelBubble = true
                    props.onSelectZone(z.id as Id)
                  }}
                />
                {centroid && (
                  <KText
                    key={`zone-label-${z.id}`}
                    x={centroid.x}
                    y={centroid.y}
                    text={`${z.name} (${z.capacity})`}
                    fontSize={0.35}
                    fill="#a7f3d0"
                  />
                )}
              </>
            )
          })}

          {/* Active zone vertex handles */}
          {props.tool === 'select' &&
            props.selectedZoneId &&
            props.selectedZonePoints?.map((p, idx) => (
              <Circle
                key={`zone-h-${idx}`}
                x={p[0]}
                y={p[1]}
                radius={0.22}
                fill="#34d399"
                draggable
                onDragEnd={(e) => props.onDragZonePoint(idx, e.target.x(), e.target.y())}
              />
            ))}

          {props.draftRowPts.length >= 1 && (
            <Line
              points={toPoints(
                props.cursorWorld
                  ? [...props.draftRowPts.map((p) => [p.x, p.y] as [number, number]), [props.cursorWorld.x, props.cursorWorld.y]]
                  : props.draftRowPts.map((p) => [p.x, p.y]),
              )}
              stroke="#fbbf24"
              strokeWidth={2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {props.draftArcPts.length >= 1 && (
            <Line
              points={toPoints(
                props.cursorWorld
                  ? [...props.draftArcPts.map((p) => [p.x, p.y] as [number, number]), [props.cursorWorld.x, props.cursorWorld.y]]
                  : props.draftArcPts.map((p) => [p.x, p.y]),
              )}
              stroke="#f97316"
              strokeWidth={2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {props.draftArcPts.map((p, i) => <Circle key={`arcpt-${i}`} x={p.x} y={p.y} radius={0.15} fill="#f97316" />)}

          {/* Seat design drafts (dots + dashed path) */}
          {props.draftSeatPath.length >= 1 && (
            <Line
              points={toPoints(
                props.cursorWorld
                  ? [...props.draftSeatPath.map((p) => [p.x, p.y] as [number, number]), [props.cursorWorld.x, props.cursorWorld.y]]
                  : props.draftSeatPath.map((p) => [p.x, p.y]),
              )}
              stroke="rgba(226,232,240,0.7)"
              strokeWidth={1.2}
              dash={dash}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {props.draftSeatDots.map((p, i) => (
            <Circle key={`seatdraft-${i}`} x={p.x} y={p.y} radius={0.14} fill="#e2e8f0" opacity={0.9} />
          ))}

          {props.rows.map((r) => {
            if (String((r as any).label ?? '') === '__MANUAL__') return null
            const isActive = props.activeRowId === (r.id as Id)
            const path = JSON.parse(r.geom_json as string) as { segments: PathSeg[] }
            const pts: Array<[number, number]> = []
            for (const seg of path.segments as any[]) {
              if (seg.type === 'line') {
                if (pts.length === 0) pts.push([seg.x1, seg.y1])
                pts.push([seg.x2, seg.y2])
              } else if (seg.type === 'arc') {
                const arcPts = sampleArc(seg)
                if (pts.length === 0) pts.push(...arcPts)
                else pts.push(...arcPts.slice(1))
              }
            }
            return (
              <Line
                key={`row-${r.id}`}
                points={toPoints(pts)}
                stroke={isActive ? '#fbbf24' : '#475569'}
                strokeWidth={isActive ? 2.5 : 1.5}
                onClick={(e) => {
                  e.cancelBubble = true
                  props.onSelectRow(r.section_id as Id, r.id as Id)
                }}
              />
            )
          })}

          {props.seats.map((s) => {
            const seatId = s.id as Id
            const isInActiveRow = props.activeRowId !== null ? s.row_id === props.activeRowId : true
            const isSelected = props.selectedSeatIds.has(seatId)
            const seatType = String((s as any).seat_type ?? 'standard')
            const radius =
              seatType === 'wheelchair' ? 0.26 : seatType === 'companion' ? 0.22 : seatType === 'aisle' ? 0.16 : seatType === 'rail' ? 0.18 : seatType === 'standing' ? 0.14 : 0.18
            const stroke =
              seatType === 'wheelchair'
                ? '#60a5fa'
                : seatType === 'companion'
                  ? '#c084fc'
                  : seatType === 'aisle'
                    ? '#94a3b8'
                    : seatType === 'rail'
                      ? '#f472b6'
                      : undefined
            return (
              <Circle
                key={`seat-${seatId}`}
                x={s.x_m as number}
                y={s.y_m as number}
                radius={radius}
                fill={props.seatColor(seatId)}
                opacity={isInActiveRow ? 1 : 0.4}
                stroke={isSelected ? '#a78bfa' : stroke}
                strokeWidth={isSelected ? 0.06 : stroke ? 0.05 : 0}
                draggable={props.seatDragEnabled}
                onDragEnd={(e) => props.onSeatDragEnd(seatId, e.target.x(), e.target.y())}
                onMouseEnter={() => props.onSeatHover(seatId)}
                onMouseLeave={() => props.onSeatHover(null)}
                onClick={(e) => {
                  e.cancelBubble = true
                  props.onSelectSeat(seatId)
                }}
              />
            )
          })}

          {/* Active section vertex handles */}
          {props.tool === 'select' &&
            props.activeSectionPoints?.map((p, idx) => (
              <Circle
                key={`sec-h-${idx}`}
                x={p[0]}
                y={p[1]}
                radius={0.22}
                fill="#60a5fa"
                draggable
                onDragEnd={(e) => props.onDragSectionPoint(idx, e.target.x(), e.target.y())}
              />
            ))}

          {/* Active row vertex handles (line-only rows) */}
          {props.tool === 'select' &&
            props.activeRowLineVertices?.map((p, idx) => (
              <Circle
                key={`row-h-${idx}`}
                x={p[0]}
                y={p[1]}
                radius={0.2}
                fill="#fbbf24"
                draggable
                onDragEnd={(e) => props.onDragRowVertex(idx, e.target.x(), e.target.y())}
              />
            ))}

          {/* Active arc row handles (single-arc rows) */}
          {props.tool === 'select' &&
            props.activeArcHandlePoints?.map((p, idx) => (
              <Circle
                key={`arc-h-${idx}`}
                x={p.x}
                y={p.y}
                radius={0.22}
                fill="#f97316"
                draggable
                onDragEnd={(e) => props.onDragArcHandle(idx, e.target.x(), e.target.y())}
              />
            ))}

          {props.hoverSeatInfo && (
            <KText x={props.hoverSeatInfo.x + 0.25} y={props.hoverSeatInfo.y + 0.25} text={props.hoverSeatInfo.code} fontSize={0.25} fill="#e2e8f0" />
          )}

          {props.selecting && props.selStart && props.selEnd && (
            <Rect
              x={Math.min(props.selStart.x, props.selEnd.x)}
              y={Math.min(props.selStart.y, props.selEnd.y)}
              width={Math.abs(props.selEnd.x - props.selStart.x)}
              height={Math.abs(props.selEnd.y - props.selStart.y)}
              stroke="#a78bfa"
              strokeWidth={0.05}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}

