import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppShell,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  useMantineColorScheme,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useElementSize } from '@mantine/hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createConfig,
  createLevel,
  createRow,
  createSection,
  createVenue,
  bulkUpsertOverrides,
  batchUpsertOverrides,
  createZone,
  computeZoneCapacity,
  downloadSeatsCsv,
  downloadZonesCsv,
  downloadManifestCsv,
  downloadBreakdownCsv,
  exportVenuePackage,
  generateSeats,
  generateSeatsInSection,
  bulkUpdateSeatType,
  createSeatsInSectionBulk,
  updateSeat,
  getRowMetrics,
  getVenueSummary,
  getVenueSummaryBreakdown,
  importVenuePackage,
  listVenues,
  listConfigs,
  deleteVenue,
  deleteLevel,
  deleteSection,
  deleteRow,
  deleteZone,
  deleteConfig,
  deletePitch,
  snapshot,
  updateRowPath,
  updateSection,
  updateZone,
  upsertPitch,
  type Id,
  type PathSeg,
} from './api'
import { arcFrom3Points, closestPointOnSegment, pointOnArc, polygonSelfIntersection, type Pt } from './geometry'
import { polygonArea } from './geometry'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { CanvasView } from './components/CanvasView'
import { modals } from '@mantine/modals'

type Tool =
  | 'select'
  | 'draw-pitch'
  | 'draw-section'
  | 'draw-row-line'
  | 'draw-row-arc'
  | 'draw-zone'
  | 'seat-place'
  | 'seat-line'
  | 'seat-poly'
  | 'seat-move'
  | 'paint-blocked'
  | 'paint-kill'
  | 'paint-sellable'

type SeatType = 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail'

function App() {
  const qc = useQueryClient()
  const { ref: stageWrapRef, width: stageW, height: stageH } = useElementSize()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
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
  const [draftZonePts, setDraftZonePts] = useState<Pt[]>([])
  const [draftSeatPath, setDraftSeatPath] = useState<Pt[]>([])
  const [draftSeatDots, setDraftSeatDots] = useState<Pt[]>([])

  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridStep, setGridStep] = useState(0.1)

  const [pan, setPan] = useState({ x: 450, y: 350 })
  const [scale, setScale] = useState(1)
  const [defaultView] = useState(() => ({ pan: { x: 450, y: 350 }, scale: 1 }))
  const [helpOpen, setHelpOpen] = useState(false)

  const panRef = useRef(pan)
  const scaleRef = useRef(scale)
  const animRef = useRef<number | null>(null)
  useEffect(() => {
    panRef.current = pan
  }, [pan])
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  const [hoverSeatId, setHoverSeatId] = useState<Id | null>(null)
  const [selectedSeatId, setSelectedSeatId] = useState<Id | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState<Id | null>(null)

  const [selecting, setSelecting] = useState(false)
  const [selectMode, setSelectMode] = useState<'paint' | 'select' | null>(null)
  const [selStart, setSelStart] = useState<Pt | null>(null)
  const [selEnd, setSelEnd] = useState<Pt | null>(null)
  const [cursorWorld, setCursorWorld] = useState<Pt | null>(null)

  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<Id>>(new Set())

  const [seatDesignType, setSeatDesignType] = useState<SeatType>('standard')
  const [seatDesignStart, setSeatDesignStart] = useState(1)
  const [seatDesignCount, setSeatDesignCount] = useState(10)
  const [seatDesignPitch, setSeatDesignPitch] = useState(0.5)
  const [seatDesignModalOpen, setSeatDesignModalOpen] = useState(false)
  const [seatDesignMode, setSeatDesignMode] = useState<'line' | 'poly'>('line')
  const [seatEnforceInside, setSeatEnforceInside] = useState(true)

  type OverrideStatus = 'sellable' | 'blocked' | 'kill'
  type PaintAction = { configId: Id; before: Array<{ seat_id: Id; status: OverrideStatus }>; after: Array<{ seat_id: Id; status: OverrideStatus }> }
  const [paintUndo, setPaintUndo] = useState<PaintAction[]>([])
  const [paintRedo, setPaintRedo] = useState<PaintAction[]>([])

  const [createVenueOpen, setCreateVenueOpen] = useState(false)
  const [newVenueName, setNewVenueName] = useState('')

  const [createLevelOpen, setCreateLevelOpen] = useState(false)
  const [newLevelName, setNewLevelName] = useState('Lower Bowl')

  const [createConfigOpen, setCreateConfigOpen] = useState(false)
  const [newConfigName, setNewConfigName] = useState('Default event layout')

  const [createSectionOpen, setCreateSectionOpen] = useState(false)
  const [newSectionCode, setNewSectionCode] = useState('101')

  const [createZoneOpen, setCreateZoneOpen] = useState(false)
  const [newZoneName, setNewZoneName] = useState('Standing')
  const [newZoneCap, setNewZoneCap] = useState(500)

  const [createRowOpen, setCreateRowOpen] = useState(false)
  const [newRowLabel, setNewRowLabel] = useState('1')
  const [newRowOrder, setNewRowOrder] = useState<number>(0)

  const [genSeatsOpen, setGenSeatsOpen] = useState(false)
  const [seatPitch, setSeatPitch] = useState(0.5)
  const [startOffset, setStartOffset] = useState(0.2)
  const [endOffset, setEndOffset] = useState(0.2)
  const [seatStart, setSeatStart] = useState(1)
  const [overwriteSeats, setOverwriteSeats] = useState(true)
  const [seatType, setSeatType] = useState<SeatType>('standard')

  const [genSectionRowsSeatsOpen, setGenSectionRowsSeatsOpen] = useState(false)
  const [sectionRowsSeatPitch, setSectionRowsSeatPitch] = useState(0.5)
  const [sectionRowsStartOffset, setSectionRowsStartOffset] = useState(0.2)
  const [sectionRowsEndOffset, setSectionRowsEndOffset] = useState(0.2)
  const [sectionRowsSeatStart, setSectionRowsSeatStart] = useState(1)
  const [sectionRowsOverwrite, setSectionRowsOverwrite] = useState(false)
  const [sectionRowsSeatType, setSectionRowsSeatType] = useState<SeatType>('standard')

  const [genSectionSeatsOpen, setGenSectionSeatsOpen] = useState(false)
  const [sectionSeatPitch, setSectionSeatPitch] = useState(0.5)
  const [sectionRowPitch, setSectionRowPitch] = useState(0.8)
  const [sectionMargin, setSectionMargin] = useState(0.2)
  const [sectionSeatStart, setSectionSeatStart] = useState(1)
  const [sectionOverwrite, setSectionOverwrite] = useState(true)
  const [sectionSeatType, setSectionSeatType] = useState<SeatType>('standard')
  const [sectionMaxSeats, setSectionMaxSeats] = useState(200_000)

  const [bulkSeatType, setBulkSeatType] = useState<SeatType>('standard')

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

  const exportZonesCsvM = useMutation({
    mutationFn: async () => {
      const blob = await downloadZonesCsv(venueId!)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `venue_${venueId}_zones.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => notifications.show({ message: 'Zones CSV download started' }),
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const exportManifestM = useMutation({
    mutationFn: async () => {
      if (!configId) throw new Error('Select a config first')
      const blob = await downloadManifestCsv(venueId!, configId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `venue_${venueId}_config_${configId}_manifest.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => notifications.show({ message: 'Manifest CSV download started' }),
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const exportBreakdownCsvM = useMutation({
    mutationFn: async () => {
      const blob = await downloadBreakdownCsv(venueId!, configId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `venue_${venueId}_breakdown.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => notifications.show({ message: 'Breakdown CSV download started' }),
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
        seat_type: seatType,
        overwrite: overwriteSeats,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setGenSeatsOpen(false)
      notifications.show({ message: `Created ${r.created} seats` })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const genSectionRowsSeatsM = useMutation({
    mutationFn: async () => {
      if (!activeSectionId) throw new Error('Select a section first')
      const sectionRowIds = rows.filter((r: any) => (r.section_id as Id) === activeSectionId).map((r: any) => r.id as Id)
      if (!sectionRowIds.length) throw new Error('No rows in this section')

      let totalCreated = 0
      let okRows = 0
      const errors: string[] = []
      for (const rid of sectionRowIds) {
        try {
          const r = await generateSeats(rid, {
            seat_pitch_m: sectionRowsSeatPitch,
            start_offset_m: sectionRowsStartOffset,
            end_offset_m: sectionRowsEndOffset,
            seat_number_start: sectionRowsSeatStart,
            seat_type: sectionRowsSeatType,
            overwrite: sectionRowsOverwrite,
          })
          totalCreated += r.created
          okRows += 1
        } catch (e) {
          errors.push(String(e))
        }
      }
      return { rows_total: sectionRowIds.length, rows_ok: okRows, seats_created: totalCreated, errors }
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setGenSectionRowsSeatsOpen(false)
      if (r.errors.length) {
        notifications.show({ color: 'yellow', message: `Generated ${r.seats_created} seats on ${r.rows_ok}/${r.rows_total} rows (some rows failed)` })
      } else {
        notifications.show({ message: `Generated ${r.seats_created} seats on ${r.rows_ok}/${r.rows_total} rows` })
      }
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const genSectionSeatsM = useMutation({
    mutationFn: () =>
      generateSeatsInSection(activeSectionId!, {
        seat_pitch_m: sectionSeatPitch,
        row_pitch_m: sectionRowPitch,
        margin_m: sectionMargin,
        seat_number_start: sectionSeatStart,
        seat_type: sectionSeatType,
        overwrite: sectionOverwrite,
        max_seats: sectionMaxSeats,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setGenSectionSeatsOpen(false)
      notifications.show({ message: `Created ${r.seats_created} seats across ${r.rows_created} rows` })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const bulkSeatTypeM = useMutation({
    mutationFn: (payload: { seat_ids: Id[]; seat_type: SeatType }) => bulkUpdateSeatType(payload),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      notifications.show({ message: `Updated seat type for ${r.updated} seats` })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  // (single-seat override updates are handled via applyPaint now)

  const bulkOverrideM = useMutation({
    mutationFn: (payload: { seat_ids: Id[]; status: 'sellable' | 'blocked' | 'kill' }) => bulkUpsertOverrides(configId!, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const batchOverrideM = useMutation({
    mutationFn: (payload: { configId: Id; items: Array<{ seat_id: Id; status: OverrideStatus }> }) =>
      batchUpsertOverrides(payload.configId, { items: payload.items }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
    },
    onError: (e) => notifications.show({ color: 'red', message: String(e) }),
  })

  const [gapStartM, setGapStartM] = useState(0)
  const [gapEndM, setGapEndM] = useState(0.5)
  const rowMetricsQ = useQuery({
    queryKey: ['row-metrics', activeRowId],
    queryFn: () => getRowMetrics(activeRowId!),
    enabled: activeRowId !== null,
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
  const zones = useMemo(() => (data?.zones ?? []) as any[], [data])
  const overrides = useMemo(() => (data?.overrides ?? []) as any[], [data])

  const pitchPoints = useMemo(() => {
    const g = data?.pitch?.geom_json as string | undefined
    if (!g) return null
    const pts = JSON.parse(g) as Array<[number, number]>
    return pts
  }, [data])

  const draftPolyPts = useMemo(() => draftPts.map((p) => [p.x, p.y] as [number, number]), [draftPts])
  const draftZonePolyPts = useMemo(() => draftZonePts.map((p) => [p.x, p.y] as [number, number]), [draftZonePts])

  const draftPolygonIntersection = useMemo(() => {
    if (!(tool === 'draw-pitch' || tool === 'draw-section')) return null
    if (draftPolyPts.length < 4) return null
    return polygonSelfIntersection(draftPolyPts)
  }, [tool, draftPolyPts])

  const draftZoneIntersection = useMemo(() => {
    if (tool !== 'draw-zone') return null
    if (draftZonePolyPts.length < 4) return null
    return polygonSelfIntersection(draftZonePolyPts)
  }, [tool, draftZonePolyPts])

  const draftPolygonInvalid = useMemo(() => {
    if (!(tool === 'draw-pitch' || tool === 'draw-section')) return false
    if (draftPolyPts.length >= 3 && polygonArea(draftPolyPts) <= 1e-6) return true
    return Boolean(draftPolygonIntersection)
  }, [tool, draftPolyPts, draftPolygonIntersection])

  const draftZoneInvalid = useMemo(() => {
    if (tool !== 'draw-zone') return false
    if (draftZonePolyPts.length >= 3 && polygonArea(draftZonePolyPts) <= 1e-6) return true
    return Boolean(draftZoneIntersection)
  }, [tool, draftZonePolyPts, draftZoneIntersection])

  const overrideBySeatId = useMemo(() => new Map(overrides.map((o) => [o.seat_id as Id, o])), [overrides])
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id as Id, r])), [rows])
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id as Id, s])), [sections])
  const levelById = useMemo(() => new Map(levels.map((l) => [l.id as Id, l])), [levels])
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id as Id, z])), [zones])

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
      seat_type: s.seat_type as string,
      x: s.x_m,
      y: s.y_m,
      row: r?.label,
      section: sec?.code,
      level: lvl?.name,
    }
  }, [selectedSeatId, seats, rowById, sectionById, levelById, overrideBySeatId])

  const zoneInfo = useMemo(() => {
    if (!selectedZoneId) return null
    const z = zoneById.get(selectedZoneId)
    if (!z) return null
    const sec = sectionById.get(z.section_id as Id)
    const lvl = sec ? levelById.get(sec.level_id as Id) : null
    return {
      id: selectedZoneId,
      name: z.name as string,
      capacity: z.capacity as number,
      zone_type: z.zone_type as string,
      section: sec?.code as string | undefined,
      level: lvl?.name as string | undefined,
    }
  }, [selectedZoneId, zoneById, sectionById, levelById])

  const summaryQ = useQuery({
    queryKey: ['summary', venueId, configId],
    queryFn: () => getVenueSummary(venueId!, configId),
    enabled: venueId !== null,
  })

  const breakdownQ = useQuery({
    queryKey: ['breakdown', venueId, configId],
    queryFn: () => getVenueSummaryBreakdown(venueId!, configId),
    enabled: venueId !== null,
  })

  const [editZoneOpen, setEditZoneOpen] = useState(false)
  const [editZoneName, setEditZoneName] = useState('')
  const [editZoneCap, setEditZoneCap] = useState(0)
  const [densityPerM2, setDensityPerM2] = useState(2.0)
  const [zoneAuto, setZoneAuto] = useState(false)

  const [breakdownView, setBreakdownView] = useState<'sections' | 'levels'>('sections')
  const [breakdownFilter, setBreakdownFilter] = useState('')
  const [breakdownSort, setBreakdownSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [breakdownPage, setBreakdownPage] = useState(1)
  const [breakdownPageSize, setBreakdownPageSize] = useState(30)

  useEffect(() => {
    if (!zoneInfo) return
    setEditZoneName(zoneInfo.name)
    setEditZoneCap(zoneInfo.capacity)
    const z = zoneById.get(zoneInfo.id) as any
    setZoneAuto((z?.capacity_mode ?? 'manual') === 'auto')
    setDensityPerM2(Number(z?.density_per_m2 ?? 2.0))
  }, [zoneInfo])

  const zoneAutoPreview = useMemo(() => {
    if (!selectedZoneId) return null
    const z = zoneById.get(selectedZoneId) as any
    if (!z) return null
    let pts: Array<[number, number]> | null = null
    try {
      pts = JSON.parse(z.geom_json as string) as Array<[number, number]>
    } catch {
      pts = null
    }
    if (!pts) return null
    const area = polygonArea(pts)
    const cap = Math.max(0, Math.round(area * Number(densityPerM2 || 0)))
    return { area_m2: area, computed_capacity: cap }
  }, [selectedZoneId, zoneById, densityPerM2])

  const breakdownRows = useMemo(() => {
    const data = breakdownQ.data as any
    if (!data) return []
    const raw = breakdownView === 'sections' ? (data.sections as any[]) : (data.levels as any[])
    const q = breakdownFilter.trim().toLowerCase()
    const filtered = q
      ? raw.filter((r) => {
          const name = breakdownView === 'sections' ? `${r.level_name}/${r.section_code}` : `${r.level_name}`
          return String(name).toLowerCase().includes(q)
        })
      : raw
    const getName = (r: any) => (breakdownView === 'sections' ? `${r.level_name}/${r.section_code}` : `${r.level_name}`)
    const getNum = (r: any, k: string) => Number(r[k] ?? 0)
    const dir = breakdownSort.dir === 'asc' ? 1 : -1
    const key = breakdownSort.key
    return [...filtered].sort((a, b) => {
      if (key === 'name') return dir * getName(a).localeCompare(getName(b))
      return dir * (getNum(a, key) - getNum(b, key))
    })
  }, [breakdownQ.data, breakdownView, breakdownFilter, breakdownSort])

  const breakdownTotalPages = Math.max(1, Math.ceil(breakdownRows.length / Math.max(1, breakdownPageSize)))
  const breakdownPageRows = breakdownRows.slice(
    (Math.max(1, breakdownPage) - 1) * Math.max(1, breakdownPageSize),
    (Math.max(1, breakdownPage) - 1) * Math.max(1, breakdownPageSize) + Math.max(1, breakdownPageSize),
  )

  useEffect(() => {
    // reset pagination when switching view/filter/sort
    setBreakdownPage(1)
  }, [breakdownView, breakdownFilter, breakdownSort])

  function boundsFromPoints(pts: Array<[number, number]>): { minX: number; minY: number; maxX: number; maxY: number } | null {
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

  function animateView(target: { pan: { x: number; y: number }; scale: number }, durationMs = 220) {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    const startPan = panRef.current
    const startScale = scaleRef.current
    const start = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs)
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      const nextScale = startScale + (target.scale - startScale) * ease
      const nextPan = {
        x: startPan.x + (target.pan.x - startPan.x) * ease,
        y: startPan.y + (target.pan.y - startPan.y) * ease,
      }
      setScale(nextScale)
      setPan(nextPan)
      if (k < 1) animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }

  function zoomToBounds(b: { minX: number; minY: number; maxX: number; maxY: number }) {
    const vw = Math.max(300, stageW)
    const vh = Math.max(300, stageH)
    const pad = 40 // pixels
    const w = Math.max(1e-6, b.maxX - b.minX)
    const h = Math.max(1e-6, b.maxY - b.minY)
    const nextScale = Math.min((vw - pad) / w, (vh - pad) / h)
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    animateView({ scale: nextScale, pan: { x: vw / 2 - cx * nextScale, y: vh / 2 - cy * nextScale } })
  }

  function zoomToSection(sectionId: Id) {
    const sec = sections.find((s) => (s.id as Id) === sectionId)
    if (!sec) return
    try {
      const pts = JSON.parse(sec.geom_json as string) as Array<[number, number]>
      const b = boundsFromPoints(pts)
      if (b) zoomToBounds(b)
    } catch {
      // ignore
    }
  }

  function zoomToLevel(levelId: Id) {
    const secs = sections.filter((s) => (s.level_id as Id) === levelId)
    const allPts: Array<[number, number]> = []
    for (const s of secs) {
      try {
        const pts = JSON.parse(s.geom_json as string) as Array<[number, number]>
        allPts.push(...pts)
      } catch {
        // ignore
      }
    }
    const b = boundsFromPoints(allPts)
    if (b) zoomToBounds(b)
  }

  function fitToVenue() {
    // Fit all sections; fallback to pitch; fallback to a default view.
    const allPts: Array<[number, number]> = []
    for (const s of sections) {
      try {
        const pts = JSON.parse(s.geom_json as string) as Array<[number, number]>
        allPts.push(...pts)
      } catch {}
    }
    if (allPts.length) {
      const b = boundsFromPoints(allPts)
      if (b) return zoomToBounds(b)
    }
    if (pitchPoints?.length) {
      const b = boundsFromPoints(pitchPoints)
      if (b) return zoomToBounds(b)
    }
    animateView({ scale: 1, pan: { x: stageW / 2, y: stageH / 2 } })
  }

  function resetView() {
    animateView({ scale: defaultView.scale, pan: defaultView.pan })
  }

  function fitToSelection() {
    // Priority: active section -> selected zone -> selected seats -> active row
    if (activeSectionId) {
      const sec = sections.find((s) => (s.id as Id) === activeSectionId)
      if (sec) {
        try {
          const pts = JSON.parse(sec.geom_json as string) as Array<[number, number]>
          const b = boundsFromPoints(pts)
          if (b) return zoomToBounds(b)
        } catch {}
      }
    }

    if (selectedZoneId) {
      const z = zones.find((zz) => (zz.id as Id) === selectedZoneId)
      if (z) {
        try {
          const pts = JSON.parse(z.geom_json as string) as Array<[number, number]>
          const b = boundsFromPoints(pts)
          if (b) return zoomToBounds(b)
        } catch {}
      }
    }

    if (selectedSeatIds.size > 0) {
      const pts: Array<[number, number]> = []
      for (const s of seats) {
        const id = s.id as Id
        if (!selectedSeatIds.has(id)) continue
        pts.push([s.x_m as number, s.y_m as number])
      }
      const b = boundsFromPoints(pts)
      if (b) return zoomToBounds(b)
    }

    if (selectedSeatId) {
      const s = seats.find((x) => (x.id as Id) === selectedSeatId)
      if (s) return zoomToBounds({ minX: s.x_m as number, minY: s.y_m as number, maxX: s.x_m as number, maxY: s.y_m as number })
    }

    if (activeRowId) {
      const r = rows.find((x) => (x.id as Id) === activeRowId)
      if (r) {
        try {
          const path = JSON.parse(r.geom_json as string) as { segments: any[] }
          const pts: Array<[number, number]> = []
          for (const seg of path.segments) {
            if (seg.type === 'line') {
              pts.push([seg.x1, seg.y1], [seg.x2, seg.y2])
            } else if (seg.type === 'arc') {
              for (let i = 0; i <= 24; i++) {
                const p = pointOnArc(seg, i / 24)
                pts.push([p.x, p.y])
              }
            }
          }
          const b = boundsFromPoints(pts)
          if (b) return zoomToBounds(b)
        } catch {}
      }
    }
  }

  const hoverSeatInfo = useMemo(() => {
    if (!hoverSeatId) return null
    const s = seats.find((x) => (x.id as Id) === hoverSeatId)
    if (!s) return null
    const r = rowById.get(s.row_id as Id)
    const sec = r ? sectionById.get(r.section_id as Id) : null
    const lvl = sec ? levelById.get(sec.level_id as Id) : null
    const code = lvl && sec && r ? `${lvl.name}-${sec.code}-${r.label}-${s.seat_number}` : `${hoverSeatId}`
    return { code, x: s.x_m as number, y: s.y_m as number }
  }, [hoverSeatId, seats, rowById, sectionById, levelById])

  const levelOptions = levels.map((l) => ({ value: String(l.id), label: l.name }))
  const sectionOptions = sections
    .filter((s) => (activeLevelId ? s.level_id === activeLevelId : true))
    .map((s) => ({ value: String(s.id), label: s.code }))
  const rowOptions = rows
    .filter((r) => (activeSectionId ? r.section_id === activeSectionId : true))
    .filter((r) => String((r as any).label ?? '') !== '__MANUAL__')
    .map((r) => ({ value: String(r.id), label: r.label }))

  function snap(p: Pt): Pt {
    if (!snapEnabled) return p
    const step = Math.max(0.001, gridStep)
    const grid = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }

    // Snap-to-geometry: nearest section/row vertex or edge within tolerance.
    const tol = Math.max(step * 2, 0.25)
    let bestPoint: Pt | null = null
    let bestDist = Number.POSITIVE_INFINITY

    const consider = (q: Pt) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d <= tol && d < bestDist) {
        bestDist = d
        bestPoint = q
      }
    }

    // vertices (sections)
    for (const s of sections) {
      try {
        const pts = JSON.parse(s.geom_json as string) as Array<[number, number]>
        for (const [x, y] of pts) consider({ x, y })
        // edges
        for (let i = 0; i < pts.length; i++) {
          const a = { x: pts[i]![0], y: pts[i]![1] }
          const b = { x: pts[(i + 1) % pts.length]![0], y: pts[(i + 1) % pts.length]![1] }
          consider(closestPointOnSegment(p, a, b))
        }
      } catch {
        // ignore
      }
    }

    // rows (line segments + sampled arcs)
    for (const r of rows) {
      try {
        const path = JSON.parse(r.geom_json as string) as { segments: any[] }
        for (const seg of path.segments) {
          if (seg.type === 'line') {
            consider({ x: seg.x1, y: seg.y1 })
            consider({ x: seg.x2, y: seg.y2 })
            consider(closestPointOnSegment(p, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }))
          } else if (seg.type === 'arc') {
            // sample for edge snapping
            for (let i = 0; i <= 24; i++) consider(pointOnArc(seg, i / 24))
          }
        }
      } catch {
        // ignore
      }
    }

    return bestPoint ?? grid
  }

  function stageToWorld(stage: any): Pt {
    const pos = stage.getPointerPosition()
    if (!pos) return { x: 0, y: 0 }
    return snap({ x: (pos.x - pan.x) / scale, y: (pos.y - pan.y) / scale })
  }

  function dist(a: Pt, b: Pt): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function finishDrawing() {
    if (tool === 'draw-pitch') {
      if (draftPts.length >= 3) {
        if (draftPolygonIntersection) {
          notifications.show({
            color: 'red',
            message: `Pitch polygon self-intersects near (${draftPolygonIntersection[0].toFixed(2)}, ${draftPolygonIntersection[1].toFixed(2)}). Undo last point (Ctrl/Cmd+Z) or adjust points.`,
          })
          return
        }
        if (polygonArea(draftPolyPts) <= 1e-6) {
          notifications.show({ color: 'red', message: 'Pitch polygon area is ~0. Adjust points and try again.' })
          return
        }
        upsertPitchM.mutate(draftPts.map((p) => [p.x, p.y]))
        setDraftPts([])
      }
      return
    }
    if (tool === 'draw-section') {
      if (draftPts.length >= 3) {
        if (draftPolygonIntersection) {
          notifications.show({
            color: 'red',
            message: `Section polygon self-intersects near (${draftPolygonIntersection[0].toFixed(2)}, ${draftPolygonIntersection[1].toFixed(2)}). Undo last point (Ctrl/Cmd+Z) or adjust points.`,
          })
          return
        }
        if (polygonArea(draftPolyPts) <= 1e-6) {
          notifications.show({ color: 'red', message: 'Section polygon area is ~0. Adjust points and try again.' })
          return
        }
        setCreateSectionOpen(true)
      }
      return
    }
    if (tool === 'draw-zone') {
      if (draftZonePts.length >= 3) {
        if (draftZoneIntersection) {
          notifications.show({
            color: 'red',
            message: `Zone polygon self-intersects near (${draftZoneIntersection[0].toFixed(2)}, ${draftZoneIntersection[1].toFixed(2)}). Undo last point (Ctrl/Cmd+Z) or adjust points.`,
          })
          return
        }
        if (polygonArea(draftZonePolyPts) <= 1e-6) {
          notifications.show({ color: 'red', message: 'Zone polygon area is ~0. Adjust points and try again.' })
          return
        }
        setCreateZoneOpen(true)
      }
      return
    }
    if (tool === 'draw-row-line') {
      if (draftRowPts.length >= 2) setCreateRowOpen(true)
      return
    }
    if (tool === 'draw-row-arc') {
      if (draftArcPts.length === 3) setCreateRowOpen(true)
      return
    }
    if (tool === 'seat-poly') {
      if (draftSeatPath.length >= 2) {
        setSeatDesignMode('poly')
        setSeatDesignModalOpen(true)
      }
      return
    }
  }

  function onStageClick(e: any) {
    if (!venueId) return
    const stage = e.target.getStage()
    const p = stageToWorld(stage)

    const closeTol = Math.max(0.25, gridStep * 2)

    if (tool === 'draw-pitch' || tool === 'draw-section') {
      if (draftPts.length >= 3 && dist(p, draftPts[0]!) <= closeTol) {
        finishDrawing()
        return
      }
      setDraftPts((prev) => [...prev, p])
      return
    }

    if (tool === 'draw-zone') {
      if (draftZonePts.length >= 3 && dist(p, draftZonePts[0]!) <= closeTol) {
        finishDrawing()
        return
      }
      setDraftZonePts((prev) => [...prev, p])
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

    if (tool === 'seat-place') {
      if (!activeSectionId) return
      createSeatsInSectionBulk(activeSectionId, {
        seat_number_start: seatDesignStart,
        enforce_inside: seatEnforceInside,
        items: [{ x_m: p.x, y_m: p.y, seat_type: seatDesignType }],
      })
        .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
        .catch((err) => notifications.show({ color: 'red', message: String(err) }))
      return
    }

    if (tool === 'seat-line') {
      setSeatDesignMode('line')
      setDraftSeatPath((prev) => {
        const next = prev.length >= 2 ? [p] : [...prev, p]
        if (next.length === 2) setSeatDesignModalOpen(true)
        return next
      })
      return
    }

    if (tool === 'seat-poly') {
      setDraftSeatPath((prev) => [...prev, p])
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
    setSelectMode(e.evt.shiftKey ? 'select' : 'paint')
  }

  function onMouseMove(e: any) {
    const stage = e.target.getStage()
    const p = stageToWorld(stage)
    setCursorWorld(p)
    if (!selecting) return
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
    if (selectMode === 'select') {
      setSelectedSeatIds((prev) => new Set([...prev, ...ids]))
      notifications.show({ message: `Selected ${ids.length} seats (shift-drag)` })
    } else {
      const status = tool === 'paint-blocked' ? 'blocked' : tool === 'paint-kill' ? 'kill' : 'sellable'
      applyPaint(ids, status)
        .then(() => notifications.show({ message: `Painted ${ids.length} seats` }))
        .catch((e) => notifications.show({ color: 'red', message: String(e) }))
    }
    setSelectMode(null)
  }

  const activeRowPath = useMemo(() => {
    if (!activeRowId) return null
    const r = rows.find((x) => (x.id as Id) === activeRowId)
    if (!r) return null
    try {
      return JSON.parse(r.geom_json as string) as { segments: PathSeg[]; gaps?: Array<[number, number]> }
    } catch {
      return null
    }
  }, [activeRowId, rows])

  const activeRowGaps = (activeRowPath?.gaps ?? []) as Array<[number, number]>

  function updateActiveRowGaps(nextGaps: Array<[number, number]>) {
    if (!activeRowId || !activeRowPath) return
    updateRowPath(activeRowId, { segments: activeRowPath.segments, gaps: nextGaps })
      .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
      .catch((e) => notifications.show({ color: 'red', message: String(e) }))
  }

  // Editable handles for active section polygon
  const activeSectionPoints = useMemo(() => {
    if (!activeSectionId) return null
    const sec = sections.find((s) => (s.id as Id) === activeSectionId)
    if (!sec) return null
    return JSON.parse(sec.geom_json as string) as Array<[number, number]>
  }, [activeSectionId, sections])

  const activeSectionArea = useMemo(() => {
    if (!activeSectionPoints) return null
    return polygonArea(activeSectionPoints)
  }, [activeSectionPoints])

  const sectionGridEstimate = useMemo(() => {
    if (activeSectionArea === null) return null
    const denom = Math.max(1e-9, sectionSeatPitch * sectionRowPitch)
    return Math.round(activeSectionArea / denom)
  }, [activeSectionArea, sectionSeatPitch, sectionRowPitch])

  // Editable handles for active row line vertices (only if all segments are line)
  const activeRowLineVertices = useMemo(() => {
    if (!activeRowPath) return null
    const segs = activeRowPath.segments
    if (!segs.every((s) => s.type === 'line')) return null
    const pts: Array<[number, number]> = []
    const first = segs[0] as any
    pts.push([first.x1, first.y1])
    for (const seg of segs as any[]) pts.push([seg.x2, seg.y2])
    return pts
  }, [activeRowPath])

  function commitSectionPoint(idx: number, x: number, y: number) {
    if (!activeSectionId || !activeSectionPoints) return
    const next = activeSectionPoints.map((p, i): [number, number] => (i === idx ? [x, y] : [p[0], p[1]]))
    updateSection(activeSectionId, next as Array<[number, number]>)
      .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
      .catch((e) => notifications.show({ color: 'red', message: String(e) }))
  }

  function commitRowVertex(idx: number, x: number, y: number) {
    if (!activeRowId || !activeRowLineVertices) return
    const nextVerts = activeRowLineVertices.map((p, i): [number, number] => (i === idx ? [x, y] : [p[0], p[1]]))
    const segs: PathSeg[] = []
    for (let i = 0; i < nextVerts.length - 1; i++) {
      const a = nextVerts[i]!
      const b = nextVerts[i + 1]!
      segs.push({ type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] })
    }
    updateRowPath(activeRowId, { segments: segs, gaps: activeRowGaps })
      .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
      .catch((e) => notifications.show({ color: 'red', message: String(e) }))
  }

  function onStageDblClick() {
    finishDrawing()
  }

  function undo() {
    if (tool === 'draw-pitch' || tool === 'draw-section') setDraftPts((p) => p.slice(0, -1))
    if (tool === 'draw-row-line') setDraftRowPts((p) => p.slice(0, -1))
    if (tool === 'draw-row-arc') setDraftArcPts((p) => p.slice(0, -1))
    if (tool === 'draw-zone') setDraftZonePts((p) => p.slice(0, -1))
    if (tool === 'seat-line' || tool === 'seat-poly') setDraftSeatPath((p) => p.slice(0, -1))
  }

  function cancelDraft() {
    setDraftPts([])
    setDraftRowPts([])
    setDraftArcPts([])
    setDraftZonePts([])
    setDraftSeatPath([])
    setDraftSeatDots([])
  }

  function pointsAlongLine(a: Pt, b: Pt, count: number): Pt[] {
    const n = Math.max(1, Math.floor(count))
    if (n === 1) return [a]
    const pts: Pt[] = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
    return pts
  }

  function pointsAlongPolyline(poly: Pt[], pitch: number): Pt[] {
    const out: Pt[] = []
    if (poly.length < 2) return out
    const step = Math.max(0.05, pitch)
    let segIdx = 0
    let segT = 0
    let cur = { ...poly[0]! }
    out.push(cur)

    const segLen = (i: number) => Math.hypot(poly[i + 1]!.x - poly[i]!.x, poly[i + 1]!.y - poly[i]!.y)
    let remainingInSeg = segLen(0)

    while (segIdx < poly.length - 1) {
      if (remainingInSeg >= step) {
        segT += step / remainingInSeg
        const a = poly[segIdx]!
        const b = poly[segIdx + 1]!
        cur = { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT }
        out.push(cur)
        remainingInSeg = remainingInSeg - step
      } else {
        segIdx += 1
        segT = 0
        if (segIdx >= poly.length - 1) break
        remainingInSeg = segLen(segIdx)
      }
      if (out.length > 5000) break
    }
    return out
  }

  function commitSeatDesign() {
    if (!activeSectionId) return
    let pts: Pt[] = []
    if (seatDesignMode === 'line') {
      if (draftSeatPath.length < 2) return
      pts = pointsAlongLine(draftSeatPath[0]!, draftSeatPath[1]!, seatDesignCount)
    } else {
      if (draftSeatPath.length < 2) return
      pts = pointsAlongPolyline(draftSeatPath, seatDesignPitch)
    }
    setDraftSeatDots(pts)
    createSeatsInSectionBulk(activeSectionId, {
      seat_number_start: seatDesignStart,
      enforce_inside: seatEnforceInside,
      items: pts.map((q) => ({ x_m: q.x, y_m: q.y, seat_type: seatDesignType })),
    })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
        setSeatDesignModalOpen(false)
        setDraftSeatPath([])
        setDraftSeatDots([])
        notifications.show({ message: 'Seats created' })
      })
      .catch((err) => notifications.show({ color: 'red', message: String(err) }))
  }

  function makeUniqueCopyName(base: string, existing: Set<string>): string {
    const trimmed = base.trim() || 'Copy'
    const candidates = [
      `${trimmed} copy`,
      `${trimmed} copy 2`,
      `${trimmed} copy 3`,
      `${trimmed} copy 4`,
      `${trimmed} copy 5`,
    ]
    for (const c of candidates) {
      if (!existing.has(c)) return c
    }
    // fallback
    let i = 2
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const c = `${trimmed} copy ${i}`
      if (!existing.has(c)) return c
      i++
    }
  }

  function translatePoints(pts: Array<[number, number]>, dx: number, dy: number): Array<[number, number]> {
    return pts.map(([x, y]) => [x + dx, y + dy])
  }

  function translateSegments(segs: any[], dx: number, dy: number): PathSeg[] {
    const out: PathSeg[] = []
    for (const seg of segs) {
      if (seg.type === 'line') {
        out.push({ type: 'line', x1: seg.x1 + dx, y1: seg.y1 + dy, x2: seg.x2 + dx, y2: seg.y2 + dy })
      } else if (seg.type === 'arc') {
        out.push({
          type: 'arc',
          cx: seg.cx + dx,
          cy: seg.cy + dy,
          r: seg.r,
          start_deg: seg.start_deg,
          end_deg: seg.end_deg,
          cw: Boolean(seg.cw),
        })
      }
    }
    return out
  }

  async function duplicateSelected() {
    if (!venueId) return
    const DX = 1.0
    const DY = 1.0

    // Zone
    if (selectedZoneId) {
      const z = zoneById.get(selectedZoneId) as any
      if (!z) return
      let pts: Array<[number, number]>
      try {
        pts = JSON.parse(z.geom_json as string) as Array<[number, number]>
      } catch {
        return
      }
      const sectionId = z.section_id as Id
      const existingNames = new Set(zones.filter((zz: any) => (zz.section_id as Id) === sectionId).map((zz: any) => String(zz.name ?? '')))
      const name = makeUniqueCopyName(String(z.name ?? 'Zone'), existingNames)
      const created = await createZone(sectionId, {
        name,
        capacity: Number(z.capacity ?? 0),
        polygonPoints: translatePoints(pts, DX, DY),
      })
      // preserve auto-capacity fields if present
      const capacity_mode = (z.capacity_mode as any) ?? undefined
      const density_per_m2 = z.density_per_m2 !== undefined ? Number(z.density_per_m2) : undefined
      if (capacity_mode !== undefined || density_per_m2 !== undefined) {
        await updateZone(created.id, { capacity_mode, density_per_m2 })
      }
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setSelectedZoneId(created.id)
      setSelectedSeatId(null)
      notifications.show({ message: 'Zone duplicated' })
      return
    }

    // Row
    if (activeRowId) {
      const r = rowById.get(activeRowId) as any
      if (!r) return
      let path: { segments: any[]; gaps?: Array<[number, number]> }
      try {
        path = JSON.parse(r.geom_json as string) as any
      } catch {
        return
      }
      const sectionId = r.section_id as Id
      const existingLabels = new Set(rows.filter((rr: any) => (rr.section_id as Id) === sectionId).map((rr: any) => String(rr.label ?? '')))
      const label = makeUniqueCopyName(String(r.label ?? 'Row'), existingLabels)
      const segs = translateSegments(path.segments ?? [], DX, DY)
      const created = await createRow(sectionId, {
        label,
        order_index: Number(r.order_index ?? 0) + 1,
        segments: segs,
      })
      const gaps = (path.gaps ?? []) as Array<[number, number]>
      if (gaps.length) await updateRowPath(created.id, { segments: segs, gaps })
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setActiveSectionId(sectionId)
      setActiveRowId(created.id)
      notifications.show({ message: 'Row duplicated (seats not copied)' })
      return
    }

    async function cloneSectionToLevel(sectionId: Id, targetLevelId: Id, dx: number, dy: number): Promise<Id | null> {
      const sec = sectionById.get(sectionId) as any
      if (!sec) return null
      let pts: Array<[number, number]>
      try {
        pts = JSON.parse(sec.geom_json as string) as Array<[number, number]>
      } catch {
        return null
      }
      const existingCodes = new Set(sections.filter((s: any) => (s.level_id as Id) === targetLevelId).map((s: any) => String(s.code ?? '')))
      const code = makeUniqueCopyName(String(sec.code ?? 'Section'), existingCodes).replace(' copy', '-copy')

      const createdSec = await createSection(targetLevelId, { code, polygonPoints: translatePoints(pts, dx, dy) })

      // clone zones + rows from original section into new section
      const srcZones = zones.filter((z: any) => (z.section_id as Id) === (sec.id as Id))
      const usedZoneNames = new Set<string>()
      for (const z of srcZones) usedZoneNames.add(String(z.name ?? ''))
      const zoneNameSet = new Set<string>()

      for (const z of srcZones as any[]) {
        let zPts: Array<[number, number]>
        try {
          zPts = JSON.parse(z.geom_json as string) as Array<[number, number]>
        } catch {
          continue
        }
        const zName = makeUniqueCopyName(String(z.name ?? 'Zone'), zoneNameSet.size ? zoneNameSet : usedZoneNames)
        zoneNameSet.add(zName)
        const createdZ = await createZone(createdSec.id, {
          name: zName,
          capacity: Number(z.capacity ?? 0),
          polygonPoints: translatePoints(zPts, dx, dy),
        })
        const capacity_mode = (z.capacity_mode as any) ?? undefined
        const density_per_m2 = z.density_per_m2 !== undefined ? Number(z.density_per_m2) : undefined
        if (capacity_mode !== undefined || density_per_m2 !== undefined) {
          await updateZone(createdZ.id, { capacity_mode, density_per_m2 })
        }
      }

      const srcRows = rows.filter((rr: any) => (rr.section_id as Id) === (sec.id as Id))
      const rowLabelSet = new Set<string>()
      for (const rr of srcRows as any[]) {
        let path: { segments: any[]; gaps?: Array<[number, number]> }
        try {
          path = JSON.parse(rr.geom_json as string) as any
        } catch {
          continue
        }
        const label = rowLabelSet.has(String(rr.label ?? ''))
          ? makeUniqueCopyName(String(rr.label ?? 'Row'), rowLabelSet)
          : String(rr.label ?? 'Row')
        rowLabelSet.add(label)
        const segs = translateSegments(path.segments ?? [], dx, dy)
        const createdR = await createRow(createdSec.id, { label, order_index: Number(rr.order_index ?? 0), segments: segs })
        const gaps = (path.gaps ?? []) as Array<[number, number]>
        if (gaps.length) await updateRowPath(createdR.id, { segments: segs, gaps })
      }

      return createdSec.id
    }

    // Section (clone section + its rows + zones)
    if (activeSectionId) {
      const sec = sectionById.get(activeSectionId) as any
      if (!sec) return
      const newId = await cloneSectionToLevel(activeSectionId, sec.level_id as Id, DX, DY)
      if (!newId) return
      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setActiveLevelId(sec.level_id as Id)
      setActiveSectionId(newId)
      setActiveRowId(null)
      notifications.show({ message: 'Section duplicated (rows/zones copied; seats not copied)' })
      return
    }

    // Level (clone level + all sections + their rows/zones)
    if (activeLevelId) {
      const lvl = levelById.get(activeLevelId) as any
      if (!lvl) return
      const existingLevelNames = new Set(levels.filter((l: any) => (l.venue_id as Id) === venueId).map((l: any) => String(l.name ?? '')))
      const name = makeUniqueCopyName(String(lvl.name ?? 'Level'), existingLevelNames)
      const createdL = await createLevel(venueId, { name, z_base_m: lvl.z_base_m !== undefined ? Number(lvl.z_base_m) : undefined })

      const srcSecs = sections.filter((s: any) => (s.level_id as Id) === (lvl.id as Id))
      const LDX = 5.0
      const LDY = 5.0
      for (const s of srcSecs as any[]) {
        await cloneSectionToLevel(s.id as Id, createdL.id as Id, LDX, LDY)
      }

      await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
      setActiveLevelId(createdL.id)
      setActiveSectionId(null)
      setActiveRowId(null)
      notifications.show({ message: 'Level duplicated (sections/rows/zones copied; seats not copied)' })
      return
    }
  }

  function onWheel(e: any) {
    e.evt.preventDefault()
    if (animRef.current) cancelAnimationFrame(animRef.current)
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = (target?.tagName || '').toLowerCase()
      const isTyping =
        tag === 'input' ||
        tag === 'textarea' ||
        (target instanceof HTMLElement && target.isContentEditable)

      if (e.key === 'Escape') cancelDraft()
      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        // finish current drawing tool
        finishDrawing()
      }

      // Delete selected object (when not typing)
      if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Prefer the most specific selection first.
        if (selectedZoneId) {
          e.preventDefault()
          modals.openConfirmModal({
            title: 'Delete zone?',
            children: <Text size="sm" c="dimmed">This will permanently delete the standing zone.</Text>,
            labels: { confirm: 'Delete zone', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
              await deleteZone(selectedZoneId)
              await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
              setSelectedZoneId(null)
              notifications.show({ message: 'Zone deleted' })
            },
          })
          return
        }

        if (activeRowId) {
          e.preventDefault()
          modals.openConfirmModal({
            title: 'Delete row?',
            children: <Text size="sm" c="dimmed">This will delete the row and all generated seats for it.</Text>,
            labels: { confirm: 'Delete row', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
              await deleteRow(activeRowId)
              await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
              setActiveRowId(null)
              notifications.show({ message: 'Row deleted' })
            },
          })
          return
        }

        if (activeSectionId) {
          e.preventDefault()
          modals.openConfirmModal({
            title: 'Delete section?',
            children: <Text size="sm" c="dimmed">This will delete the section, its rows, seats, and standing zones.</Text>,
            labels: { confirm: 'Delete section', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
              await deleteSection(activeSectionId)
              await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
              setActiveSectionId(null)
              setActiveRowId(null)
              notifications.show({ message: 'Section deleted' })
            },
          })
          return
        }

        if (activeLevelId) {
          e.preventDefault()
          modals.openConfirmModal({
            title: 'Delete level?',
            children: <Text size="sm" c="dimmed">This will delete the level and all of its sections.</Text>,
            labels: { confirm: 'Delete level', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
              await deleteLevel(activeLevelId)
              await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
              setActiveLevelId(null)
              setActiveSectionId(null)
              setActiveRowId(null)
              notifications.show({ message: 'Level deleted' })
            },
          })
          return
        }

        if (venueId && pitchPoints?.length) {
          e.preventDefault()
          modals.openConfirmModal({
            title: 'Delete pitch?',
            children: <Text size="sm" c="dimmed">This will remove the pitch/stage polygon from the venue.</Text>,
            labels: { confirm: 'Delete pitch', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
              await deletePitch(venueId)
              await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
              notifications.show({ message: 'Pitch deleted' })
            },
          })
          return
        }
      }

      // Duplicate selected object (when not typing)
      if (!isTyping && (e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected().catch((err) => notifications.show({ color: 'red', message: String(err) }))
        return
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        const hasDraft = (draftPts.length + draftRowPts.length + draftArcPts.length + draftZonePts.length) > 0
        if (hasDraft) {
          undo()
        } else if (paintUndo.length > 0) {
          doUndoPaint()
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault()
        if (paintRedo.length > 0) doRedoPaint()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        if (paintRedo.length > 0) doRedoPaint()
      }
      if (e.key === 'f' || e.key === 'F') fitToSelection()
      if (e.key === 'r' || e.key === 'R') resetView()
      if (e.key === '?' || (e.shiftKey && e.key === '/')) setHelpOpen(true)
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(50, s * 1.1))
      if (e.key === '-' || e.key === '_') setScale((s) => Math.max(0.05, s / 1.1))
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === ')')) {
        e.preventDefault()
        fitToVenue()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, pitchPoints, stageW, stageH, tool, draftPts, draftRowPts, draftArcPts, draftZonePts, paintUndo, paintRedo])

  function getSeatStatus(seatId: Id): OverrideStatus {
    const o = overrideBySeatId.get(seatId)
    return (o?.status as OverrideStatus) ?? 'sellable'
  }

  async function applyPaint(seatIds: Id[], status: OverrideStatus) {
    if (!configId) return
    const unique = Array.from(new Set(seatIds))
    if (unique.length === 0) return
    const before = unique.map((id) => ({ seat_id: id, status: getSeatStatus(id) }))
    const after = unique.map((id) => ({ seat_id: id, status }))
    await bulkUpsertOverrides(configId, { seat_ids: unique, status })
    await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
    setPaintUndo((s) => [...s, { configId, before, after }])
    setPaintRedo([])
  }

  function doUndoPaint() {
    const last = paintUndo[paintUndo.length - 1]
    if (!last) return
    batchOverrideM.mutate({ configId: last.configId, items: last.before })
    setPaintUndo((s) => s.slice(0, -1))
    setPaintRedo((s) => [...s, last])
  }

  function doRedoPaint() {
    const last = paintRedo[paintRedo.length - 1]
    if (!last) return
    batchOverrideM.mutate({ configId: last.configId, items: last.after })
    setPaintRedo((s) => s.slice(0, -1))
    setPaintUndo((s) => [...s, last])
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
        <TopBar
          venues={(venuesQ.data ?? []) as any}
          configs={(configsQ.data ?? []) as any}
          venueId={venueId}
          configId={configId}
          onVenueChange={(id) => {
            setVenueId(id)
            setActiveLevelId(null)
            setActiveSectionId(null)
            setActiveRowId(null)
          }}
          onConfigChange={(id) => setConfigId(id)}
          onNewVenue={() => setCreateVenueOpen(true)}
          onNewConfig={() => setCreateConfigOpen(true)}
          onExportPackage={() => exportM.mutate()}
          onExportSeatsCsv={() => exportCsvM.mutate()}
          onExportZonesCsv={() => exportZonesCsvM.mutate()}
          onExportManifest={() => exportManifestM.mutate()}
          onImportPackage={() => importM.mutate()}
          onDeleteVenue={() => {
            if (!venueId) return
            modals.openConfirmModal({
              title: 'Delete venue?',
              children: (
                <Text size="sm" c="dimmed">
                  This will permanently delete the venue and all of its levels, sections, rows, seats, configs, overrides, and zones.
                </Text>
              ),
              labels: { confirm: 'Delete venue', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deleteVenue(venueId)
                await qc.invalidateQueries({ queryKey: ['venues'] })
                setVenueId(null)
                setConfigId(null)
                setActiveLevelId(null)
                setActiveSectionId(null)
                setActiveRowId(null)
                notifications.show({ message: 'Venue deleted' })
              },
            })
          }}
          onDeleteConfig={() => {
            if (!configId) return
            modals.openConfirmModal({
              title: 'Delete config?',
              children: (
                <Text size="sm" c="dimmed">
                  This will permanently delete the selected config and all its overrides (seat statuses). It will not delete seats.
                </Text>
              ),
              labels: { confirm: 'Delete config', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deleteConfig(configId)
                await qc.invalidateQueries({ queryKey: ['configs', venueId] })
                setConfigId(null)
                notifications.show({ message: 'Config deleted' })
              },
            })
          }}
          onToggleTheme={() => toggleColorScheme()}
          colorScheme={colorScheme}
          onHelp={() => setHelpOpen(true)}
        />
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Sidebar
          venueId={venueId}
          configId={configId}
          levelOptions={levelOptions}
          sectionOptions={sectionOptions}
          rowOptions={rowOptions}
          activeLevelId={activeLevelId}
          activeSectionId={activeSectionId}
          activeRowId={activeRowId}
          setActiveLevelId={setActiveLevelId}
          setActiveSectionId={setActiveSectionId}
          setActiveRowId={setActiveRowId}
          tool={tool}
          setTool={(t) => {
            if (t === 'draw-section') setDraftPts([])
            if (t === 'draw-row-line') setDraftRowPts([])
            if (t === 'draw-row-arc') setDraftArcPts([])
            if (t === 'draw-zone') setDraftZonePts([])
            if (t === 'seat-line' || t === 'seat-poly' || t === 'seat-place' || t === 'seat-move') {
              setDraftSeatPath([])
              setDraftSeatDots([])
            }
            setTool(t)
          }}
          canUndo={(draftPts.length + draftRowPts.length + draftArcPts.length + draftZonePts.length + draftSeatPath.length) > 0}
          onUndo={undo}
          onCancelDraft={cancelDraft}
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          gridStep={gridStep}
          setGridStep={setGridStep}
          onAddLevel={() => setCreateLevelOpen(true)}
          hasPitch={Boolean(pitchPoints?.length)}
          onDeletePitch={() => {
            if (!venueId) return
            modals.openConfirmModal({
              title: 'Delete pitch?',
              children: <Text size="sm" c="dimmed">This will remove the pitch/stage polygon from the venue.</Text>,
              labels: { confirm: 'Delete pitch', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deletePitch(venueId)
                await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                notifications.show({ message: 'Pitch deleted' })
              },
            })
          }}
          onDeleteActiveRow={() => {
            if (!activeRowId) return
            modals.openConfirmModal({
              title: 'Delete row?',
              children: <Text size="sm" c="dimmed">This will delete the row and all generated seats for it.</Text>,
              labels: { confirm: 'Delete row', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deleteRow(activeRowId)
                await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                setActiveRowId(null)
                notifications.show({ message: 'Row deleted' })
              },
            })
          }}
          onDeleteActiveSection={() => {
            if (!activeSectionId) return
            modals.openConfirmModal({
              title: 'Delete section?',
              children: <Text size="sm" c="dimmed">This will delete the section, its rows, seats, and standing zones.</Text>,
              labels: { confirm: 'Delete section', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deleteSection(activeSectionId)
                await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                setActiveSectionId(null)
                setActiveRowId(null)
                notifications.show({ message: 'Section deleted' })
              },
            })
          }}
          onDeleteActiveLevel={() => {
            if (!activeLevelId) return
            modals.openConfirmModal({
              title: 'Delete level?',
              children: <Text size="sm" c="dimmed">This will delete the level and all of its sections.</Text>,
              labels: { confirm: 'Delete level', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: async () => {
                await deleteLevel(activeLevelId)
                await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                setActiveLevelId(null)
                setActiveSectionId(null)
                setActiveRowId(null)
                notifications.show({ message: 'Level deleted' })
              },
            })
          }}
          canDuplicateSelected={Boolean(selectedZoneId || activeRowId || activeSectionId || activeLevelId)}
          onDuplicateSelected={() => {
            duplicateSelected().catch((err) => notifications.show({ color: 'red', message: String(err) }))
          }}
          selectedSeatCount={selectedSeatIds.size}
          onBlockSelected={() => bulkOverrideM.mutate({ seat_ids: Array.from(selectedSeatIds), status: 'blocked' })}
          onKillSelected={() => bulkOverrideM.mutate({ seat_ids: Array.from(selectedSeatIds), status: 'kill' })}
          onClearSelected={() => bulkOverrideM.mutate({ seat_ids: Array.from(selectedSeatIds), status: 'sellable' })}
          onClearSelection={() => setSelectedSeatIds(new Set())}
          bulkSeatType={bulkSeatType}
          setBulkSeatType={setBulkSeatType}
          onApplySeatTypeToSelected={() => {
            const ids = Array.from(selectedSeatIds)
            if (!ids.length) return
            bulkSeatTypeM.mutate({ seat_ids: ids, seat_type: bulkSeatType })
          }}
          rowLengthText={rowMetricsQ.data ? `${rowMetricsQ.data.total_length_m.toFixed(2)} m` : '—'}
          gapStartM={gapStartM}
          setGapStartM={setGapStartM}
          gapEndM={gapEndM}
          setGapEndM={setGapEndM}
          canAddGap={Boolean(activeRowId && activeRowPath)}
          onAddGap={() => updateActiveRowGaps([...activeRowGaps, [gapStartM, gapEndM]])}
          gapList={
            activeRowGaps.length ? (
              <Stack gap={4}>
                {activeRowGaps.map((g, idx) => (
                  <Group key={`gap-${idx}`} justify="space-between">
                    <Text size="sm">
                      {g[0].toFixed(2)} → {g[1].toFixed(2)} m
                    </Text>
                    <Button variant="subtle" onClick={() => updateActiveRowGaps(activeRowGaps.filter((_, i) => i !== idx))}>
                      Remove
                    </Button>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No gaps.
              </Text>
            )
          }
          seatInspector={
            seatInfo ? (
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
                  type: {String(seatInfo.seat_type)}
                </Text>
                <Text size="sm" c="dimmed">
                  x,y: {Number(seatInfo.x).toFixed(2)}, {Number(seatInfo.y).toFixed(2)}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Click a seat to inspect.
              </Text>
            )
          }
          zoneInspector={
            zoneInfo ? (
              <Stack gap={2}>
                <Text size="sm">
                  <b>{zoneInfo.name}</b> ({zoneInfo.zone_type})
                </Text>
                <Text size="sm" c="dimmed">
                  {zoneInfo.level} / {zoneInfo.section}
                </Text>
                <Text size="sm" c="dimmed">
                  capacity: {zoneInfo.capacity}
                </Text>
                <Button variant="light" onClick={() => setEditZoneOpen(true)}>
                  Edit zone
                </Button>
                <Button
                  color="red"
                  variant="light"
                  onClick={() => {
                    if (!selectedZoneId) return
                    modals.openConfirmModal({
                      title: 'Delete zone?',
                      children: (
                        <Text size="sm" c="dimmed">
                          This will permanently delete the standing zone.
                        </Text>
                      ),
                      labels: { confirm: 'Delete zone', cancel: 'Cancel' },
                      confirmProps: { color: 'red' },
                      onConfirm: async () => {
                        await deleteZone(selectedZoneId)
                        await qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                        setSelectedZoneId(null)
                        notifications.show({ message: 'Zone deleted' })
                      },
                    })
                  }}
                >
                  Delete zone
                </Button>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Click a zone to inspect.
              </Text>
            )
          }
          summary={
            summaryQ.data ? (
              <Stack gap={2}>
                <Text size="sm" c="dimmed">
                  seats total: {summaryQ.data.seats_total}
                </Text>
                <Text size="sm" c="dimmed">
                  sellable: {summaryQ.data.seats_sellable} / blocked: {summaryQ.data.seats_blocked} / kill: {summaryQ.data.seats_kill}
                </Text>
                <Text size="sm" c="dimmed">
                  standing capacity: {summaryQ.data.standing_capacity}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                —
              </Text>
            )
          }
          breakdown={
            <>
              <Select
                label="View"
                data={[
                  { value: 'sections', label: 'Sections' },
                  { value: 'levels', label: 'Levels' },
                ]}
                value={breakdownView}
                onChange={(v) => setBreakdownView((v as any) ?? 'sections')}
              />
              <TextInput label="Filter" value={breakdownFilter} onChange={(e) => setBreakdownFilter(e.target.value)} placeholder="e.g. Lower/101" />
              <Button variant="light" disabled={!venueId} onClick={() => exportBreakdownCsvM.mutate()}>
                Export breakdown CSV
              </Button>
              <Group grow>
                <NumberInput
                  label="Page"
                  value={breakdownPage}
                  onChange={(v) => setBreakdownPage(Math.max(1, Math.min(breakdownTotalPages, Number(v ?? 1))))}
                  min={1}
                  max={breakdownTotalPages}
                />
                <NumberInput
                  label="Page size"
                  value={breakdownPageSize}
                  onChange={(v) => setBreakdownPageSize(Math.max(5, Math.min(200, Number(v ?? 30))))}
                  min={5}
                  max={200}
                />
              </Group>
              {breakdownQ.data ? (
                <Table withColumnBorders withRowBorders={false} striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ cursor: 'pointer' }} onClick={() => setBreakdownSort((s) => ({ key: 'name', dir: s.key === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                        Name
                      </Table.Th>
                      <Table.Th style={{ cursor: 'pointer' }} onClick={() => setBreakdownSort((s) => ({ key: 'sellable', dir: s.key === 'sellable' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                        Sellable
                      </Table.Th>
                      <Table.Th style={{ cursor: 'pointer' }} onClick={() => setBreakdownSort((s) => ({ key: 'blocked', dir: s.key === 'blocked' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                        Blocked
                      </Table.Th>
                      <Table.Th style={{ cursor: 'pointer' }} onClick={() => setBreakdownSort((s) => ({ key: 'kill', dir: s.key === 'kill' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                        Kill
                      </Table.Th>
                      <Table.Th style={{ cursor: 'pointer' }} onClick={() => setBreakdownSort((s) => ({ key: 'standing_capacity', dir: s.key === 'standing_capacity' && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                        Standing
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {breakdownPageRows.map((r: any, i: number) => {
                      const name = breakdownView === 'sections' ? `${r.level_name}/${r.section_code}` : `${r.level_name}`
                      return (
                        <Table.Tr
                          key={`br-${i}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            if (breakdownView === 'sections') {
                              setActiveLevelId(r.level_id as Id)
                              setActiveSectionId(r.section_id as Id)
                              setActiveRowId(null)
                              zoomToSection(r.section_id as Id)
                            } else {
                              setActiveLevelId(r.level_id as Id)
                              setActiveSectionId(null)
                              setActiveRowId(null)
                              zoomToLevel(r.level_id as Id)
                            }
                          }}
                        >
                          <Table.Td>{name}</Table.Td>
                          <Table.Td>{r.sellable}</Table.Td>
                          <Table.Td>{r.blocked}</Table.Td>
                          <Table.Td>{r.kill}</Table.Td>
                          <Table.Td>{r.standing_capacity}</Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              )}
              {breakdownRows.length > breakdownPageSize && (
                <Text size="sm" c="dimmed">
                  Showing page {breakdownPage} of {breakdownTotalPages} ({breakdownRows.length} rows).
                </Text>
              )}
            </>
          }
        />
      </AppShell.Navbar>

      <AppShell.Main>
        {!venueId ? (
          <Text>Select or create a venue to start.</Text>
        ) : snapQ.isLoading ? (
          <Text>Loading…</Text>
        ) : (
          <CanvasView
            stageRef={stageWrapRef}
            stageW={stageW}
            stageH={stageH}
            tool={tool}
            scale={scale}
            pan={pan}
            setPan={setPan}
            onZoomIn={() => setScale((s) => Math.min(50, s * 1.1))}
            onZoomOut={() => setScale((s) => Math.max(0.05, s / 1.1))}
            onScaleChange={(v) => setScale(v)}
            onFitVenue={fitToVenue}
            onFitSelection={fitToSelection}
            onResetView={resetView}
            onStageClick={onStageClick}
            onStageDblClick={onStageDblClick}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            gridStep={gridStep}
            pitchPoints={pitchPoints}
            draftPts={draftPts}
            draftZonePts={draftZonePts}
            draftRowPts={draftRowPts}
            draftArcPts={draftArcPts}
            cursorWorld={cursorWorld}
            draftPolygonInvalid={draftPolygonInvalid}
            draftZoneInvalid={draftZoneInvalid}
            draftSeatDots={draftSeatDots}
            draftSeatPath={draftSeatPath}
            seatDragEnabled={tool === 'seat-move'}
            onSeatDragEnd={(seatId, x, y) => {
              const sp = snap({ x, y })
              updateSeat(seatId, { x_m: sp.x, y_m: sp.y })
                .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
                .catch((err) => notifications.show({ color: 'red', message: String(err) }))
            }}
            sections={sections}
            zones={zones}
            rows={rows}
            seats={seats}
            activeSectionId={activeSectionId}
            activeRowId={activeRowId}
            selectedZoneId={selectedZoneId}
            selectedSeatIds={selectedSeatIds}
            hoverSeatInfo={hoverSeatInfo}
            onSeatHover={(sid) => setHoverSeatId(sid)}
            onSelectSection={(lvlId, secId) => {
              setActiveLevelId(lvlId)
              setActiveSectionId(secId)
            }}
            onSelectZone={(zid) => {
              setSelectedZoneId(zid)
              setSelectedSeatId(null)
            }}
            onSelectRow={(secId, rid) => {
              setActiveSectionId(secId)
              setActiveRowId(rid)
            }}
            onSelectSeat={(seatId) => {
              setSelectedSeatId(seatId)
              if (tool === 'paint-blocked' && configId) applyPaint([seatId], 'blocked').catch((e) => notifications.show({ color: 'red', message: String(e) }))
              if (tool === 'paint-kill' && configId) applyPaint([seatId], 'kill').catch((e) => notifications.show({ color: 'red', message: String(e) }))
              if (tool === 'paint-sellable' && configId) applyPaint([seatId], 'sellable').catch((e) => notifications.show({ color: 'red', message: String(e) }))
            }}
            seatColor={seatColor}
            selecting={selecting}
            selStart={selStart}
            selEnd={selEnd}
            activeSectionPoints={activeSectionPoints}
            onDragSectionPoint={(idx, x, y) => {
              const sp = snap({ x, y })
              commitSectionPoint(idx, sp.x, sp.y)
            }}
            selectedZonePoints={
              selectedZoneId
                ? (() => {
                    const z = zoneById.get(selectedZoneId)
                    if (!z) return null
                    try {
                      return JSON.parse((z as any).geom_json as string) as Array<[number, number]>
                    } catch {
                      return null
                    }
                  })()
                : null
            }
            onDragZonePoint={(idx, x, y) => {
              if (!selectedZoneId) return
              const z = zoneById.get(selectedZoneId)
              if (!z) return
              let pts: Array<[number, number]>
              try {
                pts = JSON.parse((z as any).geom_json as string) as Array<[number, number]>
              } catch {
                return
              }
              const sp = snap({ x, y })
              const next = pts.map((q, i): [number, number] => (i === idx ? [sp.x, sp.y] : [q[0], q[1]]))
              updateZone(selectedZoneId, { polygonPoints: next })
                .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
                .catch((err) => notifications.show({ color: 'red', message: String(err) }))
            }}
            activeRowLineVertices={activeRowLineVertices}
            onDragRowVertex={(idx, x, y) => {
              const sp = snap({ x, y })
              commitRowVertex(idx, sp.x, sp.y)
            }}
            activeArcHandlePoints={
              tool === 'select' &&
              activeRowPath?.segments?.length === 1 &&
              (activeRowPath.segments[0] as any)?.type === 'arc'
                ? (() => {
                    const seg = activeRowPath.segments[0] as any
                    const a = pointOnArc(seg, 0)
                    const b = pointOnArc(seg, 0.5)
                    const c = pointOnArc(seg, 1)
                    return [a, b, c]
                  })()
                : null
            }
            onDragArcHandle={(idx, x, y) => {
              if (!activeRowId) return
              if (!activeRowPath?.segments?.length) return
              const seg = activeRowPath.segments[0] as any
              if (seg?.type !== 'arc') return
              const a0 = pointOnArc(seg, 0)
              const b0 = pointOnArc(seg, 0.5)
              const c0 = pointOnArc(seg, 1)
              const sp = snap({ x, y })
              const a = idx === 0 ? sp : a0
              const b = idx === 1 ? sp : b0
              const c = idx === 2 ? sp : c0
              const arc = arcFrom3Points(a, b, c)
              if (!arc) return
              updateRowPath(activeRowId, { segments: [{ type: 'arc', ...arc } as any], gaps: activeRowGaps })
                .then(() => qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] }))
                .catch((err) => notifications.show({ color: 'red', message: String(err) }))
            }}
            showSelectionToolbar={selectedSeatIds.size > 0}
            selectedSeatsCount={selectedSeatIds.size}
            configSelected={Boolean(configId)}
            onBlockSelected={() => applyPaint(Array.from(selectedSeatIds), 'blocked').catch((e) => notifications.show({ color: 'red', message: String(e) }))}
            onKillSelected={() => applyPaint(Array.from(selectedSeatIds), 'kill').catch((e) => notifications.show({ color: 'red', message: String(e) }))}
            onClearOverridesSelected={() => applyPaint(Array.from(selectedSeatIds), 'sellable').catch((e) => notifications.show({ color: 'red', message: String(e) }))}
            onClearSelection={() => setSelectedSeatIds(new Set())}
            showMiniMap={true}
            onCenterWorld={(x, y) => {
              const vw = Math.max(300, stageW)
              const vh = Math.max(300, stageH)
              animateView({ scale: scaleRef.current, pan: { x: vw / 2 - x * scaleRef.current, y: vh / 2 - y * scaleRef.current } })
            }}
          />
        )}
      </AppShell.Main>

      <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title="Help & shortcuts" size="lg">
        <Stack gap="xs">
          <Text fw={700}>Keyboard</Text>
          <Text size="sm" c="dimmed">
            Esc = cancel draft, Enter = finish drawing, Delete/Backspace = delete selected, Ctrl/Cmd+D = duplicate selected, Ctrl/Cmd+Z = undo, +/- = zoom, Ctrl/Cmd+0 = fit venue, F = fit selection, R = reset view, ? = open this help
          </Text>
          <Text fw={700} mt="sm">
            Drawing
          </Text>
          <Text size="sm" c="dimmed">
            Click to add points. Finish by double-clicking, pressing Enter, or clicking back near the first point (for polygons).
          </Text>
          <Text fw={700} mt="sm">
            Painting
          </Text>
          <Text size="sm" c="dimmed">
            Drag a rectangle to paint many seats. Shift-drag to add seats to selection, then apply Block/Kill/Clear.
          </Text>
          <Text fw={700} mt="sm">
            Seat design
          </Text>
          <Text size="sm" c="dimmed">
            Use Seat tools to place dots, draw a line/column, or draw a polyline. Use Seat: drag/move to adjust seats by dragging.
          </Text>
        </Stack>
      </Modal>

      <Modal opened={seatDesignModalOpen} onClose={() => setSeatDesignModalOpen(false)} title="Seat design">
        <Stack>
          <Select
            label="Seat type"
            value={seatDesignType}
            onChange={(v) => setSeatDesignType(((v as SeatType) ?? 'standard') as SeatType)}
            data={[
              { value: 'standard', label: 'Standard' },
              { value: 'aisle', label: 'Aisle' },
              { value: 'wheelchair', label: 'Wheelchair' },
              { value: 'companion', label: 'Companion' },
              { value: 'rail', label: 'Rail' },
              { value: 'standing', label: 'Standing' },
            ]}
          />
          <NumberInput label="Seat number start" value={seatDesignStart} onChange={(v) => setSeatDesignStart(Number(v ?? 1))} min={1} />
          <Switch label="Enforce inside section polygon" checked={seatEnforceInside} onChange={(e) => setSeatEnforceInside(e.currentTarget.checked)} />
          {seatDesignMode === 'line' ? (
            <NumberInput label="Count (single row/column)" value={seatDesignCount} onChange={(v) => setSeatDesignCount(Number(v ?? 10))} min={1} />
          ) : (
            <NumberInput label="Pitch (m) along path" value={seatDesignPitch} onChange={(v) => setSeatDesignPitch(Number(v ?? 0.5))} decimalScale={2} min={0.05} />
          )}
          <Group grow>
            <Button variant="light" onClick={() => { setSeatDesignModalOpen(false); setDraftSeatPath([]); setDraftSeatDots([]) }}>
              Cancel
            </Button>
            <Button onClick={commitSeatDesign}>Create seats</Button>
          </Group>
        </Stack>
      </Modal>

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

      <Modal opened={createZoneOpen} onClose={() => setCreateZoneOpen(false)} title="Create standing zone">
        <Stack>
          <TextInput label="Zone name" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} />
          <NumberInput label="Capacity" value={newZoneCap} onChange={(v) => setNewZoneCap(Number(v ?? 0))} />
          <Button
            disabled={!activeSectionId || draftZonePts.length < 3 || !newZoneName.trim()}
            onClick={() => {
              createZone(activeSectionId!, {
                name: newZoneName.trim(),
                capacity: newZoneCap,
                polygonPoints: draftZonePts.map((p) => [p.x, p.y]),
              })
                .then(() => {
                  setCreateZoneOpen(false)
                  setDraftZonePts([])
                  qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                  notifications.show({ message: 'Zone created' })
                })
                .catch((e) => notifications.show({ color: 'red', message: String(e) }))
            }}
          >
            Save zone
          </Button>
        </Stack>
      </Modal>

      <Modal opened={editZoneOpen} onClose={() => setEditZoneOpen(false)} title="Edit zone">
        <Stack>
          <TextInput label="Zone name" value={editZoneName} onChange={(e) => setEditZoneName(e.target.value)} />
          <NumberInput label="Capacity" value={editZoneCap} onChange={(v) => setEditZoneCap(Number(v ?? 0))} disabled={zoneAuto} />
          <NumberInput label="Density (people / m²)" value={densityPerM2} onChange={(v) => setDensityPerM2(Number(v ?? 0))} decimalScale={2} />
          <Switch label="Auto capacity (area × density)" checked={zoneAuto} onChange={(e) => setZoneAuto(e.currentTarget.checked)} />
          {zoneAutoPreview && (
            <Text size="sm" c="dimmed">
              auto preview: area {zoneAutoPreview.area_m2.toFixed(1)} m² → capacity {zoneAutoPreview.computed_capacity}
            </Text>
          )}
          <Button
            variant="light"
            disabled={!selectedZoneId}
            onClick={() => {
              if (!selectedZoneId) return
              computeZoneCapacity(selectedZoneId, densityPerM2)
                .then((r) => {
                  setEditZoneCap(r.capacity)
                  qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                  notifications.show({ message: `Computed capacity: ${r.capacity} (area ${r.area_m2.toFixed(1)} m²)` })
                })
                .catch((e) => notifications.show({ color: 'red', message: String(e) }))
            }}
          >
            Compute capacity from area
          </Button>
          <Button
            disabled={!selectedZoneId}
            onClick={() => {
              if (!selectedZoneId) return
              updateZone(selectedZoneId, {
                name: editZoneName.trim(),
                capacity_mode: zoneAuto ? 'auto' : 'manual',
                density_per_m2: densityPerM2,
                ...(zoneAuto ? {} : { capacity: editZoneCap }),
              })
                .then(() => {
                  qc.invalidateQueries({ queryKey: ['snapshot', venueId, configId] })
                  setEditZoneOpen(false)
                  notifications.show({ message: 'Zone updated' })
                })
                .catch((e) => notifications.show({ color: 'red', message: String(e) }))
            }}
          >
            Save
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
          <Select
            label="Seat type"
            value={seatType}
            onChange={(v) => setSeatType(((v as SeatType) ?? 'standard') as SeatType)}
            data={[
              { value: 'standard', label: 'Standard' },
              { value: 'aisle', label: 'Aisle' },
              { value: 'wheelchair', label: 'Wheelchair' },
              { value: 'companion', label: 'Companion' },
              { value: 'rail', label: 'Rail' },
              { value: 'standing', label: 'Standing' },
            ]}
          />
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

      <Modal opened={genSectionRowsSeatsOpen} onClose={() => setGenSectionRowsSeatsOpen(false)} title="Generate seats for all rows in section">
        <Stack>
          <Text size="sm" c="dimmed">
            This runs seat generation for every row inside the active section (uses row geometry + section containment).
          </Text>
          <NumberInput label="Seat pitch (m)" value={sectionRowsSeatPitch} onChange={(v) => setSectionRowsSeatPitch(Number(v ?? 0.5))} decimalScale={2} />
          <NumberInput label="Start offset (m)" value={sectionRowsStartOffset} onChange={(v) => setSectionRowsStartOffset(Number(v ?? 0.2))} decimalScale={2} />
          <NumberInput label="End offset (m)" value={sectionRowsEndOffset} onChange={(v) => setSectionRowsEndOffset(Number(v ?? 0.2))} decimalScale={2} />
          <NumberInput label="Seat number start (per row)" value={sectionRowsSeatStart} onChange={(v) => setSectionRowsSeatStart(Number(v ?? 1))} />
          <Select
            label="Seat type"
            value={sectionRowsSeatType}
            onChange={(v) => setSectionRowsSeatType(((v as SeatType) ?? 'standard') as SeatType)}
            data={[
              { value: 'standard', label: 'Standard' },
              { value: 'aisle', label: 'Aisle' },
              { value: 'wheelchair', label: 'Wheelchair' },
              { value: 'companion', label: 'Companion' },
              { value: 'rail', label: 'Rail' },
              { value: 'standing', label: 'Standing' },
            ]}
          />
          <Switch
            label="Overwrite existing seats in each row"
            checked={sectionRowsOverwrite}
            onChange={(e) => setSectionRowsOverwrite(e.currentTarget.checked)}
          />
          <Button disabled={!activeSectionId} onClick={() => genSectionRowsSeatsM.mutate()}>
            Generate for section rows
          </Button>
        </Stack>
      </Modal>

      <Modal opened={genSectionSeatsOpen} onClose={() => setGenSectionSeatsOpen(false)} title="Generate seats in section (grid)">
        <Stack>
          <Text size="sm" c="dimmed">
            This fills the active section polygon with an axis-aligned seat grid and creates auto rows named GRID-*.
          </Text>
          {sectionGridEstimate !== null && (
            <Text size="sm" c={sectionGridEstimate > sectionMaxSeats ? 'red' : 'dimmed'}>
              estimate: ~{sectionGridEstimate.toLocaleString()} seats (area-based). Max allowed: {sectionMaxSeats.toLocaleString()}.
            </Text>
          )}
          <NumberInput label="Seat pitch (m) (X spacing)" value={sectionSeatPitch} onChange={(v) => setSectionSeatPitch(Number(v ?? 0.5))} decimalScale={2} />
          <NumberInput label="Row pitch (m) (Y spacing)" value={sectionRowPitch} onChange={(v) => setSectionRowPitch(Number(v ?? 0.8))} decimalScale={2} />
          <NumberInput label="Margin from section boundary (m)" value={sectionMargin} onChange={(v) => setSectionMargin(Number(v ?? 0.2))} decimalScale={2} />
          <NumberInput
            label="Max seats safety limit"
            value={sectionMaxSeats}
            onChange={(v) => setSectionMaxSeats(Math.max(1, Number(v ?? 200_000)))}
            min={1}
            max={1_000_000}
          />
          <NumberInput label="Seat number start (per grid row)" value={sectionSeatStart} onChange={(v) => setSectionSeatStart(Number(v ?? 1))} />
          <Select
            label="Seat type"
            value={sectionSeatType}
            onChange={(v) => setSectionSeatType(((v as SeatType) ?? 'standard') as SeatType)}
            data={[
              { value: 'standard', label: 'Standard' },
              { value: 'aisle', label: 'Aisle' },
              { value: 'wheelchair', label: 'Wheelchair' },
              { value: 'companion', label: 'Companion' },
              { value: 'rail', label: 'Rail' },
              { value: 'standing', label: 'Standing' },
            ]}
          />
          <Switch
            label="Overwrite previous GRID-* rows in this section"
            checked={sectionOverwrite}
            onChange={(e) => setSectionOverwrite(e.currentTarget.checked)}
          />
          <Button disabled={!activeSectionId} onClick={() => genSectionSeatsM.mutate()}>
            Generate in section
          </Button>
        </Stack>
      </Modal>
    </AppShell>
  )
}

export default App
