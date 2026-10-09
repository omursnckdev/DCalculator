import { useEffect } from 'react'
import { tr } from '../i18n/tr'
import { lastProjectId, loadProjectFromDb, saveProjectToDb } from '../store/persistence'
import { useStore } from '../store/useStore'
import { Canvas } from './Canvas'
import { PropertiesPanel } from './PropertiesPanel'
import { Toolbar } from './Toolbar'

export function App() {
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
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Canvas />
        <PropertiesPanel />
      </div>
      <footer className="border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">
        {tr.disclaimer}
      </footer>
    </div>
  )
}
