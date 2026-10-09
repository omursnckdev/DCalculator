import { EQUIPMENT } from '../library/equipment'
import { EDGE_STATES, EQUIPMENT_TYPES, HEAT_LOCATIONS, LINE_TYPES } from './types'
import type {
  EquipmentNode,
  EquipmentType,
  LineEdge,
  LineData,
  Params,
  Project,
  ProjectEdge,
  ProjectNode,
  Scenario,
} from './types'

/**
 * Proje dosyası şema sürümü. Şema değiştiğinde artır ve `migrate` içine
 * bir dönüşüm adımı ekle (plan §12).
 */
export const SCHEMA_VERSION = 5

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
    scenarios: [],
  }
}

export const DEFAULT_LINE: LineData = {
  tip: 'kablo',
  uzunluk: 10,
  akimKapasitesi: 630,
  r: 0.1,
  x: 0.08,
  gerilim: 400,
  pay: null,
  isiKonum: 'elektrik',
  durum: 'kapali',
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

/** React Flow handle kimlikleri: çıkış `out-0`, giriş `in-0`. */
export const handleId = (dir: 'in' | 'out', port: number): string => `${dir}-${port}`
export function portOf(handle: string | null | undefined): number {
  const m = /-(\d+)$/.exec(handle ?? '')
  return m ? Number(m[1]) : 0
}

export function toProjectEdges(edges: LineEdge[]): ProjectEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kaynakPort: portOf(e.sourceHandle),
    hedefPort: portOf(e.targetHandle),
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
  return edges.map(({ id, source, target, kaynakPort, hedefPort, ...data }) => ({
    id,
    source,
    target,
    sourceHandle: handleId('out', kaynakPort),
    targetHandle: handleId('in', hedefPort),
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

const port = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

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
    pay: typeof raw.pay === 'number' && Number.isFinite(raw.pay) ? raw.pay : null,
    isiKonum: HEAT_LOCATIONS.includes(raw.isiKonum as never)
      ? (raw.isiKonum as ProjectEdge['isiKonum'])
      : DEFAULT_LINE.isiKonum,
    kaynakPort: port(raw.kaynakPort),
    hedefPort: port(raw.hedefPort),
    durum: EDGE_STATES.includes(raw.durum as never) ? (raw.durum as ProjectEdge['durum']) : DEFAULT_LINE.durum,
  }
}

/** v1 -> v2: hatlara `pay` alanı eklendi (varsayılan null = otomatik paylaşım). */
function v1ToV2(raw: Record<string, unknown>): Record<string, unknown> {
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  return {
    ...raw,
    schemaVersion: 2,
    edges: edges.map((e) => (isObj(e) ? { pay: null, ...e } : e)),
  }
}

/** v2 -> v3: hatlara `isiKonum` eklendi (varsayılan 'elektrik'). */
function v2ToV3(raw: Record<string, unknown>): Record<string, unknown> {
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  return {
    ...raw,
    schemaVersion: 3,
    edges: edges.map((e) => (isObj(e) ? { isiKonum: 'elektrik', ...e } : e)),
  }
}

/** v3 -> v4: hatlara `durum` (anahtar durumu) ve projeye `scenarios` eklendi. */
function v3ToV4(raw: Record<string, unknown>): Record<string, unknown> {
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  return {
    ...raw,
    schemaVersion: 4,
    edges: edges.map((e) => (isObj(e) ? { durum: 'kapali', ...e } : e)),
    scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : [],
  }
}

function parseScenario(raw: unknown, nodeIds: Set<string>, edgeIds: Set<string>): Scenario | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const failed = Array.isArray(raw.failedNodes) ? raw.failedNodes : []
  const states: Scenario['edgeStates'] = {}
  if (isObj(raw.edgeStates)) {
    for (const [k, v] of Object.entries(raw.edgeStates)) {
      if (edgeIds.has(k) && EDGE_STATES.includes(v as never)) states[k] = v as Scenario['edgeStates'][string]
    }
  }
  return {
    id,
    ad: str(raw.ad, 'Senaryo'),
    // Silinmiş ekipmana başvuruları sessizce at.
    failedNodes: failed.filter((x): x is string => typeof x === 'string' && nodeIds.has(x)),
    edgeStates: states,
  }
}

/**
 * v4 -> v5: hatlara port (`kaynakPort`, `hedefPort`) eklendi. Mevcut hatlar, dosyadaki sıraya göre
 * her ekipmanın ilk boş portlarına atanır; ekipmanın giriş/çıkış sayısı kullanılan port kadar
 * (en az kütüphane varsayılanı) yapılır, böylece eski projeler aynen açılır.
 */
function v4ToV5(raw: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  const outUse = new Map<string, number>()
  const inUse = new Map<string, number>()
  const newEdges = edges.map((e) => {
    if (!isObj(e)) return e
    const s = str(e.source)
    const t = str(e.target)
    const kaynakPort = outUse.get(s) ?? 0
    const hedefPort = inUse.get(t) ?? 0
    outUse.set(s, kaynakPort + 1)
    inUse.set(t, hedefPort + 1)
    return { kaynakPort, hedefPort, ...e }
  })
  const newNodes = nodes.map((n) => {
    if (!isObj(n)) return n
    const def = EQUIPMENT[n.type as EquipmentType] as (typeof EQUIPMENT)[EquipmentType] | undefined
    const params = isObj(n.params) ? { ...n.params } : {}
    const id = str(n.id)
    if (def?.hasInput) params.girisSayisi = Math.max(num(params.girisSayisi, def.defaults.girisSayisi as number), inUse.get(id) ?? 0)
    if (def?.hasOutput) params.cikisSayisi = Math.max(num(params.cikisSayisi, def.defaults.cikisSayisi as number), outUse.get(id) ?? 0)
    return { ...n, params }
  })
  return { ...raw, schemaVersion: 5, nodes: newNodes, edges: newEdges }
}

/**
 * Herhangi bir sürümdeki ham JSON'u güncel `Project` biçimine çevirir.
 * Şema her arttığında buraya bir dönüşüm adımı eklenir (bkz. `v1ToV2`).
 */
export function migrate(input: unknown): Project {
  if (!isObj(input)) throw new ProjectFormatError('Dosya bir proje nesnesi değil.')
  let raw = input
  const version = raw.schemaVersion
  if (typeof version !== 'number') throw new ProjectFormatError('schemaVersion bulunamadı.')
  if (version > SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Dosya daha yeni bir sürümle (v${version}) kaydedilmiş; bu uygulama v${SCHEMA_VERSION} destekliyor.`,
    )
  }
  if (typeof version === 'number' && version < 2) raw = v1ToV2(raw)
  if (typeof version === 'number' && version < 3) raw = v2ToV3(raw)
  if (typeof version === 'number' && version < 4) raw = v3ToV4(raw)
  if (typeof version === 'number' && version < 5) raw = v4ToV5(raw)
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

  const edgeIds = new Set(edges.map((e) => e.id))
  const scenarios = (Array.isArray(raw.scenarios) ? raw.scenarios : [])
    .map((sc) => parseScenario(sc, ids, edgeIds))
    .filter((sc): sc is Scenario => sc !== null)

  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(raw.id) || newId('proje'),
    name: str(raw.name, 'Adsız proje'),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    nodes,
    edges,
    scenarios,
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
