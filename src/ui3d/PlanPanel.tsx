import { useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { canClonePl1 } from '../model/clonePlan'
import { parseHatCizelgesi } from '../model/hatCizelgesi'
import type { HatCizelgesi } from '../model/hatCizelgesi'
import { parsePlan, toProjectNodes } from '../model/project'
import type { Plan3D } from '../model/types'
import { useStore } from '../store/useStore'
import hdcPlanUrl from '../../examples/hdc02-gf.plan.json?url'
import hdcHatUrl from '../../examples/hdc02-c1c2.hatlar.json?url'
import { use3dStore } from './use3dStore'

const btn = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50'

/** Kat planı: plan JSON'u (scripts/pdf-plan.py çıktısı) uygular → duvarlar, odalar, etiketi eşleşen ekipmanın plandaki yeri. */
export function PlanPanel() {
  const plan = useStore((s) => s.plan3d)
  const importPlan = useStore((s) => s.importPlan3d)
  const removePlan = useStore((s) => s.removePlan3d)
  const applyHat = useStore((s) => s.applyHatCizelgesi)
  const hatRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [ekle, setEkle] = useState(true)
  const [kopya, setKopya] = useState(true)
  const nodes = useStore((st) => st.nodes)
  const edges = useStore((st) => st.edges)
  const kopyalanabilir = canClonePl1({ nodes: toProjectNodes(nodes) })
  void edges
  const fileRef = useRef<HTMLInputElement>(null)
  const A = tr.v3d.plan
  const H = tr.v3d.hat

  const apply = (p: Plan3D | undefined) => {
    if (!p) {
      setMsg(A.invalid)
      return
    }
    if (!confirm(A.confirm(p.ad, ekle, kopya && kopyalanabilir))) return
    const r = importPlan(p, { ekle, kopyaPl2: kopya && kopyalanabilir })
    setMsg(A.done(r.matched, r.unmatched, r.unused.length, r.eklenen, r.klonlanan))
    use3dStore.getState().setPrefs({ showLabels: true })
    use3dStore.getState().requestView('fit')
  }
  const applyHatSpec = (h: HatCizelgesi | undefined) => {
    if (!h) {
      setMsg(H.invalid)
      return
    }
    if (!confirm(H.confirm(h.ad))) return
    const r = applyHat(h)
    setMsg(r.hatSayisi === 0 && r.olusturulan.length === 0 ? H.nochange : H.done(r))
    use3dStore.getState().requestView('fit')
  }
  const loadHat = async () => {
    try {
      applyHatSpec(parseHatCizelgesi(await (await fetch(hdcHatUrl)).json()))
    } catch {
      setMsg(H.invalid)
    }
  }
  const onHatFile = async (f: File | undefined) => {
    if (!f) return
    try {
      applyHatSpec(parseHatCizelgesi(JSON.parse(await f.text())))
    } catch {
      setMsg(H.invalid)
    }
    if (hatRef.current) hatRef.current.value = ''
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
          <label className="flex items-center gap-1" title={A.ekleHint}>
            <input type="checkbox" checked={ekle} onChange={(e) => setEkle(e.target.checked)} />
            {A.ekle}
          </label>
          <label className={`flex items-center gap-1 ${kopyalanabilir ? '' : 'text-slate-400'}`} title={A.kopyaHint}>
            <input type="checkbox" checked={kopya && kopyalanabilir} disabled={!kopyalanabilir} onChange={(e) => setKopya(e.target.checked)} />
            {A.kopya}
          </label>
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
          <div className="border-t border-slate-200 pt-1">
            <p className="font-semibold">{H.title}</p>
            <p className="text-slate-500">{H.hint}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              <button type="button" className={btn} onClick={() => void loadHat()}>
                {H.example}
              </button>
              <button type="button" className={btn} onClick={() => hatRef.current?.click()}>
                {H.open}
              </button>
              <input ref={hatRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onHatFile(e.target.files?.[0])} />
            </div>
          </div>
          {msg && <p className="font-medium text-emerald-700">{msg}</p>}
        </div>
      )}
    </div>
  )
}
