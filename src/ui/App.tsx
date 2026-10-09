import { useEffect, useState } from 'react'
import { tr } from '../i18n/tr'
import { lastProjectId, loadProjectFromDb, saveProjectToDb } from '../store/persistence'
import { AnalysisProvider } from '../store/useAnalysis'
import { useStore } from '../store/useStore'
import { Canvas } from './Canvas'
import { IssuesPanel } from './IssuesPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryBar } from './SummaryBar'
import { TableView } from './TableView'
import { Toolbar } from './Toolbar'

type View = 'diagram' | 'table'

export function App() {
  const [view, setView] = useState<View>('diagram')

  // Açılışta son kullanılan projeyi geri yükle.
  useEffect(() => {
    const id = lastProjectId()
    if (!id) return
    void loadProjectFromDb(id)
      .then((p) => p && useStore.getState().loadProject(p))
      .catch(() => undefined)
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
          {(['diagram', 'table'] as const).map((v) => (
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
        <SummaryBar />
        <div className="flex min-h-0 flex-1">
          {view === 'diagram' ? <Canvas /> : <TableView />}
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
