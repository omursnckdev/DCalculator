import { useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { useStore } from '../store/useStore'
import { buildWorkbook, workbookToBlob } from '../export/excel'
import { renderDiagramPng } from '../export/png'
import { useAnalysis } from '../store/useAnalysis'
import { downloadProject, readProjectFile, safeName, saveBlob } from './fileio'
import { OpenDialog } from './OpenDialog'

const btn = 'rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50'

export function Toolbar() {
  const name = useStore((s) => s.projectName)
  const dirty = useStore((s) => s.dirty)
  const setName = useStore((s) => s.setProjectName)
  const newProject = useStore((s) => s.newProject)
  const saveToDb = useStore((s) => s.saveToDb)
  const getProject = useStore((s) => s.getProject)
  const loadProject = useStore((s) => s.loadProject)
  const [showOpen, setShowOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const analysis = useAnalysis()

  const exportExcel = async () => {
    try {
      const project = getProject()
      const blob = await workbookToBlob(await buildWorkbook(project, analysis, useStore.getState().scenarios.find((x) => x.id === useStore.getState().activeScenarioId)?.ad))
      saveBlob(blob, `${safeName(project.name)}.xlsx`)
    } catch (err) {
      alert(`${tr.export.failed}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const exportPng = async () => {
    try {
      const url = await renderDiagramPng(useStore.getState().nodes)
      if (!url) {
        alert(tr.export.needDiagram)
        return
      }
      saveBlob(await (await fetch(url)).blob(), `${safeName(name)}.png`)
    } catch (err) {
      alert(`${tr.export.failed}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
      <div className="mr-2">
        <div className="text-sm font-bold leading-tight">{tr.app.title}</div>
        <div className="text-[10px] text-slate-500">{tr.app.subtitle}</div>
      </div>
      <input
        aria-label={tr.toolbar.projectName}
        className="w-56 rounded border border-slate-300 px-2 py-1 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <span className={`text-xs ${dirty ? 'text-amber-600' : 'text-green-600'}`}>
        {dirty ? tr.toolbar.unsaved : tr.toolbar.saved}
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => {
            if (!dirty || confirm(tr.toolbar.confirmNew)) newProject()
          }}
        >
          {tr.toolbar.newProject}
        </button>
        <button type="button" className={btn} onClick={() => void saveToDb()}>
          {tr.toolbar.save}
        </button>
        <button type="button" className={btn} onClick={() => setShowOpen(true)}>
          {tr.toolbar.open}
        </button>
        <button type="button" className={btn} onClick={() => void exportExcel()}>
          {tr.export.excel}
        </button>
        <button type="button" className={btn} onClick={() => void exportPng()}>
          {tr.export.png}
        </button>
        <button type="button" className={btn} onClick={() => downloadProject(getProject())}>
          {tr.toolbar.exportJson}
        </button>
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          {tr.toolbar.importJson}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              loadProject(await readProjectFile(file))
            } catch (err) {
              alert(`${tr.errors.importFailed}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }}
        />
      </div>
      {showOpen && <OpenDialog onClose={() => setShowOpen(false)} />}
    </header>
  )
}
