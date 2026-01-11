import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Anchor, AppShell, Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useElementSize } from '@mantine/hooks'
import { useEffect, useMemo, useState } from 'react'
import { Circle, Layer, Line, Rect, Stage } from 'react-konva'
import {
  createConfig,
  createLevel,
  createRow,
  createSection,
  createVenue,
  bulkUpsertOverrides,
  downloadSeatsCsv,
  exportVenuePackage,
  generateSeats,
  importVenuePackage,
  listVenues,
  listConfigs,
  snapshot,
  upsertOverride,
  upsertPitch,
  type Id,
  type PathSeg,
} from './api'
import { arcFrom3Points, type Pt } from './geometry'

type Tool =
  | 'select'
  | 'draw-pitch'
  | 'draw-section'
  | 'draw-row-line'
  | 'draw-row-arc'
  | 'paint-blocked'
  | 'paint-kill'
  | 'paint-sellable'

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
  const { ref: stageWrapRef, width: stageW, height: stageH } = useElementSize()
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

  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridStep, setGridStep] = useState(0.1)

  const [pan, setPan] = useState({ x: 450, y: 350 })
  const [scale, setScale] = useState(1)

  // reserved for future hover UI (tooltips)
  const [, setHoverSeatId] = useState<Id | null>(null)
  const [selectedSeatId, setSelectedSeatId] = useState<Id | null>(null)

  const [selecting, setSelecting] = useState(false)
  const [selStart, setSelStart] = useState<Pt | null>(null)
  const [selEnd, setSelEnd] = useState<Pt | null>(null)

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

  const exportM = useMutation({
    mutationFn: () => exportVenuePackage(venueId!, configId),
    onSuccess: async (pkg) => {
      await navigator.clipboard.writeText(JSON.stringify(pkg, null, 2))
      notifications.show({ message: 'Export copied to clipboard (JSON)' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const exportCsvM = useMutation({
    mutationFn: async () => {
      const blob = await downloadSeatsCsv(venueId!, configId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `venue_${venueId}_seats.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => notifications.show({ message: 'CSV download started' }),
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const importM = useMutation({
    mutationFn: async () => {
      const txt = prompt('Paste venue package JSON here')
      if (!txt) throw new Error('No JSON provided')
      const pkg = JSON.parse(txt)
      return await importVenuePackage(pkg)
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['venues'] })
      setVenueId(r.venue_id)
      setConfigId(null)
      notifications.show({ message: 'Imported into new venue' })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

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

  const bulkOverrideM = useMutation({
    mutationFn: (payload: { seat_ids: Id[]; status: 'sellable' | 'blocked' | 'kill' }) => bulkUpsertOverrides(configId!, payload),
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
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id as Id, r])), [rows])
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id as Id, s])), [sections])
  const levelById = useMemo(() => new Map(levels.map((l) => [l.id as Id, l])), [levels])

  const seatInfo = useMemo(() => {
    if (!selectedSeatId) return null
    const s = seats.find((x) => (x.id as Id) === selectedSeatId)
    if (!s) return null
    const r = rowById.get(s.row_id as Id)
    const sec = r ? sectionById.get(r.section_id as Id) : null
    const lvl = sec ? levelById.get(sec.level_id as Id) : null
    const o = overrideBySeatId.get(selectedSeatId)
    const code = lvl && sec && r ? `${lvl.name}-${sec.code}-${r.label}-${s.seat_number}` : `${selectedSeatId}`
    return {
      id: selectedSeatId,
      code,
      status: o?.status ?? 'sellable',
      x: s.x_m,
      y: s.y_m,
      row: r?.label,
      section: sec?.code,
      level: lvl?.name,
    }
  }, [selectedSeatId, seats, rowById, sectionById, levelById, overrideBySeatId])

  const levelOptions = levels.map((l) => ({ value: String(l.id), label: l.name }))
  const sectionOptions = sections
    .filter((s) => (activeLevelId ? s.level_id === activeLevelId : true))
    .map((s) => ({ value: String(s.id), label: s.code }))
  const rowOptions = rows
    .filter((r) => (activeSectionId ? r.section_id === activeSectionId : true))
    .map((r) => ({ value: String(r.id), label: r.label }))

  function snap(p: Pt): Pt {
    if (!snapEnabled) return p
    const step = Math.max(0.001, gridStep)
    return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }
  }

  function stageToWorld(stage: any): Pt {
    const pos = stage.getPointerPosition()
    if (!pos) return { x: 0, y: 0 }
    return snap({ x: (pos.x - pan.x) / scale, y: (pos.y - pan.y) / scale })
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

  function isPaintTool(t: Tool): t is 'paint-blocked' | 'paint-kill' | 'paint-sellable' {
    return t === 'paint-blocked' || t === 'paint-kill' || t === 'paint-sellable'
  }

  function onMouseDown(e: any) {
    if (!venueId) return
    if (!configId) return
    if (!isPaintTool(tool)) return
    const stage = e.target.getStage()
    const p = stageToWorld(stage)
    setSelecting(true)
    setSelStart(p)
    setSelEnd(p)
  }

  function onMouseMove(e: any) {
    if (!selecting) return
    const stage = e.target.getStage()
    const p = stageToWorld(stage)
    setSelEnd(p)
  }

  function onMouseUp() {
    if (!selecting) return
    setSelecting(false)
    if (!selStart || !selEnd || !configId) return
    const minX = Math.min(selStart.x, selEnd.x)
    const maxX = Math.max(selStart.x, selEnd.x)
    const minY = Math.min(selStart.y, selEnd.y)
    const maxY = Math.max(selStart.y, selEnd.y)
    const area = (maxX - minX) * (maxY - minY)
    setSelStart(null)
    setSelEnd(null)
    if (area < 1e-6) return

    const filtered = seats.filter((s) => {
      if (activeRowId !== null && s.row_id !== activeRowId) return false
      if (activeSectionId !== null) {
        const r = rowById.get(s.row_id as Id)
        if (!r || r.section_id !== activeSectionId) return false
      }
      const x = s.x_m as number
      const y = s.y_m as number
      return x >= minX && x <= maxX && y >= minY && y <= maxY
    })
    const ids = filtered.map((s) => s.id as Id)
    if (ids.length === 0) return
    const status = tool === 'paint-blocked' ? 'blocked' : tool === 'paint-kill' ? 'kill' : 'sellable'
    bulkOverrideM.mutate({ seat_ids: ids, status })
    notifications.show({ message: `Painted ${ids.length} seats` })
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

  function undo() {
    if (tool === 'draw-pitch' || tool === 'draw-section') setDraftPts((p) => p.slice(0, -1))
    if (tool === 'draw-row-line') setDraftRowPts((p) => p.slice(0, -1))
    if (tool === 'draw-row-arc') setDraftArcPts((p) => p.slice(0, -1))
  }

  function cancelDraft() {
    setDraftPts([])
    setDraftRowPts([])
    setDraftArcPts([])
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
            <Button variant="subtle" disabled={!venueId} onClick={() => exportM.mutate()}>
              Export
            </Button>
            <Button variant="subtle" disabled={!venueId} onClick={() => exportCsvM.mutate()}>
              Export CSV
            </Button>
            <Button variant="subtle" onClick={() => importM.mutate()}>
              Import
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
            <Button variant="light" onClick={undo} disabled={(draftPts.length + draftRowPts.length + draftArcPts.length) === 0}>
              Undo
            </Button>
            <Button variant="light" onClick={cancelDraft} disabled={(draftPts.length + draftRowPts.length + draftArcPts.length) === 0}>
              Cancel
            </Button>
          </Group>
          <Switch label="Snap to grid" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.currentTarget.checked)} />
          <NumberInput label="Grid step (m)" value={gridStep} onChange={(v) => setGridStep(Number(v ?? 0.1))} decimalScale={3} />
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
          <Group grow>
            <Button variant={tool === 'paint-sellable' ? 'filled' : 'light'} disabled={!configId} onClick={() => setTool('paint-sellable')}>
              Paint sellable
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Tip: double-click to finish polygons/rows.
          </Text>

          <Text fw={700} mt="md">
            Seat inspector
          </Text>
          {seatInfo ? (
            <Stack gap={2}>
              <Text size="sm">
                <b>{seatInfo.code}</b>
              </Text>
              <Text size="sm" c="dimmed">
                {seatInfo.level} / {seatInfo.section} / {seatInfo.row}
              </Text>
              <Text size="sm" c="dimmed">
                status: {String(seatInfo.status)}
              </Text>
              <Text size="sm" c="dimmed">
                x,y: {Number(seatInfo.x).toFixed(2)}, {Number(seatInfo.y).toFixed(2)}
              </Text>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Click a seat to inspect.
            </Text>
          )}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {!venueId ? (
          <Text>Select or create a venue to start.</Text>
        ) : snapQ.isLoading ? (
          <Text>Loading…</Text>
        ) : (
          <div ref={stageWrapRef} style={{ width: '100%', height: 'calc(100vh - 120px)' }}>
            <Stage
            width={Math.max(300, stageW)}
            height={Math.max(300, stageH)}
            onClick={onStageClick}
            onDblClick={onStageDblClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
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
                    onMouseEnter={() => setHoverSeatId(seatId)}
                    onMouseLeave={() => setHoverSeatId((h) => (h === seatId ? null : h))}
                    onClick={(e) => {
                      e.cancelBubble = true
                      setSelectedSeatId(seatId)
                      if (tool === 'paint-blocked' && configId) overrideM.mutate({ seat_id: seatId, status: 'blocked' })
                      if (tool === 'paint-kill' && configId) overrideM.mutate({ seat_id: seatId, status: 'kill' })
                      if (tool === 'paint-sellable' && configId) overrideM.mutate({ seat_id: seatId, status: 'sellable' })
                    }}
                  />
                )
              })}

              {/* Selection rectangle */}
              {selecting && selStart && selEnd && (
                <Rect
                  x={Math.min(selStart.x, selEnd.x)}
                  y={Math.min(selStart.y, selEnd.y)}
                  width={Math.abs(selEnd.x - selStart.x)}
                  height={Math.abs(selEnd.y - selStart.y)}
                  stroke="#a78bfa"
                  strokeWidth={0.05}
                />
              )}
            </Layer>
            </Stage>
          </div>
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
