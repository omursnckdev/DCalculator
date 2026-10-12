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
  'senkron',
  'itYuku',
  'mekanikYuk',
  'aydinlatma',
  'genelYuk',
  // Soğutma ve mekanik
  'chiller',
  'crah',
  'crac',
  'fanwall',
  'inrow',
  'rdhx',
  'kuruSogutucu',
  'sogutmaKulesi',
  'pompa',
  'ahu',
  'fan',
  'nemlendirici',
  // IT ve yardımcı yükler
  'rack',
  'depolama',
  'guvenlik',
  'yangin',
  'asansor',
  'yukBankasi',
  'ofis',
  // Dağıtım
  'rpp',
] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]

export type ParamValue = number | string
export type Params = Record<string, ParamValue>

/**
 * 3D yerleşim (metre, derece). x/z zemin düzleminde ekipman merkezidir; `elev` zeminden yükseklik; `rot` Y ekseni etrafında
 * dönüş. g/d/y boyut geçersiz kılma (genişlik/derinlik/yükseklik); yoksa tür varsayılanı (`layout3d/dims.ts`).
 */
export interface Yerlesim3D {
  x: number
  z: number
  elev?: number
  rot?: number
  oda?: string
  /** Küçük eleman (kesici/ölçü) ana ekipmanın ön yüzüne oturtulmuş (otomatik yerleşim veya "panoya oturt"). */
  mont?: boolean
  g?: number
  d?: number
  y?: number
}

export interface Nokta3D {
  x: number
  y: number
  z: number
}

export const ODA_TURLERI = ['elektrik', 'salon', 'jenerator', 'dis'] as const
export type OdaTuru = (typeof ODA_TURLERI)[number]

/** Basit dikdörtgen oda (mimari değil): ekipman bağlamı, ısı haritası ve duvar gösterimi için. x/z köşe (min). */
export interface Oda3D {
  id: string
  ad: string
  tur: OdaTuru
  x: number
  z: number
  g: number
  d: number
  y: number
}

export const TAVA_TURLERI = ['guc', 'veri'] as const
export type TavaTuru = (typeof TAVA_TURLERI)[number]

/** Kablo tavası: sabit kotta (`y`, tava tabanı) x-z düzleminde çokgen yol. Genişlik/yan yükseklik metre; `sinir` izin verilen doluluk, %. */
export interface Tava3D {
  id: string
  ad: string
  tur: TavaTuru
  g: number
  h: number
  y: number
  sinir: number
  noktalar: { x: number; z: number }[]
}

export const BORU_TURLERI = ['sogukSu', 'kondenser'] as const
export type BoruTuru = (typeof BORU_TURLERI)[number]

/**
 * Boru hattı (3D çokgen). `kw` hattın taşıdığı soğutma/ısı atım yükü (debi hesabı); `dn` iç çap (mm, standart seri);
 * `uretici`/`pompalar` hattın çalışması için enerjili olması gereken ekipman (üretici + en az bir pompa).
 */
export interface Boru3D {
  id: string
  ad: string
  tur: BoruTuru
  yon: 'besleme' | 'donus'
  dn: number
  /** DN elle verildi (otomatik seçim yapılmaz). */
  dnElle?: boolean
  kw: number
  noktalar: Nokta3D[]
  uretici: string[]
  pompalar: string[]
  otomatik: boolean
}

/** Kayıtlı kamera görünümü. */
export interface Gorunum3D {
  ad: string
  pos: [number, number, number]
  target: [number, number, number]
  ortho: boolean
}

/** Düğüm (ekipman) verisi: plan §5 ortak alanları + tipe özgü parametreler. */
export interface EquipmentData extends Record<string, unknown> {
  kind: EquipmentType
  ad: string
  etiket: string
  grup: string
  notlar: string
  params: Params
  yerlesim3d?: Yerlesim3D
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
  /** 3D kablo güzergâhı ara noktaları (metre); yoksa otomatik ortogonal güzergâh. */
  guzergah3d?: Nokta3D[]
  /** Uzunluğun kaynağı: 'elle' (varsayılan, kullanıcı girdi) veya '3d' (güzergâhtan hesaplanır). */
  uzunlukKaynak?: 'elle' | '3d'
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
  yerlesim3d?: Yerlesim3D
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

import type { ProjectSettings } from './settings'

export interface Project {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  scenarios: Scenario[]
  /** Yük profili, tarife ve soğutma ayarları. */
  ayarlar: ProjectSettings
  /** 3D yerleşim: odalar ve kayıtlı kamera görünümleri (isteğe bağlı; eski dosyalarda yoktur). */
  odalar3d?: Oda3D[]
  gorunumler3d?: Gorunum3D[]
  tavalar3d?: Tava3D[]
  borular3d?: Boru3D[]
}
