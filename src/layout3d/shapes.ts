import type { EquipmentType } from '../model/types'
import type { Dims } from './dims'

/**
 * Ekipman gösterimi: tür başına basit parametrik kutu/silindir parçaları (gerçekçi model değil, tanınabilir sembol).
 * Koordinatlar ekipmanın yerel çerçevesinde, taban orta (y yukarı) ve ön yüz +z; boyutlar metre.
 */
export interface Part {
  kind: 'box' | 'cyl'
  /** Merkez (x, y, z). Silindirde eksen y'dir. */
  pos: [number, number, number]
  /** Kutu: [g, y, d]; silindir: [çap, yükseklik, çap]. */
  size: [number, number, number]
  /** body: durum rengi; accent: koyu ton; dark: koyu gri; metal: açık gri. */
  tone: 'body' | 'accent' | 'dark' | 'metal'
}

const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number, tone: Part['tone'] = 'body'): Part => ({ kind: 'box', pos: [cx, cy, cz], size: [w, h, d], tone })
const cyl = (cx: number, cy: number, cz: number, dia: number, h: number, tone: Part['tone'] = 'dark'): Part => ({ kind: 'cyl', pos: [cx, cy, cz], size: [dia, h, dia], tone })

export function partsOf(type: EquipmentType, dm: Dims, count = 1): Part[] {
  const { g, d, y } = dm
  switch (type) {
    case 'trafo': {
      const body = box(0, y * 0.4, 0, g * 0.8, y * 0.8, d * 0.8)
      const fins: Part[] = []
      const n = Math.max(3, Math.round(d / 0.25))
      for (let i = 0; i < n; i++) {
        const z = -d * 0.4 + ((i + 0.5) * (d * 0.8)) / n
        fins.push(box(-g * 0.45, y * 0.4, z, g * 0.1, y * 0.7, 0.04, 'accent'), box(g * 0.45, y * 0.4, z, g * 0.1, y * 0.7, 0.04, 'accent'))
      }
      const bushings = [-1, 0, 1].map((k) => cyl(k * g * 0.25, y * 0.8 + y * 0.1, 0, 0.12, y * 0.2, 'metal'))
      return [body, ...fins, ...bushings]
    }
    case 'jenerator':
      return [box(0, y * 0.45, 0, g, y * 0.9, d), box(g * 0.38, y * 0.9 + 0.35, -d * 0.25, 0.25, 0.7, 0.25, 'dark'), box(0, y * 0.45, d / 2 + 0.01, g * 0.9, y * 0.1, 0.02, 'accent')]
    case 'rack':
    case 'itYuku':
    case 'depolama': {
      const out: Part[] = []
      const w = g / count
      for (let i = 0; i < count; i++) {
        const cx = -g / 2 + (i + 0.5) * w
        out.push(box(cx, y / 2, 0, w * 0.94, y, d, 'dark'), box(cx, y / 2, d / 2 + 0.005, w * 0.8, y * 0.85, 0.02, 'body'))
      }
      return out
    }
    case 'chiller': {
      const fans = Math.max(1, Math.round(g / 1.4))
      const out: Part[] = [box(0, y * 0.45, 0, g, y * 0.9, d)]
      for (let i = 0; i < fans; i++) out.push(cyl(-g / 2 + ((i + 0.5) * g) / fans, y * 0.9 + 0.02, 0, Math.min(1.2, (g / fans) * 0.8, d * 0.8), 0.04, 'dark'))
      return out
    }
    case 'kuruSogutucu': {
      const fans = Math.max(1, Math.round(g / 1.2))
      const out: Part[] = [box(0, y * 0.45, 0, g, y * 0.9, d * 0.9, 'accent')]
      for (let i = 0; i < fans; i++) out.push(cyl(-g / 2 + ((i + 0.5) * g) / fans, y * 0.9 + 0.02, 0, Math.min(1, (g / fans) * 0.8), 0.04, 'dark'))
      return out
    }
    case 'sogutmaKulesi':
      return [box(0, y * 0.35, 0, g, y * 0.7, d), cyl(0, y * 0.7 + y * 0.15, 0, Math.min(g, d) * 0.8, y * 0.3, 'metal')]
    case 'fanwall': {
      const fans = Math.max(2, Math.round(g / 0.6))
      const out: Part[] = [box(0, y / 2, 0, g, y, d, 'accent')]
      for (let i = 0; i < fans; i++) out.push(cyl(-g / 2 + ((i + 0.5) * g) / fans, y / 2, d / 2 + 0.02, 0.45, 0.04, 'dark'))
      return out
    }
    case 'crah':
    case 'crac':
    case 'inrow':
    case 'rdhx':
    case 'ahu':
      return [box(0, y / 2, 0, g, y, d), box(0, y + 0.02, 0, g * 0.9, 0.04, d * 0.9, 'metal')]
    case 'pompa':
      return [cyl(-g * 0.25, y * 0.5, 0, Math.min(g, d) * 0.7, y), box(g * 0.25, y * 0.4, 0, g * 0.4, y * 0.8, d * 0.8, 'dark')]
    case 'fan':
      return [cyl(0, y / 2, 0, Math.min(g, d), y)]
    case 'senkron':
    case 'mdb':
    case 'dagitimPanosu':
    case 'upsPanosu':
    case 'rpp':
    case 'pdu':
    case 'ats':
    case 'sts': {
      // Pano sıraları: dolap bölmeleri
      const cells = Math.max(1, Math.round(g / 0.8))
      const out: Part[] = []
      const w = g / cells
      for (let i = 0; i < cells; i++) out.push(box(-g / 2 + (i + 0.5) * w, y / 2, 0, w * 0.97, y, d))
      return out
    }
    case 'ups':
      return [box(0, y / 2, 0, g, y, d), box(0, y * 0.75, d / 2 + 0.01, g * 0.4, y * 0.1, 0.02, 'dark')]
    case 'bara':
      return [box(0, y / 2, 0, g, y, d, 'metal')]
    case 'sebeke':
      return [box(0, y / 2, 0, g, y, d), cyl(0, y + 0.3, 0, 0.1, 0.6, 'metal')]
    default:
      return [box(0, y / 2, 0, g, y, d)]
  }
}
