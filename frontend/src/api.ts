export type Id = number

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? `: ${msg}` : ''}`)
  }
  return (await res.json()) as T
}

export type VenueListItem = { id: Id; name: string }

export async function listVenues(): Promise<VenueListItem[]> {
  return await http<VenueListItem[]>('/venues')
}

export async function createVenue(payload: { name: string }): Promise<{ id: Id; name: string }> {
  return await http('/venues', { method: 'POST', body: JSON.stringify(payload) })
}

export async function createLevel(venueId: Id, payload: { name: string; z_base_m?: number }): Promise<{ id: Id; name: string }> {
  return await http(`/venues/${venueId}/levels`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function upsertPitch(venueId: Id, polygonPoints: Array<[number, number]>): Promise<{ id: Id }> {
  return await http(`/venues/${venueId}/pitch`, {
    method: 'PUT',
    body: JSON.stringify({ polygon: { points: polygonPoints } }),
  })
}

export async function createSection(
  levelId: Id,
  payload: { code: string; polygonPoints: Array<[number, number]> },
): Promise<{ id: Id; code: string }> {
  return await http(`/levels/${levelId}/sections`, {
    method: 'POST',
    body: JSON.stringify({ code: payload.code, polygon: { points: payload.polygonPoints } }),
  })
}

export async function updateSection(sectionId: Id, polygonPoints: Array<[number, number]>): Promise<{ updated: boolean }> {
  return await http(`/sections/${sectionId}`, {
    method: 'PUT',
    body: JSON.stringify({ polygon: { points: polygonPoints } }),
  })
}

export type PathSeg =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start_deg: number; end_deg: number; cw: boolean }

export async function createRow(
  sectionId: Id,
  payload: { label: string; order_index: number; segments: PathSeg[] },
): Promise<{ id: Id; label: string }> {
  return await http(`/sections/${sectionId}/rows`, {
    method: 'POST',
    body: JSON.stringify({ label: payload.label, order_index: payload.order_index, path: { segments: payload.segments, gaps: [] } }),
  })
}

export async function updateRowPath(rowId: Id, payload: { segments: PathSeg[]; gaps: Array<[number, number]> }): Promise<{ updated: boolean }> {
  return await http(`/rows/${rowId}`, {
    method: 'PUT',
    body: JSON.stringify({ path: { segments: payload.segments, gaps: payload.gaps } }),
  })
}

export async function getRowMetrics(rowId: Id): Promise<{ row_id: Id; total_length_m: number }> {
  return await http(`/rows/${rowId}/metrics`)
}

export async function createZone(
  sectionId: Id,
  payload: { name: string; capacity: number; polygonPoints: Array<[number, number]> },
): Promise<{ id: Id; name: string }> {
  return await http(`/sections/${sectionId}/zones`, {
    method: 'POST',
    body: JSON.stringify({ name: payload.name, capacity: payload.capacity, polygon: { points: payload.polygonPoints } }),
  })
}

export async function updateZone(
  zoneId: Id,
  payload: { name?: string; capacity?: number; capacity_mode?: 'manual' | 'auto'; density_per_m2?: number; polygonPoints?: Array<[number, number]> },
): Promise<{ updated: boolean }> {
  return await http(`/zones/${zoneId}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.capacity !== undefined ? { capacity: payload.capacity } : {}),
      ...(payload.capacity_mode !== undefined ? { capacity_mode: payload.capacity_mode } : {}),
      ...(payload.density_per_m2 !== undefined ? { density_per_m2: payload.density_per_m2 } : {}),
      ...(payload.polygonPoints ? { polygon: { points: payload.polygonPoints } } : {}),
    }),
  })
}

export async function computeZoneCapacity(
  zoneId: Id,
  densityPerM2: number,
): Promise<{ zone_id: Id; area_m2: number; density_per_m2: number; capacity: number }> {
  return await http(`/zones/${zoneId}/compute-capacity`, { method: 'POST', body: JSON.stringify({ density_per_m2: densityPerM2 }) })
}

export async function getVenueSummaryBreakdown(
  venueId: Id,
  configId?: Id | null,
): Promise<{ levels: Array<any>; sections: Array<any> }> {
  const q = configId ? `?config_id=${configId}` : ''
  return await http(`/venues/${venueId}/summary-breakdown${q}`)
}

export async function downloadBreakdownCsv(venueId: Id, configId?: Id | null): Promise<Blob> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
  const q = configId ? `?config_id=${configId}` : ''
  const res = await fetch(`${API_BASE}/venues/${venueId}/summary-breakdown.csv${q}`)
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? `: ${msg}` : ''}`)
  }
  return await res.blob()
}

export async function generateSeats(
  rowId: Id,
  payload: {
    seat_pitch_m: number
    start_offset_m: number
    end_offset_m: number
    seat_number_start: number
    seat_type: 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail'
    overwrite: boolean
  },
): Promise<{ created: number }> {
  return await http(`/rows/${rowId}/generate-seats`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function generateSeatsInSection(
  sectionId: Id,
  payload: {
    seat_pitch_m: number
    row_pitch_m: number
    margin_m: number
    seat_number_start: number
    seat_type: 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail'
    overwrite: boolean
    max_seats: number
  },
): Promise<{ rows_created: number; seats_created: number }> {
  return await http(`/sections/${sectionId}/generate-seats`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function bulkUpdateSeatType(
  payload: { seat_ids: Id[]; seat_type: 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail' },
): Promise<{ updated: number }> {
  return await http(`/seats/types/bulk`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function createSeatsInSectionBulk(
  sectionId: Id,
  payload: {
    seat_number_start: number
    enforce_inside: boolean
    items: Array<{
      x_m: number
      y_m: number
      z_m?: number
      facing_deg?: number
      seat_type: 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail'
      seat_number?: number
    }>
  },
): Promise<{ created: number; seat_ids: Id[]; row_id: Id }> {
  return await http(`/sections/${sectionId}/seats/bulk`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function updateSeat(
  seatId: Id,
  payload: { x_m?: number; y_m?: number; z_m?: number; facing_deg?: number; seat_type?: 'standard' | 'aisle' | 'wheelchair' | 'companion' | 'standing' | 'rail'; seat_number?: number },
): Promise<{ updated: boolean }> {
  return await http(`/seats/${seatId}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function deleteSeat(seatId: Id): Promise<{ deleted: boolean }> {
  return await http(`/seats/${seatId}`, { method: 'DELETE' })
}

export async function bulkUpdateSeatPositions(payload: { items: Array<{ seat_id: Id; x_m: number; y_m: number }> }): Promise<{ updated: number }> {
  return await http(`/seats/positions/bulk`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function bulkDeleteSeats(payload: { seat_ids: Id[] }): Promise<{ deleted: number }> {
  // must not collide with /seats/{seat_id}
  return await http(`/seats/bulk/delete`, { method: 'DELETE', body: JSON.stringify(payload) })
}

export async function createConfig(venueId: Id, payload: { name: string }): Promise<{ id: Id; name: string }> {
  return await http(`/venues/${venueId}/configs`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function listConfigs(venueId: Id): Promise<Array<{ id: Id; name: string }>> {
  return await http(`/venues/${venueId}/configs`)
}

export async function upsertOverride(configId: Id, payload: { seat_id: Id; status: 'sellable' | 'blocked' | 'kill'; notes?: string }) {
  return await http(`/configs/${configId}/overrides`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function bulkUpsertOverrides(
  configId: Id,
  payload: { seat_ids: Id[]; status: 'sellable' | 'blocked' | 'kill'; notes?: string },
): Promise<{ updated?: number; created?: number; deleted?: number }> {
  return await http(`/configs/${configId}/overrides/bulk`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function batchUpsertOverrides(
  configId: Id,
  payload: { items: Array<{ seat_id: Id; status: 'sellable' | 'blocked' | 'kill'; notes?: string }> },
): Promise<{ deleted?: number; updated?: number; created?: number }> {
  return await http(`/configs/${configId}/overrides/batch`, { method: 'PUT', body: JSON.stringify(payload) })
}

export async function exportVenuePackage(venueId: Id, configId?: Id | null): Promise<any> {
  const q = configId ? `?config_id=${configId}` : ''
  return await http(`/venues/${venueId}/package${q}`)
}

export async function importVenuePackage(payload: any): Promise<{ venue_id: Id }> {
  return await http(`/venues/import`, { method: 'POST', body: JSON.stringify(payload) })
}

export async function deleteVenue(venueId: Id): Promise<{ deleted: boolean }> {
  return await http(`/venues/${venueId}`, { method: 'DELETE' })
}

export async function deleteLevel(levelId: Id): Promise<{ deleted: boolean }> {
  return await http(`/levels/${levelId}`, { method: 'DELETE' })
}

export async function deleteSection(sectionId: Id): Promise<{ deleted: boolean }> {
  return await http(`/sections/${sectionId}`, { method: 'DELETE' })
}

export async function deleteRow(rowId: Id): Promise<{ deleted: boolean }> {
  return await http(`/rows/${rowId}`, { method: 'DELETE' })
}

export async function deleteZone(zoneId: Id): Promise<{ deleted: boolean }> {
  return await http(`/zones/${zoneId}`, { method: 'DELETE' })
}

export async function deleteConfig(configId: Id): Promise<{ deleted: boolean }> {
  return await http(`/configs/${configId}`, { method: 'DELETE' })
}

export async function deletePitch(venueId: Id): Promise<{ deleted: boolean }> {
  return await http(`/venues/${venueId}/pitch`, { method: 'DELETE' })
}

export async function downloadSeatsCsv(venueId: Id, configId?: Id | null): Promise<Blob> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
  const q = configId ? `?config_id=${configId}` : ''
  const res = await fetch(`${API_BASE}/venues/${venueId}/seats.csv${q}`)
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? `: ${msg}` : ''}`)
  }
  return await res.blob()
}

export async function downloadZonesCsv(venueId: Id): Promise<Blob> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
  const res = await fetch(`${API_BASE}/venues/${venueId}/zones.csv`)
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? `: ${msg}` : ''}`)
  }
  return await res.blob()
}

export async function downloadManifestCsv(venueId: Id, configId: Id): Promise<Blob> {
  const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'
  const res = await fetch(`${API_BASE}/venues/${venueId}/manifest.csv?config_id=${configId}`)
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? `: ${msg}` : ''}`)
  }
  return await res.blob()
}

export async function getVenueSummary(
  venueId: Id,
  configId?: Id | null,
): Promise<{ seats_total: number; seats_sellable: number; seats_blocked: number; seats_kill: number; standing_capacity: number }> {
  const q = configId ? `?config_id=${configId}` : ''
  return await http(`/venues/${venueId}/summary${q}`)
}

export type Snapshot = {
  venue_id: Id
  config_id: Id | null
  venue: Record<string, unknown>
  pitch: Record<string, unknown> | null
  levels: Array<Record<string, unknown>>
  sections: Array<Record<string, unknown>>
  rows: Array<Record<string, unknown>>
  seats: Array<Record<string, unknown>>
  zones: Array<Record<string, unknown>>
  overrides: Array<Record<string, unknown>>
}

export async function snapshot(venueId: Id, configId?: Id | null): Promise<Snapshot> {
  const q = configId ? `?config_id=${configId}` : ''
  return await http(`/venues/${venueId}/snapshot${q}`)
}

