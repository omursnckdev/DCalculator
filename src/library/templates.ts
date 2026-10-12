import { EQUIPMENT } from './equipment'
import { DEFAULT_LINE, emptyProject } from '../model/project'
import type { EquipmentType, Params, Project, ProjectEdge, ProjectNode } from '../model/types'

/**
 * Hazır topoloji şablonları. Değerler tipik/varsayımdır (IT 400 kW'lık küçük bir salon);
 * kendi tesisinize göre düzenleyin.
 */
export interface TemplateInfo {
  id: string
  ad: string
  aciklama: string
  build: () => Project
}

class Builder {
  nodes: ProjectNode[] = []
  edges: ProjectEdge[] = []
  private inUse = new Map<string, number>()
  private outUse = new Map<string, number>()

  n(id: string, type: EquipmentType, ad: string, x: number, y: number, params: Params = {}, grup = ''): string {
    this.nodes.push({ id, type, ad, etiket: '', grup, notlar: '', x, y, params: { ...EQUIPMENT[type].defaults, ...params } })
    return id
  }

  e(source: string, target: string, over: { cap?: number; len?: number; pay?: number | null; durum?: 'kapali' | 'acik'; ad?: string; tip?: 'kablo' | 'busbar'; gerilim?: number; r?: number } = {}): void {
    const kp = this.outUse.get(source) ?? 0
    const hp = this.inUse.get(target) ?? 0
    this.outUse.set(source, kp + 1)
    this.inUse.set(target, hp + 1)
    const src = this.nodes.find((x) => x.id === source)!
    const v = (src.params.sekonderGerilim ?? src.params.cikisGerilim ?? src.params.gerilim) as number
    this.edges.push({
      ...DEFAULT_LINE,
      id: `${source}>${target}`,
      source,
      target,
      tip: over.tip ?? 'kablo',
      uzunluk: over.len ?? 15,
      akimKapasitesi: over.cap ?? 2000,
      r: over.r ?? 0.02,
      x: 0.02,
      gerilim: over.gerilim ?? v,
      pay: over.pay ?? null,
      durum: over.durum ?? 'kapali',
      ad: over.ad ?? '',
      kaynakPort: kp,
      hedefPort: hp,
    })
  }

  build(name: string): Project {
    // Kullanılan port sayısına göre ekipmanın giriş/çıkış sayısını ayarla.
    for (const n of this.nodes) {
      const usedIn = this.inUse.get(n.id) ?? 0
      const usedOut = this.outUse.get(n.id) ?? 0
      if (EQUIPMENT[n.type].hasInput) n.params.girisSayisi = Math.max(1, usedIn)
      if (EQUIPMENT[n.type].hasOutput) n.params.cikisSayisi = Math.max(1, usedOut)
    }
    return { ...emptyProject(name), nodes: this.nodes, edges: this.edges }
  }
}

const TX = { nominalKva: 1000, primerGerilim: 34500, sekonderGerilim: 400, uk: 6, bostaKayip: 1.5, yukKayip: 11 }
const GEN = { nominalKva: 1000, gerilim: 400, pf: 0.8 }
const UPS = { nominalKva: 500, nominalKw: 450, girisGerilim: 400, cikisGerilim: 400, verim: 96, bataryaDk: 10 }
const IT = { kuruluKw: 400, pf: 0.95, df: 1, kategori: 'IT', gerilim: 400, isiKonum: 'salon' }
const CHILLER = { kuruluKw: 150, pf: 0.85, df: 0.9, kategori: 'Mekanik', gerilim: 400, isiKonum: 'dis', sogutmaKw: 450 }

/** Tek hat: şebeke → TX → MDB → UPS → IT; yedeklilik yok (N). */
function singleLine(): Project {
  const b = new Builder()
  b.n('g', 'sebeke', 'Şebeke', 0, 0, { gerilim: 34500, kisaDevreMva: 500 })
  b.n('tx', 'trafo', 'TX', 0, 120, TX)
  b.n('mdb', 'mdb', 'MDB', 0, 260, { nominalAkim: 2000, genislik: 360 })
  b.n('ups', 'ups', 'UPS', -120, 400, UPS)
  b.n('ups-pnl', 'upsPanosu', 'UPS dağıtım panosu', -120, 540, { nominalAkim: 1000 })
  b.n('it', 'itYuku', 'IT yükü', -120, 680, IT)
  b.n('chiller', 'mekanikYuk', 'Chiller', 140, 400, CHILLER)
  b.e('g', 'tx', { cap: 100, gerilim: 34500, r: 0.1 })
  b.e('tx', 'mdb', { cap: 2000, tip: 'busbar' })
  b.e('mdb', 'ups', { cap: 1000 })
  b.e('ups', 'ups-pnl', { cap: 1000 })
  b.e('ups-pnl', 'it', { cap: 1000 })
  b.e('mdb', 'chiller', { cap: 600 })
  return b.build('Şablon: tek hat (N)')
}

/** Yedek jeneratörlü, N+1 UPS ve N+1 soğutma (Tier II/III benzeri tek yol). */
function genN1(): Project {
  const b = new Builder()
  b.n('g', 'sebeke', 'Şebeke', 0, 0, { gerilim: 34500, kisaDevreMva: 500 })
  b.n('tx', 'trafo', 'TX', 0, 120, TX)
  b.n('gen1', 'jenerator', 'GEN-1', 160, 0, GEN)
  b.n('gen2', 'jenerator', 'GEN-2', 320, 0, GEN)
  b.n('sync', 'senkron', 'Senkron panosu', 240, 120, { nominalAkim: 2000, mod: 'sirali', esik: 70 })
  b.n('mdb', 'mdb', 'MDB', 120, 260, { nominalAkim: 2000, genislik: 460 })
  b.n('ups1', 'ups', 'UPS-1', -60, 400, UPS)
  b.n('ups2', 'ups', 'UPS-2', 100, 400, UPS)
  b.n('ups-pnl', 'upsPanosu', 'UPS dağıtım panosu', 20, 540, { nominalAkim: 1000 })
  b.n('it', 'itYuku', 'IT yükü', 20, 680, IT)
  b.n('ch1', 'mekanikYuk', 'Chiller-1', 280, 400, CHILLER)
  b.n('ch2', 'mekanikYuk', 'Chiller-2', 420, 400, CHILLER)
  b.e('g', 'tx', { cap: 100, gerilim: 34500, r: 0.1 })
  b.e('tx', 'mdb', { cap: 2000, tip: 'busbar' })
  b.e('gen1', 'sync', { cap: 2000 })
  b.e('gen2', 'sync', { cap: 2000 })
  b.e('sync', 'mdb', { cap: 2000, tip: 'busbar' })
  b.e('mdb', 'ups1', { cap: 800 })
  b.e('mdb', 'ups2', { cap: 800 })
  b.e('ups1', 'ups-pnl', { cap: 800 })
  b.e('ups2', 'ups-pnl', { cap: 800 })
  b.e('ups-pnl', 'it', { cap: 1000 })
  b.e('mdb', 'ch1', { cap: 600 })
  b.e('mdb', 'ch2', { cap: 600 })
  return b.build('Şablon: jeneratörlü N+1')
}

/** 2N: iki bağımsız yol (şebeke → TX → ATS(jeneratör) → MDB → UPS → PDU), çift kablolu IT, N+1 soğutma. */
function twoN(): Project {
  const b = new Builder()
  for (const [s, x] of [['a', 0], ['b', 520]] as const) {
    const S = s.toUpperCase()
    b.n(`g${s}`, 'sebeke', `Şebeke ${S}`, x, 0, { gerilim: 34500, kisaDevreMva: 500 }, `Yol ${S}`)
    b.n(`tx${s}`, 'trafo', `TX ${S}`, x, 120, TX, `Yol ${S}`)
    b.n(`gen${s}`, 'jenerator', `GEN ${S}`, x + 160, 120, GEN, `Yol ${S}`)
    b.n(`ats${s}`, 'ats', `ATS ${S}`, x + 60, 260, { nominalAkim: 2000 }, `Yol ${S}`)
    b.n(`mdb${s}`, 'mdb', `MDB ${S}`, x + 60, 400, { nominalAkim: 2000, genislik: 220 }, `Yol ${S}`)
    b.n(`ups${s}`, 'ups', `UPS ${S}`, x + 20, 540, UPS, `Yol ${S}`)
    b.n(`pdu${s}`, 'pdu', `PDU ${S}`, x + 20, 680, { nominalAkim: 1000 }, `Yol ${S}`)
    b.n(`ch${s}`, 'mekanikYuk', `Chiller ${S}`, x + 200, 540, CHILLER, `Yol ${S}`)
    b.e(`g${s}`, `tx${s}`, { cap: 100, gerilim: 34500, r: 0.1 })
    b.e(`tx${s}`, `ats${s}`, { cap: 2000, pay: 100 })
    b.e(`gen${s}`, `ats${s}`, { cap: 2000, pay: 0 })
    b.e(`ats${s}`, `mdb${s}`, { cap: 2000, tip: 'busbar' })
    b.e(`mdb${s}`, `ups${s}`, { cap: 800 })
    b.e(`ups${s}`, `pdu${s}`, { cap: 800 })
    b.e(`mdb${s}`, `ch${s}`, { cap: 600 })
  }
  b.n('it', 'itYuku', 'IT yükü (2N)', 270, 820, IT)
  b.e('pdua', 'it', { cap: 800 })
  b.e('pdub', 'it', { cap: 800 })
  return b.build('Şablon: 2N tam yedekli')
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'tek-hat', ad: 'Tek hat (N)', aciklama: 'Şebeke → trafo → MDB → UPS → IT, tek chiller. Yedeklilik yok.', build: singleLine },
  { id: 'jenerator-n1', ad: 'Jeneratörlü N+1 (Tier II/III benzeri)', aciklama: 'Şebeke + 2 jeneratör (senkron panosu), 2 UPS (N+1), 2 chiller (N+1).', build: genN1 },
  { id: 'iki-n', ad: '2N tam yedekli (Tier IV benzeri)', aciklama: 'İki bağımsız yol (trafo + ATS + jeneratör + UPS), çift kablolu IT yükü, her yolda chiller.', build: twoN },
]
