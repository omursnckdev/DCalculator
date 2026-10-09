import { useMemo } from 'react'
import { EQUIPMENT } from '../library/equipment'
import type { FieldDef } from '../library/equipment'
import { HEAT_LOCATIONS, LINE_TYPES } from '../model/types'
import type { HeatLocation, LineType } from '../model/types'
import { tr } from '../i18n/tr'
import type { ExplainStep } from '../engine'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'
import { STATUS_BG, STATUS_COLOR, fmtNum } from './status'

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none'

function Row({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-xs text-slate-500">
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      {children}
    </label>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      className={inputCls}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber
        if (Number.isFinite(v)) onChange(v)
      }}
    />
  )
}

function Explain({ steps }: { steps: ExplainStep[] }) {
  if (steps.length === 0) return null
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-600">{tr.results.how}</summary>
      <ol className="mt-1 space-y-1.5">
        {steps.map((st, i) => (
          <li key={i} className="rounded bg-slate-50 p-1.5">
            <div className="font-medium text-slate-700">{st.label}</div>
            <div className="break-words text-slate-500">{st.formula}</div>
            <div className="font-semibold text-slate-800">= {st.result}</div>
          </li>
        ))}
      </ol>
    </details>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  )
}

export function PropertiesPanel() {
  const analysis = useAnalysis()
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const updateNodeData = useStore((s) => s.updateNodeData)
  const updateNodeParam = useStore((s) => s.updateNodeParam)
  const updateEdgeData = useStore((s) => s.updateEdgeData)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const activeScenario = useStore((s) => s.scenarios.find((x) => x.id === s.activeScenarioId))
  const setNodeFailed = useStore((s) => s.setNodeFailed)
  const setEdgeState = useStore((s) => s.setEdgeState)

  const node = useMemo(() => nodes.find((n) => n.selected), [nodes])
  const edge = useMemo(() => (node ? undefined : edges.find((e) => e.selected)), [node, edges])
  const nodeResult = node ? analysis.nodes[node.id] : undefined
  const edgeResult = edge ? analysis.edges[edge.id] : undefined

  return (
    <aside className="bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold">{tr.props.title}</h2>

      {!node && !edge && <p className="text-xs text-slate-500">{tr.props.empty}</p>}

      {node && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {tr.props.type}: {EQUIPMENT[node.data.kind].label}
          </p>
          {activeScenario && (
            <label className="mb-3 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-800">
              <input
                type="checkbox"
                checked={activeScenario.failedNodes.includes(node.id)}
                onChange={(e) => setNodeFailed(node.id, e.target.checked)}
              />
              {tr.senaryo.failedCheck}
            </label>
          )}
          <Row label={tr.props.ad}>
            <input
              className={inputCls}
              value={node.data.ad}
              onChange={(e) => updateNodeData(node.id, { ad: e.target.value })}
            />
          </Row>
          <Row label={tr.props.etiket}>
            <input
              className={inputCls}
              value={node.data.etiket}
              onChange={(e) => updateNodeData(node.id, { etiket: e.target.value })}
            />
          </Row>
          <Row label={tr.props.grup}>
            <input
              className={inputCls}
              value={node.data.grup}
              onChange={(e) => updateNodeData(node.id, { grup: e.target.value })}
            />
          </Row>
          <hr className="my-3 border-slate-200" />
          {EQUIPMENT[node.data.kind].fields.map((f: FieldDef) => {
            const raw = node.data.params[f.key]
            if (f.kind === 'select') {
              return (
                <Row key={f.key} label={f.label}>
                  <select
                    className={inputCls}
                    value={String(raw ?? f.options[0].value)}
                    onChange={(e) => updateNodeParam(node.id, f.key, e.target.value)}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Row>
              )
            }
            return (
              <Row key={f.key} label={f.label} unit={f.unit}>
                <NumberInput
                  value={typeof raw === 'number' ? raw : NaN}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  onChange={(v) => updateNodeParam(node.id, f.key, v)}
                />
              </Row>
            )
          })}
          <p className="mb-2 text-[11px] text-slate-400">{tr.props.defaultsNote}</p>
          {nodeResult && !nodeResult.cyclic && (
            <div className="mb-3 rounded-lg border border-slate-200 p-2">
              <h3 className="mb-1 flex items-center justify-between text-xs font-semibold">
                {tr.results.title}
                {nodeResult.loadingPct !== undefined && (
                  <span
                    className="rounded px-1.5 py-0.5"
                    style={{ color: STATUS_COLOR[nodeResult.status], background: STATUS_BG[nodeResult.status] }}
                  >
                    {tr.results.loading} %{fmtNum(nodeResult.loadingPct)}
                  </span>
                )}
              </h3>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                <Stat label={tr.results.it} value={`${fmtNum(nodeResult.itKw)} kW`} />
                <Stat label={tr.results.mech} value={`${fmtNum(nodeResult.mechKw)} kW`} />
                <Stat label={tr.results.loss} value={`${fmtNum(nodeResult.lossKw)} kW`} />
                <Stat label={tr.results.total} value={`${fmtNum(nodeResult.totalKw)} kW`} />
                <Stat label={tr.results.kva} value={`${fmtNum(nodeResult.kva)} kVA`} />
                <Stat label={tr.results.current} value={`${fmtNum(nodeResult.currentA)} A`} />
                {nodeResult.ownLossKw > 0 && (
                  <>
                    <Stat label={tr.results.ownLoss} value={`${fmtNum(nodeResult.ownLossKw, 2)} kW`} />
                    <Stat label={tr.results.input} value={`${fmtNum(nodeResult.inputKw)} kW`} />
                  </>
                )}
              </dl>
              <Explain steps={nodeResult.explain} />
            </div>
          )}
          <Row label={tr.props.notlar}>
            <textarea
              className={inputCls}
              rows={3}
              value={node.data.notlar}
              onChange={(e) => updateNodeData(node.id, { notlar: e.target.value })}
            />
          </Row>
        </>
      )}

      {edge && edge.data && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {tr.props.line} · {tr.props.lineRoute}:{' '}
            {nodes.find((n) => n.id === edge.source)?.data.ad} → {nodes.find((n) => n.id === edge.target)?.data.ad}
          </p>
          <Row label={tr.line.tip}>
            <select
              className={inputCls}
              value={edge.data.tip}
              onChange={(e) => updateEdgeData(edge.id, { tip: e.target.value as LineType })}
            >
              {LINE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {tr.line[t]}
                </option>
              ))}
            </select>
          </Row>
          <Row label={tr.line.uzunluk} unit="m">
            <NumberInput value={edge.data.uzunluk} min={0} onChange={(v) => updateEdgeData(edge.id, { uzunluk: v })} />
          </Row>
          <Row label={tr.line.akimKapasitesi} unit="A">
            <NumberInput
              value={edge.data.akimKapasitesi}
              min={0}
              onChange={(v) => updateEdgeData(edge.id, { akimKapasitesi: v })}
            />
          </Row>
          <Row label={tr.line.r} unit="Ω/km">
            <NumberInput value={edge.data.r} min={0} step={0.01} onChange={(v) => updateEdgeData(edge.id, { r: v })} />
          </Row>
          <Row label={tr.line.x} unit="Ω/km">
            <NumberInput value={edge.data.x} min={0} step={0.01} onChange={(v) => updateEdgeData(edge.id, { x: v })} />
          </Row>
          <Row label={tr.line.gerilim} unit="V">
            <NumberInput value={edge.data.gerilim} min={0} onChange={(v) => updateEdgeData(edge.id, { gerilim: v })} />
          </Row>
          <Row label={tr.line.pay} unit="%">
            <input
              type="number"
              className={inputCls}
              min={0}
              max={100}
              placeholder={tr.line.payOto}
              value={edge.data.pay ?? ''}
              onChange={(e) => {
                const v = e.target.valueAsNumber
                updateEdgeData(edge.id, { pay: Number.isFinite(v) ? v : null })
              }}
            />
          </Row>
          <Row label={tr.line.durum}>
            <select
              className={inputCls}
              value={activeScenario?.edgeStates[edge.id] ?? edge.data.durum}
              onChange={(e) => setEdgeState(edge.id, e.target.value as 'kapali' | 'acik')}
            >
              <option value="kapali">{tr.senaryo.kapali}</option>
              <option value="acik">{tr.senaryo.acik}</option>
            </select>
          </Row>
          <Row label={tr.line.isiKonum}>
            <select
              className={inputCls}
              value={edge.data.isiKonum}
              onChange={(e) => updateEdgeData(edge.id, { isiKonum: e.target.value as HeatLocation })}
            >
              {HEAT_LOCATIONS.map((h) => (
                <option key={h} value={h}>
                  {h === 'salon' ? tr.alan.konumSalon : h === 'dis' ? tr.alan.konumDis : tr.alan.konumElektrik}
                </option>
              ))}
            </select>
          </Row>
          {edgeResult && (
            <div className="mb-3 rounded-lg border border-slate-200 p-2">
              <h3 className="mb-1 flex items-center justify-between text-xs font-semibold">
                {tr.results.title}
                {edgeResult.loadingPct !== undefined && (
                  <span
                    className="rounded px-1.5 py-0.5"
                    style={{ color: STATUS_COLOR[edgeResult.status], background: STATUS_BG[edgeResult.status] }}
                  >
                    {tr.results.loading} %{fmtNum(edgeResult.loadingPct)}
                  </span>
                )}
              </h3>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                <Stat label={tr.results.flow} value={`${fmtNum(edgeResult.p)} kW`} />
                <Stat label={tr.results.kva} value={`${fmtNum(edgeResult.kva)} kVA`} />
                <Stat label={tr.results.current} value={`${fmtNum(edgeResult.currentA)} A`} />
                <Stat label={tr.results.ownLoss} value={`${fmtNum(edgeResult.lossKw, 3)} kW`} />
                {edgeResult.voltageDropPct !== undefined && (
                  <Stat label={tr.results.drop} value={`%${fmtNum(edgeResult.voltageDropPct, 2)}`} />
                )}
              </dl>
              <Explain steps={edgeResult.explain} />
            </div>
          )}
        </>
      )}

      {(node || edge) && (
        <button
          type="button"
          onClick={deleteSelection}
          className="mt-2 w-full rounded border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          {tr.props.delete}
        </button>
      )}
    </aside>
  )
}
