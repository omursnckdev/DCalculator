/** Proje genelinde ayarlar: yük profili, enerji tarifesi ve soğutma parametreleri (şema v7). */
export interface ProjectSettings {
  /** 24 saatlik IT yükü çarpanı, % (peak = 100). */
  profilIt: number[]
  /** 24 saatlik mekanik yük çarpanı, %. */
  profilMek: number[]
  /** Elektrik birim fiyatı, para birimi/kWh. */
  tarife: number
  /** Para birimi etiketi. */
  para: string
  /** Hedef PUE (tasarruf karşılaştırması). */
  hedefPue: number
  /** Veri salonu hava hacmi, m³. */
  salonHacmi: number
  /** Isıl kütle çarpanı: hava + ekipman + yapı kütlesinin havaya göre kat sayısı. */
  isilKutle: number
  /** Soğutma kesintisinde izin verilen sıcaklık artışı, K. */
  izinliArtis: number
}

const flat = (v: number): number[] => Array.from({ length: 24 }, () => v)

export const DEFAULT_SETTINGS: ProjectSettings = {
  profilIt: flat(100),
  profilMek: flat(100),
  tarife: 3.5,
  para: 'TL',
  hedefPue: 1.5,
  salonHacmi: 2000,
  isilKutle: 10,
  izinliArtis: 8,
}

/** Hazır 24 saatlik profil şekilleri (yüzde). */
export const PROFILE_PRESETS: Record<string, { it: number[]; mek: number[] }> = {
  duz: { it: flat(100), mek: flat(100) },
  tipik: {
    // IT yükü gün içinde hafif dalgalanır; mekanik yük dış sıcaklığa bağlı olarak öğleden sonra tepe yapar.
    it: [78, 76, 75, 75, 76, 78, 82, 88, 94, 98, 100, 100, 100, 100, 99, 98, 96, 94, 92, 90, 87, 84, 82, 80],
    mek: [60, 58, 56, 55, 55, 58, 64, 72, 82, 90, 96, 100, 100, 100, 98, 95, 90, 84, 78, 72, 68, 65, 63, 61],
  },
  yaz: {
    it: [85, 84, 83, 83, 84, 86, 89, 93, 97, 100, 100, 100, 100, 100, 100, 99, 98, 96, 94, 92, 90, 88, 87, 86],
    mek: [80, 78, 76, 75, 76, 80, 86, 92, 98, 100, 100, 100, 100, 100, 100, 100, 98, 95, 92, 88, 85, 83, 82, 81],
  },
  kis: {
    it: [80, 78, 77, 77, 78, 80, 84, 90, 95, 98, 100, 100, 100, 100, 99, 98, 96, 94, 92, 90, 88, 86, 84, 82],
    mek: [35, 34, 33, 33, 34, 36, 40, 45, 50, 54, 56, 58, 58, 57, 55, 52, 48, 44, 41, 39, 37, 36, 35, 35],
  },
}

const numIn = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

const series = (v: unknown, d: number[]): number[] =>
  Array.isArray(v) && v.length === 24 ? v.map((x, i) => numIn(x, 0, 200, d[i])) : [...d]

/** Dosyadan gelen ayarları doğrular; eksik/bozuk alanlar varsayılana düşer. */
export function parseSettings(raw: unknown): ProjectSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_SETTINGS
  return {
    profilIt: series(o.profilIt, d.profilIt),
    profilMek: series(o.profilMek, d.profilMek),
    tarife: numIn(o.tarife, 0, 1e6, d.tarife),
    para: typeof o.para === 'string' && o.para.trim() ? o.para.trim().slice(0, 6) : d.para,
    hedefPue: numIn(o.hedefPue, 1, 5, d.hedefPue),
    salonHacmi: numIn(o.salonHacmi, 1, 1e7, d.salonHacmi),
    isilKutle: numIn(o.isilKutle, 1, 1000, d.isilKutle),
    izinliArtis: numIn(o.izinliArtis, 1, 40, d.izinliArtis),
  }
}

export const cloneSettings = (s: ProjectSettings): ProjectSettings => ({ ...s, profilIt: [...s.profilIt], profilMek: [...s.profilMek] })
