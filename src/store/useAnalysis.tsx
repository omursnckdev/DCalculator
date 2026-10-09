import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { analyze } from '../engine'
import type { Analysis } from '../engine'
import { toProjectEdges, toProjectNodes } from '../model/project'
import { useStore } from './useStore'

const EMPTY: Analysis = {
  nodes: {},
  edges: {},
  issues: [],
  totals: { itKw: 0, mechKw: 0, lossKw: 0, totalKw: 0, kva: 0 },
}
const Ctx = createContext<Analysis>(EMPTY)

/**
 * Canlı sonuç: şema her değiştiğinde hesap motoru bir kez çalışır ("Hesapla"
 * butonu yok); tüm bileşenler sonucu context'ten okur.
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const value = useMemo(() => analyze({ nodes: toProjectNodes(nodes), edges: toProjectEdges(edges) }), [nodes, edges])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalysis(): Analysis {
  return useContext(Ctx)
}
