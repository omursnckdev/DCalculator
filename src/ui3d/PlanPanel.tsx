import { useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { parsePlan } from '../model/project'
import type { Plan3D } from '../model/types'
import { useStore } from '../store/useStore'
import hdcPlanUrl from '../../examples/hdc02-gf.plan.json?url'
import { use3dStore } from './use3dStore'

const btn = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50'

/** Kat planı: plan JSON'u (scripts/pdf-plan.py çıktısı) uygular → duvarlar, odalar, etiketi eşleşen ekipmanın plandaki yeri. */
export function PlanPanel() {
  const plan = useStore((s) => s.plan3d)
  const importPlan = useStore((s) => s.importPlan3d)
  const removePlan = useStore((s) => s.removePlan3d)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const A = tr.v3d.plan

  const apply = (p: Plan3D | undefined) => {
    if (!p) {
      setMsg(A.invalid)
      return
    }
    if (!confirm(A.confirm(p.ad))) return
    const r = importPlan(p)
    setMsg(A.done(r.matched, r.unmatched, r.unused.length))
    use3dStore.getState().requestView('fit')
  }
  const loadExample = async () => {
    try {
      const res = await fetch(hdcPlanUrl)
      apply(parsePlan(await res.json()))
    } catch {
      setMsg(A.invalid)
    }
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      apply(parsePlan(JSON.parse(await f.text())))
    } catch {
      setMsg(A.invalid)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="pointer-events-auto w-full rounded border border-slate-300 bg-white/95 p-2 text-xs shadow">
      <button type="button" className="font-semibold" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {A.title}
        {plan ? ` · ${plan.ad}` : ''}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          <p className="text-slate-500">{A.hint}</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={() => void loadExample()}>
              {A.example}
            </button>
            <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
              {A.open}
            </button>
            {plan && (
              <button type="button" className={`${btn} text-red-600`} onClick={() => removePlan()}>
                {A.remove}
              </button>
            )}
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {plan && (
            <p className="text-slate-600">
              {A.info(plan.duvarlar.length, plan.odalar.length, plan.ekipman.length, plan.g, plan.d)}
            </p>
          )}
          {msg && <p className="font-medium text-emerald-700">{msg}</p>}
        </div>
      )}
    </div>
  )
}
