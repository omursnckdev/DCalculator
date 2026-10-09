import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { tr } from '../i18n/tr'
import type { LineEdge } from '../model/types'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'
import { STATUS_COLOR, fmtNum } from './status'

/** Ortogonal (dik açılı) hat; busbar kalın, kablo ince çizilir. Rengi doluluğa göre değişir. */
export function LineEdgeView(props: EdgeProps<LineEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props
  const r = useAnalysis().edges[id]
  const effective = useStore((s) => {
    const sc = s.scenarios.find((x) => x.id === s.activeScenarioId)
    return sc?.edgeStates[id] ?? data?.durum ?? 'kapali'
  })
  const setEdgeState = useStore((s) => s.setEdgeState)
  const open = effective === 'acik'
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
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: open ? '#94a3b8' : r && !r.live ? '#cbd5e1' : stroke,
          strokeWidth: busbar ? 5 : 1.8,
          strokeDasharray: open ? '6 5' : r && !r.live ? '2 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute whitespace-nowrap rounded bg-white/90 px-1 text-[10px] text-slate-600"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            type="button"
            title={`${tr.line.durum}: ${open ? tr.senaryo.acik : tr.senaryo.kapali}`}
            aria-label={`${tr.line.durum}: ${open ? tr.senaryo.acik : tr.senaryo.kapali}`}
            onClick={(e) => {
              e.stopPropagation()
              setEdgeState(id, open ? 'kapali' : 'acik')
            }}
            className="pointer-events-auto mr-1 inline-block h-3 w-3 translate-y-[2px] rounded-full border-2"
            style={{
              borderColor: open ? '#dc2626' : '#16a34a',
              background: open ? '#fff' : '#16a34a',
            }}
          />
          {busbar ? tr.line.busbar : tr.line.kablo}
          {data ? ` · ${data.uzunluk} m` : ''}
          {r && r.live && r.share === 0 && (
            <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">{tr.port.state.yedek}</span>
          )}
          {r && r.live && r.currentA > 0 && (
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
