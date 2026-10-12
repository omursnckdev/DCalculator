import { useState } from 'react'
import type { EnergyReport } from '../engine'
import { MONTH_NAMES } from '../engine/climate'
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
  const [pickMonth, setPickMonth] = useState(-1) // -1: ortalama gün
  const [pasteText, setPasteText] = useState('')
  const [pasteErr, setPasteErr] = useState(false)
  const s = useStore((st) => st.ayarlar)
  const setAyarlar = useStore((st) => st.setAyarlar)
  const { value: rep } = useWorkerResult<EnergyReport>({ task: 'energy', model, settings: s }, [model, s], 350)
  if (!rep) return <div className="min-w-0 flex-1 bg-slate-50 p-6 text-sm text-slate-500">{tr.red.computing}</div>
  const shown = pickMonth >= 0 ? rep.monthHours[pickMonth] : rep.hours
  const labels = shown.map((h) => `${String(h.hour).padStart(2, '0')}`)
  const series: Series[] = [
    { name: tr.enerji.kwSeries, color: '#2563eb', values: shown.map((h) => h.totalKw), kind: 'bar' },
    { name: tr.enerji.itSeries, color: '#16a34a', values: shown.map((h) => h.itKw) },
    { name: tr.enerji.pueSeries, color: '#dc2626', values: shown.map((h) => h.pue ?? null), axis: 'right', dashed: true },
  ]
  const monthSeries: Series[] = [
    { name: tr.enerji.monthKwh, color: '#2563eb', values: rep.months.map((m) => m.totalKwh / 1000), kind: 'bar' },
    { name: tr.enerji.monthPue, color: '#dc2626', values: rep.months.map((m) => m.pue ?? null), axis: 'right', dashed: true },
    { name: tr.enerji.monthTemp, color: '#d97706', values: rep.months.map((m) => m.avgTempC), axis: 'right' },
  ]
  const applyHourly = () => {
    const vals = pasteText.split(/[\s;,]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x))
    if (vals.length !== 8760 && vals.length !== 8784) {
      setPasteErr(true)
      return
    }
    setPasteErr(false)
    setAyarlar({ iklim: { ...s.iklim, saatlik: vals } })
    setPasteText('')
  }
  const setMonth = (key: 'aylikOrt' | 'aylikGenlik', m: number, v: number) => {
    const next = [...s.iklim[key]]
    next[m] = v
    setAyarlar({ iklim: { ...s.iklim, [key]: next } })
  }
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

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={tr.enerji.co2} value={`${fmtNum(rep.co2Tons, 0)} t`} sub={`${tr.enerji.co2Factor}: ${fmtNum(s.emisyon, 2)}`} />
          {rep.waterM3 !== undefined && <Stat label={tr.enerji.water} value={`${fmtNum(rep.waterM3, 0)} m³`} sub={rep.wue !== undefined ? `${tr.enerji.wue}: ${rep.wue.toFixed(2).replace('.', ',')}` : undefined} />}
          {rep.coolingKwh !== undefined && <Stat label={tr.enerji.coolingKwh} value={`${fmtNum(rep.coolingKwh / 1000, 0)} MWh`} sub={`%${fmtNum((rep.coolingKwh / rep.annual.totalKwh) * 100, 1)}`} />}
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold">{tr.enerji.climate}</h3>
          <p className={`mb-2 text-xs ${rep.climateCoupled ? 'text-green-700' : 'text-amber-700'}`}>{rep.climateCoupled ? tr.enerji.climateOn : tr.enerji.climateOff}</p>
          <Chart labels={MONTH_NAMES} series={monthSeries} unit="MWh" rightUnit="PUE / °C" height={220} />
          <Legend series={monthSeries} />
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-medium">{tr.enerji.month}</th>
                  <th className="py-1 pr-2 text-right font-medium">{tr.enerji.tempAvg}</th>
                  <th className="py-1 pr-2 text-right font-medium">{tr.enerji.tempAmp}</th>
                  <th className="py-1 pr-2 text-right font-medium">MWh</th>
                  <th className="py-1 pr-2 text-right font-medium">PUE</th>
                  <th className="py-1 pr-2 text-right font-medium">{tr.enerji.monthFc}</th>
                  <th className="py-1 text-right font-medium">{tr.enerji.monthWater}</th>
                </tr>
              </thead>
              <tbody>
                {rep.months.map((m) => (
                  <tr key={m.month} className="border-t border-slate-100">
                    <td className="py-0.5 pr-2">{MONTH_NAMES[m.month]}</td>
                    <td className="py-0.5 pr-2 text-right">
                      {s.iklim.saatlik ? (
                        <span className="tabular-nums">{fmtNum(m.avgTempC, 1)}</span>
                      ) : (
                        <input type="number" step={0.5} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right" value={s.iklim.aylikOrt[m.month]} aria-label={`${tr.enerji.tempAvg} ${MONTH_NAMES[m.month]}`} onChange={(e) => setMonth('aylikOrt', m.month, Number(e.target.value) || 0)} />
                      )}
                    </td>
                    <td className="py-0.5 pr-2 text-right">
                      {s.iklim.saatlik ? '—' : <input type="number" step={0.5} min={0} className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right" value={s.iklim.aylikGenlik[m.month]} aria-label={`${tr.enerji.tempAmp} ${MONTH_NAMES[m.month]}`} onChange={(e) => setMonth('aylikGenlik', m.month, Math.max(0, Number(e.target.value) || 0))} />}
                    </td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{fmtNum(m.totalKwh / 1000, 1)}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{m.pue === undefined ? '—' : m.pue.toFixed(3).replace('.', ',')}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{m.freeCoolingPct === undefined ? '—' : fmtNum(m.freeCoolingPct, 0)}</td>
                    <td className="py-0.5 text-right tabular-nums">{m.waterM3 === undefined ? '—' : fmtNum(m.waterM3, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer">{tr.enerji.hourlyPaste}</summary>
            {s.iklim.saatlik && (
              <p className="my-1 text-green-700">
                {tr.enerji.hourlyInfo(s.iklim.saatlik.length)}{' '}
                <button type="button" className="underline" onClick={() => setAyarlar({ iklim: { ...s.iklim, saatlik: null } })}>
                  {tr.enerji.hourlyClear}
                </button>
              </p>
            )}
            <textarea className="mt-1 h-20 w-full rounded border border-slate-300 p-1 font-mono" value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label={tr.enerji.hourlyPaste} />
            <div className="flex items-center gap-2">
              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50" onClick={applyHourly}>
                {tr.enerji.hourlyApply}
              </button>
              {pasteErr && <span className="text-red-600">{tr.enerji.hourlyBad}</span>}
            </div>
          </details>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              {tr.enerji.co2Factor}
              <input type="number" step={0.01} min={0} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.emisyon} onChange={(e) => setAyarlar({ emisyon: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label className="flex items-center gap-2">
              {tr.enerji.setpoint}
              <input type="number" step={0.5} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s.salonSetpoint} onChange={(e) => setAyarlar({ salonSetpoint: Math.min(40, Math.max(10, Number(e.target.value) || 24)) })} />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{tr.enerji.chartTitle}</h3>
            <label className="ml-auto flex items-center gap-1 text-xs text-slate-600">
              {tr.enerji.pickMonth}
              <select className="rounded border border-slate-300 px-1 py-0.5" value={pickMonth} onChange={(e) => setPickMonth(Number(e.target.value))}>
                <option value={-1}>{tr.enerji.avgDay}</option>
                {MONTH_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
