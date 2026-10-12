import { useMemo, useState } from 'react'
import { BUILTIN_CATALOG, loadUserCatalog, saveUserCatalog } from '../library/catalog'
import type { CatalogEntry } from '../library/catalog'
import { EQUIPMENT, PALETTE_GROUPS, defsInGroup } from '../library/equipment'
import { tr } from '../i18n/tr'
import { newId } from '../model/project'
import type { EquipmentType } from '../model/types'
import { useStore } from '../store/useStore'
import { useUiPrefs } from '../store/uiPrefs'
import { Symbol } from './Symbol'

export const DND_MIME = 'application/x-dcalculator-equipment'
export const DND_CATALOG = 'application/x-dcalculator-catalog'

/** Kimlikten katalog kaydını bulur (hazır + kullanıcı). */
export const findCatalogEntry = (id: string): CatalogEntry | undefined => [...BUILTIN_CATALOG, ...loadUserCatalog()].find((c) => c.id === id)

function CatalogSection({ onAddCatalog }: { onAddCatalog: (c: CatalogEntry) => void }) {
  const [q, setQ] = useState('')
  const [mine, setMine] = useState<CatalogEntry[]>(() => loadUserCatalog())
  const selected = useStore((s) => s.nodes.find((n) => n.selected))
  const all = useMemo(() => [...mine, ...BUILTIN_CATALOG], [mine])
  const f = q.trim().toLowerCase()
  const shown = f ? all.filter((c) => `${c.ad} ${c.aciklama}`.toLowerCase().includes(f)) : all
  const saveSelected = () => {
    if (!selected) {
      alert(tr.katalog.saveNeed)
      return
    }
    const ad = prompt(tr.katalog.savePrompt, selected.data.ad)
    if (!ad?.trim()) return
    const next = [...mine, { id: newId('k'), ad: ad.trim(), type: selected.data.kind, params: { ...selected.data.params }, aciklama: '', user: true }]
    setMine(next)
    saveUserCatalog(next)
  }
  const remove = (id: string) => {
    const next = mine.filter((c) => c.id !== id)
    setMine(next)
    saveUserCatalog(next)
  }
  return (
    <details className="mb-4" open={false}>
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tr.katalog.title}</summary>
      <p className="my-1 text-[11px] text-slate-500">{tr.katalog.hint}</p>
      <input className="mb-1 w-full rounded border border-slate-300 px-1.5 py-1 text-xs" placeholder={tr.katalog.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <button type="button" className="mb-1 w-full rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={saveSelected}>
        {tr.katalog.saveSelected}
      </button>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {shown.length === 0 && <p className="text-xs text-slate-500">{tr.katalog.empty}</p>}
        {shown.map((c) => (
          <div key={c.id} className="flex items-center gap-1">
            <button
              type="button"
              draggable
              title={c.aciklama}
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_CATALOG, c.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => onAddCatalog(c)}
              className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-left text-xs hover:border-blue-400 hover:bg-blue-50"
            >
              <Symbol type={c.type} color={EQUIPMENT[c.type].color} size={18} />
              <span className="truncate">{c.user ? '★ ' : ''}{c.ad}</span>
            </button>
            {c.user && (
              <button type="button" className="px-1 text-xs text-red-600" title={tr.katalog.remove} aria-label={tr.katalog.remove} onClick={() => remove(c.id)}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

export function Palette({ onAdd, onAddCatalog }: { onAdd: (type: EquipmentType) => void; onAddCatalog: (c: CatalogEntry) => void }) {
  const open = useUiPrefs((s) => s.leftOpen)
  const setLeft = useUiPrefs((s) => s.setLeft)
  if (!open) return null
  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{tr.palette.title}</h2>
        <button type="button" className="rounded px-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setLeft(false)} title={`${tr.ui.hidePalette} ([)`} aria-label={tr.ui.hidePalette}>
          ◀
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">{tr.palette.hint}</p>
      <CatalogSection onAddCatalog={onAddCatalog} />
      {PALETTE_GROUPS.map((g) => (
        <section key={g} className="mb-4">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {tr.palette.groups[g]}
          </h3>
          <div className="flex flex-col gap-1">
            {defsInGroup(g).map((d) => (
              <button
                key={d.type}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, d.type)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => onAdd(d.type)}
                className="flex cursor-grab items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-blue-400 hover:bg-blue-50"
              >
                <Symbol type={d.type} color={EQUIPMENT[d.type].color} size={22} />
                <span className="truncate">{d.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  )
}
