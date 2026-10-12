import { coolingKw, coolingRole, chainGroup, isDuty } from '../engine/coolingUnits'
import type { Analysis } from '../engine/types'
import type { Boru3D, BoruTuru, Nokta3D, ProjectNode } from '../model/types'
import { dimsOf } from './dims'

// --- hidrolik ---------------------------------------------------------------------------

/** Standart boru iç çapları (DN, mm). */
export const STD_DN = [32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 500, 600] as const

/** Su ısıl kapasitesi: cp = 4,186 kJ/(kg·K), ρ = 1000 kg/m³ → debi (L/sn) = kW / (4,186 · ΔT). */
export const flowLps = (kw: number, dT = 5): number => (dT > 0 ? kw / (4.186 * dT) : 0)

/** Hızı vmax (m/sn) altında tutan en küçük standart DN. */
export function dnFor(lps: number, vmax = 2.5): number {
  if (lps <= 0) return STD_DN[0]
  const q = lps / 1000 // m³/sn
  const dmm = Math.sqrt((4 * q) / (Math.PI * vmax)) * 1000
  return STD_DN.find((d) => d >= dmm) ?? STD_DN[STD_DN.length - 1]
}

/** Ortalama hız, m/sn. */
export const velocity = (lps: number, dn: number): number => (dn > 0 ? lps / 1000 / ((Math.PI * (dn / 1000) ** 2) / 4) : 0)

/** Darcy–Weisbach ile 100 m başına basınç kaybı, kPa (sürtünme katsayısı 0,02; su). Yerel kayıplar dahil değildir. */
export function pressureDropKpaPer100m(lps: number, dn: number): number {
  const v = velocity(lps, dn)
  const D = dn / 1000
  return D > 0 ? (0.02 * (100 / D) * 500 * v * v) / 1000 : 0
}

export function boruLength(b: Pick<Boru3D, 'noktalar'>): number {
  let s = 0
  for (let i = 1; i < b.noktalar.length; i++) {
    const p = b.noktalar[i - 1]
    const q = b.noktalar[i]
    s += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
  }
  return s
}

/** Isı atım hattında taşınan ısı: soğutma yükü + kompresör gücü (≈ 1,25 × soğutma). */
const REJECT_FACTOR = 1.25

export interface PipeHydraulics {
  lps: number
  dn: number
  velocity: number
  dpKpa: number
}

export function hydraulicsOf(b: Boru3D): PipeHydraulics {
  const lps = flowLps(b.kw)
  const dn = b.dnElle ? b.dn : dnFor(lps)
  return { lps, dn, velocity: velocity(lps, dn), dpKpa: (pressureDropKpaPer100m(lps, dn) * boruLength(b)) / 100 }
}

/** Boru hattı çalışıyor mu: üretici (chiller) enerjili ve (pompa tanımlıysa) en az bir pompa enerjili. */
export function pipeLive(b: Pick<Boru3D, 'uretici' | 'pompalar'>, a: Analysis): boolean {
  const on = (id: string) => !!a.nodes[id]?.energized && !a.nodes[id]?.failed
  const prod = b.uretici.length === 0 || b.uretici.some(on)
  const pump = b.pompalar.length === 0 || b.pompalar.some(on)
  return prod && pump
}

// --- otomatik boru ağı ------------------------------------------------------------------

export interface PipeNode {
  node: ProjectNode
  x: number
  z: number
  /** Ekipman üst yüzeyi, m. */
  top: number
}

const CHILLED_BASE = 3.8
const CONDENSER_BASE = 4.6
const RETURN_DROP = 0.3

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

interface LoopSpec {
  tur: BoruTuru
  label: string
  producers: PipeNode[]
  pumps: PipeNode[]
  consumers: PipeNode[]
  /** Hat başına yük, kW. */
  kwOf: (p: PipeNode) => number
  base: number
}

function buildLoop(spec: LoopSpec, nextId: () => string): Boru3D[] {
  const all = [...spec.producers, ...spec.pumps, ...spec.consumers]
  if (all.length < 2 || spec.producers.length === 0 || spec.consumers.length === 0) return []
  const maxTop = Math.max(...all.map((p) => p.top))
  const ySupply = Math.max(spec.base, maxTop + 0.5)
  const yReturn = ySupply - RETURN_DROP
  const zs = median(spec.consumers.map((p) => p.z))
  const xs = all.map((p) => p.x)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const total = spec.consumers.reduce((s, p) => s + spec.kwOf(p), 0)
  const prodX = spec.producers.reduce((s, p) => s + p.x, 0) / spec.producers.length
  const consX = spec.consumers.reduce((s, p) => s + p.x, 0) / spec.consumers.length
  const ltr = prodX <= consX // besleme yönü: üreticiden tüketiciye (x ekseninde)
  const uretici = spec.producers.map((p) => p.node.id)
  const pompalar = spec.pumps.map((p) => p.node.id)
  const out: Boru3D[] = []
  const mk = (ad: string, yon: 'besleme' | 'donus', kw: number, pts: Nokta3D[]): void => {
    const ordered = yon === 'besleme' ? pts : [...pts].reverse()
    out.push({ id: nextId(), ad, tur: spec.tur, yon, dn: dnFor(flowLps(kw)), kw, noktalar: ordered, uretici, pompalar, otomatik: true })
  }
  for (const yon of ['besleme', 'donus'] as const) {
    const y = yon === 'besleme' ? ySupply : yReturn
    const tag = yon === 'besleme' ? 'Besleme' : 'Dönüş'
    // Omurga: besleme üreticiden tüketiciye (dönüş ters)
    const spine: Nokta3D[] = ltr ? [{ x: x0, y, z: zs }, { x: x1, y, z: zs }] : [{ x: x1, y, z: zs }, { x: x0, y, z: zs }]
    mk(`${spec.label} ${tag} omurga`, yon, total, spine)
    for (const p of spec.producers) {
      // Üretici bacağı: besleme ekipmandan omurgaya (yukarı), dönüş omurgadan ekipmana
      mk(`${spec.label} ${tag}: ${p.node.ad}`, yon, spec.kwOf(p), [{ x: p.x, y: p.top, z: p.z }, { x: p.x, y, z: p.z }, { x: p.x, y, z: zs }])
    }
    for (const p of spec.pumps) {
      mk(`${spec.label} ${tag}: ${p.node.ad}`, yon, total / Math.max(1, spec.pumps.filter((q) => isDuty(q.node)).length || spec.pumps.length), [{ x: p.x, y: p.top, z: p.z }, { x: p.x, y, z: p.z }, { x: p.x, y, z: zs }])
    }
    for (const p of spec.consumers) {
      // Tüketici bacağı (besleme yönü): omurgadan ekipmana; dönüşte mk ters çevirir
      mk(`${spec.label} ${tag}: ${p.node.ad}`, yon, spec.kwOf(p), [{ x: p.x, y, z: zs }, { x: p.x, y, z: p.z }, { x: p.x, y: p.top, z: p.z }])
    }
  }
  return out
}

/**
 * Soğutma boru ağını yerleşimden üretir: (1) soğuk su devresi: chiller → pompalar → hava tarafı birimleri (CRAH, fan wall,
 * in-row, RDHx, AHU); (2) kondenser/ısı atım devresi: chiller → pompalar → kuru soğutucu / soğutma kulesi. Her devre bir omurga
 * ve ekipman bacaklarından oluşur; besleme ve dönüş ayrı kotlarda üst üste çizilir. Debi: Q = P / (4,186·ΔT), ΔT = 5 K; DN: hız ≤ 2,5 m/sn.
 * Ön tasarım amaçlıdır; gerçek boru güzergâhı ve hidrolik hesap (yerel kayıplar, vana, pompa eğrisi) ayrıca yapılmalıdır.
 */
export function autoPipes(nodes: ProjectNode[], nextId: () => string): Boru3D[] {
  const items: PipeNode[] = nodes
    .filter((n) => n.yerlesim3d)
    .map((n) => {
      const l = n.yerlesim3d!
      return { node: n, x: l.x, z: l.z, top: (l.elev ?? 0) + dimsOf(n).y }
    })
  const role = (p: PipeNode) => coolingRole(p.node)
  const chillers = items.filter((p) => p.node.type === 'chiller')
  const airUnits = items.filter((p) => ['crah', 'fanwall', 'inrow', 'rdhx', 'ahu'].includes(p.node.type) && coolingKw(p.node) > 0 && role(p) === 'air')
  const coldPumps = items.filter((p) => chainGroup(p.node) === 'sogukSu')
  const condPumps = items.filter((p) => chainGroup(p.node) === 'kondenser')
  const reject = items.filter((p) => chainGroup(p.node) === 'atim')
  const out: Boru3D[] = []
  out.push(...buildLoop({ tur: 'sogukSu', label: 'Soğuk su', producers: chillers, pumps: coldPumps, consumers: airUnits, kwOf: (p) => coolingKw(p.node) || 0, base: CHILLED_BASE }, nextId))
  const chillerKw = (p: PipeNode) => coolingKw(p.node) * REJECT_FACTOR
  const rejectKw = (p: PipeNode) => {
    const c = coolingKw(p.node)
    // Isı atım ekipmanında kapasite girilmemişse: bağlı chillerların toplam ısı atımı eşit paylaşılır.
    return c > 0 ? c : chillers.reduce((s, ch) => s + chillerKw(ch), 0) / Math.max(1, reject.length)
  }
  out.push(...buildLoop({ tur: 'kondenser', label: 'Kondenser', producers: chillers, pumps: condPumps, consumers: reject, kwOf: (p) => (p.node.type === 'chiller' ? chillerKw(p) : rejectKw(p)), base: CONDENSER_BASE }, nextId))
  return out
}
