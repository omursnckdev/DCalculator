import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import { EQUIPMENT_TYPES, HEAT_LOCATIONS, LINE_TYPES } from '../model/types'
import type { EquipmentNode, EquipmentType, HeatLocation, LineEdge, LineType } from '../model/types'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'
import { STATUS_BG, STATUS_COLOR, fmtNum } from './status'
import type { LoadStatus } from '../engine'

type Cell = string | number | null

interface Col<T> {
  header: string
  unit?: string
  kind: 'text' | 'number' | 'select' | 'readonly'
  get: (row: T) => Cell
  set?: (row: T, value: string | number | null) => void
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  /** Salt-okunur sonuç sütunları için renk. */
  status?: (row: T) => LoadStatus
  placeholder?: string
}

const cellCls = 'w-full min-w-16 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none'

function EditCell<T>({ col, row }: { col: Col<T>; row: T }) {
  const v = col.get(row)
  if (col.kind === 'readonly') {
    const st = col.status?.(row)
    return (
      <span
        className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-sm"
        style={st && st !== 'none' ? { color: STATUS_COLOR[st], background: STATUS_BG[st], fontWeight: 600 } : undefined}
      >
        {v === null ? '' : String(v)}
      </span>
    )
  }
  if (col.kind === 'select') {
    return (
      <select className={cellCls} value={String(v ?? '')} onChange={(e) => col.set?.(row, e.target.value)}>
        {col.options!.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (col.kind === 'number') {
    return (
      <input
        type="number"
        className={cellCls}
        value={v ?? ''}
        min={col.min}
        max={col.max}
        step={col.step}
        placeholder={col.placeholder}
        onChange={(e) => {
          const n = e.target.valueAsNumber
          col.set?.(row, Number.isFinite(n) ? n : null)
        }}
      />
    )
  }
  return <input className={cellCls} value={String(v ?? '')} onChange={(e) => col.set?.(row, e.target.value)} />
}

function DataTable<T extends { id: string }>({ rows, cols }: { rows: T[]; cols: Col<T>[] }): ReactNode {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-left">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            {cols.map((c, i) => (
              <th key={i} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                {c.header}
                {c.unit ? <span className="font-normal text-slate-400"> ({c.unit})</span> : null}
                {c.set && rows.length > 1 && (
                  <button
                    type="button"
                    title={tr.table.fillDown}
                    aria-label={`${c.header}: ${tr.table.fillDown}`}
                    className="ml-1 rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    onClick={() => {
                      const first = c.get(rows[0])
                      for (const r of rows.slice(1)) c.set!(r, first)
                    }}
                  >
                    ↓
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
              {cols.map((c, i) => (
                <td key={i} className="px-1 py-0.5 align-middle">
                  <EditCell col={c} row={r} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TableView() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const updateNodeData = useStore((s) => s.updateNodeData)
  const updateNodeParam = useStore((s) => s.updateNodeParam)
  const updateEdgeData = useStore((s) => s.updateEdgeData)
  const analysis = useAnalysis()
  const [filter, setFilter] = useState<EquipmentType | 'all'>('all')

  const rows = useMemo(
    () => (filter === 'all' ? nodes : nodes.filter((n) => n.data.kind === filter)),
    [nodes, filter],
  )
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.data.ad ?? id

  const nodeCols: Col<EquipmentNode>[] = [
    { header: tr.props.ad, kind: 'text', get: (n) => n.data.ad, set: (n, v) => updateNodeData(n.id, { ad: String(v ?? '') }) },
    { header: tr.props.type, kind: 'readonly', get: (n) => EQUIPMENT[n.data.kind].label },
    { header: tr.props.etiket, kind: 'text', get: (n) => n.data.etiket, set: (n, v) => updateNodeData(n.id, { etiket: String(v ?? '') }) },
    { header: tr.props.grup, kind: 'text', get: (n) => n.data.grup, set: (n, v) => updateNodeData(n.id, { grup: String(v ?? '') }) },
  ]
  if (filter !== 'all') {
    for (const f of EQUIPMENT[filter].fields) {
      const fallback = EQUIPMENT[filter].defaults[f.key]
      if (f.kind === 'select') {
        nodeCols.push({
          header: f.label,
          kind: 'select',
          options: f.options,
          get: (n) => String(n.data.params[f.key] ?? fallback),
          set: (n, v) => updateNodeParam(n.id, f.key, String(v ?? '')),
        })
      } else {
        nodeCols.push({
          header: f.label,
          unit: f.unit,
          kind: 'number',
          min: f.min,
          max: f.max,
          step: f.step,
          get: (n) => {
            const v = n.data.params[f.key] ?? fallback
            return typeof v === 'number' ? v : null
          },
          set: (n, v) => typeof v === 'number' && updateNodeParam(n.id, f.key, v),
        })
      }
    }
  }
  const res = (n: EquipmentNode) => analysis.nodes[n.id]
  nodeCols.push(
    { header: tr.results.it, unit: 'kW', kind: 'readonly', get: (n) => fmtNum(res(n)?.itKw ?? 0) },
    { header: tr.results.mech, unit: 'kW', kind: 'readonly', get: (n) => fmtNum(res(n)?.mechKw ?? 0) },
    { header: tr.results.total, unit: 'kW', kind: 'readonly', get: (n) => fmtNum(res(n)?.totalKw ?? 0) },
    { header: 'kVA', kind: 'readonly', get: (n) => fmtNum(res(n)?.kva ?? 0) },
    { header: tr.results.current, unit: 'A', kind: 'readonly', get: (n) => fmtNum(res(n)?.currentA ?? 0, 0) },
    {
      header: tr.results.loading,
      unit: '%',
      kind: 'readonly',
      get: (n) => (res(n)?.loadingPct === undefined ? '' : fmtNum(res(n)!.loadingPct!)),
      status: (n) => res(n)?.status ?? 'none',
    },
  )

  const edgeCols: Col<LineEdge>[] = [
    { header: tr.table.from, kind: 'readonly', get: (e) => nameOf(e.source) },
    { header: tr.table.to, kind: 'readonly', get: (e) => nameOf(e.target) },
    {
      header: tr.line.tip,
      kind: 'select',
      options: LINE_TYPES.map((t) => ({ value: t, label: tr.line[t] })),
      get: (e) => e.data?.tip ?? 'kablo',
      set: (e, v) => updateEdgeData(e.id, { tip: String(v) as LineType }),
    },
    ...(
      [
        ['uzunluk', tr.line.uzunluk, 'm', undefined],
        ['akimKapasitesi', tr.line.akimKapasitesi, 'A', undefined],
        ['r', tr.line.r, 'Ω/km', 0.01],
        ['x', tr.line.x, 'Ω/km', 0.01],
        ['gerilim', tr.line.gerilim, 'V', undefined],
      ] as const
    ).map(
      ([key, header, unit, step]): Col<LineEdge> => ({
        header,
        unit,
        kind: 'number',
        min: 0,
        step,
        get: (e) => e.data?.[key] ?? null,
        set: (e, v) => typeof v === 'number' && updateEdgeData(e.id, { [key]: v }),
      }),
    ),
    {
      header: tr.line.pay,
      unit: '%',
      kind: 'number',
      min: 0,
      max: 100,
      placeholder: tr.line.payOto,
      get: (e) => e.data?.pay ?? null,
      set: (e, v) => updateEdgeData(e.id, { pay: typeof v === 'number' ? v : null }),
    },
    {
      header: tr.line.durum,
      kind: 'select',
      options: [
        { value: 'kapali', label: tr.senaryo.kapali },
        { value: 'acik', label: tr.senaryo.acik },
      ],
      get: (e) => e.data?.durum ?? 'kapali',
      set: (e, v) => updateEdgeData(e.id, { durum: v === 'acik' ? 'acik' : 'kapali' }),
    },
    {
      header: tr.line.isiKonum,
      kind: 'select',
      options: HEAT_LOCATIONS.map((h) => ({
        value: h,
        label: h === 'salon' ? tr.alan.konumSalon : h === 'dis' ? tr.alan.konumDis : tr.alan.konumElektrik,
      })),
      get: (e) => e.data?.isiKonum ?? 'elektrik',
      set: (e, v) => updateEdgeData(e.id, { isiKonum: String(v) as HeatLocation }),
    },
    { header: tr.results.current, unit: 'A', kind: 'readonly', get: (e) => fmtNum(analysis.edges[e.id]?.currentA ?? 0, 0) },
    { header: tr.hesap.lineLoss, unit: 'kW', kind: 'readonly', get: (e) => fmtNum(analysis.edges[e.id]?.lossKw ?? 0, 3) },
    {
      header: tr.results.loading,
      unit: '%',
      kind: 'readonly',
      get: (e) => {
        const p = analysis.edges[e.id]?.loadingPct
        return p === undefined ? '' : fmtNum(p)
      },
      status: (e) => analysis.edges[e.id]?.status ?? 'none',
    },
    {
      header: tr.results.drop,
      unit: '%',
      kind: 'readonly',
      get: (e) => {
        const p = analysis.edges[e.id]?.voltageDropPct
        return p === undefined ? '' : fmtNum(p, 2)
      },
    },
  ]

  return (
    <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold">{tr.table.nodes}</h2>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          {tr.table.filter}
          <select
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as EquipmentType | 'all')}
          >
            <option value="all">{tr.table.all}</option>
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EQUIPMENT[t].label}
              </option>
            ))}
          </select>
        </label>
        {filter === 'all' && <span className="text-xs text-slate-500">{tr.table.pickType}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr.table.empty}</p>
      ) : (
        <DataTable rows={rows} cols={nodeCols} />
      )}

      {edges.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold">{tr.table.lines}</h2>
          <DataTable rows={edges} cols={edgeCols} />
        </>
      )}
    </div>
  )
}
