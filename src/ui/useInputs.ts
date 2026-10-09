import { useMemo } from 'react'
import { portOf } from '../model/project'
import { useAnalysis } from '../store/useAnalysis'
import { useStore } from '../store/useStore'

/** Bir giriş portunun anlık durumu. */
export type InputState = 'aktif' | 'yedek' | 'enerjisiz' | 'acik'

export interface InputInfo {
  port: number
  edgeId: string
  sourceId: string
  sourceName: string
  /** Bu hattın taşıdığı yük payı, 0..1 (hesap sonucu). */
  share: number
  /** Kullanıcının girdiği pay (%), otomatikse null. */
  pay: number | null
  state: InputState
}

/** Ekipmanın bağlı giriş hatları, port sırasıyla; senaryo ve arıza durumuna göre aktif/yedek. */
export function useInputs(nodeId: string): InputInfo[] {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const scenario = useStore((s) => s.scenarios.find((x) => x.id === s.activeScenarioId))
  const analysis = useAnalysis()
  return useMemo(() => {
    const nameOf = (id: string) => nodes.find((n) => n.id === id)?.data.ad ?? id
    return edges
      .filter((e) => e.target === nodeId)
      .map((e): InputInfo => {
        const r = analysis.edges[e.id]
        const open = (scenario?.edgeStates[e.id] ?? e.data?.durum ?? 'kapali') === 'acik'
        const share = r?.share ?? 0
        const state: InputState = open ? 'acik' : !r || !r.live ? 'enerjisiz' : share > 1e-9 ? 'aktif' : 'yedek'
        return {
          port: portOf(e.targetHandle),
          edgeId: e.id,
          sourceId: e.source,
          sourceName: nameOf(e.source),
          share,
          pay: e.data?.pay ?? null,
          state,
        }
      })
      .sort((a, b) => a.port - b.port)
  }, [nodes, edges, scenario, analysis, nodeId])
}

export const STATE_COLOR: Record<InputState, string> = {
  aktif: '#16a34a',
  yedek: '#d97706',
  enerjisiz: '#94a3b8',
  acik: '#dc2626',
}
