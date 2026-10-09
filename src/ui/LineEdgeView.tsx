import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { tr } from '../i18n/tr'
import type { LineEdge } from '../model/types'

/** Ortogonal (dik açılı) hat; busbar kalın, kablo ince çizilir. */
export function LineEdgeView(props: EdgeProps<LineEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 4,
  })
  const busbar = data?.tip === 'busbar'
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: selected ? '#2563eb' : '#475569', strokeWidth: busbar ? 5 : 1.8 }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute rounded bg-white/90 px-1 text-[10px] text-slate-600"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {busbar ? tr.line.busbar : tr.line.kablo}
          {data ? ` · ${data.uzunluk} m` : ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
