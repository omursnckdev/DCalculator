import { EQUIPMENT, MAX_PORTS, portCount } from '../library/equipment'
import type { FieldDef } from '../library/equipment'
import { DEFAULT_LINE, newId } from '../model/project'
import { EQUIPMENT_TYPES } from '../model/types'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'

/**
 * Excel/CSV'den toplu ekipman içe aktarma. Başlıklar Türkçe/İngilizce eş anlamlılarla eşlenir; tipe özgü tüm
 * alanlar (anahtar veya etiketle) ayrıca tanınır. İsteğe bağlı "Besleyen" sütunu hatları oluşturur.
 * Saf fonksiyonlardır (dosya okuma `readTable`'da).
 */

export interface ImportItem {
  /** Kaynak satır numarası (1 tabanlı, başlık dahil). */
  row: number
  ad: string
  type: EquipmentType
  etiket: string
  grup: string
  notlar: string
  params: Params
  /** Besleyen ekipman adları (bu dosyadaki veya şemadaki). */
  besleyen: string[]
}

export interface ImportParse {
  items: ImportItem[]
  warnings: string[]
  /** Tanınan sütunlar (önizleme için). */
  columns: { header: string; maps: string }[]
}

// --- metin yardımcıları --------------------------------------------------------------

export const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '')

/** "1.250,5" (TR), "1,250.5" (EN), "1250,5", "1250.5". Sayı değilse undefined. */
export function parseNum(raw: string): number | undefined {
  let s = raw.trim().replace(/\s/g, '').replace(/%$/, '')
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return undefined
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot >= 0 && s.split('.').length > 2) {
    s = s.replace(/\./g, '')
  }
  const v = Number(s)
  return Number.isFinite(v) ? v : undefined
}

/** CSV ayrıştırıcı: ayraç (; , sekme) otomatik, tırnaklı alanlar, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => first.split(c).length - 1
  const delim = [';', '\t', ','].reduce((best, c) => (count(c) > count(best) ? c : best), ';')
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// --- sütun ve tip eşleme ---------------------------------------------------------------

type Std = 'ad' | 'tip' | 'etiket' | 'grup' | 'besleyen' | 'adet' | 'kw' | 'kva' | 'pf' | 'df' | 'gerilim' | 'sogutma' | 'oncelik' | 'notlar'
const STD: Record<Std, string[]> = {
  ad: ['ad', 'adi', 'isim', 'name', 'ekipman', 'ekipmanadi', 'equipment', 'equipmentname'],
  tip: ['tip', 'tur', 'type', 'ekipmantipi', 'ekipmantur', 'cins', 'equipmenttype'],
  etiket: ['etiket', 'tag', 'kod', 'code', 'tagno'],
  grup: ['grup', 'group', 'bolge', 'alan', 'zone', 'area'],
  besleyen: ['besleyen', 'kaynak', 'source', 'from', 'besleme', 'upstream', 'beslemekaynagi', 'feeder', 'suppliedby'],
  adet: ['adet', 'qty', 'miktar', 'quantity', 'count', 'sayi'],
  kw: ['guc', 'gucukw', 'kw', 'power', 'powerkw', 'kurulukw', 'kuruluguc', 'kurulu', 'elektrikkw', 'aktifguc'],
  kva: ['kva', 'nominalkva', 'gorunurguc', 'rating', 'ratingkva'],
  pf: ['pf', 'cosphi', 'cos', 'gucfaktoru', 'powerfactor'],
  df: ['df', 'diversity', 'es', 'esanlilik', 'esanlilikfaktoru', 'demandfactor'],
  gerilim: ['gerilim', 'voltage', 'v', 'volt', 'gerilimv'],
  sogutma: ['sogutmakw', 'sogutma', 'coolingkw', 'cooling', 'capacity', 'kapasite', 'sogutmakapasitesi'],
  oncelik: ['oncelik', 'priority', 'oncelikseviyesi'],
  notlar: ['not', 'notlar', 'aciklama', 'notes', 'comment', 'yorum'],
}
const STD_LOOKUP = new Map<string, Std>()
for (const [k, list] of Object.entries(STD) as [Std, string[]][]) for (const w of list) STD_LOOKUP.set(w, k)

const TYPE_WORDS: Partial<Record<EquipmentType, string[]>> = {
  sebeke: ['grid', 'utility', 'sebeke', 'sebekegirisi', 'mains'],
  trafo: ['transformer', 'trafo', 'tr'],
  jenerator: ['generator', 'jenerator', 'genset', 'dg', 'dizeljenerator'],
  mdb: ['mdb', 'anapano', 'anadagitim', 'main', 'agmdb', 'lv'],
  dagitimPanosu: ['dagitimpanosu', 'pano', 'panel', 'db', 'distribution'],
  ups: ['ups'],
  upsPanosu: ['upspanosu', 'upspanel'],
  pdu: ['pdu'],
  ats: ['ats'],
  sts: ['sts'],
  kesici: ['kesici', 'breaker', 'acb', 'mccb', 'mcb', 'ayirici', 'switch'],
  bara: ['bara', 'busbar', 'bus'],
  senkron: ['senkron', 'sync', 'synchronizing'],
  itYuku: ['it', 'ityuku', 'itload', 'server', 'sunucu', 'bt'],
  mekanikYuk: ['mekanik', 'mekanikyuk', 'mechanical'],
  aydinlatma: ['aydinlatma', 'lighting'],
  genelYuk: ['genel', 'genelyuk', 'yuk', 'load'],
  chiller: ['chiller', 'sogutucugrup', 'sogutmagrubu'],
  crah: ['crah'],
  crac: ['crac', 'dxklima'],
  fanwall: ['fanwall'],
  inrow: ['inrow'],
  rdhx: ['rdhx', 'reardoor'],
  kuruSogutucu: ['drycooler', 'kurusogutucu'],
  sogutmaKulesi: ['coolingtower', 'sogutmakulesi', 'kule'],
  pompa: ['pump', 'pompa'],
  ahu: ['ahu', 'havaislemeunitesi'],
  fan: ['fan', 'vantilator'],
  nemlendirici: ['humidifier', 'nemlendirici'],
  rack: ['rack', 'kabin', 'rafkabin'],
}

/** Tip metnini ekipman tipine çevirir: tam eşleşme (anahtar, etiket, eş anlamlı), sonra kapsama. */
export function matchType(text: string): EquipmentType | undefined {
  const f = fold(text)
  if (!f) return undefined
  const exact = EQUIPMENT_TYPES.find((t) => fold(t) === f || fold(EQUIPMENT[t].label) === f || (TYPE_WORDS[t] ?? []).includes(f))
  if (exact) return exact
  return EQUIPMENT_TYPES.find((t) => fold(EQUIPMENT[t].label).includes(f) && f.length >= 4) ?? EQUIPMENT_TYPES.find((t) => (TYPE_WORDS[t] ?? []).some((w) => w.length >= 4 && f.includes(w)))
}

function fieldFor(type: EquipmentType, header: string): FieldDef | undefined {
  const h = fold(header)
  return EQUIPMENT[type].fields.find((fd) => fold(fd.key) === h || fold(fd.label) === h)
}

function selectValue(fd: FieldDef, raw: string): string | undefined {
  if (fd.kind !== 'select') return undefined
  const f = fold(raw)
  return fd.options.find((o) => fold(String(o.value)) === f || fold(o.label) === f)?.value as string | undefined
}

// --- ayrıştırma -------------------------------------------------------------------------

export function parseTable(table: string[][]): ImportParse {
  const warnings: string[] = []
  const items: ImportItem[] = []
  if (table.length < 2) return { items, warnings: ['Dosyada başlık satırı ve en az bir veri satırı olmalı.'], columns: [] }
  const headers = table[0].map((h) => h.trim())
  const std = headers.map((h) => STD_LOOKUP.get(fold(h)))
  if (!std.includes('ad')) warnings.push('"Ad" sütunu bulunamadı; adlar tipten üretilecek.')
  if (!std.includes('tip')) {
    warnings.push('"Tip" sütunu bulunamadı: tip belirlenemeyen satırlar atlanır.')
  }
  const col = (k: Std) => std.indexOf(k)
  const columns: ImportParse['columns'] = headers.map((h, i) => ({ header: h, maps: std[i] ? `→ ${std[i]}` : '(tipe göre)' }))

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    const get = (k: Std) => (col(k) >= 0 ? (cells[col(k)] ?? '').trim() : '')
    const line = r + 1
    const typeText = get('tip')
    let type = matchType(typeText)
    if (!type) type = matchType(get('ad'))
    if (!type) {
      warnings.push(`Satır ${line}: tip "${typeText || get('ad')}" tanınmadı, atlandı.`)
      continue
    }
    const def = EQUIPMENT[type]
    const params: Params = {}
    const note = (msg: string) => warnings.push(`Satır ${line}: ${msg}`)
    const num = (k: Std): number | undefined => {
      const raw = get(k)
      if (!raw) return undefined
      const v = parseNum(raw)
      if (v === undefined) note(`"${headers[col(k)]}" sayı değil (${raw}), yok sayıldı.`)
      return v
    }
    const setIf = (key: string, v: number | undefined) => {
      if (v !== undefined && key in def.defaults) params[key] = v
    }
    const pf = num('pf')
    const kw = num('kw')
    const kva = num('kva')
    setIf('pf', pf)
    setIf('df', num('df'))
    setIf('sogutmaKw', num('sogutma'))
    setIf('oncelik', num('oncelik'))
    const volt = num('gerilim')
    if (volt !== undefined) for (const key of ['gerilim', 'sekonderGerilim']) if (key in def.defaults) params[key] = volt
    // Güç: kW sütunu yükler için kuruluKw, UPS için nominalKw; kVA sütunu nominalKva (yükte kW'a çevrilir).
    if (kw !== undefined) {
      if ('kuruluKw' in def.defaults) params.kuruluKw = kw
      else if (type === 'ups') params.nominalKw = kw
      else if ('nominalKva' in def.defaults) {
        const p = pf ?? Number(def.defaults.pf ?? 1)
        params.nominalKva = p > 0 ? Math.round(kw / p) : kw
        note(`"kW" bu tipte kVA'ya çevrildi (cos φ ${p}).`)
      } else note('"kW" bu tipte kullanılmaz, yok sayıldı.')
    }
    if (kva !== undefined) {
      if ('nominalKva' in def.defaults) {
        params.nominalKva = kva
        if (type === 'ups' && kw === undefined) params.nominalKw = Math.round(kva * 0.9)
      } else if ('kuruluKw' in def.defaults && kw === undefined) params.kuruluKw = Math.round(kva * (pf ?? Number(def.defaults.pf ?? 1)) * 10) / 10
      else if (kw === undefined) note('"kVA" bu tipte kullanılmaz, yok sayıldı.')
    }
    // Kesici tip metni (ACB/MCCB/Ayırıcı) tip sütunundan.
    if (type === 'kesici') {
      const f = fold(typeText)
      if (f === 'acb') params.tip = 'ACB'
      else if (f === 'mccb' || f === 'mcb') params.tip = 'MCCB'
      else if (f === 'ayirici' || f === 'switch') params.tip = 'Ayırıcı'
    }
    // Kalan sütunlar: tipin alanlarına anahtar/etiketle.
    headers.forEach((h, i) => {
      if (std[i] || !h) return
      const raw = (cells[i] ?? '').trim()
      if (!raw) return
      const fd = fieldFor(type!, h)
      if (!fd) return
      if (fd.kind === 'number') {
        const v = parseNum(raw)
        if (v === undefined) note(`"${h}" sayı değil (${raw}), yok sayıldı.`)
        else params[fd.key] = v
      } else {
        const v = selectValue(fd, raw)
        if (v === undefined) note(`"${h}" için "${raw}" geçerli seçenek değil, yok sayıldı.`)
        else params[fd.key] = v
      }
    })
    const adet = Math.max(1, Math.min(200, Math.round(num('adet') ?? 1)))
    const base = get('ad') || def.label.split(' (')[0]
    const besleyen = get('besleyen')
      .split(/[|+]/)
      .map((x) => x.trim())
      .filter(Boolean)
    for (let k = 1; k <= adet; k++) {
      items.push({
        row: line,
        ad: adet > 1 ? `${base} ${k}` : base,
        type,
        etiket: get('etiket'),
        grup: get('grup'),
        notlar: get('notlar'),
        params: { ...params },
        besleyen,
      })
    }
  }
  return { items, warnings, columns }
}

// --- şemaya yerleştirme ------------------------------------------------------------------

export interface ImportBuild {
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  warnings: string[]
}

/**
 * Satırları düğümlere ve hatlara çevirir. Ad çakışmaları (mevcut veya dosya içi) " (2)" ekiyle ayrılır; besleyen adları
 * önce dosya içinde, sonra mevcut şemada aranır. Düğümler besleyen derinliğine göre kademelendirilerek mevcut şemanın altına dizilir.
 */
export function buildImport(items: ImportItem[], existing: ProjectNode[], existingEdges: ProjectEdge[]): ImportBuild {
  const warnings: string[] = []
  const taken = new Set(existing.map((n) => n.ad))
  const nodes: ProjectNode[] = []
  const byName = new Map<string, ProjectNode>(existing.map((n) => [fold(n.ad), n]))
  const itemNode = new Map<ImportItem, ProjectNode>()
  for (const it of items) {
    let ad = it.ad
    for (let k = 2; taken.has(ad); k++) ad = `${it.ad} (${k})`
    if (ad !== it.ad) warnings.push(`"${it.ad}" adı zaten var, "${ad}" olarak eklendi.`)
    taken.add(ad)
    const def = EQUIPMENT[it.type]
    const node: ProjectNode = { id: newId('d'), type: it.type, ad, etiket: it.etiket, grup: it.grup, notlar: it.notlar, x: 0, y: 0, params: { ...def.defaults, ...it.params } }
    nodes.push(node)
    itemNode.set(it, node)
    // Aynı adlı satırlar sonradan "Ad 1" olmuşsa ham ad da ilk düğüme bağlanır.
    if (!byName.has(fold(ad))) byName.set(fold(ad), node)
    if (!byName.has(fold(it.ad))) byName.set(fold(it.ad), node)
  }
  // Hatlar
  const outUsed = new Map<string, number>()
  const inUsed = new Map<string, number>()
  for (const e of existingEdges) {
    outUsed.set(e.source, Math.max(outUsed.get(e.source) ?? 0, e.kaynakPort + 1))
    inUsed.set(e.target, Math.max(inUsed.get(e.target) ?? 0, e.hedefPort + 1))
  }
  const edges: ProjectEdge[] = []
  const parent = new Map<string, string[]>()
  const ensure = (n: ProjectNode, dir: 'in' | 'out', need: number): boolean => {
    if (need <= portCount(n.type, n.params, dir)) return true
    const key = dir === 'in' ? 'girisSayisi' : 'cikisSayisi'
    if (need > MAX_PORTS || !(key in EQUIPMENT[n.type].defaults)) return false
    n.params[key] = need
    return true
  }
  for (const it of items) {
    const node = itemNode.get(it)!
    for (const sup of it.besleyen) {
      const src = byName.get(fold(sup))
      if (!src || src === node) {
        warnings.push(`Satır ${it.row}: besleyen "${sup}" bulunamadı.`)
        continue
      }
      if (!EQUIPMENT[src.type].hasOutput || !EQUIPMENT[node.type].hasInput) {
        warnings.push(`Satır ${it.row}: "${src.ad}" → "${node.ad}" bağlanamaz (giriş/çıkış yok).`)
        continue
      }
      const o = outUsed.get(src.id) ?? 0
      const i = inUsed.get(node.id) ?? 0
      if (!ensure(src, 'out', o + 1) || !ensure(node, 'in', i + 1)) {
        warnings.push(`Satır ${it.row}: "${src.ad}" çıkış veya "${node.ad}" giriş portu yetmedi, hat eklenmedi.`)
        continue
      }
      outUsed.set(src.id, o + 1)
      inUsed.set(node.id, i + 1)
      parent.set(node.id, [...(parent.get(node.id) ?? []), src.id])
      edges.push({ ...DEFAULT_LINE, id: newId('hat'), source: src.id, target: node.id, kaynakPort: o, hedefPort: i, gerilim: Number(node.params.gerilim ?? src.params.gerilim ?? 400) || 400 })
    }
  }
  // Yerleşim: yeni düğümlerin derinliği (besleyen zinciri); mevcut şemanın altından başlar.
  const newIds = new Set(nodes.map((n) => n.id))
  const depth = new Map<string, number>()
  const depthOf = (id: string, guard = 0): number => {
    if (!newIds.has(id) || guard > 50) return -1
    if (depth.has(id)) return depth.get(id)!
    const ps = (parent.get(id) ?? []).filter((p) => newIds.has(p))
    const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => depthOf(p, guard + 1)))
    depth.set(id, d)
    return d
  }
  const maxY = existing.length ? Math.max(...existing.map((n) => n.y)) + 200 : 0
  const perLevel = new Map<number, number>()
  for (const n of nodes) {
    const d = depthOf(n.id)
    const idx = perLevel.get(d) ?? 0
    perLevel.set(d, idx + 1)
    n.x = idx * 220
    n.y = maxY + d * 190
  }
  return { nodes, edges, warnings }
}

// --- dosya okuma / şablon ----------------------------------------------------------------

/** .xlsx / .csv / .txt dosyasını satır dizisine çevirir (xlsx için ilk sayfa). */
export async function readTable(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const ws = wb.worksheets[0]
    const rows: string[][] = []
    ws?.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = cell.value
        const text = v === null || v === undefined ? '' : typeof v === 'object' ? ('result' in v ? String(v.result ?? '') : 'text' in v ? String(v.text) : String(cell.text ?? '')) : String(v)
        vals[c - 1] = text
      })
      rows.push(Array.from(vals, (x) => x ?? ''))
    })
    return rows
  }
  return parseCsv(await file.text())
}

export const TEMPLATE_CSV =
  [
    'Ad;Tip;kVA;kW;Soğutma kW;Gerilim;Grup;Adet;Besleyen;Öncelik',
    'Şebeke;Şebeke;;;;34500;;1;;',
    'TR1;Trafo;2500;;;;;1;Şebeke;',
    'MDB-A;Ana dağıtım panosu;;;;400;;1;TR1;',
    'Chiller;Chiller;;250;1000;;Soğutma;2;MDB-A;2',
    'CRAH;CRAH;;12;80;;Soğutma;4;MDB-A;2',
    'IT Salon 1;IT yükü;;400;;;IT;1;MDB-A;1',
  ].join('\r\n') + '\r\n'
