/** Pakette gelen hazır 3D modeller (GLB, src/assets/models): ekipman türüne göre sunulur; seçilince model kütüphanesine alınır ve ekipman kutusu ölçüye ayarlanır. */
export interface PresetModel {
  key: string
  ad: string
  /** Hangi ekipman türlerinde önerilir. */
  kinds: string[]
  /** Ekipman kutusu (m): genişlik, derinlik, yükseklik. */
  g: number
  d: number
  y: number
  /** Kaynak / lisans notu (model kütüphanesinde saklanır). */
  lisans: string
}

const SOCOMEC = 'Socomec Delphys XM — üretici BIM nesnesi (BIM&CO, Revit LOD400\'dan GLB); kullanım koşulları için Socomec/BIM&CO. Servis boşluğu hacimleri gizlenir (önde 0,5 m, arkada 0,5 m, üstte 0,5 m).'

export const PRESET_MODELS: PresetModel[] = [
  { key: 'socomec-delphys-xm', ad: 'Socomec Delphys XM (tek kabin)', kinds: ['ups'], g: 0.8, d: 1.0, y: 2.0, lisans: SOCOMEC },
  { key: 'socomec-delphys-xm-yan-kabin', ad: 'Socomec Delphys XM (yan kabinli)', kinds: ['ups'], g: 1.2, d: 1.0, y: 2.0, lisans: SOCOMEC },
]

export const presetsFor = (kind: string): PresetModel[] => PRESET_MODELS.filter((p) => p.kinds.includes(kind))

/** Hazır modelin model kimliği: kütüphaneye (IndexedDB) kaydı gerekmez, paketteki GLB doğrudan kullanılır; başka bilgisayarda da çalışır. */
export const presetId = (key: string): string => `preset:${key}`
export const presetOfId = (id: unknown): PresetModel | undefined => (typeof id === 'string' ? PRESET_MODELS.find((p) => presetId(p.key) === id) : undefined)

const normAd = (s: string): string => s.toUpperCase().replace(/[\s_]+/g, '.')

/**
 * Veri salonunu besleyen "IT UPS" mu? Şemada "(IT UPS)" notlu veya .1/.2 numaralı UPS'ler (UPS.PL1.1, UPS C2.2); .3 numaralı UPS
 * mekanik/yardımcı ("Essential") yükü besler ve dışarıda kalır.
 */
export function isItUps(n: { type: string; ad: string; etiket?: string }): boolean {
  if (n.type !== 'ups') return false
  const names = [n.ad, n.etiket ?? ''].filter(Boolean)
  if (names.some((a) => /\bIT\s*UPS\b/i.test(a))) return true
  return names.some((a) => /^UPS\.[A-Z0-9]+\.[12](?![0-9])/.test(normAd(a)))
}
