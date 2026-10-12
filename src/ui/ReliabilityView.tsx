import type { ReliabilityReport, TopologyRow } from '../engine'
import { tr } from '../i18n/tr'
import { useBaseModel } from '../store/useModel'
import { useStore } from '../store/useStore'
import { fmtNum } from './status'
import { useWorkerResult } from './useWorker'

const pct = (a: number): string => `%${(a * 100).toFixed(a > 0.9999 ? 6 : 4).replace('.', ',')}`
const dk = (m: number): string => (m >= 120 ? `${fmtNum(m / 60, 1)} saat` : `${fmtNum(m, m < 10 ? 2 : 0)} ${tr.guv.minutes.split('/')[0]}`)

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function ReliabilityView() {
  const model = useBaseModel()
  const s = useStore((st) => st.ayarlar)
  const setAyarlar = useStore((st) => st.setAyarlar)
  const { value: rep, busy } = useWorkerResult<ReliabilityReport>({ task: 'reliability', model, settings: s }, [model, s], 300)
  const { value: cmp } = useWorkerResult<TopologyRow[]>({ task: 'reliabilityCompare', settings: s }, [s], 300)
  if (!rep) return <div className="min-w-0 flex-1 bg-slate-50 p-6 text-sm text-slate-500">{tr.red.computing}</div>
  const num = (label: string, key: 'kabloMtbf' | 'kabloMttr' | 'busbarMtbf' | 'busbarMttr') => (
    <label className="flex items-center justify-between gap-2 text-sm">
      {label}
      <input type="number" min={0.01} className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-right" value={s[key]} onChange={(e) => setAyarlar({ [key]: Math.max(0.01, Number(e.target.value) || 1) })} />
    </label>
  )
  return (
    <div className={`min-w-0 flex-1 overflow-auto bg-slate-50 p-4 ${busy ? 'opacity-70' : ''}`}>
      <div className="max-w-6xl space-y-4">
        <h2 className="text-base font-semibold">{tr.guv.title}</h2>
        <p className="text-xs text-slate-500">{tr.guv.intro}</p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={tr.guv.availability} value={pct(rep.availability)} sub={`${tr.guv.components}: ${rep.components}`} />
          <Stat label={tr.guv.downtime} value={dk(rep.downtimeMinPerYear)} sub={`${fmtNum(rep.downtimeMinPerYear, 1)} ${tr.guv.minutes}`} />
          <Stat label={tr.guv.nines} value={Number.isFinite(rep.nines) ? fmtNum(rep.nines, 2) : '∞'} />
          <Stat label={tr.guv.tier} value={rep.tier ?? tr.guv.noTier} sub={`${rep.counts.single} tekil · ${rep.counts.pair} çift · ${rep.counts.triple} üçlü`} />
        </div>
        {rep.truncated && <p className="text-xs text-amber-700">{tr.guv.truncated}</p>}

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">{tr.guv.cutSets}</h3>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">{tr.guv.order}</th>
                  <th className="py-1 pr-3 font-medium">{tr.guv.names}</th>
                  <th className="py-1 pr-3 text-right font-medium">{tr.guv.prob}</th>
                  <th className="py-1 pr-3 text-right font-medium">{tr.guv.share}</th>
                  <th className="py-1 font-medium">{tr.guv.loads}</th>
                </tr>
              </thead>
              <tbody>
                {rep.cutSets.slice(0, 25).map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-0.5 pr-3 tabular-nums">{c.order}</td>
                    <td className="py-0.5 pr-3">{c.names.join('  +  ')}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{c.probability.toExponential(2).replace('.', ',')}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">%{fmtNum(c.share, 1)}</td>
                    <td className="py-0.5 text-xs text-slate-500">{c.loads.slice(0, 3).join(', ')}{c.loads.length > 3 ? ` +${c.loads.length - 3}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">{tr.guv.perLoad}</h3>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <tbody>
                  {[...rep.perLoad].sort((a, b) => a.availability - b.availability).map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="py-0.5 pr-3">{l.name}</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{pct(l.availability)}</td>
                      <td className="py-0.5 text-right tabular-nums text-slate-500">{fmtNum(l.downtimeMinPerYear, 1)} {tr.guv.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">{tr.guv.hatSettings}</h3>
            <div className="space-y-1.5">
              {num(tr.guv.cableMtbf, 'kabloMtbf')}
              {num(tr.guv.cableMttr, 'kabloMttr')}
              {num(tr.guv.busMtbf, 'busbarMtbf')}
              {num(tr.guv.busMttr, 'busbarMttr')}
            </div>
            <p className="mt-2 text-xs text-slate-500">{tr.guv.note}</p>
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">{tr.guv.compare}</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">{tr.guv.colName}</th>
                <th className="py-1 pr-3 text-right font-medium">{tr.guv.availability}</th>
                <th className="py-1 pr-3 text-right font-medium">{tr.guv.downtime}</th>
                <th className="py-1 pr-3 text-right font-medium">{tr.guv.nines}</th>
                <th className="py-1 pr-3 text-right font-medium">{tr.guv.singles}</th>
                <th className="py-1 font-medium">Tier</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-blue-50 font-medium">
                <td className="py-0.5 pr-3">{tr.guv.current}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{pct(rep.availability)}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{dk(rep.downtimeMinPerYear)}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{Number.isFinite(rep.nines) ? fmtNum(rep.nines, 2) : '∞'}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{rep.counts.single}</td>
                <td className="py-0.5">{rep.tier ?? '—'}</td>
              </tr>
              {(cmp ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-0.5 pr-3">{r.ad}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{pct(r.availability)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{dk(r.downtimeMinPerYear)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{Number.isFinite(r.nines) ? fmtNum(r.nines, 2) : '∞'}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{r.singles}</td>
                  <td className="py-0.5">{r.tier ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
