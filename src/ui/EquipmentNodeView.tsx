import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { EQUIPMENT } from '../library/equipment'
import type { EquipmentNode } from '../model/types'
import { Symbol } from './Symbol'

export function EquipmentNodeView({ data, selected }: NodeProps<EquipmentNode>) {
  const def = EQUIPMENT[data.kind]
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
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{data.ad}</div>
          {data.etiket && <div className="truncate text-[11px] text-slate-500">{data.etiket}</div>}
        </div>
      </div>
      <div className="mt-1 text-[11px] text-slate-600">{def.summary(data.params)}</div>
      {data.grup && <div className="text-[10px] uppercase tracking-wide text-slate-400">{data.grup}</div>}
      {def.hasOutput && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}
