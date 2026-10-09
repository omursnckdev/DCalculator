import { tr } from '../i18n/tr'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'

export function IssuesPanel() {
  const { issues } = useAnalysis()
  const selectNode = useStore((s) => s.selectNode)
  const selectEdge = useStore((s) => s.selectEdge)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))

  return (
    <section className="max-h-56 shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-3">
      <h2 className="mb-1 text-sm font-semibold">
        {tr.issues.title}{' '}
        <span className="text-xs font-normal text-slate-500">
          <span className={errors ? 'text-red-600' : ''}>
            {errors} {tr.issues.errors}
          </span>
          {' · '}
          <span className={warnings ? 'text-amber-600' : ''}>
            {warnings} {tr.issues.warnings}
          </span>
        </span>
      </h2>
      {issues.length === 0 && <p className="text-xs text-green-700">{tr.issues.none}</p>}
      <ul className="space-y-1">
        {sorted.map((i, idx) => (
          <li key={idx}>
            <button
              type="button"
              onClick={() => (i.nodeId ? selectNode(i.nodeId) : i.edgeId && selectEdge(i.edgeId))}
              className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50"
            >
              <span className={i.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>
                {i.severity === 'error' ? '●' : '▲'}
              </span>
              <span>{i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
