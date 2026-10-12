/// <reference lib="webworker" />
import { energyReport } from './energy'
import { maintenanceScan, redundancyReport } from './redundancy'
import type { EnergyReport } from './energy'
import type { MaintenanceReport, RedundancyReport } from './redundancy'
import type { ProjectSettings } from '../model/settings'
import type { Model } from './types'

/** Ağır taramalar (tüm arıza adayları, 24 saatlik profil) arayüzü dondurmasın diye worker'da çalışır. */
export type WorkerRequest =
  | { id: number; task: 'redundancy'; model: Model }
  | { id: number; task: 'maintenance'; model: Model; maintId: string }
  | { id: number; task: 'energy'; model: Model; settings: ProjectSettings }

export type WorkerResult = RedundancyReport | MaintenanceReport | EnergyReport
export type WorkerResponse = { id: number; result: WorkerResult } | { id: number; error: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    let result: WorkerResult
    if (req.task === 'redundancy') result = redundancyReport(req.model)
    else if (req.task === 'maintenance') result = maintenanceScan(req.model, req.maintId)
    else result = energyReport(req.model, req.settings)
    self.postMessage({ id: req.id, result } satisfies WorkerResponse)
  } catch (e) {
    self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse)
  }
}
