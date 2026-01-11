import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Anchor, AppShell, Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useEffect, useMemo, useState } from 'react'
import { Circle, Layer, Line, Stage } from 'react-konva'
import {
  createConfig,
  createLevel,
  createRow,
  createSection,
  createVenue,
  generateSeats,
  listVenues,
  listConfigs,
  snapshot,
  upsertOverride,
  upsertPitch,
  type Id,
  type PathSeg,
} from './api'
import { arcFrom3Points, type Pt } from './geometry'

type Tool = 'select' | 'draw-pitch' | 'draw-section' | 'draw-row-line' | 'draw-row-arc' | 'paint-blocked' | 'paint-kill'

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

function App() {
  const qc = useQueryClient()
  const venuesQ = useQuery({ queryKey: ['venues'], queryFn: listVenues })
  const [venueId, setVenueId] = useState<Id | null>(null)
  const [configId, setConfigId] = useState<Id | null>(null)
  const configsQ = useQuery({
    queryKey: ['configs', venueId],
    queryFn: () => listConfigs(venueId!),
    enabled: venueId !== null,
  })
  const snapQ = useQuery({
    queryKey: ['snapshot', venueId, configId],
    queryFn: () => snapshot(venueId!, configId),
    enabled: venueId !== null,
  })

  const [activeLevelId, setActiveLevelId] = useState<Id | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<Id | null>(null)
  const [activeRowId, setActiveRowId] = useState<Id | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [draftPts, setDraftPts] = useState<Pt[]>([])
  const [draftRowPts, setDraftRowPts] = useState<Pt[]>([])
  const [draftArcPts, setDraftArcPts] = useState<Pt[]>([])

  const [pan, setPan] = useState({ x: 450, y: 350 })
  const [scale, setScale] = useState(1)

  const [createVenueOpen, setCreateVenueOpen] = useState(false)
  const [newVenueName, setNewVenueName] = useState('')

  const [createLevelOpen, setCreateLevelOpen] = useState(false)
  const [newLevelName, setNewLevelName] = useState('Lower Bowl')

  const [createConfigOpen, setCreateConfigOpen] = useState(false)
  const [newConfigName, setNewConfigName] = useState('Default event layout')

  const [createSectionOpen, setCreateSectionOpen] = useState(false)
  const [newSectionCode, setNewSectionCode] = useState('101')

  const [createRowOpen, setCreateRowOpen] = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('1')
  const [newRowOrder, setNewRowOrder] = useState<number>(0)

  const [genSeatsOpen, setGenSeatsOpen] = useState(false)
  const [seatPitch, setSeatPitch] = useState(0.5)
  const [startOffset, setStartOffset] = useState(0.2)
  const [endOffset, setEndOffset] = useState(0.2)
  const [seatStart, setSeatStart] = useState(1)
  const [overwriteSeats, setOverwriteSeats] = useState(true)

  const createVenueM = useMutation({
    mutationFn: () => createVenue({ name: newVenueName.trim() }),
    onSuccess: async (v) => {
      await qc.invalidateQueries({ queryKey: ['venues'] })
      setVenueId(v.id)
      setCreateVenueOpen(false)
      setNewVenueName('')
      notifications.show({ message: 'Venue created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const createLevelM = useMutation({
    mutationFn: () => createLevel(venueId!, { name: newLevelName.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setCreateLevelOpen(false)
      notifications.show({ message: 'Level created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const createConfigM = useMutation({
    mutationFn: () => createConfig(venueId!, { name: newConfigName.trim() }),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['configs', venueId] })
      setConfigId(c.id)
      setCreateConfigOpen(false)
      setNewConfigName('Default event layout')
      notifications.show({ message: 'Config created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const upsertPitchM = useMutation({
    mutationFn: (pts: Array<[number, number]>) => upsertPitch(venueId!, pts),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      notifications.show({ message: 'Pitch saved' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const createSectionM = useMutation({
    mutationFn: () => createSection(activeLevelId!, { code: newSectionCode.trim(), polygonPoints: draftPts.map((p) => [p.x, p.y]) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setCreateSectionOpen(false)
      setDraftPts([])
      notifications.show({ message: 'Section created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const createRowM = useMutation({
    mutationFn: () => {
      const segments: PathSeg[] = []
      for (let i = 0; i < draftRowPts.length - 1; i++) {
        const a = draftRowPts[i]!
        const b = draftRowPts[i + 1]!
        segments.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y })
      }
      return createRow(activeSectionId!, { label: newRowLabel.trim(), order_index: newRowOrder, segments })
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setActiveRowId(r.id)
      setCreateRowOpen(false)
      setDraftRowPts([])
      notifications.show({ message: 'Row created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const createArcRowM = useMutation({
    mutationFn: () => {
      const [a, b, c] = draftArcPts
      const arc = a && b && c ? arcFrom3Points(a, b, c) : null
      if (!arc) throw new Error('Arc points are collinear / invalid')
      const segments: PathSeg[] = [{ type: 'arc', ...arc }]
      return createRow(activeSectionId!, { label: newRowLabel.trim(), order_index: newRowOrder, segments })
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setActiveRowId(r.id)
      setCreateRowOpen(false)
      setDraftArcPts([])
      notifications.show({ message: 'Arc row created' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const genSeatsM = useMutation({
    mutationFn: () =>
      generateSeats(activeRowId!, {
        seat_pitch_m: seatPitch,
        start_offset_m: startOffset,
        end_offset_m: endOffset,
        seat_number_start: seatStart,
        overwrite: overwriteSeats,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setGenSeatsOpen(false)
      notifications.show({ message: `Created ${r.created} seats` })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const overrideM = useMutation({
    mutationFn: (payload: { seat_id: Id; status: 'sellable' | 'blocked' | 'kill' }) => upsertOverride(configId!, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  useEffect(() => {
    // Reset config selection when switching venues
    setConfigId(null)
  }, [venueId])

  const data = snapQ.data
  const levels = useMemo(() => (data?.levels ?? []) as any[], [data])
  const sections = useMemo(() => (data?.sections ?? []) as any[], [data])
  const rows = useMemo(() => (data?.rows ?? []) as any[], [data])
  const seats = useMemo(() => (data?.seats ?? []) as any[], [data])
  const overrides = useMemo(() => (data?.overrides ?? []) as any[], [data])

  const pitchPoints = useMemo(() => {
    const g = data?.pitch?.geom_json as string | undefined
    if (!g) return null
    const pts = JSON.parse(g) as Array<[number, number]>
    return pts
  }, [data])

  const overrideBySeatId = useMemo(() => new Map(overrides.map((o) => [o.seat_id as Id, o])), [overrides])

  const levelOptions = levels.map((l) => ({ value: String(l.id), label: l.name }))
  const sectionOptions = sections
    .filter((s) => (activeLevelId ? s.level_id === activeLevelId : true))
    .map((s) => ({ value: String(s.id), label: s.code }))
  const rowOptions = rows
    .filter((r) => (activeSectionId ? r.section_id === activeSectionId : true))
    .map((r) => ({ value: String(r.id), label: r.label }))

  function stageToWorld(stage: any): Pt {
    const pos = stage.getPointerPosition()
    if (!pos) return { x: 0, y: 0 }
    return { x: (pos.x - pan.x) / scale, y: (pos.y - pan.y) / scale }
  }

  function onStageClick(e: any) {
    if (!venueId) return
    const stage = e.target.getStage()
    const p = stageToWorld(stage)

    if (tool === 'draw-pitch' || tool === 'draw-section') {
      setDraftPts((prev) => [...prev, p])
      return
    }

    if (tool === 'draw-row-line') {
      setDraftRowPts((prev) => [...prev, p])
      return
    }

    if (tool === 'draw-row-arc') {
      setDraftArcPts((prev) => (prev.length >= 3 ? [p] : [...prev, p]))
      return
    }
  }

  function onStageDblClick() {
    if (tool === 'draw-pitch') {
      if (draftPts.length >= 3) {
        upsertPitchM.mutate(draftPts.map((p) => [p.x, p.y]))
        setDraftPts([])
      }
    } else if (tool === 'draw-section') {
      if (draftPts.length >= 3) setCreateSectionOpen(true)
    } else if (tool === 'draw-row-line') {
      if (draftRowPts.length >= 2) setCreateRowOpen(true)
    } else if (tool === 'draw-row-arc') {
      if (draftArcPts.length === 3) setCreateRowOpen(true)
    }
  }

  function onWheel(e: any) {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const oldScale = scale
    const scaleBy = 1.05
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy
    const mousePointTo = {
      x: (pointer.x - pan.x) / oldScale,
      y: (pointer.y - pan.y) / oldScale,
    }
    setScale(newScale)
    setPan({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }

  function seatColor(seatId: Id): string {
    const o = overrideBySeatId.get(seatId)
    if (!o) return '#7dd3fc'
    if (o.status === 'blocked') return '#fbbf24'
    if (o.status === 'kill') return '#fb7185'
    return '#7dd3fc'
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 360, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Text fw={700}>Venue Seating Designer</Text>
            <Anchor href="http://localhost:8000/docs" target="_blank">
              API docs
            </Anchor>
          </Group>
          <Group>
            <Select
              placeholder="Select venue"
              data={(venuesQ.data ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
              value={venueId ? String(venueId) : null}
              onChange={(v) => {
                const id = v ? Number(v) : null
                setVenueId(id)
                setActiveLevelId(null)
                setActiveSectionId(null)
                setActiveRowId(null)
              }}
              w={260}
            />
            <Select
              placeholder="Config (event layout)"
              data={(configsQ.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
              value={configId ? String(configId) : null}
              onChange={(v) => setConfigId(v ? Number(v) : null)}
              w={260}
              disabled={!venueId}
              clearable
            />
            <Button variant="light" disabled={!venueId} onClick={() => setCreateConfigOpen(true)}>
              New config
            </Button>
            <Button variant="light" onClick={() => setCreateVenueOpen(true)}>
              New venue
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack gap="sm">
          <Text fw={700}>Project</Text>
          <Button disabled={!venueId} onClick={() => setCreateLevelOpen(true)}>
            Add level
          </Button>
          <Select
            label="Active level"
            data={levelOptions}
            value={activeLevelId ? String(activeLevelId) : null}
            onChange={(v) => {
              const id = v ? Number(v) : null
              setActiveLevelId(id)
              setActiveSectionId(null)
              setActiveRowId(null)
            }}
          />

          <Select
            label="Active section"
            data={sectionOptions}
            value={activeSectionId ? String(activeSectionId) : null}
            onChange={(v) => {
              const id = v ? Number(v) : null
              setActiveSectionId(id)
              setActiveRowId(null)
            }}
            disabled={!activeLevelId}
          />

          <Select
            label="Active row"
            data={rowOptions}
            value={activeRowId ? String(activeRowId) : null}
            onChange={(v) => setActiveRowId(v ? Number(v) : null)}
            disabled={!activeSectionId}
          />

          <Text fw={700} mt="md">
            Tools
          </Text>
          <Group grow>
            <Button variant={tool === 'select' ? 'filled' : 'light'} onClick={() => setTool('select')}>
              Select
            </Button>
            <Button variant={tool === 'draw-pitch' ? 'filled' : 'light'} disabled={!venueId} onClick={() => setTool('draw-pitch')}>
              Draw pitch
            </Button>
          </Group>
          <Group grow>
            <Button
              variant={tool === 'draw-section' ? 'filled' : 'light'}
              disabled={!activeLevelId}
              onClick={() => {
                setDraftPts([])
                setTool('draw-section')
              }}
            >
              Draw section
            </Button>
            <Button
              variant={tool === 'draw-row-line' ? 'filled' : 'light'}
              disabled={!activeSectionId}
              onClick={() => {
                setDraftRowPts([])
                setTool('draw-row-line')
              }}
            >
              Draw row (line)
            </Button>
          </Group>
          <Group grow>
            <Button
              variant={tool === 'draw-row-arc' ? 'filled' : 'light'}
              disabled={!activeSectionId}
              onClick={() => {
                setDraftArcPts([])
                setTool('draw-row-arc')
              }}
            >
              Draw row (arc)
            </Button>
            <Button variant="light" disabled={!activeRowId} onClick={() => setGenSeatsOpen(true)}>
              Generate seats
            </Button>
          </Group>

          <Text fw={700} mt="md">
            Configuration paint
          </Text>
          <Text size="sm" c="dimmed">
            Pick a config (event layout) in the top bar, then paint seat statuses.
          </Text>
          <Group grow>
            <Button variant={tool === 'paint-blocked' ? 'filled' : 'light'} disabled={!configId} onClick={() => setTool('paint-blocked')}>
              Paint blocked
            </Button>
            <Button variant={tool === 'paint-kill' ? 'filled' : 'light'} disabled={!configId} onClick={() => setTool('paint-kill')}>
              Paint kill
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Tip: double-click to finish polygons/rows.
          </Text>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {!venueId ? (
          <Text>Select or create a venue to start.</Text>
        ) : snapQ.isLoading ? (
          <Text>Loading…</Text>
        ) : (
          <Stage
            width={1100}
            height={750}
            onClick={onStageClick}
            onDblClick={onStageDblClick}
            onWheel={onWheel}
            draggable={tool === 'select'}
            x={pan.x}
            y={pan.y}
            scaleX={scale}
            scaleY={scale}
            onDragEnd={(e) => setPan({ x: e.target.x(), y: e.target.y() })}
          >
            <Layer>
              {pitchPoints && <Line points={toPoints(pitchPoints)} closed stroke="#22c55e" strokeWidth={2} />}
              {draftPts.length >= 2 && <Line points={toPoints(draftPts.map((p) => [p.x, p.y]))} stroke="#a78bfa" strokeWidth={2} />}

              {sections.map((s) => {
                const pts = JSON.parse(s.geom_json as string) as Array<[number, number]>
                const isActive = activeSectionId === (s.id as Id)
                return (
                  <Line
                    key={`sec-${s.id}`}
                    points={toPoints(pts)}
                    closed
                    stroke={isActive ? '#60a5fa' : '#334155'}
                    strokeWidth={isActive ? 2.5 : 1.5}
                    onClick={(e) => {
                      e.cancelBubble = true
                      setActiveLevelId(s.level_id as Id)
                      setActiveSectionId(s.id as Id)
                    }}
                  />
                )
              })}

              {/* Draft row polyline */}
              {draftRowPts.length >= 2 && <Line points={toPoints(draftRowPts.map((p) => [p.x, p.y]))} stroke="#fbbf24" strokeWidth={2} />}
              {/* Draft arc points */}
              {draftArcPts.map((p, i) => (
                <Circle key={`arcpt-${i}`} x={p.x} y={p.y} radius={0.15} fill="#f97316" />
              ))}

              {/* Rows */}
              {rows.map((r) => {
                const isActive = activeRowId === (r.id as Id)
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
                      setActiveSectionId(r.section_id as Id)
                      setActiveRowId(r.id as Id)
                    }}
                  />
                )
              })}

              {/* Seats */}
              {seats.map((s) => {
                const seatId = s.id as Id
                const isInActiveRow = activeRowId !== null ? s.row_id === activeRowId : true
                const fill = seatColor(seatId)
                return (
                  <Circle
                    key={`seat-${seatId}`}
                    x={s.x_m as number}
                    y={s.y_m as number}
                    radius={0.18}
                    fill={fill}
                    opacity={isInActiveRow ? 1 : 0.4}
                    onClick={(e) => {
                      e.cancelBubble = true
                      if (tool === 'paint-blocked' && configId) overrideM.mutate({ seat_id: seatId, status: 'blocked' })
                      if (tool === 'paint-kill' && configId) overrideM.mutate({ seat_id: seatId, status: 'kill' })
                    }}
                  />
                )
              })}
            </Layer>
          </Stage>
        )}
      </AppShell.Main>

      {/* Modals */}
      <Modal opened={createVenueOpen} onClose={() => setCreateVenueOpen(false)} title="Create venue">
        <Stack>
          <TextInput label="Venue name" value={newVenueName} onChange={(e) => setNewVenueName(e.target.value)} />
          <Button onClick={() => createVenueM.mutate()} disabled={!newVenueName.trim()}>
            Create
          </Button>
        </Stack>
      </Modal>

      <Modal opened={createLevelOpen} onClose={() => setCreateLevelOpen(false)} title="Add level">
        <Stack>
          <TextInput label="Level name" value={newLevelName} onChange={(e) => setNewLevelName(e.target.value)} />
          <Button onClick={() => createLevelM.mutate()} disabled={!newLevelName.trim()}>
            Create
          </Button>
        </Stack>
      </Modal>

      <Modal opened={createConfigOpen} onClose={() => setCreateConfigOpen(false)} title="Create config (event layout)">
        <Stack>
          <TextInput label="Config name" value={newConfigName} onChange={(e) => setNewConfigName(e.target.value)} />
          <Button onClick={() => createConfigM.mutate()} disabled={!newConfigName.trim()}>
            Create
          </Button>
        </Stack>
      </Modal>

      <Modal opened={createSectionOpen} onClose={() => setCreateSectionOpen(false)} title="Create section">
        <Stack>
          <TextInput label="Section code" value={newSectionCode} onChange={(e) => setNewSectionCode(e.target.value)} />
          <Button onClick={() => createSectionM.mutate()} disabled={!newSectionCode.trim()}>
            Save section
          </Button>
        </Stack>
      </Modal>

      <Modal opened={createRowOpen} onClose={() => setCreateRowOpen(false)} title="Create row">
        <Stack>
          <TextInput label="Row label" value={newRowLabel} onChange={(e) => setNewRowLabel(e.target.value)} />
          <NumberInput label="Order index" value={newRowOrder} onChange={(v) => setNewRowOrder(Number(v ?? 0))} />
          <Button
            onClick={() => {
              if (tool === 'draw-row-arc') createArcRowM.mutate()
              else createRowM.mutate()
            }}
            disabled={!newRowLabel.trim()}
          >
            Save row
          </Button>
        </Stack>
      </Modal>

      <Modal opened={genSeatsOpen} onClose={() => setGenSeatsOpen(false)} title="Generate seats">
        <Stack>
          <NumberInput label="Seat pitch (m)" value={seatPitch} onChange={(v) => setSeatPitch(Number(v ?? 0.5))} decimalScale={2} />
          <NumberInput label="Start offset (m)" value={startOffset} onChange={(v) => setStartOffset(Number(v ?? 0.2))} decimalScale={2} />
          <NumberInput label="End offset (m)" value={endOffset} onChange={(v) => setEndOffset(Number(v ?? 0.2))} decimalScale={2} />
          <NumberInput label="Seat number start" value={seatStart} onChange={(v) => setSeatStart(Number(v ?? 1))} />
          <Switch
            label="Overwrite existing seats in this row"
            checked={overwriteSeats}
            onChange={(e) => setOverwriteSeats(e.currentTarget.checked)}
          />
          <Button onClick={() => genSeatsM.mutate()}>Generate</Button>
          <Text size="sm" c="dimmed">
            Seats are kept only if they fall inside the section polygon (meter-accurate containment).
          </Text>
        </Stack>
      </Modal>
    </AppShell>
  )
}

export default App
