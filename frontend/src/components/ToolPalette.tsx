import { ActionIcon, Group, Tooltip } from '@mantine/core'
import {
  IconBrush,
  IconCircle,
  IconPolygon,
  IconRoute,
  IconSofa,
  IconTargetArrow,
  IconVector,
} from '@tabler/icons-react'

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

function toolIcon(tool: Tool) {
  switch (tool) {
    case 'select':
      return <IconTargetArrow size={18} />
    case 'draw-pitch':
      return <IconPolygon size={18} />
    case 'draw-section':
      return <IconVector size={18} />
    case 'draw-row-line':
      return <IconRoute size={18} />
    case 'draw-row-arc':
      return <IconCircle size={18} />
    case 'draw-zone':
      return <IconSofa size={18} />
    case 'paint-blocked':
      return <IconBrush size={18} />
    case 'paint-kill':
      return <IconBrush size={18} />
    case 'paint-sellable':
      return <IconBrush size={18} />
  }
}

export function ToolPalette(props: {
  tool: Tool
  setTool: (t: Tool) => void
  disabled: Partial<Record<Tool, boolean>>
}) {
  const items: Array<{ tool: Tool; label: string }> = [
    { tool: 'select', label: 'Select / edit' },
    { tool: 'draw-pitch', label: 'Draw pitch/stage' },
    { tool: 'draw-section', label: 'Draw section polygon' },
    { tool: 'draw-row-line', label: 'Draw row (polyline)' },
    { tool: 'draw-row-arc', label: 'Draw row (arc)' },
    { tool: 'draw-zone', label: 'Draw standing zone' },
    { tool: 'paint-blocked', label: 'Paint: blocked' },
    { tool: 'paint-kill', label: 'Paint: kill' },
    { tool: 'paint-sellable', label: 'Paint: sellable (clear)' },
  ]

  return (
    <Group gap="xs" wrap="wrap">
      {items.map((it) => {
        const active = props.tool === it.tool
        const disabled = Boolean(props.disabled[it.tool])
        return (
          <Tooltip key={it.tool} label={it.label}>
            <ActionIcon
              variant={active ? 'filled' : 'default'}
              disabled={disabled}
              onClick={() => props.setTool(it.tool)}
              aria-label={it.label}
              color={active ? 'blue' : undefined}
              size="lg"
              radius="md"
            >
              {toolIcon(it.tool)}
            </ActionIcon>
          </Tooltip>
        )
      })}
    </Group>
  )
}

