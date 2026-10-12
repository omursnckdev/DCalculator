import { createContext, useContext } from 'react'
import type { Analysis } from '../engine'
import type { ColorContext } from '../layout3d/colors'
import type { Box } from '../layout3d/geometry'
import type { Oda3D, ProjectEdge, ProjectNode } from '../model/types'

/** Sahne içinde (Canvas ağacında) paylaşılan, ana arayüzden hesaplanmış veri. */
export interface SceneData {
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  boxById: Map<string, Box>
  byId: Map<string, ProjectNode>
  overlaps: Set<string>
  analysis: Analysis
  colorCtx: ColorContext
  selected: Set<string>
  selectedEdge: string | undefined
  /** Simülasyon adımında durumu değişen ekipman. */
  changed: Set<string>
  lanes: Map<string, number>
  rooms: Oda3D[]
  flowAnim: boolean
  /** Salon sıcaklığı ısı haritasını kaydırır: 0..1 (sınıra yaklaşma). */
  tempShift: number
  tempC: number | undefined
}

export const SceneCtx = createContext<SceneData | null>(null)
export const useScene = (): SceneData => {
  const v = useContext(SceneCtx)
  if (!v) throw new Error('SceneCtx yok')
  return v
}
