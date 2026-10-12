import type { ProjectEdge, ProjectNode } from '../model/types'
import { dimsOf } from './dims'
import { boxOf } from './geometry'
import { laneMap, routeLengthM, routePoints } from './route'

/** 3D güzergâhından hesaplanan hat uzunluğu (m); uç ekipmanın yerleşimi yoksa undefined. */
export function edgeLength3d(nodes: ProjectNode[], edge: ProjectEdge, lane = 0): number | undefined {
  const a = nodes.find((n) => n.id === edge.source)
  const b = nodes.find((n) => n.id === edge.target)
  if (!a?.yerlesim3d || !b?.yerlesim3d) return undefined
  const ba = boxOf(a.id, a.type, a.yerlesim3d, dimsOf(a))
  const bb = boxOf(b.id, b.type, b.yerlesim3d, dimsOf(b))
  return routeLengthM(routePoints(edge, ba, bb, lane))
}

/** `uzunlukKaynak === '3d'` olan hatların güncel uzunlukları (yalnız değişenler). */
export function lengthPatches(nodes: ProjectNode[], edges: ProjectEdge[]): Record<string, number> {
  const lanes = laneMap(edges)
  const out: Record<string, number> = {}
  for (const e of edges) {
    if (e.uzunlukKaynak !== '3d') continue
    const L = edgeLength3d(nodes, e, lanes.get(e.id) ?? 0)
    if (L !== undefined && Math.abs(L - e.uzunluk) > 1e-9) out[e.id] = L
  }
  return out
}
