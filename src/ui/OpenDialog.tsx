import { useEffect, useState } from 'react'
import { tr } from '../i18n/tr'
import type { Project } from '../model/types'
import { deleteProjectFromDb, listProjectsInDb } from '../store/persistence'
import { useStore } from '../store/useStore'

export function OpenDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Project[] | null>(null)
  const loadProject = useStore((s) => s.loadProject)

  const refresh = () => void listProjectsInDb().then(setItems)
  useEffect(refresh, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[28rem] rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{tr.open.title}</h2>
        {items?.length === 0 && <p className="text-sm text-slate-500">{tr.open.empty}</p>}
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {items?.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {new Date(p.updatedAt).toLocaleString('tr-TR')} · {p.nodes.length} ekipman, {p.edges.length} hat
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  onClick={() => {
                    loadProject(p)
                    onClose()
                  }}
                >
                  {tr.open.load}
                </button>
                <button
                  type="button"
                  className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  onClick={async () => {
                    if (!confirm(tr.open.confirmRemove)) return
                    await deleteProjectFromDb(p.id)
                    refresh()
                  }}
                >
                  {tr.open.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 text-right">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={onClose}>
            {tr.open.close}
          </button>
        </div>
      </div>
    </div>
  )
}
