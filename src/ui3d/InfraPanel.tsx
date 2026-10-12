import { useState } from 'react'
import { fmtLocale } from '../util/numfmt'
import { BORU_TURLERI, TAVA_TURLERI } from '../model/types'
import type { Boru3D, Tava3D } from '../model/types'
import { STD_DN, boruLength, hydraulicsOf } from '../layout3d/pipes'
import { trayLength } from '../layout3d/trays'
import { tr } from '../i18n/tr'
import { useStore } from '../store/useStore'
import { finishDraw } from './drawing'
import type { SceneData } from './sceneData'
import { use3dStore } from './use3dStore'

const btn = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40'
const btnOn = 'rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs text-white'
const inp = 'w-full rounded border border-slate-300 px-1 py-0.5 text-xs'
const FILL = { ok: 'bg-green-500', warn: 'bg-amber-400', over: 'bg-red-500' } as const
const f1 = (v: number) => fmtLocale(v, 1)

function Num({ label, value, onChange, step = 0.1, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500">{label}</span>
      <input type="number" className={inp} value={value} step={step} min={min} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
    </label>
  )
}

function TrayEditor({ t }: { t: Tava3D }) {
  const update = useStore((s) => s.updateTava3d)
  const remove = useStore((s) => s.removeTava3d)
  const A = tr.v3d.infra
  const addPoint = () => {
    const pts = t.noktalar
    const last = pts[pts.length - 1]
    const prev = pts[pts.length - 2] ?? { x: last.x - 1, z: last.z }
    update(t.id, { noktalar: [...pts, { x: last.x + (last.x - prev.x || 1), z: last.z + (last.z - prev.z) }] })
  }
  return (
    <div className="space-y-1 border-t border-slate-100 pt-1">
      <input className={inp} value={t.ad} onChange={(e) => update(t.id, { ad: e.target.value })} aria-label={A.name} />
      <div className="grid grid-cols-2 gap-1">
        <label className="block">
          <span className="text-[11px] text-slate-500">{A.type}</span>
          <select className={inp} value={t.tur} onChange={(e) => update(t.id, { tur: e.target.value as Tava3D['tur'] })}>
            {TAVA_TURLERI.map((k) => (
              <option key={k} value={k}>
                {A.trayTypes[k]}
              </option>
            ))}
          </select>
        </label>
        <Num label={A.limit} value={t.sinir} step={5} min={5} onChange={(v) => update(t.id, { sinir: Math.min(100, v) })} />
        <Num label={A.width} value={t.g} min={0.05} onChange={(v) => update(t.id, { g: v })} />
        <Num label={A.height} value={t.h} min={0.02} onChange={(v) => update(t.id, { h: v })} />
        <Num label={A.elev} value={t.y} onChange={(v) => update(t.id, { y: v })} />
      </div>
      <div className="flex gap-1">
        <button type="button" className={btn} onClick={addPoint}>
          {A.addPoint}
        </button>
        <button type="button" className={`${btn} text-red-600`} onClick={() => remove(t.id)}>
          {A.remove}
        </button>
      </div>
    </div>
  )
}

function PipeEditor({ b }: { b: Boru3D }) {
  const update = useStore((s) => s.updateBoru3d)
  const remove = useStore((s) => s.removeBoru3d)
  const A = tr.v3d.infra
  const h = hydraulicsOf(b)
  return (
    <div className="space-y-1 border-t border-slate-100 pt-1">
      <input className={inp} value={b.ad} onChange={(e) => update(b.id, { ad: e.target.value })} aria-label={A.name} />
      <div className="grid grid-cols-2 gap-1">
        <label className="block">
          <span className="text-[11px] text-slate-500">{A.type}</span>
          <select className={inp} value={b.tur} onChange={(e) => update(b.id, { tur: e.target.value as Boru3D['tur'] })}>
            {BORU_TURLERI.map((k) => (
              <option key={k} value={k}>
                {A.pipeTypes[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500">{A.dir}</span>
          <select className={inp} value={b.yon} onChange={(e) => update(b.id, { yon: e.target.value as Boru3D['yon'] })}>
            <option value="besleme">{A.supply}</option>
            <option value="donus">{A.ret}</option>
          </select>
        </label>
        <Num label={A.load} value={Math.round(b.kw)} step={10} onChange={(v) => update(b.id, { kw: v })} />
        <label className="block">
          <span className="text-[11px] text-slate-500">DN {b.dnElle ? '' : `(${A.auto})`}</span>
          <select className={inp} value={h.dn} onChange={(e) => update(b.id, { dn: Number(e.target.value), dnElle: true })}>
            {STD_DN.map((d) => (
              <option key={d} value={d}>
                DN{d}
              </option>
            ))}
          </select>
        </label>
      </div>
      {b.dnElle && (
        <button type="button" className={btn} onClick={() => update(b.id, { dnElle: false, kw: b.kw })}>
          {A.autoDn}
        </button>
      )}
      <p className="text-slate-600">
        {A.length}: {f1(boruLength(b))} m · Q {f1(h.lps)} L/sn · v {f1(h.velocity)} m/sn · Δp ≈ {f1(h.dpKpa)} kPa
      </p>
      <button type="button" className={`${btn} text-red-600`} onClick={() => remove(b.id)}>
        {A.remove}
      </button>
    </div>
  )
}

/** Kablo tavası ve boru hatları: çizim araçları, doluluk, otomatik boru, seçili nesne düzenleme. */
export function InfraPanel({ data }: { data: SceneData }) {
  const [open, setOpen] = useState(true)
  const [msg, setMsg] = useState('')
  const draw = use3dStore((s) => s.draw)
  const selObj = use3dStore((s) => s.selObj)
  const startDraw = use3dStore((s) => s.startDraw)
  const cancelDraw = use3dStore((s) => s.cancelDraw)
  const setSelObj = use3dStore((s) => s.setSelObj)
  const route = useStore((s) => s.routeCablesViaTrays3d)
  const reset = useStore((s) => s.resetCableRoutes3d)
  const autoPipes = useStore((s) => s.autoPipes3d)
  const removeBoru = useStore((s) => s.removeBoru3d)
  const A = tr.v3d.infra
  const rows = [...data.trayFill.values()]
  const tray = selObj?.kind === 'tray' ? data.trays.find((t) => t.id === selObj.id) : undefined
  const pipe = selObj?.kind === 'pipe' ? data.pipes.find((p) => p.id === selObj.id) : undefined
  // Boru özeti: tür + yön gruplarında adet, toplam uzunluk, DN aralığı
  const groups = new Map<string, { n: number; len: number; dn: number[]; kw: number }>()
  for (const p of data.pipes) {
    const k = `${p.tur}|${p.yon}`
    const g = groups.get(k) ?? { n: 0, len: 0, dn: [], kw: 0 }
    g.n++
    g.len += boruLength(p)
    g.dn.push(hydraulicsOf(p).dn)
    g.kw = Math.max(g.kw, p.kw)
    groups.set(k, g)
  }
  return (
    <div className="pointer-events-auto w-full rounded border border-slate-300 bg-white/95 p-2 text-xs shadow">
      <button type="button" className="font-semibold" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {A.title} ({data.trays.length} / {data.pipes.length})
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          <div className="flex flex-wrap gap-1">
            <button type="button" className={draw?.kind === 'tray' ? btnOn : btn} onClick={() => (draw?.kind === 'tray' ? cancelDraw() : startDraw('tray'))}>
              ＋ {A.drawTray}
            </button>
            <button type="button" className={draw?.kind === 'pipe' ? btnOn : btn} onClick={() => (draw?.kind === 'pipe' ? cancelDraw() : startDraw('pipe'))}>
              ＋ {A.drawPipe}
            </button>
          </div>
          {draw && (
            <div className="rounded bg-violet-50 p-1.5 text-violet-800">
              {A.drawHint(draw.pts.length)}
              <div className="mt-1 flex gap-1">
                <button type="button" className={btn} disabled={draw.pts.length < 2} onClick={() => finishDraw()}>
                  {A.finish} (Enter)
                </button>
                <button type="button" className={btn} onClick={cancelDraw}>
                  {A.cancel} (Esc)
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1 border-t border-slate-100 pt-1">
            <div className="font-semibold text-slate-600">{A.trays}</div>
            {rows.length === 0 && <p className="text-slate-400">{A.noTrays}</p>}
            {rows.map((r) => (
              <button key={r.tray.id} type="button" className={`block w-full rounded border px-1.5 py-1 text-left ${selObj?.id === r.tray.id ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'}`} onClick={() => setSelObj({ kind: 'tray', id: r.tray.id })}>
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{r.tray.ad}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {f1(trayLength(r.tray))} m · {r.cables} {A.cables}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
                    <span className={`block h-full ${FILL[r.status]}`} style={{ width: `${Math.min(100, (r.fillPct / Math.max(1, r.tray.sinir)) * 50)}%` }} />
                  </span>
                  <span className={`w-20 text-right tabular-nums ${r.status === 'over' ? 'font-semibold text-red-600' : r.status === 'warn' ? 'text-amber-700' : 'text-slate-600'}`}>
                    %{f1(r.fillPct)} / %{r.tray.sinir}
                  </span>
                </div>
              </button>
            ))}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className={btn}
                disabled={data.trays.length === 0}
                onClick={() => {
                  const r = route()
                  setMsg(A.routed(r.routed, r.total))
                }}
              >
                {A.routeCables}
              </button>
              <button type="button" className={btn} onClick={() => reset()}>
                {A.resetRoutes}
              </button>
              {msg && <span className="text-slate-500">{msg}</span>}
            </div>
          </div>

          <div className="space-y-1 border-t border-slate-100 pt-1">
            <div className="font-semibold text-slate-600">{A.pipes}</div>
            {groups.size === 0 && <p className="text-slate-400">{A.noPipes}</p>}
            {[...groups.entries()].map(([k, g]) => {
              const [tur, yon] = k.split('|') as ['sogukSu' | 'kondenser', 'besleme' | 'donus']
              return (
                <div key={k} className="flex justify-between gap-2 text-slate-700">
                  <span>
                    {A.pipeTypes[tur]} {yon === 'besleme' ? A.supply : A.ret}
                  </span>
                  <span className="tabular-nums text-slate-500">
                    {g.n} · {f1(g.len)} m · DN{Math.min(...g.dn)}–{Math.max(...g.dn)}
                  </span>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  const n = autoPipes()
                  setMsg(A.pipesMade(n))
                }}
              >
                {A.autoPipes}
              </button>
              <button
                type="button"
                className={btn}
                disabled={!data.pipes.some((p) => p.otomatik)}
                onClick={() => {
                  for (const p of data.pipes.filter((q) => q.otomatik)) removeBoru(p.id)
                  setSelObj(null)
                }}
              >
                {A.clearAuto}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">{A.note}</p>
          </div>

          {tray && <TrayEditor t={tray} />}
          {pipe && <PipeEditor b={pipe} />}
        </div>
      )}
    </div>
  )
}
