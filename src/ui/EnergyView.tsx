import type { EnergyReport } from '../engine'
import { tr } from '../i18n/tr'
import { PROFILE_PRESETS } from '../model/settings'
import { useBaseModel } from '../store/useModel'
import { useStore } from '../store/useStore'
import { Chart, Legend } from './charts'
import { useWorkerResult } from './useWorker'
import type { Series } from './charts'
import { fmtNum } from './status'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function EnergyView() {
  const model = useBaseModel()
  const s = useStore((st) => st.ayarlar)
  const setAyarlar = useStore((st) => st.setAyarlar)
  const { value: rep } = useWorkerResult<EnergyReport>({ task: 'energy', model, settings: s }, [model, s])
  if (!rep) return <div className="min-w-0 flex-1 bg-slate-50 p-6 text-sm text-slate-500">{tr.red.computing}</div>
  const labels = rep.hours.map((h) => `${String(h.hour).padStart(2, '0')}`)
  const series: Series[] = [
    { name: tr.enerji.kwSeries, color: '#2563eb', values: rep.hours.map((h) => h.totalKw), kind: 'bar' },
    { name: tr.enerji.itSeries, color: '#16a34a', values: rep.hours.map((h) => h.itKw) },
    { name: tr.enerji.pueSeries, color: '#dc2626', values: rep.hours.map((h) => h.pue ?? null), axis: 'right', dashed: true },
  ]
  const setHour = (key: 'profilIt' | 'profilMek', h: number, v: number) => {
    const next = [...s[key]]
    next[h] = Math.max(0, Math.min(200, v))
    setAyarlar({ [key]: next })
  }
  const money = (v: number) => `${fmtNum(v, 0)} ${s.para}`
  const preset = (k: keyof typeof PROFILE_PRESETS) => setAyarlar({ profilIt: [...PROFILE_PRESETS[k].it], profilMek: [...PROFILE_PRESETS[k].mek] })

  return (
    <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
      <div className="max-w-6xl space-y-4">
        <h2 className="text-base font-semibold">{tr.enerji.title}</h2>
        <p className="text-xs text-slate-500">{tr.enerji.intro}</p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={tr.enerji.avgPue} value={rep.avgPue === undefined ? '—' : rep.avgPue.toFixed(3).replace('.', ',')} sub={`${tr.enerji.peak}: ${fmtNum(rep.peakKw, 0)} kW`} />
          <Stat label={tr.enerji.daily} value={`${fmtNum(rep.daily.totalKwh, 0)} kWh`} sub={`IT ${fmtNum(rep.daily.itKwh, 0)} · ${tr.summary.loss} ${fmtNum(rep.daily.lossKwh, 0)} kWh`} />
          <Stat label={tr.enerji.annual} value={`${fmtNum(rep.annual.totalKwh / 1000, 0)} MWh`} sub={`${tr.enerji.lossCost}: ${money(rep.annual.lossCost)}`} />
          <Stat label={tr.enerji.cost} value={money(rep.annual.cost)} sub={`${tr.enerji.monthly}: ${money(rep.annual.monthlyCost)}`} />
        </div>

        {rep.saving ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
            <b>{tr.enerji.saving(s.hedefPue.toFixed(2).replace('.', ','))}:</b> {fmtNum(rep.saving.kwh / 1000, 0)} MWh · {money(rep.saving.cost)}
          </div>
        ) : (
          <p className="text-xs text-slate-500">{tr.enerji.noSaving}</p>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold">{tr.enerji.chartTitle}</h3>
          <Chart labels={labels} series={series} unit="kW" rightUnit="PUE" height={240} xTitle={tr.enerji.hour} />
          <Legend series={series} />
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{tr.enerji.profile}</h3>
              <span className="ml-auto text-xs text-slate-500">{tr.enerji.presets}:</span>
              {(
                [
                  ['duz', tr.enerji.pFlat],
                  ['tipik', tr.enerji.pTypical],
                  ['yaz', tr.enerji.pSummer],
                  ['kis', tr.enerji.pWinter],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50" onClick={() => preset(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">{tr.enerji.hour}</th>
                    <th className="py-1 pr-2 font-medium">{tr.enerji.it} %</th>
                    <th className="py-1 pr-2 font-medium">{tr.enerji.mech} %</th>
                    <th className="py-1 text-right font-medium">kW</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.hours.map((h) => (
                    <tr key={h.hour} className="border-t border-slate-100">
                      <td className="py-0.5 pr-2 tabular-nums text-slate-600">{String(h.hour).padStart(2, '0')}:00</td>
                      {(['profilIt', 'profilMek'] as const).map((key) => (
                        <td key={key} className="py-0.5 pr-2">
                          <input
                            type="number"
                            min={0}
                            max={200}
                            className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right"
                            value={s[key][h.hour]}
                            aria-label={`${key === 'profilIt' ? tr.enerji.it : tr.enerji.mech} ${h.hour}`}
                            onChange={(e) => setHour(key, h.hour, Number(e.target.value))}
                          />
                        </td>
                      ))}
                      <td className="py-0.5 text-right tabular-nums">{fmtNum(h.totalKw, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold">{tr.enerji.tariff}</h3>
              <div className="space-y-2 text-sm">
                <label className="flex items-center justify-between gap-2">
                  {tr.enerji.tariff} ({s.para}/kWh)
                  <input type="number" min={0} step={0.1} className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.tarife} onChange={(e) => setAyarlar({ tarife: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  {tr.enerji.currency}
                  <input className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.para} maxLength={6} onChange={(e) => setAyarlar({ para: e.target.value || 'TL' })} />
                </label>
                <label className="flex items-center justify-between gap-2">
                  {tr.enerji.targetPue}
                  <input type="number" min={1} max={5} step={0.05} className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.hedefPue} onChange={(e) => setAyarlar({ hedefPue: Math.min(5, Math.max(1, Number(e.target.value) || 1.5)) })} />
                </label>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold">{tr.enerji.topLosses}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-medium">{tr.enerji.colItem}</th>
                    <th className="py-1 pr-2 text-right font-medium">{tr.enerji.colKwh}</th>
                    <th className="py-1 text-right font-medium">{tr.enerji.colCost}</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.topLosses.map((l) => (
                    <tr key={`${l.kind}-${l.id}`} className="border-t border-slate-100">
                      <td className="py-0.5 pr-2">
                        {l.name} <span className="text-xs text-slate-400">{tr.isi.kind[l.kind]}</span>
                      </td>
                      <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(l.annualKwh, 0)}</td>
                      <td className="py-0.5 text-right tabular-nums">{money(l.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
