import { EQUIPMENT, PALETTE_GROUPS, defsInGroup } from '../library/equipment'
import { tr } from '../i18n/tr'
import type { EquipmentType } from '../model/types'
import { Symbol } from './Symbol'

export const DND_MIME = 'application/x-dcalculator-equipment'

export function Palette({ onAdd }: { onAdd: (type: EquipmentType) => void }) {
  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
      <h2 className="text-sm font-semibold">{tr.palette.title}</h2>
      <p className="mb-3 text-xs text-slate-500">{tr.palette.hint}</p>
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
