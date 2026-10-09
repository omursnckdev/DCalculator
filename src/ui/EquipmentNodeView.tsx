import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { useEffect } from 'react'
import { tr } from '../i18n/tr'
import { EQUIPMENT, portCount } from '../library/equipment'
import { handleId } from '../model/project'
import type { EquipmentNode } from '../model/types'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'
import { Symbol } from './Symbol'
import { STATUS_BG, STATUS_COLOR, fmtNum } from './status'
import { STATE_COLOR, useInputs } from './useInputs'

const PORT_SPACING = 34
const COMPACT: string[] = ['kesici', 'yardimci']

export function EquipmentNodeView({ id, data, selected }: NodeProps<EquipmentNode>) {
  const def = EQUIPMENT[data.kind]
  const r = useAnalysis().nodes[id]
  const inputs = useInputs(id)
  const status = r?.status ?? 'none'
  const isLoad = !def.hasOutput
  const nIn = portCount(data.kind, data.params, 'in')
  const nOut = portCount(data.kind, data.params, 'out')
  const isTransfer = data.kind === 'ats' || data.kind === 'sts'
  const compact = COMPACT.includes(data.kind)
  const setNodeSwitch = useStore((s) => s.setNodeSwitch)
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => updateInternals(id), [id, nIn, nOut, updateInternals])

  const stateByPort = new Map(inputs.map((i) => [i.port, i.state]))
  const active = inputs.filter((i) => i.state === 'aktif')
  const left = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`

  return (
    <div
      className={`rounded-lg border border-l-4 shadow-sm ${compact ? 'px-2 py-1' : 'px-3 py-2'} ${
        r?.failed ? 'bg-red-50' : r && !r.energized && !r.cyclic ? 'bg-slate-100' : 'bg-white'
      } ${selected ? 'border-blue-600 ring-2 ring-blue-200' : r?.failed ? 'border-red-400' : 'border-slate-300'} ${
        r && !r.energized && !r.failed && !r.open && !r.cyclic ? 'opacity-60' : ''
      }`}
      style={{ borderLeftColor: def.color, minWidth: compact ? 120 : Math.max(176, Math.max(nIn, nOut) * PORT_SPACING) }}
    >
      {r?.failed && (
        <div className="-mx-3 -mt-2 mb-1 rounded-t bg-red-600 px-3 py-0.5 text-[10px] font-bold tracking-wide text-white">
          {tr.senaryo.failedBadge}
        </div>
      )}
      {r?.open && (
        <div className="mb-0.5 text-[10px] font-bold tracking-wide text-red-600">{tr.senaryo.openBadge}</div>
      )}
      {r && !r.energized && !r.failed && !r.open && !r.cyclic && (
        <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-slate-500">{tr.senaryo.deenergized}</div>
      )}
      {Array.from({ length: nIn }, (_, i) => {
        const st = stateByPort.get(i)
        return (
          <Handle
            key={`in-${i}`}
            id={handleId('in', i)}
            type="target"
            position={Position.Top}
            style={{
              left: left(i, nIn),
              width: 10,
              height: 10,
              background: st ? STATE_COLOR[st] : '#fff',
              border: `2px solid ${st ? STATE_COLOR[st] : '#64748b'}`,
            }}
            title={`${tr.port.input} ${i + 1}${st ? ` · ${tr.port.state[st]}` : ''}`}
          />
        )
      })}
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
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
        {data.kind === 'kesici' && (
          <button
            type="button"
            className="nodrag nopan inline-block h-3 w-3 shrink-0 rounded-full border-2"
            title={`${tr.alan.kesiciDurum}: ${r?.open ? tr.senaryo.acik : tr.senaryo.kapali}`}
            aria-label={`${data.ad}: ${tr.alan.kesiciDurum} ${r?.open ? tr.senaryo.acik : tr.senaryo.kapali}`}
            onClick={(e) => {
              e.stopPropagation()
              setNodeSwitch(id, r?.open ? 'kapali' : 'acik')
            }}
            style={{ borderColor: r?.open ? '#dc2626' : '#16a34a', background: r?.open ? '#fff' : '#16a34a' }}
          />
        )}
        <span>{def.summary(data.params)}</span>
      </div>
      {isTransfer && (
        <div
          className="mt-0.5 rounded px-1 py-0.5 text-[11px] font-medium"
          style={{
            background: active.length ? '#dcfce7' : '#f1f5f9',
            color: active.length ? '#166534' : '#64748b',
          }}
        >
          {tr.port.feed}:{' '}
          {active.length
            ? active.map((a) => `${a.sourceName} (${tr.port.inputShort}${a.port + 1})`).join(', ')
            : tr.port.noFeed}
        </div>
      )}
      {!compact && r && !r.cyclic && (r.totalKw > 0 || isLoad) && (
        <div className="mt-0.5 text-[11px] font-medium text-slate-800">
          {fmtNum(r.totalKw)} kW · {fmtNum(r.kva)} kVA · {fmtNum(r.currentA, 0)} A
        </div>
      )}
      {!compact && r && r.status !== 'none' && (
        <div className="mt-1 h-1 overflow-hidden rounded bg-slate-100">
          <div
            className="h-full"
            style={{ width: `${Math.min(100, r.loadingPct ?? 0)}%`, background: STATUS_COLOR[status] }}
          />
        </div>
      )}
      {data.grup && <div className="text-[10px] uppercase tracking-wide text-slate-400">{data.grup}</div>}
      {Array.from({ length: nOut }, (_, i) => (
        <Handle
          key={`out-${i}`}
          id={handleId('out', i)}
          type="source"
          position={Position.Bottom}
          style={{ left: left(i, nOut), width: 10, height: 10, background: '#fff', border: '2px solid #64748b' }}
          title={`${tr.port.output} ${i + 1}`}
        />
      ))}
    </div>
  )
}
