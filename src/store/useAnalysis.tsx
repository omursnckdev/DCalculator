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
  unserved: { itKw: 0, mechKw: 0, totalKw: 0 },
  heat: { salonKw: 0, elektrikKw: 0, disKw: 0, totalKw: 0 },
  losses: { upsKw: 0, trafoKw: 0, lineKw: 0 },
}
const Ctx = createContext<Analysis>(EMPTY)

/**
 * Canlı sonuç: şema her değiştiğinde hesap motoru bir kez çalışır ("Hesapla"
 * butonu yok); tüm bileşenler sonucu context'ten okur.
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const scenarios = useStore((s) => s.scenarios)
  const activeId = useStore((s) => s.activeScenarioId)
  const simAnalysis = useStore((s) => (s.sim ? s.sim.steps[s.sim.index]?.analysis : undefined))
  const computed = useMemo(
    () =>
      analyze(
        { nodes: toProjectNodes(nodes), edges: toProjectEdges(edges) },
        undefined,
        scenarios.find((x) => x.id === activeId),
      ),
    [nodes, edges, scenarios, activeId],
  )
  // Canlı simülasyon açıkken tuval, seçili adımın durumunu gösterir.
  const value = simAnalysis ?? computed
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalysis(): Analysis {
  return useContext(Ctx)
}
