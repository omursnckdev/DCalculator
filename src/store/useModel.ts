import { useMemo } from 'react'
import type { Model } from '../engine'
import { toProjectEdges, toProjectNodes } from '../model/project'
import { modelSignature } from './modelSig'
import { useStore } from './useStore'

/** Şemanın hesaplamaya giren hâli; yalnız konum değişimi modeli yenilemez (ağır taramalar için). */
export function useBaseModel(): Model {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const sig = useMemo(() => modelSignature(nodes, edges), [nodes, edges])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ nodes: toProjectNodes(nodes), edges: toProjectEdges(edges) }), [sig])
}
