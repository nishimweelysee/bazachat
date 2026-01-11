import { ActionIcon, Anchor, Button, Group, Select, Text, Tooltip } from '@mantine/core'
import { IconHelp, IconMoon, IconSun } from '@tabler/icons-react'

export function TopBar(props: {
  venues: Array<{ id: number; name: string }>
  configs: Array<{ id: number; name: string }>
  venueId: number | null
  configId: number | null
  onVenueChange: (venueId: number | null) => void
  onConfigChange: (configId: number | null) => void
  onNewVenue: () => void
  onNewConfig: () => void
  onExportPackage: () => void
  onExportSeatsCsv: () => void
  onExportZonesCsv: () => void
  onExportManifest: () => void
  onImportPackage: () => void
  onToggleTheme: () => void
  colorScheme: 'light' | 'dark' | 'auto'
  onHelp: () => void
}) {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group wrap="nowrap">
        <Text fw={800} size="lg">
          Venue Seating Designer
        </Text>
        <Anchor href="http://localhost:8000/docs" target="_blank">
          API docs
        </Anchor>
      </Group>

      <Group wrap="nowrap">
        <Select
          placeholder="Select venue"
          data={props.venues.map((v) => ({ value: String(v.id), label: v.name }))}
          value={props.venueId ? String(props.venueId) : null}
          onChange={(v) => props.onVenueChange(v ? Number(v) : null)}
          w={240}
        />
        <Select
          placeholder="Config (event layout)"
          data={props.configs.map((c) => ({ value: String(c.id), label: c.name }))}
          value={props.configId ? String(props.configId) : null}
          onChange={(v) => props.onConfigChange(v ? Number(v) : null)}
          w={240}
          disabled={!props.venueId}
          clearable
        />

        <Tooltip label="Create a new event layout">
          <Button variant="light" disabled={!props.venueId} onClick={props.onNewConfig}>
            New config
          </Button>
        </Tooltip>
        <Tooltip label="Create a new venue">
          <Button variant="light" onClick={props.onNewVenue}>
            New venue
          </Button>
        </Tooltip>

        <Tooltip label="Export venue package (JSON to clipboard)">
          <Button variant="subtle" disabled={!props.venueId} onClick={props.onExportPackage}>
            Export
          </Button>
        </Tooltip>
        <Tooltip label="Export seats CSV (effective status)">
          <Button variant="subtle" disabled={!props.venueId} onClick={props.onExportSeatsCsv}>
            Seats CSV
          </Button>
        </Tooltip>
        <Tooltip label="Export standing zones CSV">
          <Button variant="subtle" disabled={!props.venueId} onClick={props.onExportZonesCsv}>
            Zones CSV
          </Button>
        </Tooltip>
        <Tooltip label="Export manifest CSV for selected config">
          <Button variant="subtle" disabled={!props.venueId || !props.configId} onClick={props.onExportManifest}>
            Manifest
          </Button>
        </Tooltip>
        <Tooltip label="Import venue package (JSON)">
          <Button variant="subtle" onClick={props.onImportPackage}>
            Import
          </Button>
        </Tooltip>

        <Tooltip label={props.colorScheme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
          <ActionIcon variant="default" onClick={props.onToggleTheme} aria-label="Toggle color scheme">
            {props.colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Help / shortcuts (?)">
          <ActionIcon variant="default" onClick={props.onHelp} aria-label="Help">
            <IconHelp size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  )
}

