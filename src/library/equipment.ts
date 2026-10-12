import { tr } from '../i18n/tr'
import { fmtLocale } from '../util/numfmt'
import { GEN_START_FAILURE_PCT, RELIABILITY_DEFAULTS } from './reliability'
import type { EquipmentType, Params } from '../model/types'

/**
 * Ekipman kütüphanesi: her tip için varsayılan değerler ve düzenlenebilir alanlar.
 *
 * DİKKAT: Varsayılanlar GENEL TİPİK değerlerdir (50 Hz, 34,5 kV / 400 V).
 * Gerçek proje ekipman verileri girildikçe güncellenmelidir; bkz. docs/PLAN.md
 * "Açık Sorular" 3, 5 ve 6.
 */

export type PaletteGroup = 'kaynak' | 'dagitim' | 'koruma' | 'ups' | 'sogutma' | 'yuk'

/**
 * Soğutma kapasitesi olan ekipmanın rolü: 'produce' soğuk su üretir (chiller), 'air' soğuk suyu salon havasına
 * aktarır (CRAH, fan wall, in-row, RDHx), 'direct' kendi başına soğutur (CRAC/DX). Etkin kapasite:
 * min(üretim, hava tarafı) + doğrudan.
 */
export type CoolingRole = 'produce' | 'air' | 'direct'

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
  /** Soğutma kapasitesi (`sogutmaKw`) olan ekipman için rol. */
  coolingRole?: CoolingRole
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
const fmt = (v: number): string => fmtLocale(v, 2)
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
  n('thd', A.thd, '%', { min: 0, max: 150, step: 1 }),
  n('oncelik', A.oncelik, undefined, { min: 1, max: 5, step: 1 }),
  n('kalkisKat', A.kalkisKat, '× In', { min: 1, max: 10, step: 0.5 }),
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
      eddyOran: 10,
      trafoTur: 'kuru',
    },
    fields: [
      n('nominalKva', A.nominalKva, 'kVA', { min: 0, step: 50 }),
      { kind: 'select', key: 'trafoTur', label: A.trafoTur, options: [
        { value: 'kuru', label: A.trafoKuru },
        { value: 'yagli', label: A.trafoYagli },
      ] },
      n('primerGerilim', A.primerGerilim, 'V', { min: 0 }),
      n('sekonderGerilim', A.sekonderGerilim, 'V', { min: 0 }),
      n('uk', A.uk, '%', { min: 0, step: 0.1 }),
      n('bostaKayip', A.bostaKayip, 'kW', { min: 0, step: 0.1 }),
      n('yukKayip', A.yukKayip, 'kW', { min: 0, step: 0.5 }),
      n('eddyOran', A.eddyOran, '%', { min: 0, max: 100, step: 1 }),
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
    defaults: { nominalKva: 2000, gerilim: 400, pf: 0.8, xd: 15, yakitL: 5000, yakitKullanilabilir: 90 },
    fields: [
      n('nominalKva', A.nominalKva, 'kVA', { min: 0, step: 50 }),
      voltage,
      pf,
      n('xd', A.xd, '%', { min: 0, step: 0.5 }),
      n('yakitL', A.yakitL, 'L', { min: 0, step: 500 }),
      n('yakitKullanilabilir', A.yakitKullanilabilir, '%', { min: 10, max: 100, step: 5 }),
    ],
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
    defaults: { tip: 'ACB', nominalAkim: 1600, kutup: '4P', durum: 'kapali', otomatik: 'yok', gerilim: 400, kesmeKa: 0, korumaModu: 'oto', irOran: 100, trSn: 12, isdKat: 6, tsdSn: 0.3, iiKat: 15 },
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
      n('kesmeKa', A.kesmeKa, 'kA', { min: 0, step: 1 }),
      { kind: 'select', key: 'korumaModu', label: A.korumaModu, options: [
        { value: 'oto', label: A.korumaOto },
        { value: 'ozel', label: A.korumaOzel },
      ] },
      n('irOran', A.irOran, '% In', { min: 40, max: 100, step: 5 }),
      n('trSn', A.trSn, 'sn', { min: 0.5, max: 100, step: 0.5 }),
      n('isdKat', A.isdKat, '× Ir', { min: 0, max: 15, step: 0.5 }),
      n('tsdSn', A.tsdSn, 'sn', { min: 0.05, max: 1, step: 0.05 }),
      n('iiKat', A.iiKat, '× In', { min: 0, max: 40, step: 1 }),
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
      kisaDevreKati: 1.5,
      girisThd: 0,
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
      n('kisaDevreKati', A.kisaDevreKati, '× In', { min: 0, step: 0.1 }),
      n('girisThd', A.girisThd, '%', { min: 0, max: 150, step: 1 }),
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
    defaults: { kuruluKw: 100, pf: 0.95, df: 1, kategori: 'IT', gerilim: 400, isiKonum: 'salon', thd: 0, oncelik: 1, kalkisKat: 1 },
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
    defaults: { kuruluKw: 200, pf: 0.85, df: 0.8, kategori: 'Mekanik', gerilim: 400, isiKonum: 'dis', thd: 0, oncelik: 3, kalkisKat: 5, sogutmaKw: 0 },
    fields: [...loadFields, n('sogutmaKw', A.sogutmaKw, 'kW', { min: 0, step: 10 })],
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
    defaults: { kuruluKw: 20, pf: 0.9, df: 0.8, kategori: 'Mekanik', gerilim: 400, isiKonum: 'salon', thd: 0, oncelik: 3, kalkisKat: 1 },
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
    defaults: { kuruluKw: 50, pf: 0.9, df: 1, kategori: 'Mekanik', gerilim: 400, isiKonum: 'salon', thd: 0, oncelik: 3, kalkisKat: 1 },
    fields: loadFields,
    summary: loadSummary,
  },
]

const coolingField = n('sogutmaKw', A.sogutmaKw, 'kW', { min: 0, step: 10 })

const coolingSummary = (p: Params): string =>
  `${fmt(num(p, 'kuruluKw'))} kW · ${num(p, 'sogutmaKw') > 0 ? `${fmt(num(p, 'sogutmaKw'))} kW soğutma` : `DF ${fmt(num(p, 'df'))}`}`

const gorevField: SelectField = {
  kind: 'select',
  key: 'gorev',
  label: A.gorev,
  options: [
    { value: 'asil', label: A.gorevAsil },
    { value: 'yedek', label: A.gorevYedek },
  ],
}
const copExtra = { defaults: { cop: 0, copEgim: 2.5, copTnom: 35 } as Params, fields: [n('cop', A.cop, undefined, { min: 0, step: 0.1 }), n('copEgim', A.copEgim, '%/K', { min: 0, max: 10, step: 0.1 }), n('copTnom', A.copTnom, '°C', { min: -20, max: 60, step: 1 })] as FieldDef[] }

interface LoadSpec {
  type: EquipmentType
  group: PaletteGroup
  color: string
  kw: number
  pf: number
  df?: number
  kategori?: 'IT' | 'Mekanik'
  isi: 'salon' | 'elektrik' | 'dis'
  /** Termal soğutma kapasitesi (kW); verilirse alan ve rol eklenir. */
  cool?: number
  role?: CoolingRole
  /** Yük atma önceliği (1 = en kritik, 5 = ilk atılan) ve motor kalkış akımı katı (× In). */
  onc: number
  kat: number
  extra?: { defaults: Params; fields: FieldDef[] }
}

/** Soğutma, mekanik ve yardımcı yük ekipmanı: ortak yük alanları + (varsa) soğutma kapasitesi. */
const LOAD_SPECS: LoadSpec[] = [
  {
    type: 'chiller', onc: 2, kat: 3,
    group: 'sogutma',
    color: '#0284c7',
    kw: 250,
    pf: 0.87,
    isi: 'dis',
    cool: 1000,
    role: 'produce',
    extra: {
      defaults: { ...copExtra.defaults, freeCooling: 'yok', fcAlt: 2, fcUst: 10, fcOran: 12 },
      fields: [
        ...copExtra.fields,
        { kind: 'select', key: 'freeCooling', label: A.freeCooling, options: [{ value: 'yok', label: A.freeCoolingYok }, { value: 'var', label: A.freeCoolingVar }] },
        n('fcAlt', A.fcAlt, '°C', { min: -30, max: 40, step: 1 }),
        n('fcUst', A.fcUst, '°C', { min: -30, max: 40, step: 1 }),
        n('fcOran', A.fcOran, '%', { min: 0, max: 100, step: 1 }),
      ],
    },
  },
  { type: 'crah', onc: 2, kat: 2, group: 'sogutma', color: '#0891b2', kw: 12, pf: 0.9, isi: 'salon', cool: 80, role: 'air' },
  { type: 'crac', onc: 2, kat: 5, group: 'sogutma', color: '#0e7490', kw: 30, pf: 0.85, isi: 'dis', cool: 90, role: 'direct', extra: copExtra },
  { type: 'fanwall', onc: 2, kat: 1.5, group: 'sogutma', color: '#06b6d4', kw: 25, pf: 0.95, isi: 'salon', cool: 250, role: 'air' },
  { type: 'inrow', onc: 2, kat: 2, group: 'sogutma', color: '#22d3ee', kw: 6, pf: 0.95, isi: 'salon', cool: 35, role: 'air' },
  { type: 'rdhx', onc: 2, kat: 1, group: 'sogutma', color: '#38bdf8', kw: 1.5, pf: 0.95, isi: 'salon', cool: 30, role: 'air' },
  { type: 'kuruSogutucu', onc: 2, kat: 3, group: 'sogutma', color: '#64748b', kw: 18, pf: 0.85, isi: 'dis', extra: { defaults: { gorev: 'asil' }, fields: [gorevField] } },
  {
    type: 'sogutmaKulesi', onc: 3, kat: 4,
    group: 'sogutma',
    color: '#475569',
    kw: 22,
    pf: 0.85,
    isi: 'dis',
    extra: { defaults: { gorev: 'asil', isiPayi: 100, suTuketimi: 1.8 }, fields: [gorevField, n('isiPayi', A.isiPayi, '%', { min: 0, max: 100, step: 5 }), n('suTuketimi', A.suTuketimi, 'L/kWh', { min: 0, step: 0.1 })] },
  },
  {
    type: 'pompa', onc: 2, kat: 6,
    group: 'sogutma',
    color: '#2563eb',
    kw: 30,
    pf: 0.85,
    isi: 'dis',
    extra: {
      defaults: { pompaTip: 'sogukSu', gorev: 'asil' },
      fields: [
        gorevField,
        {
          kind: 'select',
          key: 'pompaTip',
          label: A.pompaTip,
          options: [
            { value: 'sogukSu', label: A.pompaSogukSu },
            { value: 'kondenser', label: A.pompaKondenser },
            { value: 'yangin', label: A.pompaYangin },
            { value: 'sirkulasyon', label: A.pompaSirkulasyon },
          ],
        },
      ],
    },
  },
  { type: 'ahu', onc: 3, kat: 5, group: 'sogutma', color: '#0d9488', kw: 15, pf: 0.85, isi: 'dis' },
  { type: 'fan', onc: 3, kat: 6, group: 'sogutma', color: '#94a3b8', kw: 5.5, pf: 0.85, isi: 'dis' },
  { type: 'nemlendirici', onc: 4, kat: 1, group: 'sogutma', color: '#7dd3fc', kw: 10, pf: 1, isi: 'salon' },
  { type: 'rack', onc: 1, kat: 1, group: 'yuk', color: '#b91c1c', kw: 80, pf: 0.95, kategori: 'IT', isi: 'salon' },
  { type: 'depolama', onc: 1, kat: 1, group: 'yuk', color: '#c2410c', kw: 20, pf: 0.95, kategori: 'IT', isi: 'salon' },
  { type: 'guvenlik', onc: 1, kat: 1, group: 'yuk', color: '#4f46e5', kw: 4, pf: 0.9, isi: 'elektrik' },
  { type: 'yangin', onc: 1, kat: 1, group: 'yuk', color: '#e11d48', kw: 2, pf: 0.9, isi: 'elektrik' },
  { type: 'asansor', onc: 4, kat: 3, group: 'yuk', color: '#78716c', kw: 18, pf: 0.8, df: 0.5, isi: 'elektrik' },
  { type: 'yukBankasi', onc: 5, kat: 1, group: 'yuk', color: '#a16207', kw: 500, pf: 1, isi: 'dis' },
  { type: 'ofis', onc: 4, kat: 1, group: 'yuk', color: '#7c3aed', kw: 30, pf: 0.9, df: 0.8, isi: 'dis' },
  // Plan (DXF) ile gelen yardımcı ekipman: tipik, küçük bekleme güçleri; gerçek değerler girilene kadar yer tutucudur.
  { type: 'batarya', onc: 1, kat: 1, group: 'yuk', color: '#65a30d', kw: 0, pf: 1, isi: 'elektrik' },
  { type: 'bcp', onc: 1, kat: 1, group: 'yuk', color: '#4d7c0f', kw: 0.3, pf: 0.9, isi: 'elektrik' },
  { type: 'dcPanel', onc: 1, kat: 1, group: 'yuk', color: '#0369a1', kw: 0, pf: 1, isi: 'elektrik' },
  { type: 'telekomDolap', onc: 1, kat: 1, group: 'yuk', color: '#0f766e', kw: 2, pf: 0.95, kategori: 'IT', isi: 'elektrik' },
]

for (const sp of LOAD_SPECS) {
  defs.push({
    type: sp.type,
    label: tr.ekipman[sp.type as keyof typeof tr.ekipman],
    group: sp.group,
    hasInput: true,
    hasOutput: false,
    color: sp.color,
    defaults: {
      kuruluKw: sp.kw,
      pf: sp.pf,
      df: sp.df ?? 1,
      kategori: sp.kategori ?? 'Mekanik',
      gerilim: 400,
      isiKonum: sp.isi,
      thd: 0,
      oncelik: sp.onc,
      kalkisKat: sp.kat,
      ...(sp.cool !== undefined ? { sogutmaKw: sp.cool } : {}),
      ...(sp.extra?.defaults ?? {}),
    },
    fields: [...loadFields, ...(sp.cool !== undefined ? [coolingField] : []), ...(sp.extra?.fields ?? [])],
    summary: sp.cool !== undefined ? coolingSummary : loadSummary,
    coolingRole: sp.role,
  })
}

// Dağıtım: RPP (uzak güç panosu) — PDU benzeri, çok çıkışlı pano.
defs.push({
  type: 'rpp',
  label: tr.ekipman.rpp,
  group: 'ups',
  hasInput: true,
  hasOutput: true,
  color: '#0f766e',
  defaults: { gerilim: 400, nominalAkim: 250, diversity: 1, baraUzunluk: 1.5, baraDirenc: 0, isiKonum: 'elektrik' },
  fields: [voltage, rating, diversity, busLength, busResistance, heatField],
  summary: panelSummary,
})

// OG pano (RMU / MVTB): giriş-çıkış panosu; gerilim OG, kayıp panel kaybı gibi hesaplanır.
defs.push({
  type: 'rmu',
  label: tr.ekipman.rmu,
  group: 'dagitim',
  hasInput: true,
  hasOutput: true,
  color: '#7c2d12',
  defaults: { gerilim: 34500, nominalAkim: 630, diversity: 1, baraUzunluk: 1, baraDirenc: 0, isiKonum: 'elektrik' },
  fields: [voltage, rating, diversity, busLength, busResistance, heatField],
  summary: panelSummary,
})

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
  chiller: { in: 1, out: 0 },
  crah: { in: 1, out: 0 },
  crac: { in: 1, out: 0 },
  fanwall: { in: 1, out: 0 },
  inrow: { in: 1, out: 0 },
  rdhx: { in: 1, out: 0 },
  kuruSogutucu: { in: 1, out: 0 },
  sogutmaKulesi: { in: 1, out: 0 },
  pompa: { in: 1, out: 0 },
  ahu: { in: 1, out: 0 },
  fan: { in: 1, out: 0 },
  nemlendirici: { in: 1, out: 0 },
  rack: { in: 1, out: 0 },
  depolama: { in: 1, out: 0 },
  guvenlik: { in: 1, out: 0 },
  yangin: { in: 1, out: 0 },
  asansor: { in: 1, out: 0 },
  yukBankasi: { in: 1, out: 0 },
  ofis: { in: 1, out: 0 },
  rpp: { in: 2, out: 12 },
  rmu: { in: 1, out: 2 },
  batarya: { in: 1, out: 0 },
  bcp: { in: 1, out: 0 },
  dcPanel: { in: 1, out: 0 },
  telekomDolap: { in: 1, out: 0 },
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
  // Güvenilirlik alanları (MTBF / MTTR): güç zincirindeki ekipmanda; yükler ve ölçü elemanlarında yok.
  const rel = RELIABILITY_DEFAULTS[d.type]
  if (rel) {
    d.defaults.mtbf = rel.mtbf
    d.defaults.mttr = rel.mttr
    extra.push(n('mtbf', A.mtbf, 'saat', { min: 1, step: 1000 }), n('mttr', A.mttr, 'saat', { min: 0.1, step: 1 }))
    if (d.type === 'jenerator') {
      d.defaults.baslamaHata = GEN_START_FAILURE_PCT
      extra.push(n('baslamaHata', A.baslamaHata, '%', { min: 0, max: 100, step: 0.5 }))
    }
  }
  d.fields = [...d.fields, ...extra]
}

export const EQUIPMENT: Record<EquipmentType, EquipmentDef> = Object.fromEntries(
  defs.map((d) => [d.type, d]),
) as Record<EquipmentType, EquipmentDef>

export const PALETTE_GROUPS: PaletteGroup[] = ['kaynak', 'dagitim', 'koruma', 'ups', 'sogutma', 'yuk']

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
