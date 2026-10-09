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

function CardNodeView({ id, data, selected }: NodeProps<EquipmentNode>) {
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


const ICON_PORT_SPACING = 16

/** Kompakt gösterim: yalnızca ikon (durum rengiyle çerçeveli) ve ekipman adı. Ayrıntılar panelde. */
function IconNodeView({ id, data, selected }: NodeProps<EquipmentNode>) {
  const def = EQUIPMENT[data.kind]
  const r = useAnalysis().nodes[id]
  const inputs = useInputs(id)
  const setNodeSwitch = useStore((s) => s.setNodeSwitch)
  const nIn = portCount(data.kind, data.params, 'in')
  const nOut = portCount(data.kind, data.params, 'out')
  const small = data.kind === 'kesici' || data.kind === 'yardimci'
  const isTransfer = data.kind === 'ats' || data.kind === 'sts'
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => updateInternals(id), [id, nIn, nOut, updateInternals])

  // Çok portlu ekipman (pano, bara) port sayısı kadar genişler; şemadaki bara gibi görünür.
  const size = small ? 36 : 48
  const width = Math.max(size, Math.max(nIn, nOut) * ICON_PORT_SPACING + 8)
  const stateByPort = new Map(inputs.map((i) => [i.port, i.state]))
  const active = inputs.filter((i) => i.state === 'aktif')
  const left = (i: number, n: number) => `${((i + 1) / (n + 1)) * 100}%`

  const failed = r?.failed
  const open = r?.open
  const dead = r && !r.energized && !failed && !open && !r.cyclic
  const status = r?.status ?? 'none'
  const ring = failed || open ? '#dc2626' : status === 'over' || status === 'warning' ? STATUS_COLOR[status] : dead ? '#94a3b8' : def.color
  const feed = active.length ? active.map((a) => `${a.sourceName} (${tr.port.inputShort}${a.port + 1})`).join(', ') : tr.port.noFeed
  const tip = [
    data.ad,
    def.summary(data.params),
    r && !r.cyclic && (r.totalKw > 0 || !def.hasOutput) ? `${fmtNum(r.totalKw)} kW · ${fmtNum(r.kva)} kVA · ${fmtNum(r.currentA, 0)} A` : '',
    r?.loadingPct !== undefined ? `${tr.results.loading} %${fmtNum(r.loadingPct)}` : '',
    isTransfer ? `${tr.port.feed}: ${feed}` : '',
    failed ? tr.senaryo.failedBadge : open ? tr.senaryo.openBadge : dead ? tr.senaryo.deenergized : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className={`relative ${dead ? 'opacity-55' : ''}`} style={{ width, height: size }} title={tip}>
      <div
        className={`flex h-full w-full items-center justify-center rounded-lg border-2 ${
          failed ? 'bg-red-50' : dead ? 'bg-slate-100' : 'bg-white'
        } ${selected ? 'ring-2 ring-blue-400' : ''}`}
        style={{ borderColor: ring, borderStyle: open ? 'dashed' : 'solid' }}
      >
        <Symbol type={data.kind} color={failed || open ? '#dc2626' : def.color} size={small ? 22 : 30} />
      </div>
      {Array.from({ length: nIn }, (_, i) => {
        const st = stateByPort.get(i)
        return (
          <Handle
            key={`in-${i}`}
            id={handleId('in', i)}
            type="target"
            position={Position.Top}
            style={{ left: left(i, nIn), width: 8, height: 8, background: st ? STATE_COLOR[st] : '#fff', border: `2px solid ${st ? STATE_COLOR[st] : '#64748b'}` }}
            title={`${tr.port.input} ${i + 1}${st ? ` · ${tr.port.state[st]}` : ''}`}
          />
        )
      })}
      {Array.from({ length: nOut }, (_, i) => (
        <Handle
          key={`out-${i}`}
          id={handleId('out', i)}
          type="source"
          position={Position.Bottom}
          style={{ left: left(i, nOut), width: 8, height: 8, background: '#fff', border: '2px solid #64748b' }}
          title={`${tr.port.output} ${i + 1}`}
        />
      ))}
      {data.kind === 'kesici' && (
        <button
          type="button"
          className="nodrag nopan absolute -left-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border-2"
          title={`${tr.alan.kesiciDurum}: ${open ? tr.senaryo.acik : tr.senaryo.kapali}`}
          aria-label={`${data.ad}: ${tr.alan.kesiciDurum} ${open ? tr.senaryo.acik : tr.senaryo.kapali}`}
          onClick={(e) => {
            e.stopPropagation()
            setNodeSwitch(id, open ? 'kapali' : 'acik')
          }}
          style={{ borderColor: open ? '#dc2626' : '#16a34a', background: open ? '#fff' : '#16a34a' }}
        />
      )}
      {r?.loadingPct !== undefined && !failed && !open && (
        <span
          className="absolute -right-2 -top-2 rounded px-1 text-[9px] font-bold leading-4"
          style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}
        >
          %{fmtNum(r.loadingPct, 0)}
        </span>
      )}
      {(failed || open) && (
        <span className="absolute -right-2 -top-2 rounded bg-red-600 px-1 text-[9px] font-bold leading-4 text-white">
          {failed ? tr.senaryo.failedBadge : tr.senaryo.openBadge}
        </span>
      )}
      <div
        className="pointer-events-none absolute left-full top-1/2 ml-1.5 w-32 -translate-y-1/2 text-[11px] font-medium leading-tight text-slate-800"
        style={{ textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff' }}
      >
        {data.ad}
        {isTransfer && (
          <div className="text-[10px] font-normal" style={{ color: active.length ? '#166534' : '#64748b' }}>
            ← {feed}
          </div>
        )}
      </div>
    </div>
  )
}

export function EquipmentNodeView(props: NodeProps<EquipmentNode>) {
  const view = useStore((s) => s.nodeView)
  return view === 'card' ? <CardNodeView {...props} /> : <IconNodeView {...props} />
}
