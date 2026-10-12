import { EQUIPMENT } from '../library/equipment'
import type { EquipmentType, OdaTuru, Params, ProjectNode } from '../model/types'

/**
 * Ekipman 3D boyutları (metre): genişlik (x) × derinlik (z) × yükseklik (y). Değerler **tipik yer tutucudur**
 * (model/üretici verisi değildir); düğümde `yerlesim3d.g/d/y` ile geçersiz kılınabilir.
 */
export interface Dims {
  g: number
  d: number
  y: number
}

const num = (p: Params, key: string, type: EquipmentType): number => {
  const v = p[key] ?? EQUIPMENT[type].defaults[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r1 = (v: number) => Math.round(v * 10) / 10

/** Rack sırasında kabin sayısı: IT yükü ÷ tipik 7 kW/kabin (yeni parametre yok). */
export function rackCount(n: Pick<ProjectNode, 'type' | 'params'>): number {
  if (n.type !== 'rack' && n.type !== 'itYuku' && n.type !== 'depolama') return 1
  return clamp(Math.round(num(n.params, 'kuruluKw', n.type) / 7), 1, 30)
}

/** Kesici modülü boyutu (tipe göre, panoya oturan ön plaka): [genişlik, derinlik, yükseklik] m. */
function breakerDims(tip: string): Dims {
  if (tip === 'MCCB') return { g: 0.26, d: 0.14, y: 0.32 }
  if (tip === 'Ayırıcı') return { g: 0.3, d: 0.16, y: 0.4 }
  return { g: 0.5, d: 0.22, y: 0.62 }
}

export function defaultDims(n: Pick<ProjectNode, 'type' | 'params'>): Dims {
  const p = n.params
  const t = n.type
  const kva = num(p, 'nominalKva', t)
  switch (t) {
    case 'sebeke':
      return { g: 1.2, d: 1.2, y: 2.4 }
    case 'trafo':
      return { g: r1(0.9 + kva * 0.00052), d: r1(0.8 + kva * 0.00032), y: r1(1.2 + kva * 0.0004) }
    case 'jenerator':
      return { g: r1(2.5 + kva * 0.00175), d: r1(1.6 + kva * 0.0004), y: r1(2 + kva * 0.0003) }
    case 'mdb':
      return { g: r1(clamp(1.6 + num(p, 'nominalAkim', t) * 0.0006, 1.6, 8)), d: 0.8, y: 2.2 }
    case 'dagitimPanosu':
      return { g: 1.2, d: 0.6, y: 2 }
    case 'bara':
      return { g: 3, d: 0.4, y: 0.4 }
    case 'ups':
      return { g: r1(clamp(0.8 + kva * 0.0008, 0.8, 4)), d: 0.9, y: 2 }
    case 'upsPanosu':
      return { g: 1.2, d: 0.8, y: 2.2 }
    case 'pdu':
    case 'ats':
    case 'sts':
      return { g: 0.8, d: 0.8, y: 2 }
    case 'rpp':
      return { g: 0.8, d: 0.6, y: 2 }
    case 'kesici':
      return breakerDims(String(p.tip ?? EQUIPMENT.kesici.defaults.tip ?? 'ACB'))
    case 'yardimci':
      return { g: 0.22, d: 0.12, y: 0.22 }
    case 'senkron':
      return { g: 2.4, d: 0.8, y: 2.2 }
    case 'itYuku':
    case 'rack':
    case 'depolama':
      return { g: r1(rackCount(n) * 0.6), d: 1.2, y: 2.2 }
    case 'mekanikYuk':
      return { g: 1.5, d: 1, y: 1.5 }
    case 'aydinlatma':
      return { g: 0.6, d: 0.6, y: 0.3 }
    case 'genelYuk':
      return { g: 1, d: 1, y: 1 }
    case 'chiller':
      return { g: r1(clamp(2 + num(p, 'sogutmaKw', t) * 0.004, 2.5, 12)), d: 2.4, y: 2.6 }
    case 'crah':
      return { g: r1(clamp(0.6 + num(p, 'sogutmaKw', t) * 0.004, 0.6, 3)), d: 0.9, y: 2 }
    case 'crac':
      return { g: 0.9, d: 0.9, y: 2 }
    case 'fanwall':
      return { g: 3, d: 0.6, y: 3 }
    case 'inrow':
      return { g: 0.3, d: 1.2, y: 2.2 }
    case 'rdhx':
      return { g: 0.6, d: 0.15, y: 2.2 }
    case 'kuruSogutucu':
      return { g: 4, d: 2, y: 2 }
    case 'sogutmaKulesi':
      return { g: 3, d: 3, y: 4 }
    case 'pompa':
      return { g: 1, d: 0.6, y: 0.8 }
    case 'ahu':
      return { g: 3, d: 1.5, y: 1.8 }
    case 'fan':
      return { g: 0.8, d: 0.8, y: 0.8 }
    case 'nemlendirici':
      return { g: 0.6, d: 0.6, y: 1 }
    case 'guvenlik':
      return { g: 0.6, d: 0.6, y: 1.8 }
    case 'yangin':
      return { g: 0.5, d: 0.2, y: 0.7 }
    case 'asansor':
      return { g: 1.5, d: 1.5, y: 2.5 }
    case 'yukBankasi':
      return { g: 2, d: 1, y: 1.5 }
    case 'rmu':
      return { g: 1, d: 1.3, y: 1.8 }
    case 'batarya':
      return { g: 1.5, d: 0.8, y: 2 }
    case 'bcp':
    case 'dcPanel':
      return { g: 0.8, d: 0.8, y: 2 }
    case 'telekomDolap':
      return { g: 0.6, d: 1.2, y: 2.2 }
    case 'ofis':
      return { g: 2, d: 1.5, y: 2.2 }
    default:
      return { g: 1, d: 1, y: 1 }
  }
}

/** Düğümün etkin boyutu: kullanıcı geçersiz kılması varsa o, yoksa tür varsayılanı. */
export function dimsOf(n: Pick<ProjectNode, 'type' | 'params' | 'yerlesim3d'>): Dims {
  const d = defaultDims(n)
  const o = n.yerlesim3d
  return { g: o?.g ?? d.g, d: o?.d ?? d.d, y: o?.y ?? d.y }
}

/** Servis boşluğu (m): ön (yerel +z) ve arka. Yalnız gösterim içindir; çakışma sayılmaz. */
export function clearanceOf(type: EquipmentType): { front: number; back: number } {
  if (type === 'kesici' || type === 'yardimci' || type === 'aydinlatma' || type === 'bara' || type === 'yangin') return { front: 0, back: 0 }
  if (type === 'trafo' || type === 'jenerator' || type === 'chiller' || type === 'sogutmaKulesi' || type === 'kuruSogutucu') return { front: 1.5, back: 1 }
  return { front: 1, back: 0.6 }
}

/** Isıyı bıraktığı yer / tür → oda türü. */
export function zoneOf(n: Pick<ProjectNode, 'type' | 'params'>): OdaTuru {
  if (n.type === 'jenerator') return 'jenerator'
  const v = n.params.isiKonum ?? EQUIPMENT[n.type].defaults.isiKonum
  return v === 'salon' ? 'salon' : v === 'dis' ? 'dis' : 'elektrik'
}

/** Küçük, ana ekipmana bağlı sayılan elemanlar (şemada çok, 3D'de gruplanır). */
export const isMinor = (t: EquipmentType): boolean => t === 'kesici' || t === 'yardimci'
