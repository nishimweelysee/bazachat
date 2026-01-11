import { ActionIcon, Badge, Group, Slider, Text, Tooltip } from '@mantine/core'
import { IconArrowsMaximize, IconCircleMinus, IconCirclePlus, IconFocus, IconHome } from '@tabler/icons-react'

export function CanvasControls(props: {
  tool: string
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onScaleChange: (scale: number) => void
  onFitVenue: () => void
  onFitSelection: () => void
  onResetView: () => void
}) {
  const scale = props.scale

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 240,
      }}
    >
      <Group gap="xs" justify="space-between">
        <Badge variant="light">{props.tool}</Badge>
        <Badge variant="outline">x{scale.toFixed(2)}</Badge>
      </Group>

      <Group gap="xs" wrap="nowrap">
        <Tooltip label="Zoom out (-)">
          <ActionIcon variant="default" onClick={props.onZoomOut} aria-label="Zoom out">
            <IconCircleMinus size={18} />
          </ActionIcon>
        </Tooltip>

        <Slider
          value={Math.min(6, Math.max(0.1, scale))}
          min={0.1}
          max={6}
          step={0.05}
          onChange={props.onScaleChange}
          styles={{ root: { flex: 1 } }}
        />

        <Tooltip label="Zoom in (+)">
          <ActionIcon variant="default" onClick={props.onZoomIn} aria-label="Zoom in">
            <IconCirclePlus size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Group gap="xs">
        <Tooltip label="Fit to venue (Ctrl/Cmd+0)">
          <ActionIcon variant="default" onClick={props.onFitVenue} aria-label="Fit to venue">
            <IconArrowsMaximize size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Fit to selection (F)">
          <ActionIcon variant="default" onClick={props.onFitSelection} aria-label="Fit to selection">
            <IconFocus size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Reset view (R)">
          <ActionIcon variant="default" onClick={props.onResetView} aria-label="Reset view">
            <IconHome size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Text size="xs" c="dimmed">
        Shortcuts: Esc cancel, Ctrl/Cmd+Z undo, +/- zoom, Ctrl/Cmd+0 fit, F fit selection, R reset view
      </Text>
    </div>
  )
}

