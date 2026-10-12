import { useRef, useState } from 'react'
import { buildImport, parseTable, readTable, TEMPLATE_CSV } from '../import/equipmentImport'
import type { ImportBuild, ImportParse } from '../import/equipmentImport'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import { useStore } from '../store/useStore'
import { saveBlob } from './fileio'

/** Excel/CSV'den ekipman listesi içe aktarma: dosya seç → önizle (uyarılar, sütun eşleme) → şemaya ekle. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [res, setRes] = useState<{ parse: ImportParse; build: ImportBuild } | null>(null)
  const importEquipment = useStore((s) => s.importEquipment)

  const pick = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const parse = parseTable(await readTable(file))
      const st = useStore.getState()
      const model = st.getProject()
      const build = buildImport(parse.items, model.nodes, model.edges)
      setRes({ parse, build })
    } catch (err) {
      setRes(null)
      setError(`${tr.ice.failed}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  const warnings = res ? [...res.parse.warnings, ...res.build.warnings] : []
  const nameOf = (id: string) => res?.build.nodes.find((n) => n.id === id)?.ad ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="max-h-[90vh] w-[56rem] max-w-[95vw] overflow-y-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold">{tr.ice.title}</h2>
        <p className="mb-3 text-xs text-slate-500">{tr.ice.intro}</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={() => fileRef.current?.click()}>
            {tr.ice.pick}
          </button>
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={() => saveBlob(new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }), 'ekipman-sablon.csv')}>
            {tr.ice.template}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void pick(f)
            }}
          />
          {busy && <span className="text-sm text-slate-500">{tr.ice.reading}</span>}
          {res && <span className="text-sm font-medium">{tr.ice.summary(res.build.nodes.length, res.build.edges.length, warnings.length)}</span>}
        </div>
        {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
        {res && (
          <div className="space-y-3">
            {warnings.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-amber-700">{tr.ice.warnings}</h3>
                <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-amber-800">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="text-sm font-semibold">{tr.ice.columns}</h3>
              <p className="text-xs text-slate-600">{res.parse.columns.map((c) => `${c.header} ${c.maps}`).join(' · ')}</p>
            </section>
            <section>
              <h3 className="text-sm font-semibold">{tr.ice.preview}</h3>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2 font-medium">{tr.ice.colName}</th>
                      <th className="py-1 pr-2 font-medium">{tr.ice.colType}</th>
                      <th className="py-1 pr-2 font-medium">{tr.ice.colGroup}</th>
                      <th className="py-1 font-medium">{tr.ice.colFrom}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.build.nodes.slice(0, 200).map((n) => (
                      <tr key={n.id} className="border-t border-slate-100">
                        <td className="py-0.5 pr-2">{n.ad}</td>
                        <td className="py-0.5 pr-2">{EQUIPMENT[n.type].label}</td>
                        <td className="py-0.5 pr-2">{n.grup}</td>
                        <td className="py-0.5">
                          {res.build.edges
                            .filter((e) => e.target === n.id)
                            .map((e) => nameOf(e.source) || e.source)
                            .join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={onClose}>
            {tr.ice.cancel}
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
            disabled={!res || res.build.nodes.length === 0}
            onClick={() => {
              if (!res) return
              importEquipment(res.build.nodes, res.build.edges)
              onClose()
            }}
          >
            {tr.ice.add}
          </button>
        </div>
      </div>
    </div>
  )
}
