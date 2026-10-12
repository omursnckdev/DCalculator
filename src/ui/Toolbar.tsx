import { useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { useStore } from '../store/useStore'
import { buildWorkbook, workbookToBlob } from '../export/excel'
import { renderDiagramPng } from '../export/png'
import { buildReportHtml, printHtml } from '../export/report'
import { generatorStudy } from '../engine/generator'
import { capture3d } from '../ui3d/capture'
import { arcFlashStudy, selectivityStudy } from '../engine/protection'
import { analyze } from '../engine'
import type { EnergyReport, RedundancyReport, ReliabilityReport } from '../engine'
import { toProjectEdges, toProjectNodes } from '../model/project'
import { runInWorker } from './useWorker'
import { useAnalysis } from '../store/useAnalysis'
import { redo, undo } from '../store/history'
import { downloadProject, readProjectFile, safeName, saveBlob } from './fileio'
import { TEMPLATES } from '../library/templates'
import { ImportDialog } from './ImportDialog'
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
  const [showImport, setShowImport] = useState(false)
  const hist = useStore((s) => s.history)
  const [showTpl, setShowTpl] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const analysis = useAnalysis()

  const exportExcel = async () => {
    try {
      const project = getProject()
      const blob = await workbookToBlob(await buildWorkbook(project, analysis, useStore.getState().scenarios.find((x) => x.id === useStore.getState().activeScenarioId)?.ad, useStore.getState().sim?.steps))
      saveBlob(blob, `${safeName(project.name)}.xlsx`)
    } catch (err) {
      alert(`${tr.export.failed}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Yazdırılabilir rapor: özet, kayıplar, yedeklilik, enerji/maliyet ve (varsa) simülasyon; PDF olarak kaydedilebilir. */
  const exportReport = async () => {
    setReportBusy(true)
    try {
      const st = useStore.getState()
      const model = { nodes: toProjectNodes(st.nodes), edges: toProjectEdges(st.edges) }
      const scenario = st.scenarios.find((x) => x.id === st.activeScenarioId)
      const [redundancy, energy, reliability] = await Promise.all([
        runInWorker<RedundancyReport>({ task: 'redundancy', model }),
        runInWorker<EnergyReport>({ task: 'energy', model, settings: st.ayarlar }),
        runInWorker<ReliabilityReport>({ task: 'reliability', model, settings: st.ayarlar }),
      ])
      const diagramPng = await renderDiagramPng(st.nodes).catch(() => null)
      const baseA = analyze(model, undefined, scenario)
      printHtml(
        buildReportHtml({
          project: st.getProject(),
          analysis: baseA,
          selectivity: selectivityStudy(model, baseA),
          generator: generatorStudy(model, st.ayarlar),
          arcFlash: arcFlashStudy(model, baseA, st.ayarlar),
          scenarioName: scenario?.ad,
          settings: st.ayarlar,
          redundancy,
          energy,
          reliability,
          steps: st.sim?.steps,
          diagramPng,
          view3dPng: capture3d(),
        }),
      )
    } catch (err) {
      alert(`${tr.export.failed}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReportBusy(false)
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
      <div className="flex gap-1">
        <button type="button" className={btn} onClick={undo} disabled={hist.undo === 0} title={`${tr.toolbar.undo} (Ctrl+Z)`} aria-label={tr.toolbar.undo}>
          ↶
        </button>
        <button type="button" className={btn} onClick={redo} disabled={hist.redo === 0} title={`${tr.toolbar.redo} (Ctrl+Y)`} aria-label={tr.toolbar.redo}>
          ↷
        </button>
      </div>
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
        <div className="relative">
          <button type="button" className={btn} onClick={() => setShowTpl(!showTpl)} aria-expanded={showTpl}>
            {tr.toolbar.template} ▾
          </button>
          {showTpl && (
            <ul className="absolute right-0 z-20 mt-1 w-80 rounded border border-slate-300 bg-white text-sm shadow-lg">
              {TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-slate-100"
                    onClick={() => {
                      setShowTpl(false)
                      if (useStore.getState().nodes.length > 0 && !confirm(tr.toolbar.confirmTemplate)) return
                      loadProject(t.build())
                    }}
                  >
                    <div className="font-medium">{t.ad}</div>
                    <div className="text-xs text-slate-500">{t.aciklama}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className={btn} onClick={() => void saveToDb()}>
          {tr.toolbar.save}
        </button>
        <button type="button" className={btn} onClick={() => setShowOpen(true)}>
          {tr.toolbar.open}
        </button>
        <button type="button" className={btn} onClick={() => setShowImport(true)}>
          {tr.ice.button}
        </button>
        <button type="button" className={btn} onClick={() => void exportExcel()}>
          {tr.export.excel}
        </button>
        <button type="button" className={btn} disabled={reportBusy} onClick={() => void exportReport()} title={tr.export.reportHint}>
          {reportBusy ? tr.red.computing : tr.export.report}
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
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </header>
  )
}
