import { useState } from 'react'
import type { CheckStatus, MaintenanceReport, RedundancyReport } from '../engine'
import { EQUIPMENT } from '../library/equipment'
import { tr } from '../i18n/tr'
import { useBaseModel } from '../store/useModel'
import { runInWorker, useWorkerResult } from './useWorker'
import { fmtNum } from './status'

const STATUS_STYLE: Record<CheckStatus, { cls: string; icon: string; label: string }> = {
  ok: { cls: 'border-green-300 bg-green-50 text-green-800', icon: '✓', label: tr.red.statusOk },
  warn: { cls: 'border-amber-300 bg-amber-50 text-amber-900', icon: '▲', label: tr.red.statusWarn },
  fail: { cls: 'border-red-300 bg-red-50 text-red-800', icon: '✕', label: tr.red.statusFail },
}

export function RedundancyView() {
  const model = useBaseModel()
  const [tick, setTick] = useState(0)
  const { value: report, busy } = useWorkerResult<RedundancyReport>({ task: 'redundancy', model }, [model, tick])
  const [maintId, setMaintId] = useState('')
  const [maint, setMaint] = useState<MaintenanceReport | null>(null)
  const [maintBusy, setMaintBusy] = useState(false)
  const candidates = model.nodes.filter((n) => EQUIPMENT[n.type].hasOutput)
  const maintName = model.nodes.find((n) => n.id === maintId)?.ad ?? ''

  if (!report) {
    return <div className="min-w-0 flex-1 bg-slate-50 p-6 text-sm text-slate-500">{tr.red.computing}</div>
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
      <div className="max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">{tr.red.title}</h2>
          <span className="text-sm text-slate-600">{busy ? tr.red.computing : tr.red.survive(report.survived, report.total)}</span>
          <button type="button" className="ml-auto rounded border border-slate-300 px-2 py-1 text-sm hover:bg-white" onClick={() => setTick(tick + 1)}>
            {tr.red.recompute}
          </button>
        </div>
        <p className="text-xs text-slate-500">{tr.red.intro}</p>

        <div className="grid gap-3 md:grid-cols-2">
          {report.checks.map((c) => {
            const st = STATUS_STYLE[c.status]
            return (
              <section key={c.id} className={`rounded-lg border p-3 ${st.cls}`}>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden>{st.icon}</span>
                  {c.title}
                  <span className="ml-auto rounded bg-white/70 px-1.5 text-[11px]">{st.label}</span>
                </h3>
                <p className="text-sm">{c.detail}</p>
              </section>
            )
          })}
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">{tr.red.spofTitle}</h3>
          {report.spof.length === 0 ? (
            <p className="text-sm text-green-700">{tr.red.noSpof}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">{tr.red.colName}</th>
                  <th className="py-1 pr-4 font-medium">{tr.red.colKind}</th>
                  <th className="py-1 text-right font-medium">{tr.red.colLost}</th>
                </tr>
              </thead>
              <tbody>
                {report.spof.map((s) => (
                  <tr key={`${s.kind}-${s.id}`} className="border-t border-slate-100">
                    <td className="py-0.5 pr-4">{s.label}</td>
                    <td className="py-0.5 pr-4 text-slate-600">{s.kind === 'node' ? tr.red.node : tr.red.edge}</td>
                    <td className="py-0.5 text-right tabular-nums text-red-700">{fmtNum(s.lostKw, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold">{tr.red.maintTitle}</h3>
          <p className="mb-2 text-xs text-slate-500">{tr.red.maintHint}</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={maintId}
              onChange={(e) => {
                setMaintId(e.target.value)
                setMaint(null)
              }}
              aria-label={tr.red.maintPick}
            >
              <option value="">{tr.red.maintPick}</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.ad}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!maintId || maintBusy}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
              onClick={() => {
                setMaintBusy(true)
                void runInWorker<MaintenanceReport>({ task: 'maintenance', model, maintId })
                  .then(setMaint)
                  .finally(() => setMaintBusy(false))
              }}
            >
              {maintBusy ? tr.red.computing : tr.red.maintRun}
            </button>
          </div>
          {maint && (
            <div className="space-y-2 text-sm">
              <p className={maint.maintenanceLostKw > 0.5 ? 'font-semibold text-red-700' : 'text-green-700'}>
                {maintName}: {maint.maintenanceLostKw > 0.5 ? tr.red.maintLost(fmtNum(maint.maintenanceLostKw, 0)) : tr.red.maintOk}
              </p>
              <p className="text-slate-600">{tr.red.maintSafe(maint.safe, maint.total)}</p>
              {maint.risky.length === 0 ? (
                <p className="text-green-700">{tr.red.maintNoRisk}</p>
              ) : (
                <>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{tr.red.maintRisk}</h4>
                  <table className="w-full">
                    <tbody>
                      {maint.risky.map((r) => (
                        <tr key={`${r.kind}-${r.id}`} className="border-t border-slate-100">
                          <td className="py-0.5 pr-4">{r.label}</td>
                          <td className="py-0.5 pr-4 text-slate-600">{r.kind === 'node' ? tr.red.node : tr.red.edge}</td>
                          <td className="py-0.5 text-right tabular-nums text-red-700">{fmtNum(r.lostKw, 0)} kW</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
