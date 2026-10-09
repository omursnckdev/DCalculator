import { useMemo, useState } from 'react'
import { DEFAULT_THRESHOLDS, analyze, runN1, statusOf } from '../engine'
import type { Analysis, N1Row } from '../engine'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import { toProjectEdges, toProjectNodes } from '../model/project'
import type { EdgeState, Scenario } from '../model/types'
import { useStore } from '../store/useStore'
import { STATUS_BG, STATUS_COLOR, fmtNum } from './status'

const card = 'rounded-lg border border-slate-200 bg-white p-4'
const btn = 'rounded border border-slate-300 bg-white px-2.5 py-1 text-sm hover:bg-slate-50'
const selectCls = 'rounded border border-slate-300 bg-white px-2 py-1 text-sm'

function PctCell({ pct }: { pct?: number }) {
  if (pct === undefined) return <span className="text-slate-400">—</span>
  const st = statusOf(pct, DEFAULT_THRESHOLDS)
  return (
    <span className="rounded px-1.5 py-0.5 text-sm font-semibold" style={{ color: STATUS_COLOR[st], background: STATUS_BG[st] }}>
      %{fmtNum(pct)}
    </span>
  )
}

function ScenarioEditor({ sc }: { sc: Scenario }) {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const updateScenario = useStore((s) => s.updateScenario)
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.data.ad ?? id
  const edgeName = (id: string) => {
    const e = edges.find((x) => x.id === id)
    return e ? `${nodeName(e.source)} → ${nodeName(e.target)}` : id
  }
  const candidates = nodes.filter((n) => EQUIPMENT[n.data.kind].hasOutput && !sc.failedNodes.includes(n.id))
  const edgeCandidates = edges.filter((e) => !(e.id in sc.edgeStates))
  const switchCandidates = nodes.filter((n) => n.data.kind === 'kesici' && !(n.id in sc.nodeStates))

  return (
    <div className="mt-3 grid gap-4 border-t border-slate-100 pt-3 md:grid-cols-2">
      <div>
        <h4 className="mb-1 text-xs font-semibold text-slate-600">{tr.senaryo.failedTitle}</h4>
        <div className="mb-2 flex flex-wrap gap-1">
          {sc.failedNodes.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
              {nodeName(id)}
              <button
                type="button"
                aria-label={`${nodeName(id)} ${tr.senaryo.remove}`}
                onClick={() => updateScenario(sc.id, { failedNodes: sc.failedNodes.filter((x) => x !== id) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <select
          className={selectCls}
          value=""
          aria-label={tr.senaryo.addFailed}
          onChange={(e) => e.target.value && updateScenario(sc.id, { failedNodes: [...sc.failedNodes, e.target.value] })}
        >
          <option value="">{tr.senaryo.addFailed}</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data.ad}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold text-slate-600">{tr.senaryo.switchTitle}</h4>
        <ul className="mb-2 space-y-1">
          {Object.entries(sc.nodeStates).map(([id, state]) => (
            <li key={`n-${id}`} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{nodeName(id)}</span>
              <select
                className={selectCls}
                value={state}
                onChange={(e) => updateScenario(sc.id, { nodeStates: { ...sc.nodeStates, [id]: e.target.value as EdgeState } })}
              >
                <option value="kapali">{tr.senaryo.kapali}</option>
                <option value="acik">{tr.senaryo.acik}</option>
              </select>
              <button
                type="button"
                aria-label={`${nodeName(id)} ${tr.senaryo.remove}`}
                className="text-slate-400 hover:text-red-600"
                onClick={() => {
                  const next = { ...sc.nodeStates }
                  delete next[id]
                  updateScenario(sc.id, { nodeStates: next })
                }}
              >
                ×
              </button>
            </li>
          ))}
          {Object.entries(sc.edgeStates).map(([id, state]) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{edgeName(id)}</span>
              <select
                className={selectCls}
                value={state}
                onChange={(e) => updateScenario(sc.id, { edgeStates: { ...sc.edgeStates, [id]: e.target.value as EdgeState } })}
              >
                <option value="kapali">{tr.senaryo.kapali}</option>
                <option value="acik">{tr.senaryo.acik}</option>
              </select>
              <button
                type="button"
                aria-label={`${edgeName(id)} ${tr.senaryo.remove}`}
                className="text-slate-400 hover:text-red-600"
                onClick={() => {
                  const next = { ...sc.edgeStates }
                  delete next[id]
                  updateScenario(sc.id, { edgeStates: next })
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <select
          className={`${selectCls} mr-2`}
          value=""
          aria-label={tr.senaryo.addBreaker}
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            const base = nodes.find((x) => x.id === id)?.data.params.durum === 'acik' ? 'acik' : 'kapali'
            updateScenario(sc.id, { nodeStates: { ...sc.nodeStates, [id]: base === 'kapali' ? 'acik' : 'kapali' } })
          }}
        >
          <option value="">{tr.senaryo.addBreaker}</option>
          {switchCandidates.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data.ad}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value=""
          aria-label={tr.senaryo.addSwitch}
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            const base = edges.find((x) => x.id === id)?.data?.durum ?? 'kapali'
            updateScenario(sc.id, { edgeStates: { ...sc.edgeStates, [id]: base === 'kapali' ? 'acik' : 'kapali' } })
          }}
        >
          <option value="">{tr.senaryo.addSwitch}</option>
          {edgeCandidates.map((e) => (
            <option key={e.id} value={e.id}>
              {edgeName(e.id)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-slate-400">{tr.senaryo.switchHint}</p>
      </div>
    </div>
  )
}

export function ScenarioView() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const scenarios = useStore((s) => s.scenarios)
  const activeId = useStore((s) => s.activeScenarioId)
  const addScenario = useStore((s) => s.addScenario)
  const updateScenario = useStore((s) => s.updateScenario)
  const deleteScenario = useStore((s) => s.deleteScenario)
  const setActive = useStore((s) => s.setActiveScenario)
  const [onlyFail, setOnlyFail] = useState(false)

  const model = useMemo(() => ({ nodes: toProjectNodes(nodes), edges: toProjectEdges(edges) }), [nodes, edges])
  const n1 = useMemo(() => runN1(model), [model])
  const results = useMemo(() => {
    const m = new Map<string | null, Analysis>()
    m.set(null, analyze(model))
    for (const sc of scenarios) m.set(sc.id, analyze(model, undefined, sc))
    return m
  }, [model, scenarios])

  const active = scenarios.find((x) => x.id === activeId)
  const rows = onlyFail ? n1.filter((r) => !r.ok) : n1
  const okCount = n1.filter((r) => r.ok).length

  const saveRow = (r: N1Row) =>
    addScenario({
      ad: r.label,
      failedNodes: r.kind === 'node' ? [r.id] : [],
      edgeStates: r.kind === 'edge' ? { [r.id]: 'acik' } : {},
    })

  const cols: (Scenario | null)[] = [null, ...scenarios]
  const base = results.get(null)!
  const equipRows = model.nodes.filter((n) => base.nodes[n.id]?.capacity)
  const lineRows = model.edges.filter((e) => e.durum === 'kapali')
  const nameOf = (id: string) => model.nodes.find((n) => n.id === id)?.ad ?? id

  return (
    <div className="min-w-0 flex-1 space-y-4 overflow-auto bg-slate-50 p-4">
      <section className={card}>
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-sm font-semibold">{tr.senaryo.title}</h2>
          <button type="button" className={btn} onClick={() => addScenario()}>
            + {tr.senaryo.newOne}
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          <li className="flex items-center gap-3 py-1.5">
            <button
              type="button"
              className={`${btn} ${activeId === null ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}
              onClick={() => setActive(null)}
            >
              {activeId === null ? tr.senaryo.shown : tr.senaryo.show}
            </button>
            <span className="text-sm font-medium">{tr.senaryo.base}</span>
          </li>
          {scenarios.map((sc) => (
            <li key={sc.id} className="flex flex-wrap items-center gap-3 py-1.5">
              <button
                type="button"
                className={`${btn} ${activeId === sc.id ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}
                onClick={() => setActive(sc.id)}
              >
                {activeId === sc.id ? tr.senaryo.shown : tr.senaryo.show}
              </button>
              <input
                aria-label="Senaryo adı"
                className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
                value={sc.ad}
                onChange={(e) => updateScenario(sc.id, { ad: e.target.value })}
              />
              <span className="text-xs text-slate-500">
                {tr.senaryo.nodes(sc.failedNodes.length)} · {tr.senaryo.switches(Object.keys(sc.edgeStates).length + Object.keys(sc.nodeStates).length)}
              </span>
              <button
                type="button"
                className="ml-auto text-sm text-red-600 hover:underline"
                onClick={() => confirm(tr.senaryo.confirmRemove) && deleteScenario(sc.id)}
              >
                {tr.senaryo.remove}
              </button>
            </li>
          ))}
        </ul>
        {scenarios.length === 0 && <p className="mt-2 text-xs text-slate-500">{tr.senaryo.none}</p>}
        {active ? <ScenarioEditor sc={active} /> : scenarios.length > 0 && <p className="mt-2 text-xs text-slate-500">{tr.senaryo.pickActive}</p>}
      </section>

      <section className={card}>
        <div className="mb-1 flex items-center gap-3">
          <h2 className="text-sm font-semibold">{tr.senaryo.n1.title}</h2>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} />
            {tr.senaryo.n1.onlyFail}
          </label>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          {tr.senaryo.n1.hint} <b>{n1.length > 0 ? tr.senaryo.n1.summary(okCount, n1.length) : ''}</b>
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{tr.senaryo.n1.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  {[tr.senaryo.n1.element, tr.senaryo.n1.type, tr.senaryo.n1.lostIt, tr.senaryo.n1.lostMech, tr.senaryo.n1.peak, tr.senaryo.n1.overloads, tr.senaryo.n1.result, ''].map((h, i) => (
                    <th key={i} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => Number(a.ok) - Number(b.ok)).map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1">{r.label}</td>
                    <td className="px-2 py-1 text-slate-500">{r.kind === 'node' ? tr.senaryo.n1.node : tr.senaryo.n1.edge}</td>
                    <td className="px-2 py-1 tabular-nums">{r.lostItKw > 0 ? <b className="text-red-600">{fmtNum(r.lostItKw)}</b> : 0}</td>
                    <td className="px-2 py-1 tabular-nums">{r.lostMechKw > 0 ? <b className="text-red-600">{fmtNum(r.lostMechKw)}</b> : 0}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {r.peak ? (
                        <>
                          <PctCell pct={r.peak.pct} /> <span className="text-xs text-slate-500">{r.peak.name}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1 text-xs">{r.overloads.map((o) => o.name).join(', ') || '—'}</td>
                    <td className="px-2 py-1">
                      <span className={r.ok ? 'font-semibold text-green-700' : 'font-semibold text-red-600'}>
                        {r.ok ? `✓ ${tr.senaryo.n1.ok}` : `✗ ${tr.senaryo.n1.fail}`}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => saveRow(r)}>
                        {tr.senaryo.n1.saveAs}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold">{tr.senaryo.compare.title}</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-slate-500">{tr.senaryo.compare.need}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-2 py-1.5" />
                  {cols.map((c) => (
                    <th key={c?.id ?? 'base'} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                      {c ? c.ad : tr.senaryo.compare.base}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [tr.senaryo.compare.totalKw, (a: Analysis) => fmtNum(a.totals.totalKw)],
                    [tr.senaryo.compare.itKw, (a: Analysis) => fmtNum(a.totals.itKw)],
                    [tr.senaryo.compare.lossKw, (a: Analysis) => fmtNum(a.totals.lossKw)],
                    [tr.senaryo.compare.lostKw, (a: Analysis) => fmtNum(Math.max(0, a.unserved.totalKw - base.unserved.totalKw))],
                    [tr.senaryo.compare.pue, (a: Analysis) => (a.pue === undefined ? '—' : a.pue.toFixed(3).replace('.', ','))],
                  ] as [string, (a: Analysis) => string][]
                ).map(([label, f]) => (
                  <tr key={label} className="border-b border-slate-100">
                    <td className="px-2 py-1 text-slate-600">{label}</td>
                    {cols.map((c) => (
                      <td key={c?.id ?? 'base'} className="px-2 py-1 tabular-nums">
                        {f(results.get(c?.id ?? null)!)}
                      </td>
                    ))}
                  </tr>
                ))}
                {equipRows.length > 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                      {tr.senaryo.compare.equipment}
                    </td>
                  </tr>
                )}
                {equipRows.map((n) => (
                  <tr key={n.id} className="border-b border-slate-100">
                    <td className="px-2 py-1">{n.ad}</td>
                    {cols.map((c) => {
                      const r = results.get(c?.id ?? null)!.nodes[n.id]
                      return (
                        <td key={c?.id ?? 'base'} className="px-2 py-1">
                          {r.failed ? (
                            <span className="text-xs font-bold text-red-600">{tr.senaryo.compare.failed}</span>
                          ) : !r.energized ? (
                            <span className="text-xs text-slate-400">{tr.senaryo.compare.dead}</span>
                          ) : (
                            <PctCell pct={r.loadingPct} />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {lineRows.length > 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                      {tr.senaryo.compare.lines}
                    </td>
                  </tr>
                )}
                {lineRows.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="px-2 py-1">
                      {nameOf(e.source)} → {nameOf(e.target)}
                    </td>
                    {cols.map((c) => {
                      const a = results.get(c?.id ?? null)!
                      const r = a.edges[e.id]
                      return (
                        <td key={c?.id ?? 'base'} className="px-2 py-1">
                          {!r ? (
                            <span className="text-xs text-slate-400">{tr.senaryo.compare.open}</span>
                          ) : !r.live ? (
                            <span className="text-xs text-slate-400">{tr.senaryo.compare.dead}</span>
                          ) : (
                            <PctCell pct={r.loadingPct} />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
