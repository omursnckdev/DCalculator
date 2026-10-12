import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { MaintenanceReport } from '../engine'
import { EQUIPMENT } from '../library/equipment'
import { SimulationPanel } from '../ui/SimulationPanel'
import { runInWorker } from '../ui/useWorker'
import { useBaseModel } from '../store/useModel'
import { fmtNum } from '../ui/status'
import { useAnalysis } from '../store/useAnalysis'
import { COLOR_MODES, DEAD_HEX, FAILED_HEX, OPEN_HEX, SHED_HEX, STATUS_HEX, groupHex, heatKwOf } from '../layout3d/colors'
import type { ColorMode } from '../layout3d/colors'
import { boxesOf } from '../layout3d/autoLayout'
import type { FloorFilter } from '../layout3d/floors'
import { findOverlaps } from '../layout3d/geometry'
import { laneMap, polylineLength, routePoints, defaultRoute } from '../layout3d/route'
import { tr } from '../i18n/tr'
import type { CatalogEntry } from '../library/catalog'
import { toProjectEdges, toProjectNodes } from '../model/project'
import type { Nokta3D, OdaTuru } from '../model/types'
import { ODA_TURLERI } from '../model/types'
import { useStore } from '../store/useStore'
import { DND_CATALOG, DND_MIME, Palette, findCatalogEntry } from '../ui/Palette'
import { saveBlob } from '../ui/fileio'
import { EQUIPMENT_TYPES } from '../model/types'
import type { EquipmentType } from '../model/types'
import { snap } from '../layout3d/geometry'
import { alignPatches, distributePatches } from '../layout3d/arrange'
import type { AlignMode } from '../layout3d/arrange'
import { capture3d, currentCamera, pickGround } from './capture'
import { detectGpu } from './gpu'
import { InfraPanel } from './InfraPanel'
import { trayFillFor } from '../layout3d/infra'
import type { GpuInfo } from './gpu'
import type { SceneData } from './sceneData'
import { use3dStore } from './use3dStore'

const Scene3D = lazy(() => import('./Scene3D'))

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const btn = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50'
const btnOn = 'rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs text-white'

/** Açılır menü: dışarı tıklayınca kapanır. */
function Menu({ label, children, active = false }: { label: string; children: React.ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu]')) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="relative" data-menu>
      <button type="button" className={active || open ? btnOn : btn} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label} ▾
      </button>
      {open && <div className="absolute left-0 top-full z-30 mt-1 w-56 space-y-1.5 rounded border border-slate-300 bg-white p-2 text-xs shadow-lg">{children}</div>}
    </div>
  )
}

function Toolbar3D({ gpu }: { gpu: GpuInfo | null }) {
  const s = use3dStore()
  const nodes = useStore((st) => st.nodes)
  const views = useStore((st) => st.gorunumler3d)
  const saveView = useStore((st) => st.saveGorunum3d)
  const removeView = useStore((st) => st.removeGorunum3d)
  const autoLayout3d = useStore((st) => st.autoLayout3d)
  const flowAnim = useStore((st) => st.flowAnim)
  const setFlowAnim = useStore((st) => st.setFlowAnim)
  const [q, setQ] = useState('')
  const [help, setHelp] = useState(false)
  const matches = q.trim() ? nodes.filter((n) => `${n.data.ad} ${n.data.etiket} ${n.data.grup}`.toLocaleLowerCase('tr').includes(q.trim().toLocaleLowerCase('tr'))).slice(0, 8) : []
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  )
  const sel = 'rounded border border-slate-300 px-1 py-0.5 text-xs'
  return (
    <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-3 py-1.5">
      <div className="flex overflow-hidden rounded border border-slate-300">
        {(['fit', 'front', 'side', 'top', 'persp'] as const).map((v) => (
          <button key={v} type="button" className="border-r border-slate-200 bg-white px-2 py-1 text-xs last:border-r-0 hover:bg-slate-50" onClick={() => s.requestView(v)}>
            {tr.v3d[v]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-xs">
        {tr.v3d.color}
        <select className={sel} value={s.colorMode} onChange={(e) => s.setPrefs({ colorMode: e.target.value as ColorMode })}>
          {COLOR_MODES.map((m) => (
            <option key={m} value={m}>
              {tr.v3d.modes[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs" title={tr.v3d.floorHint}>
        {tr.v3d.floor}
        <select className={sel} value={s.floor} onChange={(e) => s.setFloor(e.target.value as FloorFilter)}>
          <option value="tum">{tr.v3d.floorAll}</option>
          <option value="zemin">{tr.v3d.floorGround}</option>
          <option value="kat1">{tr.v3d.floor1}</option>
        </select>
      </label>
      <Menu label={tr.v3d.show}>
        {check(tr.v3d.walls, !s.hideWalls, (v) => s.setPrefs({ hideWalls: !v }))}
        {check(tr.v3d.heat, s.showHeat, (v) => s.setPrefs({ showHeat: v }))}
        {check(tr.v3d.cables, s.showCables, (v) => s.setPrefs({ showCables: v }))}
        {check(tr.v3d.labels, s.showLabels, (v) => s.setPrefs({ showLabels: v }))}
        {check(tr.v3d.flowLong, flowAnim, setFlowAnim)}
        <label className="flex items-center justify-between gap-2">
          {tr.v3d.snap}
          <select className={sel} value={s.snapStep} onChange={(e) => s.setPrefs({ snapStep: Number(e.target.value) })}>
            <option value={0}>{tr.v3d.free}</option>
            {[0.1, 0.25, 0.5, 1].map((v) => (
              <option key={v} value={v}>
                {v} m
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2" title={tr.v3d.qualityHint}>
          {tr.v3d.quality}
          <select className={sel} value={s.quality} onChange={(e) => s.setPrefs({ quality: e.target.value as 'dusuk' | 'normal' | 'yuksek' })}>
            <option value="dusuk">{tr.v3d.qLow}</option>
            <option value="normal">{tr.v3d.qNormal}</option>
            <option value="yuksek">{tr.v3d.qHigh}</option>
          </select>
        </label>
      </Menu>
      <div className="flex gap-1">
        <button type="button" className={s.walk ? btnOn : btn} onClick={() => s.setWalk(!s.walk)} title={tr.v3d.walkHint}>
          🚶 {tr.v3d.walk}
        </button>
        <button type="button" className={s.measure ? btnOn : btn} onClick={() => s.setMeasure(!s.measure)} title={tr.v3d.measureHint}>
          📏 {tr.v3d.measure}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            if (confirm(tr.v3d.autoConfirm)) autoLayout3d()
          }}
        >
          {tr.v3d.auto}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const png = capture3d()
            if (png) void fetch(png).then((r) => r.blob()).then((b) => saveBlob(b, `${useStore.getState().projectName || 'proje'}-3d.png`))
          }}
        >
          {tr.v3d.png}
        </button>
      </div>
      <ArrangeMenu />
      <Menu label={`${tr.v3d.views}${views.length ? ` (${views.length})` : ''}`}>
        {views.length === 0 && <p className="text-slate-400">{tr.v3d.noViews}</p>}
        {views.map((v, i) => (
          <div key={v.ad} className="flex items-center justify-between gap-1">
            <button type="button" className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left hover:bg-slate-100" onClick={() => s.moveCamera(v.pos, v.target, v.ortho ? 'top' : 'persp')}>
              {v.ad}
            </button>
            <button type="button" className="px-1 text-red-600" aria-label={tr.v3d.remove} onClick={() => removeView(i)}>
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${btn} w-full`}
          onClick={() => {
            const c = currentCamera()
            const ad = c && prompt(tr.v3d.viewName, `Görünüm ${views.length + 1}`)
            if (c && ad?.trim()) saveView({ ad: ad.trim(), pos: c.pos, target: c.target, ortho: c.ortho })
          }}
        >
          + {tr.v3d.saveView}
        </button>
      </Menu>
      <div className="relative">
        <input
          id="v3d-search"
          className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
          placeholder={tr.v3d.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="absolute left-0 top-full z-30 mt-1 w-56 rounded border border-slate-300 bg-white text-xs shadow-lg">
            {matches.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-left hover:bg-slate-100"
                  onClick={() => {
                    useStore.getState().selectNode(n.id)
                    s.focus(n.id)
                    setQ('')
                  }}
                >
                  {n.data.ad}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {gpu?.software && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" title={`${tr.v3d.softGpuHint} (${gpu.renderer})`}>
            ⚠ {tr.v3d.softGpu}
          </span>
        )}
        <button type="button" className={help ? btnOn : btn} onClick={() => setHelp(!help)} aria-label={tr.v3d.help} title={tr.v3d.help}>
          ?
        </button>
      </div>
      {help && (
        <div className="absolute right-3 top-full z-30 mt-1 w-96 max-w-[90vw] rounded border border-slate-300 bg-white p-3 text-xs shadow-lg">
          <h4 className="mb-1 text-sm font-semibold">{tr.v3d.helpTitle}</h4>
          <ul className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-700">
            {tr.v3d.keys.map(([k, v]) => (
              <li key={k}>
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1">{k}</kbd> {v}
              </li>
            ))}
          </ul>
          <p className="mb-1 text-slate-500">{tr.v3d.approx}</p>
          <p className={gpu?.software ? 'font-medium text-amber-700' : 'text-slate-600'}>
            {tr.v3d.gpu}: {gpu ? gpu.renderer : tr.v3d.gpuUnknown}
            {gpu?.software ? ` — ${tr.v3d.softGpuHint}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

/** Seçili ekipmanı hizala / eşit dağıt / kopyala. */
function ArrangeMenu() {
  const nodes = useStore((st) => st.nodes)
  const setLayout = useStore((st) => st.setLayout3d)
  const duplicate = useStore((st) => st.duplicateSelected3d)
  const mountMinors = useStore((st) => st.mountMinors3d)
  const sel = nodes.filter((n) => n.selected && n.data.yerlesim3d)
  const boxesOfSel = () => {
    const pn = toProjectNodes(sel)
    return boxesOf(pn)
  }
  const align = (m: AlignMode) => setLayout(alignPatches(boxesOfSel(), m))
  const dist = (a: 'x' | 'z') => setLayout(distributePatches(boxesOfSel(), a))
  const b = `${btn} w-full text-left disabled:opacity-40`
  const A = tr.v3d.arr
  return (
    <Menu label={A.title}>
      <p className="text-slate-500">{A.selected(sel.length)}</p>
      <div className="grid grid-cols-2 gap-1">
        {(['left', 'right', 'top', 'bottom', 'centerX', 'centerZ'] as const).map((m) => (
          <button key={m} type="button" className={b} disabled={sel.length < 2} onClick={() => align(m)}>
            {A[m]}
          </button>
        ))}
        <button type="button" className={b} disabled={sel.length < 3} onClick={() => dist('x')}>
          {A.distX}
        </button>
        <button type="button" className={b} disabled={sel.length < 3} onClick={() => dist('z')}>
          {A.distZ}
        </button>
      </div>
      <button type="button" className={b} onClick={() => mountMinors()} title={A.mountHint}>
        ▤ {A.mount}
      </button>
      <button type="button" className={b} disabled={sel.length < 1} onClick={() => duplicate()}>
        ⧉ {A.duplicate} (Ctrl+D)
      </button>
    </Menu>
  )
}

/** Renk modu açıklaması (lejant). */
function Legend3D({ data }: { data: SceneData }) {
  const mode = use3dStore((s) => s.colorMode)
  const dot = (c: string, label: string) => (
    <span key={label} className="inline-flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
      {label}
    </span>
  )
  const L = tr.v3d.legend
  let body: React.ReactNode = null
  if (mode === 'doluluk') body = [dot(STATUS_HEX.none, L.none), dot(STATUS_HEX.ok, L.ok), dot(STATUS_HEX.warning, L.warn), dot(STATUS_HEX.over, L.over)]
  else if (mode === 'enerji') body = [dot('#16a34a', L.energized), dot(DEAD_HEX, L.dead)]
  else if (mode === 'isi')
    body = (
      <span className="inline-flex items-center gap-1">
        0
        <span className="inline-block h-2.5 w-24 rounded-sm" style={{ background: 'linear-gradient(90deg,#2563eb,#22c55e,#facc15,#f97316,#dc2626)' }} />
        {fmtNum(data.colorCtx.maxHeatKw, 0)} kW
      </span>
    )
  else if (mode === 'grup') {
    const groups = [...new Set(data.nodes.map((n) => n.grup).filter(Boolean))].slice(0, 8)
    body = groups.length ? groups.map((g) => dot(groupHex(g), g)) : <span className="text-slate-400">{L.noGroup}</span>
  } else body = <span className="text-slate-500">{L.byType}</span>
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 max-w-md space-y-1 rounded bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">{body}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-slate-200 pt-0.5">
        {dot(FAILED_HEX, L.failed)}
        {dot(SHED_HEX, L.shed)}
        {dot(OPEN_HEX, L.open)}
        {dot('#22c55e', L.running)}
        {dot('#facc15', L.battery)}
      </div>
    </div>
  )
}

function RoomsPanel() {
  const rooms = useStore((st) => st.odalar3d)
  const add = useStore((st) => st.addOda3d)
  const update = useStore((st) => st.updateOda3d)
  const remove = useStore((st) => st.removeOda3d)
  const [open, setOpen] = useState(false)
  const inp = 'w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-xs'
  return (
    <div className="pointer-events-auto w-full overflow-y-auto rounded border border-slate-300 bg-white/95 p-2 text-xs shadow">
      <div className="flex items-center justify-between">
        <button type="button" className="font-semibold" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {tr.v3d.rooms} ({rooms.length})
        </button>
        <button type="button" className={btn} onClick={() => add({ ad: `Oda ${rooms.length + 1}`, tur: 'salon', x: 0, z: 0, g: 20, d: 12, y: 3.5 })}>
          {tr.v3d.addRoom}
        </button>
      </div>
      {open &&
        rooms.map((r) => (
          <div key={r.id} className="mt-1 grid grid-cols-[1fr_auto] items-center gap-1 border-t border-slate-100 pt-1">
            <div className="flex flex-wrap items-center gap-1">
              <input className="w-28 rounded border border-slate-300 px-1 py-0.5" value={r.ad} title={tr.v3d.roomName} onChange={(e) => update(r.id, { ad: e.target.value })} />
              <select className="rounded border border-slate-300 px-1 py-0.5" value={r.tur} title={tr.v3d.roomType} onChange={(e) => update(r.id, { tur: e.target.value as OdaTuru })}>
                {ODA_TURLERI.map((t) => (
                  <option key={t} value={t}>
                    {tr.v3d.roomTypes[t]}
                  </option>
                ))}
              </select>
              <span title={tr.v3d.roomPos}>
                <input type="number" className={inp} value={r.x} onChange={(e) => update(r.id, { x: Number(e.target.value) || 0 })} />
                <input type="number" className={inp} value={r.z} onChange={(e) => update(r.id, { z: Number(e.target.value) || 0 })} />
              </span>
              <span title={tr.v3d.roomDims}>
                <input type="number" className={inp} value={r.g} min={1} onChange={(e) => update(r.id, { g: Math.max(1, Number(e.target.value) || 1) })} />
                <input type="number" className={inp} value={r.d} min={1} onChange={(e) => update(r.id, { d: Math.max(1, Number(e.target.value) || 1) })} />
                <input type="number" className={inp} value={r.y} min={0.5} step={0.5} onChange={(e) => update(r.id, { y: Math.max(0.5, Number(e.target.value) || 1) })} />
              </span>
              <label className="flex items-center gap-1" title={tr.v3d.roomElev}>
                {tr.v3d.roomElevShort}
                <input type="number" className={inp} value={r.elev ?? 0} min={0} step={0.5} onChange={(e) => update(r.id, { elev: Math.max(0, Number(e.target.value) || 0) || undefined })} />
              </label>
            </div>
            <button type="button" className="text-red-600" onClick={() => remove(r.id)}>
              {tr.v3d.remove}
            </button>
          </div>
        ))}
    </div>
  )
}

/** Senaryo seçimi, seçili ekipmanı arızalı/bakımda işaretleme ve bakım analizi (3D'den). Dinamik simülasyon alttaki şerittedir. */
function ScenarioPanel3D() {
  const scenarios = useStore((s) => s.scenarios)
  const activeId = useStore((s) => s.activeScenarioId)
  const setActive = useStore((s) => s.setActiveScenario)
  const addScenario = useStore((s) => s.addScenario)
  const updateScenario = useStore((s) => s.updateScenario)
  const setNodeFailed = useStore((s) => s.setNodeFailed)
  const nodes = useStore((s) => s.nodes)
  const model = useBaseModel()
  const [open, setOpen] = useState(true)
  const [maint, setMaint] = useState<{ id: string; name: string; rep: MaintenanceReport } | null>(null)
  const [busy, setBusy] = useState(false)
  const active = scenarios.find((x) => x.id === activeId)
  const selected = nodes.filter((n) => n.selected)
  const node = selected.length === 1 && EQUIPMENT[selected[0].data.kind].hasOutput ? selected[0] : undefined
  const failed = !!node && !!active?.failedNodes.includes(node.id)
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.data.ad ?? id
  const toggleFail = () => {
    if (!node) return
    if (!active) addScenario({ ad: tr.v3d.scen.newFail(node.data.ad), failedNodes: [node.id] })
    else setNodeFailed(node.id, !failed)
  }
  const runMaint = () => {
    if (!node) return
    setBusy(true)
    const id = node.id
    const name = node.data.ad
    void runInWorker<MaintenanceReport>({ task: 'maintenance', model, maintId: id })
      .then((rep) => setMaint({ id, name, rep }))
      .finally(() => setBusy(false))
  }
  const sc = tr.v3d.scen
  return (
    <div className="pointer-events-auto w-full overflow-y-auto rounded border border-slate-300 bg-white/95 p-2 text-xs shadow">
      <button type="button" className="font-semibold" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {sc.title}
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          <div className="flex items-center gap-1">
            <label className="flex flex-1 items-center gap-1">
              {sc.active}
              <select className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5" value={activeId ?? ''} onChange={(e) => setActive(e.target.value || null)}>
                <option value="">{sc.base}</option>
                {scenarios.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.ad}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={btn} onClick={() => addScenario()}>
              + {sc.newOne}
            </button>
          </div>
          {active && (
            <div>
              <div className="mb-0.5 text-slate-500">{sc.failed}</div>
              <div className="flex flex-wrap gap-1">
                {active.failedNodes.length === 0 && <span className="text-slate-400">{sc.none}</span>}
                {active.failedNodes.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-red-800">
                    {nameOf(id)}
                    <button type="button" aria-label={`${nameOf(id)} ${tr.senaryo.remove}`} onClick={() => updateScenario(active.id, { failedNodes: active.failedNodes.filter((x) => x !== id) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-slate-100 pt-1">
            <div className="mb-1 text-slate-500">
              {sc.selected}: <b className="text-slate-800">{node ? node.data.ad : '—'}</b>
            </div>
            {!node ? (
              <p className="text-slate-400">{sc.pickOne}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                <button type="button" className={failed ? btnOn : btn} onClick={toggleFail}>
                  {failed ? `✓ ${sc.unfail}` : `⚡ ${sc.fail}`}
                </button>
                <button type="button" className={btn} disabled={busy} onClick={runMaint}>
                  🔧 {busy ? sc.maintRunning : sc.maint}
                </button>
              </div>
            )}
          </div>
          {maint && (
            <div className="space-y-1 border-t border-slate-100 pt-1">
              <p className={maint.rep.maintenanceLostKw > 0.5 ? 'font-semibold text-red-700' : 'text-green-700'}>
                {maint.name}: {maint.rep.maintenanceLostKw > 0.5 ? sc.maintLost(fmtNum(maint.rep.maintenanceLostKw, 0)) : sc.maintOk}
              </p>
              <p className="text-slate-600">{sc.maintSafe(maint.rep.safe, maint.rep.total)}</p>
              {maint.rep.risky.length > 0 && (
                <>
                  <div className="text-slate-500">{sc.maintRisk}</div>
                  <ul className="max-h-24 overflow-y-auto">
                    {maint.rep.risky.map((r) => (
                      <li key={`${r.kind}-${r.id}`} className="flex justify-between border-t border-slate-100 py-0.5">
                        <span>{r.label}</span>
                        <span className="tabular-nums text-red-700">{fmtNum(r.lostKw, 0)} kW</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className={btn} onClick={() => addScenario({ ad: sc.newName(maint.name), failedNodes: [maint.id] })}>
                {sc.maintApply}
              </button>
            </div>
          )}
          <p className="text-[11px] text-slate-500">{sc.simHint}</p>
        </div>
      )}
    </div>
  )
}

/** Seçili hat için 3D güzergâh araçları: uzunluk kaynağı, ara nokta ekleme, sıfırlama. */
function EdgeTools({ data }: { data: SceneData }) {
  const id = data.selectedEdge
  const setRoute = useStore((st) => st.setEdgeRoute3d)
  const setSource = useStore((st) => st.setLengthSource3d)
  const e = data.edges.find((x) => x.id === id)
  const a = e && data.boxById.get(e.source)
  const b = e && data.boxById.get(e.target)
  if (!e || !a || !b) return null
  const lane = data.lanes.get(e.id) ?? 0
  const mid: Nokta3D[] = e.guzergah3d && e.guzergah3d.length ? e.guzergah3d : defaultRoute(a, b, lane)
  const len = polylineLength(routePoints(e, a, b, lane))
  const addPoint = () => {
    // En uzun parçanın ortasına yeni nokta.
    const pts = [{ x: a.x, y: a.elev + a.h, z: a.z }, ...mid, { x: b.x, y: b.elev + b.h, z: b.z }]
    let best = 0
    let bl = -1
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z)
      if (l > bl) {
        bl = l
        best = i
      }
    }
    const p = { x: (pts[best].x + pts[best - 1].x) / 2, y: (pts[best].y + pts[best - 1].y) / 2 + 0.5, z: (pts[best].z + pts[best - 1].z) / 2 }
    const next = [...mid]
    next.splice(Math.max(0, best - 1), 0, p)
    setRoute(e.id, next)
  }
  return (
    <div className="absolute right-2 top-2 z-10 w-72 rounded border border-violet-300 bg-white/95 p-2 text-xs shadow">
      <div className="font-semibold">
        {tr.v3d.edge}: {e.ad || e.id}
      </div>
      <div className="mt-1">
        {tr.v3d.length}: {e.uzunluk.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m · 3D: {len.toFixed(1)} m
      </div>
      <label className="mt-1 flex items-center gap-2">
        {tr.v3d.lenSource}
        <select className="rounded border border-slate-300 px-1 py-0.5" value={e.uzunlukKaynak ?? 'elle'} onChange={(ev) => setSource([e.id], ev.target.value as 'elle' | '3d')}>
          <option value="elle">{tr.v3d.lenManual}</option>
          <option value="3d">{tr.v3d.len3d}</option>
        </select>
      </label>
      <div className="mt-1 flex gap-1">
        <button type="button" className={btn} onClick={addPoint}>
          {tr.v3d.addPoint}
        </button>
        <button type="button" className={btn} onClick={() => setRoute(e.id, undefined)}>
          {tr.v3d.resetRoute}
        </button>
      </div>
    </div>
  )
}

export function View3D() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const rooms = useStore((s) => s.odalar3d)
  const trays = useStore((s) => s.tavalar3d)
  const pipes = useStore((s) => s.borular3d)
  const ayarlar = useStore((s) => s.ayarlar)
  const flowAnim = useStore((s) => s.flowAnim)
  const simStep = useStore((s) => (s.sim ? s.sim.steps[s.sim.index] : undefined))
  const addNode3d = useStore((s) => s.addNode3d)
  const ensure = useStore((s) => s.ensureLayout3d)
  const analysis = useAnalysis()
  const colorMode = use3dStore((s) => s.colorMode)
  const quality = use3dStore((s) => s.quality)
  const measure = use3dStore((s) => s.measure)
  const walk = use3dStore((s) => s.walk)
  const walkH = use3dStore((s) => s.walkH)
  const marquee = use3dStore((s) => s.marquee)
  const [ok] = useState(webglOk)
  const [gpu] = useState<GpuInfo | null>(detectGpu)

  // Ctrl+K: ekipman aramasına odaklan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('v3d-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 2D'de eklenen ve henüz yerleşimi olmayan ekipman 3D açılınca yerleştirilir.
  useEffect(() => {
    ensure()
  }, [nodes.length, ensure])

  const pnodes = useMemo(() => toProjectNodes(nodes), [nodes])
  const pedges = useMemo(() => toProjectEdges(edges), [edges])
  const boxes = useMemo(() => boxesOf(pnodes), [pnodes])
  const overlaps = useMemo(() => findOverlaps(boxes), [boxes])
  const lanes = useMemo(() => laneMap(pedges), [pedges])
  const data: SceneData = useMemo(() => {
    const byId = new Map(pnodes.map((n) => [n.id, n]))
    let maxHeat = 0
    for (const n of pnodes) maxHeat = Math.max(maxHeat, heatKwOf(n, analysis.nodes[n.id]))
    const room = simStep?.room
    return {
      nodes: pnodes,
      edges: pedges,
      boxById: new Map(boxes.map((b) => [b.id, b])),
      byId,
      overlaps,
      analysis,
      colorCtx: { mode: colorMode, maxHeatKw: maxHeat },
      selected: new Set(nodes.filter((n) => n.selected).map((n) => n.id)),
      selectedEdge: edges.find((e) => e.selected)?.id,
      changed: new Set(simStep?.changedNodes ?? []),
      lanes,
      rooms,
      trays,
      pipes,
      trayFill: new Map(trayFillFor(pnodes, pedges, trays).map((r) => [r.tray.id, r])),
      flowAnim,
      tempShift: room ? (room.limitReached ? 1 : Math.min(1, Math.max(0, (room.tempC - ayarlar.salonSetpoint) / Math.max(1, ayarlar.izinliArtis)))) : 0,
      tempC: room?.tempC,
    }
  }, [pnodes, pedges, boxes, overlaps, analysis, colorMode, nodes, edges, simStep, lanes, rooms, trays, pipes, flowAnim, ayarlar])

  const centerGround = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    return r ? pickGround(r.left + r.width / 2, r.top + r.height / 2) : null
  }
  const place = (g: { x: number; z: number } | null, type: EquipmentType, entry?: CatalogEntry) => {
    const step = use3dStore.getState().snapStep
    const x = snap(g?.x ?? 0, step || 0.1)
    const z = snap(g?.z ?? 0, step || 0.1)
    addNode3d(type, x, z, entry ? { ad: entry.ad, params: entry.params } : undefined)
  }
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  if (!ok) {
    return <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-600">{tr.v3d.noWebgl}</div>
  }
  const overlapCount = overlaps.size
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <Palette onAdd={(t) => place(centerGround(host), t)} onAddCatalog={(c) => place(centerGround(host), c.type, c)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Toolbar3D gpu={gpu} />
        <div
          ref={setHost}
          className="relative min-h-0 flex-1"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const g = pickGround(e.clientX, e.clientY)
            const cat = findCatalogEntry(e.dataTransfer.getData(DND_CATALOG))
            if (cat) return place(g, cat.type, cat)
            const type = e.dataTransfer.getData(DND_MIME) as EquipmentType
            if (EQUIPMENT_TYPES.includes(type)) place(g, type)
          }}
        >
          <Suspense fallback={<div className="p-4 text-sm text-slate-500">{tr.v3d.loading}</div>}>
            <Scene3D data={data} dpr={quality === 'dusuk' ? 1 : quality === 'yuksek' ? Math.min(2, window.devicePixelRatio || 1) : Math.min(1.5, window.devicePixelRatio || 1)} />
          </Suspense>
          <div className="pointer-events-none absolute bottom-2 left-2 top-2 z-10 flex w-80 max-w-[90%] flex-col gap-2 overflow-y-auto">
            <ScenarioPanel3D />
            <InfraPanel data={data} />
            <RoomsPanel />
          </div>
          <EdgeTools data={data} />
          <Legend3D data={data} />
          {overlapCount > 0 && <div className="pointer-events-none absolute bottom-16 right-2 z-10 rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">⚠ {tr.v3d.overlap}: {overlapCount}</div>}
          {walk && (
            <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded bg-slate-900/85 px-3 py-1.5 text-xs text-white shadow">
              <span>🚶 {tr.v3d.walkHud}</span>
              <span className="rounded bg-white/15 px-1.5 py-0.5 font-semibold">{tr.v3d.floorLabel(walkH)}</span>
              <button type="button" className="rounded border border-white/40 px-2 py-0.5 hover:bg-white/10" onClick={() => use3dStore.getState().setWalk(false)}>
                {tr.v3d.walkExit} (Esc)
              </button>
            </div>
          )}
          {marquee && host && (() => {
            const r = host.getBoundingClientRect()
            return <div className="pointer-events-none absolute z-20 border border-blue-500 bg-blue-500/10" style={{ left: Math.min(marquee.x0, marquee.x1) - r.left, top: Math.min(marquee.y0, marquee.y1) - r.top, width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
          })()}
          {measure && <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded bg-sky-600 px-2 py-0.5 text-xs text-white">{tr.v3d.measureHint}</div>}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-lg bg-white/90 px-6 py-4 text-center text-sm text-slate-600 shadow">{tr.v3d.empty}</div>
            </div>
          )}
        </div>
        <SimulationPanel />
      </div>
    </div>
  )
}

export default View3D
