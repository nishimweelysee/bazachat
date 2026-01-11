import { Button, Divider, Group, NumberInput, ScrollArea, Select, Stack, Switch, Text, Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import { ToolPalette } from './ToolPalette'

type Tool =
  | 'select'
  | 'draw-pitch'
  | 'draw-section'
  | 'draw-row-line'
  | 'draw-row-arc'
  | 'draw-zone'
  | 'paint-blocked'
  | 'paint-kill'
  | 'paint-sellable'

export function Sidebar(props: {
  venueId: number | null
  configId: number | null

  levelOptions: Array<{ value: string; label: string }>
  sectionOptions: Array<{ value: string; label: string }>
  rowOptions: Array<{ value: string; label: string }>
  activeLevelId: number | null
  activeSectionId: number | null
  activeRowId: number | null
  setActiveLevelId: (id: number | null) => void
  setActiveSectionId: (id: number | null) => void
  setActiveRowId: (id: number | null) => void

  tool: Tool
  setTool: (t: Tool) => void

  // draft actions
  canUndo: boolean
  onUndo: () => void
  onCancelDraft: () => void

  snapEnabled: boolean
  setSnapEnabled: (v: boolean) => void
  gridStep: number
  setGridStep: (v: number) => void

  onAddLevel: () => void
  onGenerateSeats: () => void
  onDeleteActiveRow: () => void
  onDeleteActiveSection: () => void
  onDeleteActiveLevel: () => void
  onDeletePitch: () => void
  hasPitch: boolean
  canDuplicateSelected: boolean
  onDuplicateSelected: () => void

  // selection actions
  selectedSeatCount: number
  onBlockSelected: () => void
  onKillSelected: () => void
  onClearSelected: () => void
  onClearSelection: () => void

  // gaps UI
  rowLengthText: string
  gapStartM: number
  setGapStartM: (v: number) => void
  gapEndM: number
  setGapEndM: (v: number) => void
  canAddGap: boolean
  onAddGap: () => void
  gapList: ReactNode

  // inspectors + summaries (already computed in App)
  seatInspector: ReactNode
  zoneInspector: ReactNode
  summary: ReactNode
  breakdown: ReactNode
}) {
  return (
    <ScrollArea h="calc(100vh - 90px)" offsetScrollbars scrollbarSize={8}>
      <Stack gap="md" p="md">
        <Text fw={700}>Project</Text>
        <Tooltip label="Add a new level/deck">
          <Button disabled={!props.venueId} onClick={props.onAddLevel}>
            Add level
          </Button>
        </Tooltip>

        <Tooltip label="Choose the deck/tier you’re working on">
          <Select
            label="Active level"
            data={props.levelOptions}
            value={props.activeLevelId ? String(props.activeLevelId) : null}
            onChange={(v) => {
              const id = v ? Number(v) : null
              props.setActiveLevelId(id)
              props.setActiveSectionId(null)
              props.setActiveRowId(null)
            }}
          />
        </Tooltip>

        <Tooltip label="Choose the section you’re editing">
          <Select
            label="Active section"
            data={props.sectionOptions}
            value={props.activeSectionId ? String(props.activeSectionId) : null}
            onChange={(v) => {
              const id = v ? Number(v) : null
              props.setActiveSectionId(id)
              props.setActiveRowId(null)
            }}
            disabled={!props.activeLevelId}
          />
        </Tooltip>

        <Tooltip label="Choose the row to generate seats or add gaps">
          <Select
            label="Active row"
            data={props.rowOptions}
            value={props.activeRowId ? String(props.activeRowId) : null}
            onChange={(v) => props.setActiveRowId(v ? Number(v) : null)}
            disabled={!props.activeSectionId}
          />
        </Tooltip>

        <Tooltip label="Generate seats along the active row">
          <Button variant="light" disabled={!props.activeRowId} onClick={props.onGenerateSeats}>
            Generate seats
          </Button>
        </Tooltip>

        <Tooltip label="Delete pitch/stage polygon">
          <Button color="red" variant="light" disabled={!props.venueId || !props.hasPitch} onClick={props.onDeletePitch}>
            Delete pitch
          </Button>
        </Tooltip>

        <Tooltip label="Duplicate selected object (Ctrl/Cmd+D)">
          <Button variant="light" disabled={!props.canDuplicateSelected} onClick={props.onDuplicateSelected}>
            Duplicate selected
          </Button>
        </Tooltip>

        <Group grow>
          <Tooltip label="Delete the active row (and its seats)">
            <Button color="red" variant="light" disabled={!props.activeRowId} onClick={props.onDeleteActiveRow}>
              Delete row
            </Button>
          </Tooltip>
          <Tooltip label="Delete the active section (rows, seats, zones)">
            <Button color="red" variant="light" disabled={!props.activeSectionId} onClick={props.onDeleteActiveSection}>
              Delete section
            </Button>
          </Tooltip>
        </Group>
        <Tooltip label="Delete the active level (all sections)">
          <Button color="red" variant="light" disabled={!props.activeLevelId} onClick={props.onDeleteActiveLevel}>
            Delete level
          </Button>
        </Tooltip>

        <Divider />

        <Text fw={700}>Tools</Text>
        <ToolPalette
          tool={props.tool}
          setTool={props.setTool}
          disabled={{
            'draw-pitch': !props.venueId,
            'draw-section': !props.activeLevelId,
            'draw-row-line': !props.activeSectionId,
            'draw-row-arc': !props.activeSectionId,
            'draw-zone': !props.activeSectionId,
            'paint-blocked': !props.configId,
            'paint-kill': !props.configId,
            'paint-sellable': !props.configId,
          }}
        />

        <Group grow>
          <Tooltip label="Undo last point (Ctrl/Cmd+Z)">
            <Button variant="light" onClick={props.onUndo} disabled={!props.canUndo}>
              Undo
            </Button>
          </Tooltip>
          <Tooltip label="Cancel current draft (Esc)">
            <Button variant="light" onClick={props.onCancelDraft} disabled={!props.canUndo}>
              Cancel
            </Button>
          </Tooltip>
        </Group>

        <Tooltip label="Enable snapping for precise geometry">
          <Switch label="Snap to grid" checked={props.snapEnabled} onChange={(e) => props.setSnapEnabled(e.currentTarget.checked)} />
        </Tooltip>
        <Tooltip label="Grid resolution in meters (smaller = finer snap)">
          <NumberInput label="Grid step (m)" value={props.gridStep} onChange={(v) => props.setGridStep(Number(v ?? 0.1))} decimalScale={3} />
        </Tooltip>

        <Divider />

        <Text fw={700}>Selection</Text>
        <Text size="sm" c="dimmed">
          Shift-drag to add seats to selection.
        </Text>
        <Group grow>
          <Button variant="light" disabled={!props.configId || props.selectedSeatCount === 0} onClick={props.onBlockSelected}>
            Block
          </Button>
          <Button variant="light" disabled={!props.configId || props.selectedSeatCount === 0} onClick={props.onKillSelected}>
            Kill
          </Button>
        </Group>
        <Group grow>
          <Button variant="light" disabled={!props.configId || props.selectedSeatCount === 0} onClick={props.onClearSelected}>
            Clear
          </Button>
          <Button variant="light" disabled={props.selectedSeatCount === 0} onClick={props.onClearSelection}>
            Clear selection
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Selected: {props.selectedSeatCount}
        </Text>

        <Divider />

        <Text fw={700}>Row gaps (aisles)</Text>
        <Text size="sm" c="dimmed">
          Row length: {props.rowLengthText}
        </Text>
        <Group grow>
          <NumberInput label="Gap start (m)" value={props.gapStartM} onChange={(v) => props.setGapStartM(Number(v ?? 0))} decimalScale={2} />
          <NumberInput label="Gap end (m)" value={props.gapEndM} onChange={(v) => props.setGapEndM(Number(v ?? 0.5))} decimalScale={2} />
        </Group>
        <Tooltip label="Add an aisle/vomitory skip interval">
          <Button variant="light" disabled={!props.canAddGap} onClick={props.onAddGap}>
            Add gap
          </Button>
        </Tooltip>
        {props.gapList}

        <Divider />

        <Text fw={700}>Seat inspector</Text>
        {props.seatInspector}

        <Divider />

        <Text fw={700}>Venue summary</Text>
        {props.summary}

        <Divider />

        <Text fw={700}>Breakdown</Text>
        {props.breakdown}

        <Divider />

        <Text fw={700}>Zone inspector</Text>
        {props.zoneInspector}
      </Stack>
    </ScrollArea>
  )
}

