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

export type PathSeg =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start_deg: number; end_deg: number; cw: boolean }

export async function createRow(
  sectionId: Id,
  payload: { label: string; order_index: number; segments: PathSeg[] },
): Promise<{ id: Id; label: string }> {
  return await http(`/sections/${sectionId}/rows`, {
    method: 'POST',
    body: JSON.stringify({ label: payload.label, order_index: payload.order_index, path: { segments: payload.segments } }),
  })
}

export async function generateSeats(
  rowId: Id,
  payload: {
    seat_pitch_m: number
    start_offset_m: number
    end_offset_m: number
    seat_number_start: number
    overwrite: boolean
  },
): Promise<{ created: number }> {
  return await http(`/rows/${rowId}/generate-seats`, { method: 'POST', body: JSON.stringify(payload) })
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

export type Snapshot = {
  venue_id: Id
  config_id: Id | null
  venue: Record<string, unknown>
  pitch: Record<string, unknown> | null
  levels: Array<Record<string, unknown>>
  sections: Array<Record<string, unknown>>
  rows: Array<Record<string, unknown>>
  seats: Array<Record<string, unknown>>
  overrides: Array<Record<string, unknown>>
}

export async function snapshot(venueId: Id, configId?: Id | null): Promise<Snapshot> {
  const q = configId ? `?config_id=${configId}` : ''
  return await http(`/venues/${venueId}/snapshot${q}`)
}

