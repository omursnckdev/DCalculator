import { kwToTr } from '../engine'
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

export function SummaryView() {
  const { totals, heat, losses, pue } = useAnalysis()
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
              <Row label={tr.summary.loss} kw={losses.upsKw + losses.trafoKw + losses.lineKw} bold />
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
      </div>
    </div>
  )
}
