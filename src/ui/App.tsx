import { useEffect, useState } from 'react'
import { tr } from '../i18n/tr'
import { lastProjectId, loadProjectFromDb, saveProjectToDb } from '../store/persistence'
import { AnalysisProvider } from '../store/useAnalysis'
import { redo, undo } from '../store/history'
import { useStore } from '../store/useStore'
import { Canvas } from './Canvas'
import { IssuesPanel } from './IssuesPanel'
import { EnergyView } from './EnergyView'
import { PropertiesPanel } from './PropertiesPanel'
import { RedundancyView } from './RedundancyView'
import { ScenarioView } from './ScenarioView'
import { SimulationPanel } from './SimulationPanel'
import { SummaryBar } from './SummaryBar'
import { SummaryView } from './SummaryView'
import { TableView } from './TableView'
import { Toolbar } from './Toolbar'

type View = 'diagram' | 'table' | 'summary' | 'scenario' | 'redundancy' | 'energy'

export function App() {
  const [view, setView] = useState<View>('diagram')
  const activeScenario = useStore((s) => s.scenarios.find((x) => x.id === s.activeScenarioId))
  const setActiveScenario = useStore((s) => s.setActiveScenario)

  // Açılışta son kullanılan projeyi geri yükle.
  useEffect(() => {
    const id = lastProjectId()
    if (!id) return
    void loadProjectFromDb(id)
      .then((p) => p && useStore.getState().loadProject(p))
      .catch(() => undefined)
  }, [])

  // Geri al / yinele kısayolları (metin kutularında tarayıcının kendi geri alması geçerli).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Otomatik kayıt: değişiklikten 1 sn sonra IndexedDB'ye yaz.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    return useStore.subscribe((s, prev) => {
      if (!s.dirty || s === prev) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const st = useStore.getState()
        void saveProjectToDb(st.getProject()).then(() => useStore.setState({ dirty: false }))
      }, 1000)
    })
  }, [])

  return (
    <AnalysisProvider>
      <div className="flex h-full flex-col">
        <Toolbar />
        <div className="flex items-center border-b border-slate-200 bg-white">
          {(['diagram', 'table', 'summary', 'scenario', 'redundancy', 'energy'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`border-b-2 px-4 py-1.5 text-sm ${
                view === v ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-slate-600'
              }`}
            >
              {tr.view[v]}
            </button>
          ))}
        </div>
        {activeScenario && (
          <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-3 py-1 text-sm text-amber-900">
            <b>{tr.senaryo.banner(activeScenario.ad)}</b>
            <button type="button" className="underline" onClick={() => setActiveScenario(null)}>
              {tr.senaryo.backToBase}
            </button>
          </div>
        )}
        <SummaryBar />
        <div className="flex min-h-0 flex-1">
          {view === 'diagram' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1">
                <Canvas />
              </div>
              <SimulationPanel />
            </div>
          ) : view === 'table' ? (
            <TableView />
          ) : view === 'summary' ? (
            <SummaryView />
          ) : view === 'redundancy' ? (
            <RedundancyView />
          ) : view === 'energy' ? (
            <EnergyView />
          ) : (
            <ScenarioView />
          )}
          <div className="flex w-72 shrink-0 flex-col border-l border-slate-200">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PropertiesPanel />
            </div>
            <IssuesPanel />
          </div>
        </div>
        <footer className="border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">
          {tr.disclaimer}
        </footer>
      </div>
    </AnalysisProvider>
  )
}
