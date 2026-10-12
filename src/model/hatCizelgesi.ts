import { EQUIPMENT, MAX_PORTS, portCount } from '../library/equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from './types'
import { newId as defaultNewId } from './project'

/**
 * Hat çizelgesi (kablo çizelgesi): kablo, bara ve koruma cihazı satırlarından oluşan bağlantı tanımı. Modeldeki ekipman adıyla
 * eşleşir (yoksa oluşturulur); her satır "kaynak → [şalter] → hat → [şalter] → hedef" zinciri olarak eklenir (şalter ayrı
 * `kesici` düğümü, panoya 3D'de oturur). Saf fonksiyon: modeli değiştirmez, değişiklik kümesi (`HatDelta`) döndürür.
 * Üretici: scripts/build-hdc02-c1c2.py (LV Cable Schedule C1/C2).
 */

export interface KesiciSpec {
  ad: string
  tip: 'ACB' | 'MCCB' | 'Ayırıcı'
  akim: number
  icu: number
  kutup: '3P' | '4P'
  durum: 'acik' | 'kapali'
  otomatik: 'yok' | 'otomatik'
  /** 'cizelge': belgeden okunan; 'varsayim': belgede yok, tahmin. */
  veri: 'cizelge' | 'varsayim'
  sayfa: string
  not?: string
}

export interface KabloSpec {
  paralel: number
  damar: number
  kesit: number
  pe?: number
  metin: string
  /** Toplam akım kapasitesi (paralel dahil), A. */
  akim: number
  /** Ω/km (paralel dahil). */
  r: number
  x: number
}

export interface DugumSpec {
  ref: string
  tur: EquipmentType
  ad: string
  alias?: string[]
  /** Eşleşen ve yeni düğümde uygulanır (gerilim gibi zorunlu değerler). */
  params?: Params
  /** Yalnızca yeni oluşturulan düğümde, tür varsayılanının üstüne uygulanır. */
  varsayilan?: Params
  olustur?: boolean
  not?: string
  grup?: string
}

export interface HatSpec {
  ad: string
  tip: 'kablo' | 'busbar'
  kaynak: string
  hedef: string
  uzunluk: number
  sayfa: string
  veri: 'cizelge' | 'varsayim'
  akim?: number
  kablo?: KabloSpec
  kesici?: KesiciSpec
  hedefKesici?: KesiciSpec
  grup?: string
  aciklama?: string
  gerilim?: number
  uzunlukKaynak?: 'elle' | '3d'
  pay?: number
}

export interface TemizleDugum {
  adlar: string[]
  tur: EquipmentType
  grup?: string
}

export interface TemizleHat {
  kaynak: string
  hedef: string
  grup?: string
}

export interface HatCizelgesi {
  surum: 1
  ad: string
  kaynak: string
  dugumler: DugumSpec[]
  hatlar: HatSpec[]
  temizle: { dugumler: TemizleDugum[]; hatlar: TemizleHat[] }
}

export interface HatRapor {
  /** Spec düğümü → modelde eşleşen mevcut düğüm adı. */
  eslesen: { ref: string; ad: string }[]
  olusturulan: string[]
  kesiciSayisi: number
  hatSayisi: number
  silinenDugum: string[]
  silinenHat: number
  /** Atlanan hatlar ve nedenleri (zaten var, uç yok). */
  atlanan: { ad: string; neden: string }[]
  uyarilar: string[]
}

export interface HatDelta {
  addNodes: ProjectNode[]
  addEdges: ProjectEdge[]
  removeNodeIds: string[]
  removeEdgeIds: string[]
  paramPatches: Record<string, Params>
  posPatches: Record<string, { x: number; y: number }>
  rapor: HatRapor
}

// --- ayrıştırma ---------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const numv = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function parseParamsLoose(v: unknown): Params | undefined {
  if (!isObj(v)) return undefined
  const out: Params = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val
    else if (typeof val === 'string') out[k] = val
  }
  return out
}

function parseKesici(v: unknown): KesiciSpec | undefined {
  if (!isObj(v) || !str(v.ad)) return undefined
  const tip = v.tip === 'MCCB' || v.tip === 'Ayırıcı' ? v.tip : 'ACB'
  return {
    ad: str(v.ad),
    tip,
    akim: numv(v.akim, 100),
    icu: numv(v.icu, 0),
    kutup: v.kutup === '3P' ? '3P' : '4P',
    durum: v.durum === 'acik' ? 'acik' : 'kapali',
    otomatik: v.otomatik === 'otomatik' ? 'otomatik' : 'yok',
    veri: v.veri === 'varsayim' ? 'varsayim' : 'cizelge',
    sayfa: str(v.sayfa),
    ...(str(v.not) ? { not: str(v.not) } : {}),
  }
}

function parseKablo(v: unknown): KabloSpec | undefined {
  if (!isObj(v)) return undefined
  return {
    paralel: Math.max(1, Math.round(numv(v.paralel, 1))),
    damar: Math.max(1, Math.round(numv(v.damar, 4))),
    kesit: numv(v.kesit, 0),
    ...(numv(v.pe, 0) > 0 ? { pe: numv(v.pe) } : {}),
    metin: str(v.metin),
    akim: numv(v.akim, 100),
    r: numv(v.r, 0.1),
    x: numv(v.x, 0.08),
  }
}

/** Dosyadan okunan hat çizelgesini doğrular; geçersizse undefined. Bilinmeyen alanlar atılır, hatalı satırlar düşer. */
export function parseHatCizelgesi(raw: unknown): HatCizelgesi | undefined {
  if (!isObj(raw) || raw.surum !== 1 || !Array.isArray(raw.dugumler) || !Array.isArray(raw.hatlar)) return undefined
  const dugumler: DugumSpec[] = []
  for (const d of raw.dugumler) {
    if (!isObj(d) || !str(d.ref) || !str(d.ad)) continue
    const tur = d.tur as EquipmentType
    if (!(tur in EQUIPMENT)) continue
    dugumler.push({
      ref: str(d.ref),
      tur,
      ad: str(d.ad),
      ...(strArr(d.alias).length ? { alias: strArr(d.alias) } : {}),
      ...(parseParamsLoose(d.params) ? { params: parseParamsLoose(d.params) } : {}),
      ...(parseParamsLoose(d.varsayilan) ? { varsayilan: parseParamsLoose(d.varsayilan) } : {}),
      olustur: d.olustur !== false,
      ...(str(d.not) ? { not: str(d.not) } : {}),
      ...(str(d.grup) ? { grup: str(d.grup) } : {}),
    })
  }
  const hatlar: HatSpec[] = []
  for (const h of raw.hatlar) {
    if (!isObj(h) || !str(h.ad) || !str(h.kaynak) || !str(h.hedef)) continue
    hatlar.push({
      ad: str(h.ad),
      tip: h.tip === 'kablo' ? 'kablo' : 'busbar',
      kaynak: str(h.kaynak),
      hedef: str(h.hedef),
      uzunluk: Math.max(0, numv(h.uzunluk, 1)),
      sayfa: str(h.sayfa),
      veri: h.veri === 'varsayim' ? 'varsayim' : 'cizelge',
      ...(numv(h.akim, 0) > 0 ? { akim: numv(h.akim) } : {}),
      ...(parseKablo(h.kablo) ? { kablo: parseKablo(h.kablo) } : {}),
      ...(parseKesici(h.kesici) ? { kesici: parseKesici(h.kesici) } : {}),
      ...(parseKesici(h.hedefKesici) ? { hedefKesici: parseKesici(h.hedefKesici) } : {}),
      ...(str(h.grup) ? { grup: str(h.grup) } : {}),
      ...(str(h.aciklama) ? { aciklama: str(h.aciklama) } : {}),
      ...(numv(h.gerilim, 0) > 0 ? { gerilim: numv(h.gerilim) } : {}),
      ...(h.uzunlukKaynak === '3d' ? { uzunlukKaynak: '3d' as const } : {}),
      ...(typeof h.pay === 'number' && Number.isFinite(h.pay) ? { pay: h.pay } : {}),
    })
  }
  const t = isObj(raw.temizle) ? raw.temizle : {}
  const temizle: HatCizelgesi['temizle'] = { dugumler: [], hatlar: [] }
  if (Array.isArray(t.dugumler)) {
    for (const d of t.dugumler) {
      if (!isObj(d) || !strArr(d.adlar).length || !((d.tur as EquipmentType) in EQUIPMENT)) continue
      temizle.dugumler.push({ adlar: strArr(d.adlar), tur: d.tur as EquipmentType, ...(str(d.grup) ? { grup: str(d.grup) } : {}) })
    }
  }
  if (Array.isArray(t.hatlar)) {
    for (const h of t.hatlar) {
      if (!isObj(h) || !str(h.kaynak) || !str(h.hedef)) continue
      temizle.hatlar.push({ kaynak: str(h.kaynak), hedef: str(h.hedef), ...(str(h.grup) ? { grup: str(h.grup) } : {}) })
    }
  }
  if (dugumler.length === 0 || hatlar.length === 0) return undefined
  return { surum: 1, ad: str(raw.ad) || 'Hat çizelgesi', kaynak: str(raw.kaynak), dugumler, hatlar, temizle }
}

// --- eşleştirme ---------------------------------------------------------------------------------------------------

/** Etiket karşılaştırma biçimi: büyük harf, boşluk/alt çizgi → nokta ("UPS C1.1" = "UPS.C1.1"). */
export const normTag = (s: string): string => s.trim().toUpperCase().replace(/[\s_]+/g, '.').replace(/\.{2,}/g, '.')

const isMinor = (t: EquipmentType): boolean => t === 'kesici' || t === 'yardimci'
const PANEL_TYPES: EquipmentType[] = ['mdb', 'dagitimPanosu', 'bara', 'upsPanosu', 'pdu']

/** Düğümün eşleşme adayları ve puanı: etiket/ad tam eşleşme 3, ilk sözcük ve parantez öncesi 2. */
function nodeTags(n: Pick<ProjectNode, 'ad' | 'etiket'>): { tag: string; score: number }[] {
  const out: { tag: string; score: number }[] = []
  if (n.etiket) out.push({ tag: normTag(n.etiket), score: 3 })
  out.push({ tag: normTag(n.ad), score: 3 })
  const first = n.ad.trim().split(/\s+/)[0]
  if (first) out.push({ tag: normTag(first), score: 2 })
  const before = n.ad.split('(')[0].trim()
  if (before) out.push({ tag: normTag(before), score: 2 })
  return out
}

function findNode(nodes: ProjectNode[], def: DugumSpec, claimed: Set<string>): ProjectNode | undefined {
  const aliases = (def.alias?.length ? def.alias : [def.ad]).map(normTag)
  let best: { n: ProjectNode; score: number } | undefined
  for (const n of nodes) {
    if (claimed.has(n.id)) continue
    const sameType = n.type === def.tur
    // Aynı tür; ya da pano ailesi (mdb / dağıtım panosu / bara) kendi aralarında eşleşebilir.
    if (!sameType && !(PANEL_TYPES.includes(n.type) && PANEL_TYPES.includes(def.tur))) continue
    let s = 0
    for (const t of nodeTags(n)) if (aliases.includes(t.tag)) s = Math.max(s, t.score)
    if (s === 0) continue
    const score = s * 10 + (sameType ? 5 : 0)
    if (!best || score > best.score) best = { n, score }
  }
  return best?.n
}

// --- uygulama -----------------------------------------------------------------------------------------------------

const STUB_LENGTH = 2
const BUSBAR_R = 0.02
const BUSBAR_X = 0.02

interface Ctx {
  nodes: ProjectNode[]
  newNodes: ProjectNode[]
  patches: Record<string, Params>
  removedNodes: Set<string>
  removedEdges: Set<string>
  /** Çıkış/giriş portları: düğüm kimliği → kullanılan port numaraları. */
  outUse: Map<string, Set<number>>
  inUse: Map<string, Set<number>>
  addEdges: ProjectEdge[]
  newId: (prefix: string) => string
}

function alloc(map: Map<string, Set<number>>, id: string): number {
  const set = map.get(id) ?? new Set<number>()
  map.set(id, set)
  let p = 0
  while (set.has(p)) p++
  set.add(p)
  return p
}

function edgeBase(c: Ctx, source: string, target: string, over: Partial<ProjectEdge>): ProjectEdge {
  const e: ProjectEdge = {
    id: c.newId('hat'),
    source,
    target,
    kaynakPort: alloc(c.outUse, source),
    hedefPort: alloc(c.inUse, target),
    tip: 'busbar',
    uzunluk: STUB_LENGTH,
    akimKapasitesi: 100000,
    r: BUSBAR_R,
    x: BUSBAR_X,
    gerilim: 415,
    pay: null,
    isiKonum: 'elektrik',
    durum: 'kapali',
    ad: '',
    aciklama: '',
    ...over,
  }
  c.addEdges.push(e)
  return e
}

function makeKesici(c: Ctx, k: KesiciSpec, hedefUcu: boolean, gerilim: number): ProjectNode {
  const d = EQUIPMENT.kesici.defaults
  const note = k.not ?? ''
  const n: ProjectNode = {
    id: c.newId('k'),
    type: 'kesici',
    ad: k.ad,
    etiket: '',
    grup: '',
    notlar: k.veri === 'varsayim' && !/^Varsayım/.test(note) ? `Varsayım: ${note}` : note,
    x: 0,
    y: 0,
    params: {
      ...d,
      tip: k.tip,
      nominalAkim: k.akim,
      kutup: k.kutup,
      durum: k.durum,
      otomatik: k.otomatik,
      gerilim,
      kesmeKa: k.icu,
      // Hat sonundaki giriş şalteri: 3D'de akış yukarısındaki uzak panoya değil, beslediği panoya oturur.
      ...(hedefUcu ? { montaj: 'alt' } : {}),
    },
  }
  c.newNodes.push(n)
  return n
}

/**
 * Çizelgeyi modele uygular. Dönen `HatDelta`: eklenecek düğüm/hat, silinecek yer tutucular, port ve gerilim yamaları, 2B konumlar.
 * Aynı çizelge ikinci kez uygulanırsa (hat adları zaten varsa) değişiklik üretmez.
 */
export function planHatCizelgesi(
  model: { nodes: ProjectNode[]; edges: ProjectEdge[] },
  spec: HatCizelgesi,
  newId: (prefix: string) => string = defaultNewId,
): HatDelta {
  const rapor: HatRapor = { eslesen: [], olusturulan: [], kesiciSayisi: 0, hatSayisi: 0, silinenDugum: [], silinenHat: 0, atlanan: [], uyarilar: [] }
  const defs = new Map(spec.dugumler.map((d) => [d.ref, d]))
  const claimed = new Set<string>()
  const found = new Map<string, ProjectNode>()
  for (const d of spec.dugumler) {
    const n = findNode(model.nodes, d, claimed)
    if (n) {
      claimed.add(n.id)
      found.set(d.ref, n)
    }
  }
  const resolvable = (ref: string): boolean => {
    const d = defs.get(ref)
    return !!d && (found.has(ref) || d.olustur !== false)
  }

  // Grup: aynı gruptaki tüm hatların uçları çözümlenmiyorsa grup atlanır (ör. PL2 yoksa PL2 catcher hatları).
  const groupOk = new Map<string, boolean>()
  for (const h of spec.hatlar) {
    if (!h.grup) continue
    groupOk.set(h.grup, (groupOk.get(h.grup) ?? true) && resolvable(h.kaynak) && resolvable(h.hedef))
  }
  for (const t of spec.temizle.dugumler) if (t.grup && !groupOk.has(t.grup)) groupOk.set(t.grup, false)

  const c: Ctx = {
    nodes: model.nodes,
    newNodes: [],
    patches: {},
    removedNodes: new Set(),
    removedEdges: new Set(),
    outUse: new Map(),
    inUse: new Map(),
    addEdges: [],
    newId,
  }

  // 1) Yer tutucuları temizle (şema dışı kaynaklar, 0 kW catcher yükleri) ve bağlı hatlarını sil.
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  for (const t of spec.temizle.dugumler) {
    if (t.grup && groupOk.get(t.grup) !== true) continue
    const adlar = t.adlar.map(normTag)
    for (const n of model.nodes) {
      if (n.type !== t.tur || !adlar.includes(normTag(n.ad)) || c.removedNodes.has(n.id)) continue
      c.removedNodes.add(n.id)
      rapor.silinenDugum.push(n.ad)
    }
  }
  for (const t of spec.temizle.hatlar) {
    if (t.grup && groupOk.get(t.grup) !== true) continue
    const a = found.get(t.kaynak)
    const b = found.get(t.hedef)
    if (!a || !b) continue
    for (const e of model.edges) if (e.source === a.id && e.target === b.id) c.removedEdges.add(e.id)
  }
  for (const e of model.edges) if (c.removedNodes.has(e.source) || c.removedNodes.has(e.target)) c.removedEdges.add(e.id)
  rapor.silinenHat = c.removedEdges.size
  // Silinecek yer tutucu hatların adları (ör. PL1 şemasındaki "BB/C1") yeni hatla çakışmaz.
  const existingNames = new Set(model.edges.filter((e) => !c.removedEdges.has(e.id)).map((e) => e.ad).filter(Boolean))

  // Mevcut hatlardan kullanılan portlar (silinenler hariç).
  for (const e of model.edges) {
    if (c.removedEdges.has(e.id)) continue
    const o = c.outUse.get(e.source) ?? new Set<number>()
    o.add(e.kaynakPort)
    c.outUse.set(e.source, o)
    const i = c.inUse.get(e.target) ?? new Set<number>()
    i.add(e.hedefPort)
    c.inUse.set(e.target, i)
  }

  // 2) Düğümleri çöz: bulunanlar yamalanır, olmayanlar oluşturulur (yalnızca kullanılacak hatlar için).
  const resolved = new Map<string, ProjectNode>()
  const refGroup = new Map<string, string>() // düğüm kimliği → 2B yerleşim bloğu
  const used = new Set<string>()
  const include: HatSpec[] = []
  for (const h of spec.hatlar) {
    if (!defs.has(h.kaynak) || !defs.has(h.hedef)) {
      rapor.atlanan.push({ ad: h.ad, neden: `bilinmeyen uç (${!defs.has(h.kaynak) ? h.kaynak : h.hedef})` })
      continue
    }
    if (h.grup && groupOk.get(h.grup) !== true) {
      rapor.atlanan.push({ ad: h.ad, neden: 'grubun uçlarından biri modelde yok' })
      continue
    }
    if (!h.grup && (!resolvable(h.kaynak) || !resolvable(h.hedef))) {
      rapor.atlanan.push({ ad: h.ad, neden: 'uç ekipman modelde yok' })
      continue
    }
    if (existingNames.has(h.ad)) {
      rapor.atlanan.push({ ad: h.ad, neden: 'zaten var' })
      continue
    }
    include.push(h)
    used.add(h.kaynak)
    used.add(h.hedef)
  }
  const blockOf = (ref: string): string => (ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : ref)
  for (const ref of used) {
    const d = defs.get(ref)!
    let n = found.get(ref)
    if (n) {
      rapor.eslesen.push({ ref, ad: n.ad })
      if (d.params) {
        const diff: Params = {}
        for (const [k, v] of Object.entries(d.params)) if (n.params[k] !== v) diff[k] = v
        if (Object.keys(diff).length) c.patches[n.id] = { ...c.patches[n.id], ...diff }
      }
    } else {
      const defaults = EQUIPMENT[d.tur].defaults as Params
      n = {
        id: newId('c'),
        type: d.tur,
        ad: d.ad,
        etiket: '',
        grup: d.grup ?? '',
        notlar: d.not ?? '',
        x: 0,
        y: 0,
        params: { ...defaults, ...(d.varsayilan ?? {}), ...(d.params ?? {}) },
      }
      c.newNodes.push(n)
      rapor.olusturulan.push(n.ad)
    }
    resolved.set(ref, n)
    refGroup.set(n.id, blockOf(ref))
  }

  // 3) Hatları ekle: kaynak → [şalter] → hat → [şalter] → hedef.
  for (const h of include) {
    const src = resolved.get(h.kaynak)!
    const dst = resolved.get(h.hedef)!
    const gerilim = h.gerilim ?? 415
    let from = src
    let to = dst
    let k1: ProjectNode | undefined
    let k2: ProjectNode | undefined
    if (h.kesici) {
      k1 = makeKesici(c, h.kesici, false, gerilim)
      refGroup.set(k1.id, refGroup.get(src.id) ?? '')
      from = k1
    }
    if (h.hedefKesici) {
      k2 = makeKesici(c, h.hedefKesici, true, gerilim)
      refGroup.set(k2.id, refGroup.get(dst.id) ?? '')
      to = k2
    }
    const cap = h.kablo?.akim ?? h.akim ?? 100000
    if (k1) edgeBase(c, src.id, k1.id, { akimKapasitesi: h.kesici!.akim, gerilim })
    const main = edgeBase(c, from.id, to.id, {
      tip: h.tip,
      uzunluk: h.uzunluk,
      akimKapasitesi: cap,
      r: h.kablo ? h.kablo.r : BUSBAR_R,
      x: h.kablo ? h.kablo.x : BUSBAR_X,
      gerilim,
      ad: h.ad,
      aciklama: h.kablo?.metin ?? h.aciklama ?? '',
      pay: h.pay ?? null,
      ...(h.uzunlukKaynak ? { uzunlukKaynak: h.uzunlukKaynak } : {}),
    })
    if (h.kablo && h.aciklama) main.aciklama = `${h.kablo.metin} — ${h.aciklama}`
    if (k2) edgeBase(c, k2.id, dst.id, { akimKapasitesi: h.hedefKesici!.akim, gerilim })
    rapor.hatSayisi++
    rapor.kesiciSayisi += (k1 ? 1 : 0) + (k2 ? 1 : 0)
  }

  // 4) Port sayıları: kullanılan en yüksek port + 1 (azaltılmaz).
  const touched = new Set<string>([...c.outUse.keys(), ...c.inUse.keys()])
  const newById = new Map(c.newNodes.map((n) => [n.id, n]))
  for (const id of touched) {
    const n = newById.get(id) ?? byId.get(id)
    if (!n || c.removedNodes.has(id)) continue
    const params = { ...n.params, ...(c.patches[id] ?? {}) }
    const patch: Params = {}
    for (const [dir, key, map] of [
      ['in', 'girisSayisi', c.inUse],
      ['out', 'cikisSayisi', c.outUse],
    ] as const) {
      const used = map.get(id)
      if (!used || used.size === 0) continue
      const need = Math.max(...used) + 1
      if (need > MAX_PORTS) {
        rapor.uyarilar.push(`${n.ad}: ${need} ${dir === 'in' ? 'giriş' : 'çıkış'} portu gerekiyor (en çok ${MAX_PORTS}).`)
        continue
      }
      if (portCount(n.type, params, dir) < need) patch[key] = need
    }
    if (Object.keys(patch).length) {
      if (newById.has(id)) Object.assign(newById.get(id)!.params, patch)
      else c.patches[id] = { ...c.patches[id], ...patch }
    }
  }

  const delta: HatDelta = {
    addNodes: c.newNodes,
    addEdges: c.addEdges,
    removeNodeIds: [...c.removedNodes],
    removeEdgeIds: [...c.removedEdges],
    paramPatches: c.patches,
    posPatches: {},
    rapor,
  }
  delta.posPatches = layoutPositions(model, delta, refGroup)
  return delta
}

/** Değişiklik kümesini modele uygulayıp yeni model döndürür (yamalar ve 2B konumlar dahil). */
export function applyHatDelta(model: { nodes: ProjectNode[]; edges: ProjectEdge[] }, d: HatDelta): { nodes: ProjectNode[]; edges: ProjectEdge[] } {
  const rn = new Set(d.removeNodeIds)
  const re = new Set(d.removeEdgeIds)
  const nodes = [...model.nodes.filter((n) => !rn.has(n.id)), ...d.addNodes].map((n) => {
    const p = d.paramPatches[n.id]
    const pos = d.posPatches[n.id]
    if (!p && !pos) return n
    return { ...n, ...(pos ?? {}), params: p ? { ...n.params, ...p } : n.params }
  })
  const edges = [...model.edges.filter((e) => !re.has(e.id)), ...d.addEdges]
  return { nodes, edges }
}

// --- 2B yerleşim ---------------------------------------------------------------------------------------------------

const LAYER_GAP = 130
const COL_GAP = 28
const BLOCK_GAP = 320

const widthOf = (n: ProjectNode, params: Params): number => {
  if (isMinor(n.type)) return 150
  const ports = Math.max(portCount(n.type, params, 'in'), portCount(n.type, params, 'out'))
  return Math.max(200, ports * 18 + 170)
}

/**
 * Yeni düğümler ve plandan gelen ("Plan" grubu) eşleşen düğümler için katmanlı 2B konum: mevcut şemanın sağında, blok başına
 * bir şerit (C1, C2...), kaynaktan yüke yukarıdan aşağıya. Mevcut elle yerleştirilmiş düğümler yerinde kalır.
 */
function layoutPositions(model: { nodes: ProjectNode[]; edges: ProjectEdge[] }, d: HatDelta, groupOf: Map<string, string>): Record<string, { x: number; y: number }> {
  const removed = new Set(d.removeNodeIds)
  const all = new Map<string, ProjectNode>()
  for (const n of model.nodes) if (!removed.has(n.id)) all.set(n.id, { ...n, params: { ...n.params, ...(d.paramPatches[n.id] ?? {}) } })
  for (const n of d.addNodes) all.set(n.id, n)
  const edges = [...model.edges.filter((e) => !d.removeEdgeIds.includes(e.id)), ...d.addEdges]

  const toLay = new Set<string>()
  for (const n of d.addNodes) toLay.add(n.id)
  for (const id of groupOf.keys()) if (all.get(id)?.grup === 'Plan') toLay.add(id)
  if (toLay.size === 0) return {}

  const fixed = [...all.values()].filter((n) => !toLay.has(n.id))
  const maxX = fixed.length ? Math.max(...fixed.map((n) => n.x + widthOf(n, n.params))) : 0
  const minY = fixed.length ? Math.min(...fixed.map((n) => n.y)) : 0
  const groups = new Map<string, string[]>()
  for (const id of toLay) {
    const g = groupOf.get(id) ?? ''
    groups.set(g, [...(groups.get(g) ?? []), id])
  }
  const out: Record<string, { x: number; y: number }> = {}
  let originX = maxX + BLOCK_GAP
  for (const ids of groups.values()) {
    const set = new Set(ids)
    const local = edges.filter((e) => set.has(e.source) && set.has(e.target))
    const depth = new Map(ids.map((id) => [id, 0]))
    for (let pass = 0; pass < ids.length; pass++) {
      let changed = false
      for (const e of local) {
        const nd = (depth.get(e.source) ?? 0) + 1
        if (nd > (depth.get(e.target) ?? 0) && nd <= ids.length) {
          depth.set(e.target, nd)
          changed = true
        }
      }
      if (!changed) break
    }
    const layers: string[][] = []
    for (const id of ids) {
      const l = depth.get(id) ?? 0
      ;(layers[l] ??= []).push(id)
    }
    const xs = new Map<string, number>()
    let right = 0
    layers.forEach((layer, li) => {
      if (!layer) return
      const parentsX = (id: string): number | undefined => {
        const ps = local.filter((e) => e.target === id && xs.has(e.source)).map((e) => xs.get(e.source)!)
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : undefined
      }
      const order = layer
        .map((id, i) => ({ id, i, t: parentsX(id) }))
        .sort((a, b) => (a.t ?? Number.NEGATIVE_INFINITY) - (b.t ?? Number.NEGATIVE_INFINITY) || a.i - b.i)
      let cursor = Number.NEGATIVE_INFINITY
      for (const o of order) {
        const w = widthOf(all.get(o.id)!, all.get(o.id)!.params)
        const want = o.t === undefined ? (cursor === Number.NEGATIVE_INFINITY ? 0 : cursor) : o.t
        const x = Math.max(want, cursor)
        xs.set(o.id, x)
        cursor = x + w + COL_GAP
        right = Math.max(right, cursor)
        out[o.id] = { x: 0, y: Math.round(minY + li * LAYER_GAP) }
      }
    })
    const minX = Math.min(...ids.map((id) => xs.get(id) ?? 0))
    for (const id of ids) out[id] = { x: Math.round(originX + (xs.get(id) ?? 0) - minX), y: out[id].y }
    originX += right - minX + BLOCK_GAP
  }
  return out
}
