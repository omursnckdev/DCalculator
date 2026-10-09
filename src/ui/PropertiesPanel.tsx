import { useMemo } from 'react'
import { EQUIPMENT } from '../library/equipment'
import type { FieldDef } from '../library/equipment'
import { LINE_TYPES } from '../model/types'
import type { LineType } from '../model/types'
import { tr } from '../i18n/tr'
import { useStore } from '../store/useStore'

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

export function PropertiesPanel() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const updateNodeData = useStore((s) => s.updateNodeData)
  const updateNodeParam = useStore((s) => s.updateNodeParam)
  const updateEdgeData = useStore((s) => s.updateEdgeData)
  const deleteSelection = useStore((s) => s.deleteSelection)

  const node = useMemo(() => nodes.find((n) => n.selected), [nodes])
  const edge = useMemo(() => (node ? undefined : edges.find((e) => e.selected)), [node, edges])

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold">{tr.props.title}</h2>

      {!node && !edge && <p className="text-xs text-slate-500">{tr.props.empty}</p>}

      {node && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {tr.props.type}: {EQUIPMENT[node.data.kind].label}
          </p>
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
