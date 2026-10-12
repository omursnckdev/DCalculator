import type { ProjectEdge, ProjectNode, Tava3D } from '../model/types'
import { boxesOf } from './autoLayout'
import { laneMap, routePoints } from './route'
import { cableAreaMm2, cableSizeOf, trayFillRows } from './trays'
import type { TrayFillRow } from './trays'

/** Şemadaki kabloların (tip: kablo) tavalardaki doluluğu: her hattın 3D güzergâhı ve kablo kesitiyle. */
export function trayFillFor(nodes: ProjectNode[], edges: ProjectEdge[], trays: Tava3D[]): TrayFillRow[] {
  if (trays.length === 0) return []
  const boxes = new Map(boxesOf(nodes).map((b) => [b.id, b]))
  const lanes = laneMap(edges)
  const cables: { id: string; poly: ReturnType<typeof routePoints>; area: number }[] = []
  for (const e of edges) {
    if (e.tip !== 'kablo') continue
    const a = boxes.get(e.source)
    const b = boxes.get(e.target)
    if (!a || !b) continue
    cables.push({ id: e.id, poly: routePoints(e, a, b, lanes.get(e.id) ?? 0), area: cableAreaMm2(cableSizeOf(e)) })
  }
  return trayFillRows(trays, cables)
}
