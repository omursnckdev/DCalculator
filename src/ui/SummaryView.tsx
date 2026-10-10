import { useState } from 'react'
import { kwToTr } from '../engine'
import type { LossItem } from '../engine'
import { tr } from '../i18n/tr'
import { useAnalysis } from '../store/useAnalysis'
import { fmtNum } from './status'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, kw, tr: showTr, bold }: { label: string; kw: number; tr?: boolean; bold?: boolean }) {
  return (
    <tr className={bold ? 'font-semibold' : undefined}>
      <td className="py-0.5 pr-6 text-slate-600">{label}</td>
      <td className="whitespace-nowrap py-0.5 text-right tabular-nums">{fmtNum(kw, 2)} kW</td>
      {showTr && (
        <td className="whitespace-nowrap py-0.5 pl-6 text-right tabular-nums text-slate-500">
          {fmtNum(kwToTr(kw), 1)} {tr.isi.tr}
        </td>
      )}
    </tr>
  )
}

const LOC: Record<string, string> = { salon: tr.alan.konumSalon, elektrik: tr.alan.konumElektrik, dis: tr.alan.konumDis }

/** Kablo, busbar hattı, pano iç barası, trafo ve UPS kayıplarını kalem kalem listeler. */
function LossItems({ items }: { items: LossItem[] }) {
  const [kind, setKind] = useState<'all' | LossItem['kind']>('all')
  const kinds = (Object.keys(tr.isi.kind) as LossItem['kind'][]).filter((k) => items.some((i) => i.kind === k))
  const rows = items.filter((i) => i.kw > 0.0005 && (kind === 'all' || i.kind === kind))
  const sum = rows.reduce((a, i) => a + i.kw, 0)
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{tr.isi.itemsTitle}</h3>
        <div className="ml-auto flex flex-wrap gap-1">
          {(['all', ...kinds] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded border px-2 py-0.5 text-xs ${kind === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 hover:bg-slate-50'}`}
            >
              {k === 'all' ? tr.isi.filterAll : tr.isi.kind[k]}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr.isi.noItems}</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-4 font-medium">{tr.isi.colName}</th>
                <th className="py-1 pr-4 font-medium">{tr.isi.colKind}</th>
                <th className="py-1 pr-4 text-right font-medium">{tr.isi.colCurrent} (A)</th>
                <th className="py-1 pr-4 text-right font-medium">{tr.isi.colLoss} (kW)</th>
                <th className="py-1 pr-4 text-right font-medium">{tr.isi.colShare}</th>
                <th className="py-1 font-medium">{tr.isi.colWhere}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={`${i.kind}-${i.id}`} className="border-t border-slate-100">
                  <td className="py-0.5 pr-4">{i.name}</td>
                  <td className="py-0.5 pr-4 text-slate-600">{tr.isi.kind[i.kind]}</td>
                  <td className="py-0.5 pr-4 text-right tabular-nums">{fmtNum(i.currentA, 0)}</td>
                  <td className="py-0.5 pr-4 text-right tabular-nums">{fmtNum(i.kw, 3)}</td>
                  <td className="py-0.5 pr-4 text-right tabular-nums text-slate-500">%{fmtNum(sum > 0 ? (i.kw / sum) * 100 : 0, 1)}</td>
                  <td className="py-0.5 text-slate-600">{LOC[i.location]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1" colSpan={3}>
                  {tr.summary.loss}
                </td>
                <td className="py-1 pr-4 text-right tabular-nums">{fmtNum(sum, 3)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">{tr.isi.itemsNote}</p>
    </section>
  )
}

export function SummaryView() {
  const { totals, heat, losses, lossItems, pue } = useAnalysis()
  const cooling = heat.salonKw + heat.elektrikKw
  return (
    <div className="min-w-0 flex-1 overflow-auto bg-slate-50 p-4">
      <div className="grid max-w-5xl gap-4 md:grid-cols-2">
        <Card title={tr.isi.power}>
          <table className="text-sm">
            <tbody>
              <Row label={tr.summary.it} kw={totals.itKw} />
              <Row label={tr.summary.mech} kw={totals.mechKw} />
              <Row label={tr.summary.loss} kw={totals.lossKw} />
              <Row label={tr.summary.total} kw={totals.totalKw} bold />
              <tr>
                <td className="py-0.5 pr-6 text-slate-600">{tr.results.kva}</td>
                <td className="py-0.5 text-right tabular-nums">{fmtNum(totals.kva, 2)} kVA</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title={tr.isi.pue}>
          <div className="text-3xl font-semibold tabular-nums">{pue === undefined ? '—' : pue.toFixed(3).replace('.', ',')}</div>
          <p className="mt-1 text-xs text-slate-500">{tr.isi.pueHow}</p>
        </Card>

        <Card title={tr.isi.losses}>
          <table className="text-sm">
            <tbody>
              <Row label={tr.isi.ups} kw={losses.upsKw} />
              <Row label={tr.isi.trafo} kw={losses.trafoKw} />
              <Row label={tr.isi.line} kw={losses.lineKw} />
              <Row label={tr.isi.panel} kw={losses.panelKw} />
              <Row label={tr.summary.loss} kw={losses.upsKw + losses.trafoKw + losses.lineKw + losses.panelKw} bold />
            </tbody>
          </table>
        </Card>

        <Card title={tr.isi.title}>
          <table className="text-sm">
            <tbody>
              <Row label={tr.isi.salon} kw={heat.salonKw} tr />
              <Row label={tr.isi.elektrik} kw={heat.elektrikKw} tr />
              <Row label={tr.isi.dis} kw={heat.disKw} tr />
              <Row label={tr.isi.totalHeat} kw={heat.totalKw} tr bold />
              <tr>
                <td colSpan={3} className="pt-2" />
              </tr>
              <Row label={tr.isi.cooling} kw={cooling} tr bold />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">{tr.isi.trNote}</p>
        </Card>

        <LossItems items={lossItems} />
      </div>
    </div>
  )
}
