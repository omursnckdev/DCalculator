import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentNode } from '../model/types'
import { useAnalysis } from '../store/useAnalysis'
import { Symbol } from './Symbol'
import { STATUS_BG, STATUS_COLOR, fmtNum } from './status'

export function EquipmentNodeView({ id, data, selected }: NodeProps<EquipmentNode>) {
  const def = EQUIPMENT[data.kind]
  const r = useAnalysis().nodes[id]
  const status = r?.status ?? 'none'
  const isLoad = !def.hasOutput
  return (
    <div
      className={`min-w-44 rounded-lg border border-l-4 bg-white px-3 py-2 shadow-sm ${
        selected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-300'
      }`}
      style={{ borderLeftColor: def.color }}
    >
      {def.hasInput && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-2">
        <Symbol type={data.kind} color={def.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{data.ad}</div>
          {data.etiket && <div className="truncate text-[11px] text-slate-500">{data.etiket}</div>}
        </div>
        {r?.loadingPct !== undefined && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}
            title="Doluluk"
          >
            %{fmtNum(r.loadingPct, 0)}
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-slate-600">{def.summary(data.params)}</div>
      {r && !r.cyclic && (r.totalKw > 0 || isLoad) && (
        <div className="mt-0.5 text-[11px] font-medium text-slate-800">
          {fmtNum(r.totalKw)} kW · {fmtNum(r.kva)} kVA · {fmtNum(r.currentA, 0)} A
        </div>
      )}
      {r && r.status !== 'none' && (
        <div className="mt-1 h-1 overflow-hidden rounded bg-slate-100">
          <div
            className="h-full"
            style={{ width: `${Math.min(100, r.loadingPct ?? 0)}%`, background: STATUS_COLOR[status] }}
          />
        </div>
      )}
      {data.grup && <div className="text-[10px] uppercase tracking-wide text-slate-400">{data.grup}</div>}
      {def.hasOutput && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}
