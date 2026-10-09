import { tr } from '../i18n/tr'
import { useAnalysis } from '../store/useAnalysis'
import { fmtNum } from './status'

export function SummaryBar() {
  const { totals } = useAnalysis()
  return (
    <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
      <span className="font-semibold">{tr.summary.title}:</span>
      <span>
        {tr.summary.it} <b>{fmtNum(totals.itKw)}</b> kW
      </span>
      <span>
        {tr.summary.mech} <b>{fmtNum(totals.mechKw)}</b> kW
      </span>
      <span>
        {tr.summary.loss} <b>{fmtNum(totals.lossKw)}</b> kW
      </span>
      <span>
        {tr.summary.total} <b>{fmtNum(totals.totalKw)}</b> kW · <b>{fmtNum(totals.kva)}</b> kVA
      </span>
    </div>
  )
}
