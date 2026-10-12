import { useMemo, useState } from 'react'
import { analyze } from '../engine'
import { cableStudy } from '../engine/cableSizing'
import { arcFlashStudy, curvePoints, selectivityStudy, tripSettings } from '../engine/protection'
import type { ArcFlashRow, SelectivityRow } from '../engine/protection'
import { tr } from '../i18n/tr'
import { useBaseModel } from '../store/useModel'
import { useStore } from '../store/useStore'
import { Legend, TccChart } from './charts'
import { fmtNum } from './status'

type Tab = 'sel' | 'arc' | 'cable'

const STATUS: Record<SelectivityRow['status'], { cls: string; label: string }> = {
  total: { cls: 'text-green-700', label: tr.elk.selTotal },
  partial: { cls: 'text-amber-700', label: tr.elk.selPartial },
  none: { cls: 'text-red-700 font-semibold', label: tr.elk.selNone },
}
const PPE_CLS = ['text-green-700', 'text-green-700', 'text-amber-700', 'text-amber-700', 'text-red-700', 'text-red-700 font-bold']

function SelectivityPanel() {
  const model = useBaseModel()
  const a = useMemo(() => analyze(model), [model])
  const rows = useMemo(() => selectivityStudy(model, a), [model, a])
  const [pick, setPick] = useState(0)
  const row = rows[Math.min(pick, rows.length - 1)]
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const up = row && byId.get(row.upId)
  const down = row && byId.get(row.downId)
  const curves = row && up && down
    ? [
        { name: row.upName, color: '#2563eb', points: curvePoints(tripSettings(up), 150, row.iscKa * 1000 * 1.2) },
        { name: row.downName, color: '#dc2626', points: curvePoints(tripSettings(down), 150, row.iscKa * 1000 * 1.2) },
      ]
    : []
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{tr.elk.selIntro}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr.elk.selNone2}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">{tr.elk.up}</th>
                    <th className="py-1 pr-2 font-medium">{tr.elk.down}</th>
                    <th className="py-1 pr-2 text-right font-medium">Isc (kA)</th>
                    <th className="py-1 pr-2 text-right font-medium">{tr.elk.limit} (kA)</th>
                    <th className="py-1 font-medium">{tr.elk.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.upId}-${r.downId}`} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${i === pick ? 'bg-blue-50' : ''}`} onClick={() => setPick(i)}>
                      <td className="py-0.5 pr-2">{r.upName}</td>
                      <td className="py-0.5 pr-2">{r.downName}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.iscKa, 1)}</td>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.limitKa, 1)}</td>
                      <td className={`py-0.5 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-semibold">{tr.elk.tcc}</h3>
            <TccChart curves={curves} marks={row ? [{ a: row.iscKa * 1000, label: `Isc ${fmtNum(row.iscKa, 1)} kA`, color: '#475569' }, { a: row.limitKa * 1000, label: `${tr.elk.limit} ${fmtNum(row.limitKa, 1)} kA`, color: '#d97706' }] : []} />
            <Legend series={curves.map((c) => ({ name: c.name, color: c.color, values: [] }))} />
            <p className="mt-1 text-xs text-slate-500">{tr.elk.tccNote}</p>
          </section>
        </div>
      )}
    </div>
  )
}

function ArcPanel() {
  const model = useBaseModel()
  const s = useStore((st) => st.ayarlar)
  const setAyarlar = useStore((st) => st.setAyarlar)
  const a = useMemo(() => analyze(model), [model])
  const rows: ArcFlashRow[] = useMemo(() => arcFlashStudy(model, a, s), [model, a, s])
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{tr.elk.arcIntro}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          {tr.elk.arcDist}
          <input type="number" className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.arkMesafe} onChange={(e) => setAyarlar({ arkMesafe: Math.min(2000, Math.max(100, Number(e.target.value) || 455)) })} />
        </label>
        <label className="flex items-center gap-2">
          {tr.elk.arcGap}
          <input type="number" className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.arkAralik} onChange={(e) => setAyarlar({ arkAralik: Math.min(200, Math.max(5, Number(e.target.value) || 32)) })} />
        </label>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">{tr.elk.panel}</th>
                <th className="py-1 pr-2 text-right font-medium">Ibf (kA)</th>
                <th className="py-1 pr-2 text-right font-medium">Ia (kA)</th>
                <th className="py-1 pr-2 font-medium">{tr.elk.protectedBy}</th>
                <th className="py-1 pr-2 text-right font-medium">t (sn)</th>
                <th className="py-1 pr-2 text-right font-medium">E (cal/cm²)</th>
                <th className="py-1 font-medium">PPE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-0.5 pr-2">{r.name}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.ibfKa, 1)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.iaKa, 1)}</td>
                  <td className="py-0.5 pr-2 text-slate-600">{r.protectedBy ?? tr.elk.noProtection}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.clearingSec, 2)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.energy, 1)}</td>
                  <td className={`py-0.5 ${PPE_CLS[r.ppe]}`}>{r.ppe === 5 ? tr.elk.ppeDanger : r.ppe === 0 ? tr.elk.ppe0 : `${tr.elk.ppeCat} ${r.ppe}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CablePanel() {
  const model = useBaseModel()
  const s = useStore((st) => st.ayarlar)
  const setAyarlar = useStore((st) => st.setAyarlar)
  const apply = useStore((st) => st.applyCableSpec)
  const a = useMemo(() => analyze(model), [model])
  const rows = useMemo(() => cableStudy(model, a, s), [model, a, s])
  const [onlyBad, setOnlyBad] = useState(false)
  const shown = onlyBad ? rows.filter((r) => !r.adequate) : rows
  const num = (label: string, key: 'kabloOrtam' | 'kabloGruplama' | 'kabloDusum' | 'kabloKscSure', step: number) => (
    <label className="flex items-center gap-2">
      {label}
      <input type="number" step={step} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s[key]} onChange={(e) => setAyarlar({ [key]: Number(e.target.value) || 0 })} />
    </label>
  )
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">{tr.elk.cableIntro}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        {num(tr.elk.cableAmb, 'kabloOrtam', 1)}
        {num(tr.elk.cableGroup, 'kabloGruplama', 0.05)}
        {num(tr.elk.cableDrop, 'kabloDusum', 0.5)}
        {num(tr.elk.cableSc, 'kabloKscSure', 0.1)}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />
          {tr.elk.cableOnlyBad}
        </label>
        <button
          type="button"
          className="ml-auto rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
          disabled={!rows.some((r) => !r.adequate && r.rec)}
          onClick={() => rows.filter((r) => !r.adequate && r.rec).forEach((r) => apply(r.edgeId, r.rec!))}
        >
          {tr.elk.cableApplyAll}
        </button>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">{tr.elk.cableLine}</th>
                <th className="py-1 pr-2 text-right font-medium">L (m)</th>
                <th className="py-1 pr-2 text-right font-medium">I (A)</th>
                <th className="py-1 pr-2 text-right font-medium">{tr.elk.cableCurCap}</th>
                <th className="py-1 pr-2 text-right font-medium">ΔU (%)</th>
                <th className="py-1 pr-2 font-medium">{tr.elk.status}</th>
                <th className="py-1 pr-2 font-medium">{tr.elk.cableRec}</th>
                <th className="py-1 pr-2 text-right font-medium">{tr.elk.cableRecCap}</th>
                <th className="py-1 pr-2 text-right font-medium">ΔU (%)</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.edgeId} className="border-t border-slate-100">
                  <td className="py-0.5 pr-2">{r.name}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.lengthM, 0)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.currentA, 0)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(r.currentCapacityA, 0)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{r.currentDropPct === undefined ? '—' : fmtNum(r.currentDropPct, 2)}</td>
                  <td className={`py-0.5 pr-2 ${r.adequate ? 'text-green-700' : 'font-semibold text-red-700'}`}>{r.adequate ? tr.elk.cableOk : r.reason === 'capacity' ? tr.elk.cableLowCap : tr.elk.cableHighDrop}</td>
                  <td className="py-0.5 pr-2">{r.rec ? `${r.rec.n}×${r.rec.s} mm²` : tr.elk.cableNone}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{r.rec ? fmtNum(r.rec.capacityA, 0) : '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{r.rec ? fmtNum(r.rec.dropPct, 2) : '—'}</td>
                  <td className="py-0.5 text-right">
                    {r.rec && (
                      <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50" onClick={() => apply(r.edgeId, r.rec!)}>
                        {tr.elk.cableApply}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/** Elektrik çalışmaları: koruma seçiciliği (TCC) ve ark flaşı. */
export function ElectricalView() {
  const [tab, setTab] = useState<Tab>('sel')
  const tabs: [Tab, string][] = [
    ['sel', tr.elk.tabSel],
    ['arc', tr.elk.tabArc],
    ['cable', tr.elk.tabCable],
  ]
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
      <div className="max-w-6xl space-y-4">
        <h2 className="text-base font-semibold">{tr.elk.title}</h2>
        <div className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded border px-3 py-1 text-sm ${tab === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'sel' && <SelectivityPanel />}
        {tab === 'arc' && <ArcPanel />}
        {tab === 'cable' && <CablePanel />}
      </div>
    </div>
  )
}
