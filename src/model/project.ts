import { EQUIPMENT_TYPES, LINE_TYPES } from './types'
import type {
  EquipmentNode,
  EquipmentType,
  LineEdge,
  LineData,
  Params,
  Project,
  ProjectEdge,
  ProjectNode,
} from './types'

/**
 * Proje dosyası şema sürümü. Şema değiştiğinde artır ve `migrate` içine
 * bir dönüşüm adımı ekle (plan §12).
 */
export const SCHEMA_VERSION = 1

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function emptyProject(name = 'Yeni proje'): Project {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('proje'),
    name,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
  }
}

export const DEFAULT_LINE: LineData = {
  tip: 'kablo',
  uzunluk: 10,
  akimKapasitesi: 630,
  r: 0.1,
  x: 0.08,
  gerilim: 400,
}

// --- React Flow <-> Project dönüşümü -------------------------------------

export function toProjectNodes(nodes: EquipmentNode[]): ProjectNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.kind,
    ad: n.data.ad,
    etiket: n.data.etiket,
    grup: n.data.grup,
    notlar: n.data.notlar,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    params: { ...n.data.params },
  }))
}

export function toProjectEdges(edges: LineEdge[]): ProjectEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.data ?? DEFAULT_LINE),
  }))
}

export function fromProjectNodes(nodes: ProjectNode[]): EquipmentNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'equipment',
    position: { x: n.x, y: n.y },
    data: {
      kind: n.type,
      ad: n.ad,
      etiket: n.etiket,
      grup: n.grup,
      notlar: n.notlar,
      params: { ...n.params },
    },
  }))
}

export function fromProjectEdges(edges: ProjectEdge[]): LineEdge[] {
  return edges.map(({ id, source, target, ...data }) => ({
    id,
    source,
    target,
    type: 'line',
    data,
  }))
}

// --- Doğrulama ve sürüm dönüşümü -----------------------------------------

export class ProjectFormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

function parseParams(v: unknown): Params {
  const out: Params = {}
  if (!isObj(v)) return out
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val
    else if (typeof val === 'string') out[k] = val
  }
  return out
}

function parseNode(raw: unknown, i: number): ProjectNode {
  if (!isObj(raw)) throw new ProjectFormatError(`Düğüm ${i + 1} geçersiz.`)
  const type = raw.type as EquipmentType
  if (!EQUIPMENT_TYPES.includes(type)) {
    throw new ProjectFormatError(`Düğüm ${i + 1}: bilinmeyen ekipman tipi "${String(raw.type)}".`)
  }
  const id = str(raw.id)
  if (!id) throw new ProjectFormatError(`Düğüm ${i + 1}: id eksik.`)
  return {
    id,
    type,
    ad: str(raw.ad),
    etiket: str(raw.etiket),
    grup: str(raw.grup),
    notlar: str(raw.notlar),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    params: parseParams(raw.params),
  }
}

function parseEdge(raw: unknown, i: number): ProjectEdge {
  if (!isObj(raw)) throw new ProjectFormatError(`Hat ${i + 1} geçersiz.`)
  const id = str(raw.id)
  const source = str(raw.source)
  const target = str(raw.target)
  if (!id || !source || !target) throw new ProjectFormatError(`Hat ${i + 1}: id/kaynak/hedef eksik.`)
  const tip = LINE_TYPES.includes(raw.tip as never) ? (raw.tip as ProjectEdge['tip']) : 'kablo'
  return {
    id,
    source,
    target,
    tip,
    uzunluk: num(raw.uzunluk, DEFAULT_LINE.uzunluk),
    akimKapasitesi: num(raw.akimKapasitesi, DEFAULT_LINE.akimKapasitesi),
    r: num(raw.r, DEFAULT_LINE.r),
    x: num(raw.x, DEFAULT_LINE.x),
    gerilim: num(raw.gerilim, DEFAULT_LINE.gerilim),
  }
}

/**
 * Herhangi bir sürümdeki ham JSON'u güncel `Project` biçimine çevirir.
 * Gelecekte `schemaVersion` artınca burada `if (v < 2) raw = v1ToV2(raw)`
 * şeklinde adımlar eklenir.
 */
export function migrate(raw: unknown): Project {
  if (!isObj(raw)) throw new ProjectFormatError('Dosya bir proje nesnesi değil.')
  const version = raw.schemaVersion
  if (typeof version !== 'number') throw new ProjectFormatError('schemaVersion bulunamadı.')
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Dosya daha yeni bir sürümle (v${version}) kaydedilmiş; bu uygulama v${SCHEMA_VERSION} destekliyor.`,
    )
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new ProjectFormatError('nodes/edges listeleri eksik.')
  }

  const nodes = raw.nodes.map(parseNode)
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) throw new ProjectFormatError('Yinelenen düğüm id değeri var.')
  const edges = raw.edges.map(parseEdge)
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new ProjectFormatError(`Hat "${e.id}" var olmayan bir düğüme bağlı.`)
    }
  }

  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(raw.id) || newId('proje'),
    name: str(raw.name, 'Adsız proje'),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    nodes,
    edges,
  }
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2)
}

export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectFormatError('Dosya geçerli bir JSON değil.')
  }
  return migrate(raw)
}
