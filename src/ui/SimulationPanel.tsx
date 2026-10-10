import { useEffect, useMemo, useState } from 'react'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import { modelSignature } from '../store/modelSig'
import { useStore } from '../store/useStore'
import { fmtNum } from './status'

const KIND_STYLE: Record<string, string> = {
  fault: 'bg-red-100 text-red-800',
  lost: 'bg-red-50 text-red-700',
  restored: 'bg-green-50 text-green-700',
  deenergized: 'bg-slate-100 text-slate-700',
  energized: 'bg-green-50 text-green-700',
  transfer: 'bg-blue-50 text-blue-800',
  autoClose: 'bg-blue-50 text-blue-800',
  standby: 'bg-slate-100 text-slate-700',
  genStart: 'bg-amber-50 text-amber-800',
  battery: 'bg-amber-50 text-amber-800',
  overload: 'bg-red-50 text-red-700',
  cleared: 'bg-green-100 text-green-800',
  genStop: 'bg-slate-100 text-slate-700',
}
const KIND_ICON: Record<string, string> = {
  fault: '⚡',
  lost: '✕',
  restored: '✓',
  deenergized: '○',
  energized: '●',
  transfer: '⇄',
  autoClose: '⏻',
  standby: '⏸',
  genStart: '⚙',
  battery: '🔋',
  overload: '⚠',
  cleared: '🔧',
  genStop: '■',
}

/** Alt şerit: ekipman arızasını adım adım oynatır; tuval seçili adımın durumunu gösterir. */
export function SimulationPanel() {
  const sim = useStore((s) => s.sim)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const scenario = useStore((s) => s.scenarios.find((x) => x.id === s.activeScenarioId))
  const startSim = useStore((s) => s.startSim)
  const stopSim = useStore((s) => s.stopSim)
  const clearFault = useStore((s) => s.clearSimFault)
  const setIndex = useStore((s) => s.setSimIndex)
  const setPlaying = useStore((s) => s.setSimPlaying)
  const setSpeed = useStore((s) => s.setSimSpeed)
  const picked = useStore((s) => s.simPicked)
  const setPicked = useStore((s) => s.setSimPicked)
  const open = useStore((s) => s.simOpen)
  const setOpen = useStore((s) => s.setSimOpen)
  const [clearPick, setClearPick] = useState('')

  // Silinen ekipman arıza listesinde kalmasın.
  useEffect(() => {
    const alive = picked.filter((id) => nodes.some((n) => n.id === id))
    if (alive.length !== picked.length) setPicked(alive)
  }, [nodes, picked, setPicked])

  const candidates = useMemo(
    () => nodes.filter((n) => EQUIPMENT[n.data.kind].hasOutput && !picked.includes(n.id)),
    [nodes, picked],
  )

  // Model değişirse oynatılan adımlar eskir: simülasyonu kapat.
  const sig = useMemo(() => modelSignature(nodes, edges, scenario), [nodes, edges, scenario])
  const [startedSig, setStartedSig] = useState<string | null>(null)
  useEffect(() => {
    if (sim && startedSig !== null && sig !== startedSig) stopSim()
  }, [sig, sim, startedSig, stopSim])

  // Oynat: her adım 1,8 sn / hız.
  const playing = sim?.playing ?? false
  const index = sim?.index ?? 0
  const last = (sim?.steps.length ?? 1) - 1
  useEffect(() => {
    if (!playing) return
    if (index >= last) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex(index + 1), 1800 / (sim?.speed ?? 1))
    return () => clearTimeout(t)
  }, [playing, index, last, sim?.speed, setIndex, setPlaying])

  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.data.ad ?? id
  const step = sim?.steps[index]

  return (
    <section className="shrink-0 border-t border-slate-300 bg-white" aria-label={tr.sim.title}>
      <div className="flex items-center gap-3 px-3 py-1.5">
        <button type="button" className="text-sm font-semibold" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {tr.sim.title}
        </button>
        {!sim && (
          <>
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value=""
              aria-label={tr.sim.pickFault}
              onChange={(e) => e.target.value && setPicked([...picked, e.target.value])}
            >
              <option value="">{tr.sim.pickFault}</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.ad}
                </option>
              ))}
            </select>
            {picked.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                {nameOf(id)}
                <button type="button" aria-label={`${nameOf(id)} ${tr.senaryo.remove}`} onClick={() => setPicked(picked.filter((x) => x !== id))}>
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              disabled={picked.length === 0}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-40"
              onClick={() => {
                setStartedSig(sig)
                startSim(picked)
                setOpen(true)
              }}
            >
              {tr.sim.apply}
            </button>
          </>
        )}
        {sim && (
          <>
            <span className="text-xs text-slate-500">
              {(step?.failed.length ? step.failed : sim.failed).map(nameOf).join(', ')} · {tr.sim.step(index + 1, sim.steps.length)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-sm" onClick={() => { setPlaying(false); setIndex(0) }} aria-label="|◀">
                ⏮
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-sm" onClick={() => { setPlaying(false); setIndex(index - 1) }} aria-label={tr.sim.prev} disabled={index === 0}>
                ◀ {tr.sim.prev}
              </button>
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-0.5 text-sm text-white"
                onClick={() => {
                  if (playing) setPlaying(false)
                  else {
                    if (index >= last) setIndex(0)
                    setPlaying(true)
                  }
                }}
              >
                {playing ? `❚❚ ${tr.sim.pause}` : `▶ ${tr.sim.play}`}
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-sm" onClick={() => { setPlaying(false); setIndex(index + 1) }} aria-label={tr.sim.next} disabled={index >= last}>
                {tr.sim.next} ▶
              </button>
              <select className="rounded border border-slate-300 px-1 py-0.5 text-sm" value={sim.speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={tr.sim.speed}>
                {[0.5, 1, 2, 4].map((v) => (
                  <option key={v} value={v}>
                    ×{v}
                  </option>
                ))}
              </select>
              {(step?.failed.length ?? 0) > 1 && (
                <select
                  className="ml-2 rounded border border-slate-300 px-1 py-0.5 text-sm"
                  value={step!.failed.includes(clearPick) ? clearPick : ''}
                  onChange={(e) => setClearPick(e.target.value)}
                  aria-label={tr.sim.clearWhich}
                >
                  <option value="">{tr.sim.clearAll(step!.failed.length)}</option>
                  {step!.failed.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={index === 0 || (step?.failed.length ?? 0) === 0}
                title={tr.sim.clearFaultHint}
                className={`${(step?.failed.length ?? 0) > 1 ? '' : 'ml-2 '}rounded bg-green-600 px-3 py-0.5 text-sm text-white disabled:opacity-40`}
                onClick={() => clearFault(step && clearPick && step.failed.includes(clearPick) ? [clearPick] : undefined)}
              >
                🔧 {tr.sim.clearFault}
              </button>
              <button type="button" className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-sm" onClick={stopSim}>
                {tr.sim.stop}
              </button>
            </div>
          </>
        )}
      </div>

      {open && sim && step && (
        <div className="flex gap-4 border-t border-slate-100 px-3 py-2">
          <ol className="flex w-80 shrink-0 flex-col gap-1 overflow-y-auto" style={{ maxHeight: 190 }}>
            {sim.steps.map((st, i) => (
              <li key={`${st.phase}-${st.id}`}>
                {st.phase === 'recovery' && sim.steps[i - 1]?.phase !== 'recovery' && (
                  <div className="mb-1 mt-1 border-t border-green-300 pt-1 text-[10px] font-semibold uppercase tracking-wide text-green-700">{tr.sim.recoveryHeading}</div>
                )}
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setIndex(i) }}
                  className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs ${
                    i === index ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="w-16 shrink-0 font-mono text-[11px] text-slate-500">{st.timeLabel || '—'}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{st.title}</span>
                  {st.lostKw > 0.5 && <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">−{fmtNum(st.lostKw, 0)} kW</span>}
                </button>
              </li>
            ))}
          </ol>
          <div className="min-w-0 flex-1 overflow-y-auto" style={{ maxHeight: 190 }}>
            <div className="mb-1 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{step.title}</h3>
              <span className="font-mono text-xs text-slate-500">{step.timeLabel}</span>
            </div>
            <p className="mb-2 text-xs text-slate-600">{step.description}</p>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tr.sim.changes}</h4>
            {step.changes.length === 0 ? (
              <p className="text-xs text-slate-500">{tr.sim.nothing}</p>
            ) : (
              <ul className="space-y-1">
                {step.changes.map((c, i) => (
                  <li key={i} className={`rounded px-2 py-0.5 text-xs ${KIND_STYLE[c.kind] ?? ''}`}>
                    <span className="mr-1.5">{KIND_ICON[c.kind]}</span>
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-slate-400">{tr.sim.typicalNote}</p>
          </div>
        </div>
      )}
    </section>
  )
}
