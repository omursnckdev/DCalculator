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
  'ats',
  'sts',
  'kesici',
  'yardimci',
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

/** Isının bırakıldığı mekân (plan §6.4). */
export const HEAT_LOCATIONS = ['salon', 'elektrik', 'dis'] as const
export type HeatLocation = (typeof HEAT_LOCATIONS)[number]

/** Hat üzerindeki anahtar/kesici durumu. */
export const EDGE_STATES = ['kapali', 'acik'] as const
export type EdgeState = (typeof EDGE_STATES)[number]

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
  /**
   * Hedef düğümün yükünden bu hattın taşıyacağı pay (%). `null` = otomatik:
   * açıkça pay verilmeyen hatlar kalan yüzdeyi eşit paylaşır (2N için %50/%50).
   * Yedek (standby) besleme için 0 girilir.
   */
  pay: number | null
  /** Hat I²R kaybının ısıyı bıraktığı mekân. */
  isiKonum: HeatLocation
  /** Hattın ucundaki anahtar/kesicinin normal durumu; 'acik' hat yok sayılır. */
  durum: EdgeState
  /** Hat adı (ör. BB/MSB.PL1/01, CBL/UDP.PL1.3/01). */
  ad: string
  /** Serbest açıklama (ör. 1600 A BUSBAR (5P), 2x(4x95)+95 mm² N2XH). */
  aciklama: string
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
  /** Kaynak ekipmanın çıkış portu (0 tabanlı, ekipmanın altında soldan sağa). */
  kaynakPort: number
  /** Hedef ekipmanın giriş portu (0 tabanlı, ekipmanın üstünde soldan sağa). */
  hedefPort: number
}

/**
 * Arıza / anahtarlama senaryosu: temel duruma göre farklar. Arızalı ekipman
 * enerjisiz sayılır; `edgeStates` hattın anahtar durumunu geçersiz kılar.
 */
export interface Scenario {
  id: string
  ad: string
  failedNodes: string[]
  edgeStates: Record<string, EdgeState>
  /** Kesici/ayırıcı düğümlerinin durumunu bu senaryoda geçersiz kılar. */
  nodeStates: Record<string, EdgeState>
}

export interface Project {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  scenarios: Scenario[]
}
