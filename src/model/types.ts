import type { Edge, Node } from '@xyflow/react'

/** Şemadaki ekipman tipleri (plan §5). */
export const EQUIPMENT_TYPES = [
  'sebeke',
  'trafo',
  'jenerator',
  'mdb',
  'dagitimPanosu',
  'bara',
  'ups',
  'upsPanosu',
  'pdu',
  'itYuku',
  'mekanikYuk',
  'aydinlatma',
  'genelYuk',
] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]

export type ParamValue = number | string
export type Params = Record<string, ParamValue>

/** Düğüm (ekipman) verisi: plan §5 ortak alanları + tipe özgü parametreler. */
export interface EquipmentData extends Record<string, unknown> {
  kind: EquipmentType
  ad: string
  etiket: string
  grup: string
  notlar: string
  params: Params
}

export const LINE_TYPES = ['kablo', 'busbar'] as const
export type LineType = (typeof LINE_TYPES)[number]

/** Kenar (hat) verisi: plan §5. */
export interface LineData extends Record<string, unknown> {
  tip: LineType
  /** m */
  uzunluk: number
  /** A */
  akimKapasitesi: number
  /** Ω/km */
  r: number
  /** Ω/km */
  x: number
  /** V */
  gerilim: number
}

export type EquipmentNode = Node<EquipmentData, 'equipment'>
export type LineEdge = Edge<LineData, 'line'>

/** Diske / JSON'a yazılan düz biçim. React Flow'dan bağımsızdır. */
export interface ProjectNode {
  id: string
  type: EquipmentType
  ad: string
  etiket: string
  grup: string
  notlar: string
  x: number
  y: number
  params: Params
}

export interface ProjectEdge extends LineData {
  id: string
  source: string
  target: string
}

export interface Project {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodes: ProjectNode[]
  edges: ProjectEdge[]
}
