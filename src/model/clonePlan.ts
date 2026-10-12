import type { Model } from '../engine/types'
import type { ProjectEdge, ProjectNode } from '../model/types'

/**
 * PL1 zincirini PL2'ye kopyalar: tüm düğümler ve aralarındaki hatlar yeni kimliklerle çoğaltılır. Adlarda "PL1" → "PL2";
 * "PL1" içermeyen adların başına "PL2 " eklenir (böylece plan etiketiyle yanlış eşleşmez). Parametreler (anma değerleri,
 * kablo uzunluğu/kapasitesi) aynen kopyalanır, 3D yerleşim ve güzergâhlar kopyalanmaz (plan yeniden yerleştirir).
 * Zaten PL2 düğümü olan modelde kopya yapılmaz.
 */
export function hasPl(model: Pick<Model, 'nodes'>, pl: 'PL1' | 'PL2'): boolean {
  return model.nodes.some((n) => n.ad.toUpperCase().includes(pl))
}

export function canClonePl1(model: Pick<Model, 'nodes'>): boolean {
  return model.nodes.filter((n) => n.ad.toUpperCase().includes('PL1')).length >= 5 && !hasPl(model, 'PL2')
}

const rename = (s: string): string => s.replace(/PL1/g, 'PL2')

export function clonePl1ToPl2(model: Model, dx = 0): { nodes: ProjectNode[]; edges: ProjectEdge[] } {
  const idOf = (id: string) => `${id}-pl2`
  const nodes: ProjectNode[] = model.nodes.map((n) => {
    const has = n.ad.includes('PL1')
    const ad = has ? rename(n.ad) : `PL2 ${n.ad}`
    return {
      ...n,
      id: idOf(n.id),
      x: n.x + dx,
      ad,
      etiket: rename(n.etiket),
      grup: rename(n.grup),
      notlar: n.notlar,
      params: { ...n.params },
      yerlesim3d: undefined,
    }
  })
  const edges: ProjectEdge[] = model.edges.map((e) => ({
    ...e,
    id: idOf(e.id),
    source: idOf(e.source),
    target: idOf(e.target),
    ad: rename(e.ad),
    aciklama: rename(e.aciklama),
    guzergah3d: undefined,
  }))
  return { nodes, edges }
}
