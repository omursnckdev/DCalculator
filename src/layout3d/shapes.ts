import type { EquipmentType } from '../model/types'
import type { Dims } from './dims'

/**
 * Ekipman gösterimi: tür başına parametrik kutu/silindir parçaları (tanınabilir, ayrıntılı ama hafif). Koordinatlar ekipmanın
 * yerel çerçevesinde, taban orta (y yukarı) ve ön yüz +z; boyutlar metre. Parçalar çizimde iki geometride birleşir.
 * Değerler tipiktir (üretici modeli değildir).
 */
export interface Part {
  kind: 'box' | 'cyl'
  /** Merkez (x, y, z). Silindirde eksen önce y'dir (rot ile yönlendirilir). */
  pos: [number, number, number]
  /** Kutu: [g, y, d]; silindir: [çap, uzunluk, çap]. */
  size: [number, number, number]
  /** Euler dönüşü (radyan, XYZ): ör. yatay silindir için [0, 0, π/2] (x ekseni), [π/2, 0, 0] (z ekseni). */
  rot?: [number, number, number]
  /**
   * body: durum rengi; accent: durum renginin koyusu; dark: koyu gri; metal: açık gri; glass: ekran/cam;
   * led: gösterge ışığı (yeşil); warn: uyarı/etiket (amber); red: ON/acil durdurma/alarm; white: etiket plakası; copper: bakır bara.
   */
  tone: 'body' | 'accent' | 'dark' | 'metal' | 'glass' | 'led' | 'warn' | 'red' | 'white' | 'copper'
}

type Tone = Part['tone']
const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number, tone: Tone = 'body', rot?: [number, number, number]): Part => ({ kind: 'box', pos: [cx, cy, cz], size: [w, h, d], tone, ...(rot ? { rot } : {}) })
const cyl = (cx: number, cy: number, cz: number, dia: number, h: number, tone: Tone = 'dark', rot?: [number, number, number]): Part => ({ kind: 'cyl', pos: [cx, cy, cz], size: [dia, h, dia], tone, ...(rot ? { rot } : {}) })
const HALF = Math.PI / 2
const AX_X: [number, number, number] = [0, 0, HALF] // silindir ekseni x
const AX_Z: [number, number, number] = [HALF, 0, 0] // silindir ekseni z

/** Üstte döşenen fan ızgarası: çerçeve halkası + koruma + göbek. */
function fanTop(cx: number, cz: number, dia: number, y: number): Part[] {
  return [cyl(cx, y + 0.06, cz, dia, 0.12, 'metal'), cyl(cx, y + 0.13, cz, dia * 0.92, 0.02, 'dark'), cyl(cx, y + 0.15, cz, dia * 0.22, 0.04, 'metal')]
}

/**
 * Pano sıraları: kaide ve havalandırma yarıkları, bölme başına kapı (çerçeve, iç pano, menteşe, kol + kilit), ölçü penceresi,
 * gösterge ışıkları, etiket plakası, alt panjur, tavan (kaldırma gözleri, kablo kanalı) ve bara bölmesi izi.
 */
function panel(g: number, d: number, y: number, minCell = 0.8): Part[] {
  const cells = Math.max(1, Math.round(g / minCell))
  const w = g / cells
  const f = d / 2
  const out: Part[] = [box(0, 0.06, 0, g, 0.12, d, 'dark'), box(0, y + 0.03, 0, g * 1.0, 0.06, d * 1.0, 'dark')]
  // Tavan: kaldırma gözleri + üst kablo kanalı + bakır bara izi
  out.push(box(0, y + 0.1, -d * 0.18, g * 0.92, 0.08, d * 0.34, 'dark'), box(0, y + 0.065, d * 0.22, g * 0.94, 0.012, 0.03, 'copper'))
  for (const sx of [-1, 1]) out.push(cyl(sx * (g / 2 - 0.12), y + 0.08, f - 0.12, 0.07, 0.04, 'metal'))
  for (let i = 0; i < cells; i++) {
    const cx = -g / 2 + (i + 0.5) * w
    const mid = 0.12 + (y - 0.12) / 2
    out.push(
      box(cx, mid, 0, w * 0.985, y - 0.12, d),
      // Kapı: dış çerçeve (vurgu) ve içerideki hafif kabarık pano
      box(cx, mid, f + 0.006, w * 0.94, (y - 0.16) * 0.97, 0.012, 'accent'),
      box(cx, mid, f + 0.014, w * 0.86, (y - 0.28) * 0.93, 0.008),
      // Menteşeler (sol kenar)
      ...[0.2, 0.5, 0.82].map((k) => cyl(cx - w * 0.47, y * k, f + 0.014, 0.03, 0.12, 'metal')),
      // Kol + kilit
      box(cx + w * 0.38, y * 0.5, f + 0.032, 0.03, 0.32, 0.026, 'metal'),
      cyl(cx + w * 0.38, y * 0.5 - 0.23, f + 0.026, 0.045, 0.022, 'dark', AX_Z),
      // Ölçü penceresi ve gösterge ışıkları
      box(cx - w * 0.1, y * 0.9, f + 0.022, w * 0.5, 0.16, 0.012, 'glass'),
      box(cx + w * 0.3, y * 0.915, f + 0.022, 0.035, 0.035, 0.012, 'led'),
      box(cx + w * 0.3, y * 0.885, f + 0.022, 0.035, 0.035, 0.012, 'warn'),
      box(cx + w * 0.3, y * 0.855, f + 0.022, 0.035, 0.035, 0.012, 'red'),
      // Etiket plakası (üst) ve metin çizgileri
      box(cx - w * 0.06, y * 0.805, f + 0.02, w * 0.62, 0.05, 0.008, 'white'),
      box(cx - w * 0.14, y * 0.805, f + 0.026, w * 0.36, 0.012, 0.004, 'dark'),
      // Alt panjur
      ...[0, 1, 2, 3].map((k) => box(cx, 0.2 + k * 0.045, f + 0.016, w * 0.6, 0.016, 0.008, 'dark')),
    )
  }
  // Bölmeler arası dikey derz
  for (let i = 1; i < cells; i++) out.push(box(-g / 2 + i * w, 0.12 + (y - 0.12) / 2, f + 0.01, 0.012, y - 0.16, 0.016, 'dark'))
  return out
}

/** Soğuk su klimaları, in-row, AHU: dolap + ızgara + ekran + üst boru bağlantıları. */
function airUnit(g: number, d: number, y: number): Part[] {
  return [
    box(0, 0.04, 0, g * 0.98, 0.08, d * 0.98, 'dark'),
    box(0, 0.08 + (y - 0.08) / 2, 0, g, y - 0.08, d),
    box(0, y * 0.72, d / 2 + 0.008, g * 0.82, y * 0.34, 0.016, 'dark'),
    box(0, y * 0.38, d / 2 + 0.008, g * 0.82, y * 0.2, 0.016, 'accent'),
    box(g * 0.3, y * 0.5, d / 2 + 0.014, Math.min(0.3, g * 0.3), 0.12, 0.012, 'glass'),
    box(g * 0.4, y * 0.5 - 0.1, d / 2 + 0.014, 0.04, 0.04, 0.012, 'led'),
    cyl(-g * 0.25, y + 0.15, -d * 0.3, 0.08, 0.3, 'metal'),
    cyl(-g * 0.1, y + 0.15, -d * 0.3, 0.08, 0.3, 'metal'),
  ]
}

export function partsOf(type: EquipmentType, dm: Dims, count = 1, variant = ''): Part[] {
  const { g, d, y } = dm
  switch (type) {
    case 'trafo': {
      const th = y * 0.62
      const base = 0.12
      const out: Part[] = [box(0, base / 2, 0, g * 0.95, base, d * 0.95, 'dark'), box(0, base + th / 2, 0, g * 0.62, th, d * 0.78), box(0, base + th + 0.02, 0, g * 0.66, 0.04, d * 0.82, 'metal')]
      const n = Math.max(3, Math.round(d / 0.22))
      for (let i = 0; i < n; i++) {
        const z = -d * 0.36 + ((i + 0.5) * (d * 0.72)) / n
        for (const sx of [-1, 1]) out.push(box(sx * (g * 0.31 + g * 0.1), base + th * 0.52, z, g * 0.16, th * 0.86, 0.03, 'accent'))
      }
      for (const sx of [-1, 1]) {
        out.push(cyl(sx * (g * 0.31 + g * 0.1), base + th * 0.94, 0, 0.07, d * 0.72, 'metal', AX_Z), cyl(sx * (g * 0.31 + g * 0.1), base + th * 0.1, 0, 0.07, d * 0.72, 'metal', AX_Z))
      }
      // Konservatör (genleşme tankı) ve yüksek/alçak gerilim geçitleri
      out.push(cyl(0, base + th + 0.3, -d * 0.1, 0.3, d * 0.6, 'accent', AX_Z), box(-g * 0.2, base + th + 0.15, -d * 0.1, 0.05, 0.25, 0.05, 'dark'), box(g * 0.2, base + th + 0.15, -d * 0.1, 0.05, 0.25, 0.05, 'dark'))
      for (const k of [-1, 0, 1]) {
        out.push(cyl(k * g * 0.18, base + th + 0.2, d * 0.16, 0.1, 0.4, 'metal'), cyl(k * g * 0.18, base + th + 0.45, d * 0.16, 0.14, 0.06, 'metal'))
        out.push(cyl(k * g * 0.18, base + th + 0.12, d * 0.3, 0.07, 0.24, 'dark'))
      }
      out.push(box(0, base + th * 0.5, d * 0.39 + 0.012, g * 0.22, 0.14, 0.02, 'warn'), box(g * 0.18, base + th * 0.82, d * 0.39 + 0.01, 0.12, 0.12, 0.02, 'glass'))
      // Gerilim kademe anahtarı kutusu + kadran, yağ seviye göstergesi, plaka, buchholz rölesi, topraklama, tekerlekler
      out.push(box(-g * 0.22, base + th * 0.55, d * 0.39 + 0.03, 0.24, 0.3, 0.05, 'dark'), cyl(-g * 0.22, base + th * 0.58, d * 0.39 + 0.06, 0.16, 0.02, 'glass', AX_Z), box(-g * 0.22, base + th * 0.58, d * 0.39 + 0.075, 0.012, 0.07, 0.006, 'red'))
      out.push(cyl(g * 0.18, base + th * 0.6, d * 0.39 + 0.02, 0.14, 0.02, 'glass', AX_Z), box(0, base + th * 0.25, d * 0.39 + 0.012, g * 0.3, 0.1, 0.012, 'white'), box(0, base + th * 0.25, d * 0.39 + 0.02, g * 0.2, 0.014, 0.006, 'dark'))
      out.push(cyl(0, base + th + 0.2, d * 0.02, 0.12, 0.22, 'warn', AX_Z), box(-g * 0.46, base + 0.1, d * 0.3, 0.04, 0.1, 0.06, 'metal'))
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(cyl(sx * g * 0.38, 0.05, sz * d * 0.34, 0.1, 0.06, 'dark', AX_X))
      return out
    }
    case 'jenerator': {
      const sk = 0.34
      const hh = y - sk - 0.06
      const out: Part[] = [box(0, sk / 2, 0, g, sk, d, 'dark'), box(0, sk + hh / 2, 0, g * 0.98, hh, d * 0.98), box(0, y - 0.03, 0, g, 0.06, d, 'accent')]
      // Radyatör ucu
      out.push(box(g / 2 + 0.03, sk + hh * 0.5, 0, 0.12, hh * 0.9, d * 0.82, 'dark'), box(g / 2 + 0.1, sk + hh * 0.5, 0, 0.02, hh * 0.84, d * 0.74, 'metal'))
      // Havalandırma panjurları ve kapı derzleri
      for (let i = 0; i < 6; i++) out.push(box(-g * 0.16, sk + 0.3 + i * 0.12, d / 2 + 0.012, g * 0.42, 0.03, 0.02, 'dark'))
      for (const x of [-g * 0.4, g * 0.05, g * 0.3]) out.push(box(x, sk + hh / 2, d / 2 + 0.01, 0.02, hh * 0.9, 0.02, 'dark'))
      out.push(box(-g * 0.38, sk + hh * 0.55, d / 2 + 0.014, 0.5, 0.35, 0.02, 'glass'), box(-g * 0.38, sk + hh * 0.3, d / 2 + 0.014, 0.12, 0.12, 0.02, 'led'))
      out.push(box(g * 0.17, sk + hh * 0.5, d / 2 + 0.03, 0.03, 0.2, 0.03, 'metal'), box(g * 0.42, sk + hh * 0.5, d / 2 + 0.03, 0.03, 0.2, 0.03, 'metal'))
      // Egzoz susturucusu ve bacası, uyarı lambası
      out.push(cyl(-g * 0.22, y + 0.24, -d * 0.2, 0.46, g * 0.34, 'metal', AX_X), cyl(-g * 0.06, y + 0.7, -d * 0.2, 0.2, 0.9, 'dark'), cyl(g * 0.3, y + 0.08, d * 0.3, 0.14, 0.14, 'warn'))
      // Yakıt dolum / kablo giriş
      out.push(box(-g / 2 - 0.02, sk * 0.5, d * 0.25, 0.04, 0.2, 0.3, 'warn'))
      // Kontrol paneli: ekran, tuşlar, acil durdurma (kırmızı mantar), LED'ler; yakıt tankı şeridi, etiket, akü kutusu, fan koruması
      out.push(box(-g * 0.38, sk + hh * 0.78, d / 2 + 0.024, 0.46, 0.16, 0.012, 'dark'), box(-g * 0.38, sk + hh * 0.78, d / 2 + 0.03, 0.34, 0.1, 0.008, 'glass'))
      out.push(...[0, 1, 2, 3].map((k) => box(-g * 0.38 - 0.15 + k * 0.1, sk + hh * 0.66, d / 2 + 0.03, 0.06, 0.03, 0.01, k === 3 ? 'red' : 'metal')))
      out.push(cyl(-g * 0.38 + 0.18, sk + hh * 0.3, d / 2 + 0.04, 0.09, 0.04, 'red', AX_Z), box(-g * 0.38 + 0.18, sk + hh * 0.3, d / 2 + 0.022, 0.13, 0.13, 0.01, 'warn'))
      out.push(box(0, sk * 0.5, d / 2 + 0.012, g * 0.6, sk * 0.5, 0.012, 'warn'), box(g * 0.17, sk + hh * 0.82, d / 2 + 0.02, 0.4, 0.08, 0.008, 'white'))
      out.push(box(g * 0.36, sk + 0.18, d / 2 + 0.05, 0.35, 0.3, 0.1, 'dark'), cyl(g / 2 + 0.115, sk + hh * 0.5, 0, Math.min(d, hh) * 0.62, 0.02, 'dark', AX_X))
      return out
    }
    case 'ups': {
      const f = d / 2
      const out: Part[] = [
        box(0, 0.05, 0, g * 0.98, 0.1, d * 0.98, 'dark'),
        box(0, 0.1 + (y - 0.1) / 2, 0, g, y - 0.1, d),
        box(0, y * 0.5, f + 0.006, g * 0.92, y * 0.84, 0.012, 'accent'),
        // Ekran ve tuş takımı
        box(0, y * 0.8, f + 0.014, Math.min(0.4, g * 0.38), 0.22, 0.012, 'glass'),
        ...[-1, 0, 1].map((k) => box(k * 0.075, y * 0.8 - 0.19, f + 0.016, 0.05, 0.03, 0.01, k === 0 ? 'warn' : 'led')),
        ...[-1, 0, 1, 2].map((k) => box(k * 0.06 - 0.03, y * 0.8 - 0.25, f + 0.016, 0.045, 0.025, 0.01, k === 2 ? 'red' : 'metal')),
        // Durum LED şeridi: şebeke / evirici / bypass / batarya / alarm
        ...(['led', 'led', 'led', 'warn', 'red'] as const).map((t, k) => box(-g * 0.3 + k * 0.05, y * 0.66, f + 0.014, 0.03, 0.03, 0.01, t)),
        box(g * 0.38, y * 0.5, f + 0.025, 0.03, 0.22, 0.03, 'metal'),
        // Kapı derzi (modül/batarya bölmesi), alt panjur, etiket
        box(0, y * 0.3, f + 0.012, g * 0.5, 0.24, 0.012, 'dark'),
        box(0, y * 0.5, f + 0.012, 0.012, y * 0.82, 0.014, 'dark'),
        box(0, y * 0.12, f + 0.016, g * 0.4, 0.05, 0.008, 'white'),
        ...[0, 1, 2, 3].map((k) => box(0, y * 0.2 + k * 0.035, f + 0.016, g * 0.36, 0.014, 0.008, 'dark')),
        // Üst havalandırma ızgarası ve fan
        ...Array.from({ length: 6 }, (_, i) => box(-g * 0.34 + i * (g * 0.136), y + 0.006, 0, 0.04, 0.012, d * 0.7, 'dark')),
      ]
      return out
    }
    case 'mdb':
    case 'dagitimPanosu':
    case 'upsPanosu':
    case 'rpp':
    case 'pdu':
    case 'ats':
    case 'sts':
    case 'senkron':
      return panel(g, d, y, type === 'mdb' || type === 'senkron' ? 0.8 : 0.6)
    case 'itYuku':
    case 'rack':
    case 'depolama': {
      const out: Part[] = [box(0, y + 0.04, 0, g, 0.08, Math.min(d, 0.35), 'dark')] // kablo tavası
      const w = g / count
      for (let i = 0; i < count; i++) {
        const cx = -g / 2 + (i + 0.5) * w
        out.push(box(cx, y / 2, 0, w * 0.96, y, d, 'dark'), box(cx, y / 2, d / 2 + 0.01, w * 0.84, y * 0.9, 0.02))
        for (let k = 0; k < 6; k++) out.push(box(cx, y * 0.18 + k * (y * 0.13), d / 2 + 0.022, w * 0.7, 0.02, 0.01, 'dark'))
        // Sunucu önleri (metal çerçeve + durum LED'i) ve alt kapak
        for (let k = 0; k < 8; k++) {
          const sy = y * 0.12 + k * (y * 0.095)
          out.push(box(cx, sy, d / 2 + 0.03, w * 0.66, y * 0.07, 0.012, 'metal'), box(cx - w * 0.26, sy, d / 2 + 0.038, 0.016, 0.016, 0.006, k % 5 === 3 ? 'warn' : 'led'))
        }
        out.push(box(cx + w * 0.34, y * 0.5, d / 2 + 0.03, 0.02, 0.2, 0.02, 'metal'), box(cx - w * 0.3, y * 0.94, d / 2 + 0.022, 0.03, 0.03, 0.01, 'led'), box(cx - w * 0.22, y * 0.94, d / 2 + 0.022, 0.03, 0.03, 0.01, 'led'))
      }
      return out
    }
    case 'chiller': {
      const fans = Math.max(1, Math.round(g / 1.4))
      const hb = y * 0.78
      const out: Part[] = [box(0, 0.1, 0, g, 0.2, d * 0.98, 'dark'), box(0, 0.2 + hb / 2, 0, g * 0.98, hb, d * 0.98)]
      for (const sz of [-1, 1]) {
        out.push(box(0, 0.2 + hb * 0.5, sz * (d / 2 + 0.01), g * 0.9, hb * 0.8, 0.02, 'dark'))
        const ribs = Math.max(4, Math.round(g / 0.45))
        for (let i = 0; i < ribs; i++) out.push(box(-g * 0.45 + ((i + 0.5) * g * 0.9) / ribs, 0.2 + hb * 0.5, sz * (d / 2 + 0.02), 0.03, hb * 0.8, 0.01, 'accent'))
      }
      for (let i = 0; i < fans; i++) out.push(...fanTop(-g / 2 + ((i + 0.5) * g) / fans, 0, Math.min(1.2, (g / fans) * 0.8, d * 0.8), 0.2 + hb))
      out.push(box(g / 2 + 0.03, 0.2 + hb * 0.55, d * 0.2, 0.06, hb * 0.55, 0.5, 'accent'), box(g / 2 + 0.065, 0.2 + hb * 0.65, d * 0.2, 0.01, 0.2, 0.3, 'glass'), box(g / 2 + 0.065, 0.2 + hb * 0.45, d * 0.2, 0.01, 0.05, 0.05, 'led'))
      out.push(cyl(-g / 2 + 0.5, 0.45, -d / 2 - 0.2, 0.3, 0.4, 'metal', AX_Z), cyl(-g / 2 + 1, 0.45, -d / 2 - 0.2, 0.3, 0.4, 'metal', AX_Z))
      return out
    }
    case 'kuruSogutucu': {
      const fans = Math.max(1, Math.round(g / 1.2))
      const out: Part[] = []
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(cyl(sx * (g / 2 - 0.1), 0.35, sz * (d / 2 - 0.1), 0.12, 0.7, 'dark'))
      out.push(box(0, 0.75, 0, g, 0.1, d * 0.96, 'dark'))
      for (const sz of [-1, 1]) out.push(box(0, 0.75 + y * 0.28, sz * d * 0.2, g * 0.98, y * 0.56, 0.1, 'accent', [-sz * 0.45, 0, 0]))
      for (let i = 0; i < fans; i++) out.push(...fanTop(-g / 2 + ((i + 0.5) * g) / fans, 0, Math.min(1, (g / fans) * 0.8), 0.75 + y * 0.5))
      out.push(cyl(g / 2 + 0.1, 0.9, 0, 0.2, d * 0.7, 'metal', AX_Z))
      return out
    }
    case 'sogutmaKulesi': {
      const hb = y * 0.58
      const out: Part[] = [box(0, 0.35, 0, g, 0.7, d, 'dark'), box(0, 0.7 + hb / 2, 0, g * 0.96, hb, d * 0.96)]
      const ribs = Math.max(5, Math.round(g / 0.35))
      for (const sz of [-1, 1]) for (let i = 0; i < ribs; i++) out.push(box(-g * 0.45 + ((i + 0.5) * g * 0.9) / ribs, 0.7 + hb / 2, sz * (d * 0.48 + 0.01), 0.04, hb * 0.86, 0.02, 'accent'))
      const dia = Math.min(g, d) * 0.72
      out.push(cyl(0, 0.7 + hb + y * 0.12, 0, dia, y * 0.24, 'metal'), cyl(0, 0.7 + hb + y * 0.24 + 0.02, 0, dia * 0.9, 0.04, 'dark'), cyl(0, 0.7 + hb + y * 0.24 + 0.06, 0, dia * 0.2, 0.08, 'metal'))
      out.push(box(g / 2 + 0.03, 0.7 + hb / 2, 0, 0.04, hb, 0.2, 'metal'), cyl(0, 0.45, d / 2 + 0.2, 0.25, 0.4, 'metal', AX_Z))
      return out
    }
    case 'fanwall': {
      const fans = Math.max(2, Math.round(g / 0.6))
      const out: Part[] = [box(0, y / 2, 0, g, y, d, 'accent')]
      for (let i = 0; i < fans; i++) {
        const cx = -g / 2 + ((i + 0.5) * g) / fans
        for (let r = 0; r < Math.max(1, Math.round(y / 0.7)); r++) {
          const cy = ((r + 0.5) * y) / Math.max(1, Math.round(y / 0.7))
          out.push(cyl(cx, cy, d / 2 + 0.02, Math.min(0.5, g / fans - 0.04), 0.04, 'dark', AX_Z), cyl(cx, cy, d / 2 + 0.045, 0.1, 0.05, 'metal', AX_Z))
        }
      }
      return out
    }
    case 'crah':
    case 'crac':
    case 'inrow':
    case 'rdhx':
    case 'ahu':
      return airUnit(g, d, y)
    case 'pompa':
      return [
        box(0, 0.04, 0, g, 0.08, d, 'dark'),
        cyl(-g * 0.22, 0.28, 0, 0.32, g * 0.4, 'accent', AX_X),
        box(-g * 0.22, 0.46, 0, 0.1, 0.1, 0.1, 'dark'),
        cyl(g * 0.18, 0.28, 0, 0.42, 0.22, 'metal', AX_Z),
        cyl(g * 0.18, 0.6, 0, 0.12, 0.5, 'metal'),
        cyl(g * 0.38, 0.42, 0, 0.1, 0.5, 'metal', AX_X),
      ]
    case 'fan':
      return [box(0, 0.04, 0, g, 0.08, d, 'dark'), cyl(0, y / 2, 0, Math.min(g, d), y, 'accent', AX_Z), cyl(0, y / 2, d / 2 + 0.01, Math.min(g, d) * 0.9, 0.02, 'dark', AX_Z), cyl(0, y / 2, d / 2 + 0.03, 0.14, 0.05, 'metal', AX_Z)]
    case 'nemlendirici':
      return [box(0, 0.04, 0, g, 0.08, d, 'dark'), box(0, y * 0.45, 0, g * 0.96, y * 0.9, d * 0.96), cyl(g * 0.2, y + 0.15, 0, 0.08, 0.3, 'metal'), box(0, y * 0.7, d / 2 + 0.01, 0.2, 0.1, 0.012, 'glass')]
    case 'rmu': {
      // OG halka ana birimi: kaide, 3 hücre (kapak, mimik şema, kol girişi, topraklama kolu), gösterge, kablo bölmesi kapağı
      const cells = Math.max(2, Math.min(4, Math.round(g / 0.45)))
      const w = g / cells
      const out: Part[] = [box(0, 0.06, 0, g, 0.12, d, 'dark'), box(0, y + 0.03, 0, g, 0.06, d, 'dark')]
      for (let i = 0; i < cells; i++) {
        const cx = -g / 2 + (i + 0.5) * w
        out.push(
          box(cx, 0.12 + (y - 0.12) / 2, 0, w * 0.98, y - 0.12, d),
          box(cx, y * 0.62, d / 2 + 0.008, w * 0.88, y * 0.52, 0.016, 'accent'),
          box(cx, y * 0.68, d / 2 + 0.02, w * 0.5, 0.14, 0.012, 'glass'),
          cyl(cx - w * 0.2, y * 0.5, d / 2 + 0.03, 0.06, 0.04, 'metal', AX_Z),
          cyl(cx + w * 0.2, y * 0.5, d / 2 + 0.03, 0.06, 0.04, 'red', AX_Z),
          box(cx, y * 0.4, d / 2 + 0.02, w * 0.7, 0.04, 0.012, 'warn'),
          box(cx, y * 0.2, d / 2 + 0.012, w * 0.86, y * 0.22, 0.016, 'dark'),
          box(cx + w * 0.3, y * 0.88, d / 2 + 0.02, 0.04, 0.04, 0.012, 'led'),
        )
      }
      return out
    }
    case 'batarya': {
      // Akü dolabı: iki kanatlı kapı, havalandırma yarıkları, durum ışıkları, plaka
      const half = g / 2
      return [
        box(0, 0.05, 0, g * 0.98, 0.1, d * 0.98, 'dark'),
        box(0, 0.1 + (y - 0.1) / 2, 0, g, y - 0.1, d),
        box(-half / 2, y * 0.52, d / 2 + 0.008, half * 0.9, y * 0.86, 0.016, 'accent'),
        box(half / 2, y * 0.52, d / 2 + 0.008, half * 0.9, y * 0.86, 0.016, 'accent'),
        box(0, y * 0.52, d / 2 + 0.012, 0.01, y * 0.86, 0.016, 'dark'),
        ...[0, 1, 2, 3, 4].map((k) => box(-half / 2, 0.25 + k * 0.045, d / 2 + 0.018, half * 0.6, 0.014, 0.008, 'dark')),
        ...[0, 1, 2, 3, 4].map((k) => box(half / 2, 0.25 + k * 0.045, d / 2 + 0.018, half * 0.6, 0.014, 0.008, 'dark')),
        box(-0.06, y * 0.86, d / 2 + 0.02, 0.04, 0.04, 0.012, 'led'),
        box(0.06, y * 0.86, d / 2 + 0.02, 0.04, 0.04, 0.012, 'warn'),
        box(0, y * 0.72, d / 2 + 0.02, g * 0.4, 0.06, 0.008, 'white'),
        box(g * 0.38, y * 0.5, d / 2 + 0.028, 0.025, 0.2, 0.025, 'metal'),
      ]
    }
    case 'bcp':
    case 'dcPanel': {
      // Küçük kontrol/DC panosu: ekran, ölçü, butonlar, LED'ler, kol
      return [
        box(0, 0.05, 0, g * 0.98, 0.1, d * 0.98, 'dark'),
        box(0, 0.1 + (y - 0.1) / 2, 0, g, y - 0.1, d),
        box(0, y * 0.52, d / 2 + 0.008, g * 0.88, y * 0.86, 0.016, 'accent'),
        box(0, y * 0.78, d / 2 + 0.02, g * 0.6, 0.18, 0.012, 'glass'),
        ...[-1, 0, 1].map((k) => box(k * 0.18, y * 0.62, d / 2 + 0.02, 0.08, 0.05, 0.012, k === 1 ? 'red' : 'metal')),
        ...[-1, 0, 1].map((k) => box(k * 0.12, y * 0.55, d / 2 + 0.02, 0.04, 0.04, 0.012, k === 0 ? 'warn' : 'led')),
        box(0, y * 0.35, d / 2 + 0.02, g * 0.5, 0.08, 0.008, 'white'),
        box(g * 0.36, y * 0.45, d / 2 + 0.03, 0.025, 0.24, 0.025, 'metal'),
      ]
    }
    case 'telekomDolap': {
      // Telekom/ODF dolabı: delikli kapı, yama paneli şeritleri, LED'ler, kilit
      const out: Part[] = [box(0, 0.04, 0, g, 0.08, d, 'dark'), box(0, 0.08 + (y - 0.08) / 2, 0, g, y - 0.08, d, 'dark'), box(0, y * 0.5, d / 2 + 0.01, g * 0.9, y * 0.92, 0.02)]
      const rows = Math.max(3, Math.round(y / 0.18))
      for (let k = 0; k < rows; k++) out.push(box(0, 0.2 + k * ((y - 0.4) / rows), d / 2 + 0.022, g * 0.74, 0.03, 0.01, k % 3 === 2 ? 'metal' : 'dark'))
      out.push(box(g * 0.36, y * 0.5, d / 2 + 0.03, 0.02, 0.2, 0.02, 'metal'), box(-g * 0.3, y * 0.95, d / 2 + 0.022, 0.03, 0.03, 0.01, 'led'), box(-g * 0.18, y * 0.95, d / 2 + 0.022, 0.03, 0.03, 0.01, 'warn'))
      return out
    }
    case 'yukBankasi': {
      const fans = Math.max(1, Math.round(g / 0.9))
      const out: Part[] = [box(0, 0.08, 0, g, 0.16, d, 'dark'), box(0, 0.16 + (y - 0.16) / 2, 0, g * 0.98, y - 0.16, d * 0.98)]
      for (let i = 0; i < fans; i++) out.push(...fanTop(-g / 2 + ((i + 0.5) * g) / fans, 0, Math.min(0.8, (g / fans) * 0.8), y))
      for (let i = 0; i < 5; i++) out.push(box(0, 0.3 + i * 0.16, d / 2 + 0.012, g * 0.8, 0.04, 0.02, 'dark'))
      return out
    }
    case 'ofis':
      return [
        box(0, 0.1, 0, g, 0.2, d, 'dark'),
        box(0, 0.2 + (y - 0.2) / 2, 0, g, y - 0.2, d),
        ...[-0.3, 0.1].map((k) => box(g * k, y * 0.6, d / 2 + 0.01, g * 0.25, y * 0.28, 0.02, 'glass')),
        box(g * 0.38, y * 0.45, d / 2 + 0.012, 0.4, y * 0.6, 0.02, 'accent'),
        box(0, y + 0.03, 0, g * 1.02, 0.06, d * 1.02, 'dark'),
      ]
    case 'asansor':
      return [box(0, y / 2, 0, g, y, d, 'metal'), box(0, y * 0.45, d / 2 + 0.01, g * 0.5, y * 0.8, 0.02, 'dark'), box(0, y * 0.45, d / 2 + 0.02, 0.02, y * 0.8, 0.01, 'metal')]
    case 'aydinlatma':
      return [box(0, y / 2, 0, g, y, d, 'led')]
    case 'guvenlik':
      return [box(0, y / 2, 0, g, y, d), box(0, y * 0.7, d / 2 + 0.01, g * 0.6, y * 0.25, 0.02, 'glass'), box(0, y + 0.03, 0, g * 1.05, 0.06, d * 1.05, 'dark')]
    case 'yangin':
      return [box(0, y / 2, 0, g, y, d, 'warn'), box(0, y * 0.6, d / 2 + 0.01, g * 0.5, y * 0.3, 0.01, 'glass')]
    case 'mekanikYuk':
      return [box(0, 0.05, 0, g, 0.1, d, 'dark'), box(0, 0.1 + (y - 0.1) * 0.35, 0, g * 0.8, (y - 0.1) * 0.7, d * 0.9), cyl(g * 0.28, y * 0.8, 0, 0.5, 0.5, 'accent', AX_X), cyl(-g * 0.3, y * 0.4, d * 0.2, 0.15, y * 0.8, 'metal')]
    case 'bara': {
      const out: Part[] = [box(0, y / 2, 0, g, y * 0.6, d * 0.8, 'metal')]
      const n = Math.max(2, Math.round(g / 1.2))
      for (let i = 0; i <= n; i++) out.push(box(-g / 2 + (i * g) / n, y / 2, 0, 0.05, y * 0.9, d, 'accent'))
      return out
    }
    case 'sebeke':
      return [
        box(0, y / 2, 0, g, y, d),
        ...[-1, 0, 1].map((k) => cyl(k * g * 0.28, y + 0.12, -d * 0.2, 0.1, 0.25, 'metal')),
        box(0, y * 0.55, d / 2 + 0.01, g * 0.7, y * 0.3, 0.02, 'accent'),
        box(0, y * 0.8, d / 2 + 0.012, g * 0.3, 0.14, 0.012, 'warn'),
      ]
    case 'kesici': {
      // Panoya oturan modül. variant: ACB | MCCB | Ayırıcı, isteğe bağlı "|acik" (kesici açık konumda)
      const [v0, st] = (variant || 'ACB').split('|')
      const v = v0 || 'ACB'
      const open = st === 'acik'
      const f = d / 2
      if (v === 'MCCB') {
        const lever = open ? y * 0.5 : y * 0.7
        return [
          box(0, y / 2, 0, g, y, d, 'accent'),
          box(0, y * 0.5, f + 0.004, g * 0.92, y * 0.94, 0.008, 'dark'),
          box(0, y * 0.9, f + 0.011, g * 0.74, y * 0.08, 0.006, 'white'),
          box(-g * 0.1, y * 0.9, f + 0.016, g * 0.36, y * 0.025, 0.004, 'dark'),
          box(0, y * 0.62, f + 0.014, g * 0.56, y * 0.26, 0.012, 'metal'),
          box(0, lever, f + 0.04, g * 0.2, y * 0.15, 0.04, 'dark'),
          box(0, lever + (open ? -1 : 1) * y * 0.08, f + 0.04, g * 0.2, y * 0.025, 0.042, open ? 'led' : 'red'),
          ...[-1, 1].flatMap((sx) => [cyl(sx * g * 0.24, y * 0.3, f + 0.017, 0.07, 0.02, 'metal', AX_Z), box(sx * g * 0.24, y * 0.3, f + 0.028, 0.012, 0.045, 0.004, 'warn')]),
          cyl(0, y * 0.13, f + 0.016, 0.045, 0.02, 'red', AX_Z),
          box(0, y * 0.045, f + 0.011, g * 0.72, 0.026, 0.006, 'white'),
          ...[-1, 0, 1].map((k) => cyl(k * g * 0.28, y + 0.012, 0, 0.035, 0.024, 'metal')),
        ]
      }
      if (v === 'Ayırıcı') {
        const hw = g * 0.62
        return [
          box(0, y / 2, 0, g, y, d, 'accent'),
          box(0, y * 0.5, f + 0.004, g * 0.92, y * 0.94, 0.008, 'dark'),
          box(0, y * 0.9, f + 0.011, g * 0.74, y * 0.07, 0.006, 'white'),
          cyl(0, y * 0.56, f + 0.016, g * 0.66, 0.02, 'warn', AX_Z),
          cyl(0, y * 0.56, f + 0.032, g * 0.14, 0.03, 'metal', AX_Z),
          // Döner kol: kapalıda yatay, açıkta dikey
          box(0, y * 0.56, f + 0.05, open ? 0.07 : hw, open ? hw : 0.07, 0.04, 'red'),
          box(0, y * 0.2, f + 0.02, g * 0.4, 0.045, 0.02, 'metal'),
          cyl(0, y * 0.2, f + 0.035, 0.05, 0.03, 'dark', AX_Z),
          ...[-1, 1].map((sx) => box(sx * g * 0.32, y + 0.02, 0, 0.05, 0.04, 0.05, 'metal')),
        ]
      }
      const f2 = f
      return [
        box(0, y / 2, 0, g, y, d, 'accent'),
        // Çerçeve, üst etiket
        box(0, y * 0.5, f2 + 0.006, g * 0.96, y * 0.96, 0.012, 'dark'),
        box(0, y * 0.935, f2 + 0.014, g * 0.86, y * 0.07, 0.008, 'white'),
        box(-g * 0.12, y * 0.935, f2 + 0.019, g * 0.4, y * 0.025, 0.004, 'dark'),
        // Açma birimi: ekran + rakam LED'leri + tuşlar + durum ışıkları
        box(0, y * 0.78, f2 + 0.016, g * 0.6, y * 0.14, 0.01, 'glass'),
        ...[-1, 0, 1].map((k) => box(k * g * 0.14, y * 0.78, f2 + 0.023, g * 0.08, y * 0.06, 0.006, 'led')),
        ...[-1, 0, 1, 2].map((k) => box(-g * 0.18 + (k + 1) * g * 0.12, y * 0.67, f2 + 0.02, g * 0.09, y * 0.032, 0.01, 'metal')),
        box(g * 0.36, y * 0.8, f2 + 0.02, 0.025, 0.025, 0.006, 'led'),
        box(g * 0.36, y * 0.75, f2 + 0.02, 0.025, 0.025, 0.006, 'warn'),
        box(g * 0.36, y * 0.7, f2 + 0.02, 0.025, 0.025, 0.006, 'red'),
        // Yay durumu penceresi (şarjlı sarı) ve konum göstergesi (ON kırmızı / OFF yeşil)
        box(-g * 0.2, y * 0.55, f2 + 0.013, g * 0.34, y * 0.085, 0.008, 'glass'),
        box(-g * 0.2, y * 0.55, f2 + 0.018, g * 0.26, y * 0.05, 0.008, 'warn'),
        box(g * 0.2, y * 0.55, f2 + 0.016, g * 0.26, y * 0.07, 0.01, open ? 'led' : 'red'),
        // Aç / kapa butonları ve etiketleri
        cyl(-g * 0.2, y * 0.41, f2 + 0.02, 0.07, 0.03, 'led', AX_Z),
        cyl(g * 0.2, y * 0.41, f2 + 0.02, 0.07, 0.03, 'red', AX_Z),
        box(-g * 0.2, y * 0.34, f2 + 0.016, 0.07, 0.016, 0.006, 'white'),
        box(g * 0.2, y * 0.34, f2 + 0.016, 0.07, 0.016, 0.006, 'white'),
        // Şarj kolu ve plaka
        box(0, y * 0.23, f2 + 0.035, g * 0.34, 0.05, 0.04, 'metal'),
        cyl(g * 0.19, y * 0.23, f2 + 0.035, 0.05, 0.05, 'dark', AX_Z),
        box(0, y * 0.095, f2 + 0.014, g * 0.7, y * 0.1, 0.008, 'metal'),
        box(0, y * 0.095, f2 + 0.019, g * 0.5, 0.012, 0.004, 'dark'),
        // Çekmece rayları (yanlarda), ark odası delikleri (üstte), kutup uçları (arkada)
        ...[-1, 1].map((sx) => box(sx * (g / 2 + 0.006), y * 0.5, 0, 0.014, y * 0.08, d * 0.95, 'metal')),
        ...Array.from({ length: 5 }, (_, k) => box(-g * 0.3 + k * g * 0.15, y + 0.003, 0, 0.03, 0.006, d * 0.7, 'dark')),
        ...[-1, 0, 1].flatMap((k) => [box(k * g * 0.28, y + 0.04, -d * 0.25, 0.07, 0.08, 0.03, 'metal'), box(k * g * 0.28, 0.03, -d * 0.3, 0.07, 0.05, 0.04, 'metal')]),
      ]
    }
    case 'yardimci': {
      // Ölçü/koruma elemanı (CT, sayaç, parafudr): gövde, çerçeveli kadran (skala çizgileri + ibre), vidalar, klemensler
      const f = d / 2
      const r = Math.min(g, y) * 0.78
      const out: Part[] = [box(0, y / 2, 0, g, y, d, 'accent'), cyl(0, y * 0.52, f + 0.008, r, 0.016, 'dark', AX_Z), cyl(0, y * 0.52, f + 0.017, r * 0.88, 0.012, 'white', AX_Z)]
      for (let k = 0; k < 7; k++) {
        const a = -1 + k * (2 / 6)
        out.push(box(Math.sin(a) * r * 0.36, y * 0.52 + Math.cos(a) * r * 0.36, f + 0.025, 0.008, r * 0.1, 0.004, k > 4 ? 'red' : 'dark', [0, 0, -a]))
      }
      out.push(box(Math.sin(0.35) * r * 0.16, y * 0.52 + Math.cos(0.35) * r * 0.16, f + 0.03, 0.01, r * 0.34, 0.005, 'red', [0, 0, -0.35]), cyl(0, y * 0.52, f + 0.032, r * 0.1, 0.012, 'metal', AX_Z))
      for (const sx of [-1, 1]) for (const sy of [0.1, 0.94]) out.push(cyl(sx * g * 0.42, y * sy, f + 0.01, 0.018, 0.012, 'metal', AX_Z))
      out.push(box(-g * 0.2, 0.02, 0, 0.04, 0.04, 0.05, 'metal'), box(g * 0.2, 0.02, 0, 0.04, 0.04, 0.05, 'metal'))
      return out
    }
    default:
      return [box(0, y / 2, 0, g, y, d)]
  }
}
