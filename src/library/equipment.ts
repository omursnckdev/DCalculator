import { tr } from '../i18n/tr'
import type { EquipmentType, Params } from '../model/types'

/**
 * Ekipman kütüphanesi: her tip için varsayılan değerler ve düzenlenebilir alanlar.
 *
 * DİKKAT: Varsayılanlar GENEL TİPİK değerlerdir (50 Hz, 34,5 kV / 400 V).
 * Gerçek proje ekipman verileri girildikçe güncellenmelidir; bkz. docs/PLAN.md
 * "Açık Sorular" 3, 5 ve 6.
 */

export type PaletteGroup = 'kaynak' | 'dagitim' | 'koruma' | 'ups' | 'yuk'

export interface NumberField {
  kind: 'number'
  key: string
  label: string
  unit?: string
  min?: number
  max?: number
  step?: number
}
export interface SelectField {
  kind: 'select'
  key: string
  label: string
  options: { value: string; label: string }[]
}
export type FieldDef = NumberField | SelectField

export interface EquipmentDef {
  type: EquipmentType
  label: string
  group: PaletteGroup
  /** Giriş (üst) bağlantı noktası: bir kaynaktan beslenebilir. */
  hasInput: boolean
  /** Çıkış (alt) bağlantı noktası: başka ekipman besleyebilir. */
  hasOutput: boolean
  /** Düğüm vurgu rengi. */
  color: string
  defaults: Params
  fields: FieldDef[]
  /** Düğüm kartında gösterilen tek satırlık özet. */
  summary: (p: Params) => string
}

const n = (key: string, label: string, unit?: string, extra: Partial<NumberField> = {}): NumberField => ({
  kind: 'number',
  key,
  label,
  unit,
  ...extra,
})

const A = tr.alan
const voltage = n('gerilim', A.gerilim, 'V', { min: 0, step: 1 })
const rating = n('nominalAkim', A.nominalAkim, 'A', { min: 0, step: 10 })
const pf = n('pf', A.pf, undefined, { min: 0.1, max: 1, step: 0.01 })

const num = (p: Params, k: string): number => {
  const v = p[k]
  return typeof v === 'number' ? v : 0
}
const fmt = (v: number): string => v.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
const panelSummary = (p: Params) => `${fmt(num(p, 'nominalAkim'))} A · ${fmt(num(p, 'gerilim'))} V`
const loadSummary = (p: Params) => `${fmt(num(p, 'kuruluKw'))} kW · DF ${fmt(num(p, 'df'))}`

const heatField: SelectField = {
  kind: 'select',
  key: 'isiKonum',
  label: A.isiKonum,
  options: [
    { value: 'salon', label: A.konumSalon },
    { value: 'elektrik', label: A.konumElektrik },
    { value: 'dis', label: A.konumDis },
  ],
}
const busLength = n('baraUzunluk', A.baraUzunluk, 'm', { min: 0, step: 0.5 })
const busResistance = n('baraDirenc', A.baraDirenc, 'mΩ/m', { min: 0, step: 0.001 })
const widthField = n('genislik', A.genislik, 'px', { min: 0, step: 10 })
const diversity = n('diversity', A.diversity, undefined, { min: 0, max: 1, step: 0.01 })

const categoryField: SelectField = {
  kind: 'select',
  key: 'kategori',
  label: A.kategori,
  options: [
    { value: 'IT', label: A.kategoriIT },
    { value: 'Mekanik', label: A.kategoriMekanik },
  ],
}

const loadFields: FieldDef[] = [
  n('kuruluKw', A.kuruluKw, 'kW', { min: 0, step: 1 }),
  pf,
  n('df', A.df, undefined, { min: 0, max: 1, step: 0.01 }),
  categoryField,
  voltage,
  heatField,
]

const defs: EquipmentDef[] = [
  {
    type: 'sebeke',
    label: tr.ekipman.sebeke,
    group: 'kaynak',
    hasInput: false,
    hasOutput: true,
    color: '#64748b',
    defaults: { gerilim: 34500, kisaDevreMva: 500 },
    fields: [n('gerilim', A.gerilim, 'V', { min: 0 }), n('kisaDevreMva', A.kisaDevreMva, 'MVA', { min: 0 })],
    summary: (p) => `${fmt(num(p, 'gerilim') / 1000)} kV`,
  },
  {
    type: 'trafo',
    label: tr.ekipman.trafo,
    group: 'kaynak',
    hasInput: true,
    hasOutput: true,
    color: '#7c3aed',
    defaults: {
      nominalKva: 2500,
      primerGerilim: 34500,
      sekonderGerilim: 400,
      uk: 6,
      bostaKayip: 3,
      yukKayip: 22,
      isiKonum: 'elektrik',
    },
    fields: [
      n('nominalKva', A.nominalKva, 'kVA', { min: 0, step: 50 }),
      n('primerGerilim', A.primerGerilim, 'V', { min: 0 }),
      n('sekonderGerilim', A.sekonderGerilim, 'V', { min: 0 }),
      n('uk', A.uk, '%', { min: 0, step: 0.1 }),
      n('bostaKayip', A.bostaKayip, 'kW', { min: 0, step: 0.1 }),
      n('yukKayip', A.yukKayip, 'kW', { min: 0, step: 0.5 }),
      heatField,
    ],
    summary: (p) =>
      `${fmt(num(p, 'nominalKva'))} kVA · ${fmt(num(p, 'primerGerilim') / 1000)} kV/${fmt(num(p, 'sekonderGerilim'))} V`,
  },
  {
    type: 'jenerator',
    label: tr.ekipman.jenerator,
    group: 'kaynak',
    hasInput: false,
    hasOutput: true,
    color: '#d97706',
    defaults: { nominalKva: 2000, gerilim: 400, pf: 0.8 },
    fields: [n('nominalKva', A.nominalKva, 'kVA', { min: 0, step: 50 }), voltage, pf],
    summary: (p) => `${fmt(num(p, 'nominalKva'))} kVA · ${fmt(num(p, 'gerilim'))} V`,
  },
  {
    type: 'mdb',
    label: tr.ekipman.mdb,
    group: 'dagitim',
    hasInput: true,
    hasOutput: true,
    color: '#2563eb',
    defaults: { gerilim: 400, nominalAkim: 4000, diversity: 1, baraUzunluk: 6, baraDirenc: 0, isiKonum: 'elektrik', genislik: 0 },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField, widthField],
    summary: panelSummary,
  },
  {
    type: 'dagitimPanosu',
    label: tr.ekipman.dagitimPanosu,
    group: 'dagitim',
    hasInput: true,
    hasOutput: true,
    color: '#0891b2',
    defaults: { gerilim: 400, nominalAkim: 800, diversity: 1, baraUzunluk: 3, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  {
    type: 'bara',
    label: tr.ekipman.bara,
    group: 'dagitim',
    hasInput: true,
    hasOutput: true,
    color: '#475569',
    defaults: { gerilim: 400, nominalAkim: 3200, diversity: 1, baraUzunluk: 5, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  // ATS/STS: birden çok girişten yalnızca biri aktif olur (tercih edilen = en yüksek pay).
  // Kararlı durum hesabında ikisi aynı davranır; fark geçiş süresindedir (ATS ~saniye, STS ~ms).
  {
    type: 'ats',
    label: tr.ekipman.ats,
    group: 'dagitim',
    hasInput: true,
    hasOutput: true,
    color: '#b45309',
    defaults: { gerilim: 400, nominalAkim: 1600, diversity: 1, baraUzunluk: 2, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  {
    type: 'sts',
    label: tr.ekipman.sts,
    group: 'dagitim',
    hasInput: true,
    hasOutput: true,
    color: '#be185d',
    defaults: { gerilim: 400, nominalAkim: 800, diversity: 1, baraUzunluk: 2, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  {
    type: 'kesici',
    label: tr.ekipman.kesici,
    group: 'koruma',
    hasInput: true,
    hasOutput: true,
    color: '#b91c1c',
    // Açık kesici hattı keser (normalde açık bypass/kuplaj/load bank gibi). Kapalıysa geçirgendir.
    defaults: { tip: 'ACB', nominalAkim: 1600, kutup: '4P', durum: 'kapali', otomatik: 'yok', gerilim: 400 },
    fields: [
      { kind: 'select', key: 'tip', label: A.kesiciTip, options: [
        { value: 'ACB', label: 'ACB' },
        { value: 'MCCB', label: 'MCCB' },
        { value: 'Ayırıcı', label: A.ayirici },
      ] },
      n('nominalAkim', A.nominalAkim, 'A', { min: 0, step: 10 }),
      { kind: 'select', key: 'kutup', label: A.kutup, options: [
        { value: '3P', label: '3P' },
        { value: '4P', label: '4P' },
      ] },
      { kind: 'select', key: 'durum', label: A.kesiciDurum, options: [
        { value: 'kapali', label: tr.senaryo.kapali },
        { value: 'acik', label: tr.senaryo.acik },
      ] },
      { kind: 'select', key: 'otomatik', label: A.otomatik, options: [
        { value: 'yok', label: A.otoYok },
        { value: 'otomatik', label: A.otoVar },
      ] },
      voltage,
    ],
    summary: (p) => `${p.tip ?? 'ACB'} ${fmt(num(p, 'nominalAkim'))} A ${p.kutup ?? ''} · ${p.durum === 'acik' ? tr.senaryo.acik : tr.senaryo.kapali}`,
  },
  {
    type: 'senkron',
    label: tr.ekipman.senkron,
    group: 'kaynak',
    hasInput: true,
    hasOutput: true,
    color: '#ea580c',
    // Jeneratörleri paralel bağlar ve yük paylaşımını yönetir (PMS). Jeneratörler girişlerine
    // (kesicilerden geçerek) bağlanır; giriş port sırası çalışma önceliğidir.
    defaults: { gerilim: 400, nominalAkim: 5000, diversity: 1, mod: 'sirali', esik: 70, baraUzunluk: 4, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [
      voltage,
      rating,
      { kind: 'select', key: 'mod', label: A.mod, options: [
        { value: 'sirali', label: A.modSirali },
        { value: 'esit', label: A.modEsit },
      ] },
      n('esik', A.esik, '%', { min: 10, max: 100, step: 1 }),
      busLength,
      busResistance,
      heatField,
    ],
    summary: (p) => `${fmt(num(p, 'nominalAkim'))} A · ${p.mod === 'esit' ? A.modEsit.split(' ')[0] : `${A.modSirali.split(' ')[0]} %${fmt(num(p, 'esik'))}`}`,
  },
  {
    type: 'yardimci',
    label: tr.ekipman.yardimci,
    group: 'koruma',
    hasInput: true,
    hasOutput: false,
    color: '#64748b',
    // Güç akışını etkilemeyen ölçü/koruma elemanı (akım trafosu, sayaç, parafudr...).
    defaults: { altTip: 'akimTrafosu', gerilim: 400 },
    fields: [
      { kind: 'select', key: 'altTip', label: A.yardimciTip, options: [
        { value: 'akimTrafosu', label: A.akimTrafosu },
        { value: 'sayac', label: A.sayac },
        { value: 'pqm', label: A.pqm },
        { value: 'parafudr', label: A.parafudr },
      ] },
      voltage,
    ],
    summary: (p) => ({ akimTrafosu: A.akimTrafosu, sayac: A.sayac, pqm: A.pqm, parafudr: A.parafudr }[String(p.altTip)] ?? ''),
  },
  {
    type: 'ups',
    label: tr.ekipman.ups,
    group: 'ups',
    hasInput: true,
    hasOutput: true,
    color: '#16a34a',
    defaults: {
      nominalKva: 1000,
      nominalKw: 900,
      girisGerilim: 400,
      cikisGerilim: 400,
      verim: 96,
      girisPf: 0.99,
      // Tipik çift dönüşümlü UPS eğrisi (genel değerler; Açık Soru 3/14).
      verimModu: 'sabit',
      verim25: 94.5,
      verim50: 96,
      verim75: 96.5,
      verim100: 96.3,
      bataryaDk: 10,
      isiKonum: 'elektrik',
    },
    fields: [
      n('nominalKva', A.nominalKva, 'kVA', { min: 0, step: 10 }),
      n('nominalKw', A.nominalKw, 'kW', { min: 0, step: 10 }),
      n('girisGerilim', A.girisGerilim, 'V', { min: 0 }),
      n('cikisGerilim', A.cikisGerilim, 'V', { min: 0 }),
      n('verim', A.verim, '%', { min: 50, max: 100, step: 0.1 }),
      n('girisPf', A.girisPf, undefined, { min: 0.1, max: 1, step: 0.01 }),
      {
        kind: 'select',
        key: 'verimModu',
        label: A.verimModu,
        options: [
          { value: 'sabit', label: A.verimSabit },
          { value: 'egri', label: A.verimEgri },
        ],
      },
      n('verim25', A.verim25, '%', { min: 50, max: 100, step: 0.1 }),
      n('verim50', A.verim50, '%', { min: 50, max: 100, step: 0.1 }),
      n('verim75', A.verim75, '%', { min: 50, max: 100, step: 0.1 }),
      n('verim100', A.verim100, '%', { min: 50, max: 100, step: 0.1 }),
      n('bataryaDk', A.bataryaDk, 'dk', { min: 0, step: 1 }),
      heatField,
    ],
    summary: (p) =>
      `${fmt(num(p, 'nominalKva'))} kVA · ${p.verimModu === 'egri' ? 'η eğri' : `η ${fmt(num(p, 'verim'))}%`}`,
  },
  {
    type: 'upsPanosu',
    label: tr.ekipman.upsPanosu,
    group: 'ups',
    hasInput: true,
    hasOutput: true,
    color: '#059669',
    defaults: { gerilim: 400, nominalAkim: 1600, diversity: 1, baraUzunluk: 3, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  {
    type: 'pdu',
    label: tr.ekipman.pdu,
    group: 'ups',
    hasInput: true,
    hasOutput: true,
    color: '#0d9488',
    defaults: { gerilim: 400, nominalAkim: 250, diversity: 1, baraUzunluk: 1.5, baraDirenc: 0, isiKonum: 'elektrik' },
    fields: [voltage, rating, diversity, busLength, busResistance, heatField],
    summary: panelSummary,
  },
  {
    type: 'itYuku',
    label: tr.ekipman.itYuku,
    group: 'yuk',
    hasInput: true,
    hasOutput: false,
    color: '#dc2626',
    defaults: { kuruluKw: 100, pf: 0.95, df: 1, kategori: 'IT', gerilim: 400, isiKonum: 'salon' },
    fields: loadFields,
    summary: loadSummary,
  },
  {
    type: 'mekanikYuk',
    label: tr.ekipman.mekanikYuk,
    group: 'yuk',
    hasInput: true,
    hasOutput: false,
    color: '#ea580c',
    defaults: { kuruluKw: 200, pf: 0.85, df: 0.8, kategori: 'Mekanik', gerilim: 400, isiKonum: 'dis' },
    fields: loadFields,
    summary: loadSummary,
  },
  {
    type: 'aydinlatma',
    label: tr.ekipman.aydinlatma,
    group: 'yuk',
    hasInput: true,
    hasOutput: false,
    color: '#ca8a04',
    // Plan yalnız IT/Mekanik kategorisi tanımlıyor; yardımcı yükler şimdilik Mekanik (Açık Soru 6).
    defaults: { kuruluKw: 20, pf: 0.9, df: 0.8, kategori: 'Mekanik', gerilim: 400, isiKonum: 'salon' },
    fields: loadFields,
    summary: loadSummary,
  },
  {
    type: 'genelYuk',
    label: tr.ekipman.genelYuk,
    group: 'yuk',
    hasInput: true,
    hasOutput: false,
    color: '#9333ea',
    defaults: { kuruluKw: 50, pf: 0.9, df: 1, kategori: 'Mekanik', gerilim: 400, isiKonum: 'salon' },
    fields: loadFields,
    summary: loadSummary,
  },
]

/**
 * Bağlantı noktası (port) sayıları: giriş üstte, çıkış altta. Her porta tek hat bağlanır.
 * Varsayılanlar genel tipiktir; ekipman başına "Giriş sayısı / Çıkış sayısı" ile değiştirilir.
 */
export const MAX_PORTS = 24
const PORT_DEFAULTS: Record<EquipmentType, { in: number; out: number }> = {
  sebeke: { in: 0, out: 1 },
  jenerator: { in: 0, out: 1 },
  trafo: { in: 1, out: 1 },
  mdb: { in: 2, out: 6 },
  dagitimPanosu: { in: 1, out: 6 },
  bara: { in: 2, out: 8 },
  ups: { in: 1, out: 1 },
  upsPanosu: { in: 2, out: 6 },
  pdu: { in: 2, out: 6 },
  ats: { in: 2, out: 1 },
  sts: { in: 2, out: 1 },
  senkron: { in: 2, out: 1 },
  kesici: { in: 1, out: 1 },
  yardimci: { in: 1, out: 0 },
  itYuku: { in: 1, out: 0 },
  mekanikYuk: { in: 1, out: 0 },
  aydinlatma: { in: 1, out: 0 },
  genelYuk: { in: 1, out: 0 },
}
for (const d of defs) {
  // Alan dizileri tipler arasında paylaşılabilir (ör. yükler); kopyalayıp ekle.
  const extra: FieldDef[] = []
  if (d.hasInput) {
    d.defaults.girisSayisi = PORT_DEFAULTS[d.type].in
    extra.push(n('girisSayisi', A.girisSayisi, undefined, { min: 1, max: MAX_PORTS, step: 1 }))
  }
  if (d.hasOutput) {
    d.defaults.cikisSayisi = PORT_DEFAULTS[d.type].out
    extra.push(n('cikisSayisi', A.cikisSayisi, undefined, { min: 1, max: MAX_PORTS, step: 1 }))
  }
  d.fields = [...d.fields, ...extra]
}

export const EQUIPMENT: Record<EquipmentType, EquipmentDef> = Object.fromEntries(
  defs.map((d) => [d.type, d]),
) as Record<EquipmentType, EquipmentDef>

export const PALETTE_GROUPS: PaletteGroup[] = ['kaynak', 'dagitim', 'koruma', 'ups', 'yuk']

export function defsInGroup(group: PaletteGroup): EquipmentDef[] {
  return defs.filter((d) => d.group === group)
}

export type PortDir = 'in' | 'out'

/** Ekipmanın giriş (üst) veya çıkış (alt) port sayısı; eski dosyalarda parametre yoksa varsayılan. */
export function portCount(type: EquipmentType, params: Params, dir: PortDir): number {
  const def = EQUIPMENT[type]
  if (dir === 'in' ? !def.hasInput : !def.hasOutput) return 0
  const key = dir === 'in' ? 'girisSayisi' : 'cikisSayisi'
  const v = params[key] ?? def.defaults[key]
  const k = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1
  return Math.min(MAX_PORTS, Math.max(1, k))
}

export const portKey = (dir: PortDir): 'girisSayisi' | 'cikisSayisi' => (dir === 'in' ? 'girisSayisi' : 'cikisSayisi')
