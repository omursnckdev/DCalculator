import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { tr } from '../i18n/tr'
import type { LineEdge } from '../model/types'
import { useAnalysis } from '../store/useAnalysis'
import { STATUS_COLOR, fmtNum } from './status'

/** Ortogonal (dik açılı) hat; busbar kalın, kablo ince çizilir. Rengi doluluğa göre değişir. */
export function LineEdgeView(props: EdgeProps<LineEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props
  const r = useAnalysis().edges[id]
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
  const status = r?.status ?? 'none'
  const stroke = selected ? '#2563eb' : status === 'warning' || status === 'over' ? STATUS_COLOR[status] : '#475569'
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth: busbar ? 5 : 1.8 }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute rounded bg-white/90 px-1 text-[10px] text-slate-600"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {busbar ? tr.line.busbar : tr.line.kablo}
          {data ? ` · ${data.uzunluk} m` : ''}
          {r && r.currentA > 0 && (
            <span style={{ color: STATUS_COLOR[status] }}>
              {' '}
              · {fmtNum(r.currentA, 0)} A{r.loadingPct !== undefined ? ` (%${fmtNum(r.loadingPct, 0)})` : ''}
            </span>
          )}
          {data && data.pay !== null && ` · pay %${fmtNum(data.pay)}`}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
