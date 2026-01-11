import { ActionIcon, Badge, Group, Paper, Tooltip } from '@mantine/core'
import { IconArrowsMaximize, IconBlockquote, IconEraser, IconSkull, IconX } from '@tabler/icons-react'

export function SelectionToolbar(props: {
  visible: boolean
  selectedSeats: number
  configSelected: boolean
  onFitSelection: () => void
  onClearSelection: () => void
  onBlockSelected: () => void
  onKillSelected: () => void
  onClearOverridesSelected: () => void
}) {
  if (!props.visible) return null

  return (
    <Paper
      shadow="md"
      radius="md"
      p="xs"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
        backdropFilter: 'blur(6px)',
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <Badge variant="light">Selected: {props.selectedSeats}</Badge>

        <Tooltip label="Fit selection (F)">
          <ActionIcon variant="default" onClick={props.onFitSelection} aria-label="Fit selection">
            <IconArrowsMaximize size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={props.configSelected ? 'Mark selected as blocked' : 'Select a config to paint'}>
          <ActionIcon
            variant="default"
            disabled={!props.configSelected}
            onClick={props.onBlockSelected}
            aria-label="Block selected"
          >
            <IconBlockquote size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={props.configSelected ? 'Mark selected as kill' : 'Select a config to paint'}>
          <ActionIcon
            variant="default"
            disabled={!props.configSelected}
            onClick={props.onKillSelected}
            aria-label="Kill selected"
          >
            <IconSkull size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={props.configSelected ? 'Clear overrides (sellable)' : 'Select a config to paint'}>
          <ActionIcon
            variant="default"
            disabled={!props.configSelected}
            onClick={props.onClearOverridesSelected}
            aria-label="Clear overrides"
          >
            <IconEraser size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Clear selection">
          <ActionIcon variant="default" onClick={props.onClearSelection} aria-label="Clear selection">
            <IconX size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  )
}

