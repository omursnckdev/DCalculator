import { toProjectEdges, toProjectNodes } from '../model/project'
import type { EquipmentNode, LineEdge, Scenario } from '../model/types'

/** Konumları hariç tutan model imzası: yalnızca hesabı etkileyen değişiklikler imzayı değiştirir. */
export function modelSignature(nodes: EquipmentNode[], edges: LineEdge[], scenario?: Scenario): string {
  const n = toProjectNodes(nodes).map((x) => [x.id, x.type, x.params])
  const e = toProjectEdges(edges)
  return JSON.stringify([n, e, scenario ? [scenario.failedNodes, scenario.edgeStates, scenario.nodeStates] : null])
}
