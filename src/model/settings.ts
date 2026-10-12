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
  /** Salon sıcaklık ayar noktası, °C (simülasyonda başlangıç sıcaklığı). */
  salonSetpoint: number
  /** Dış hava sıcaklık profili (COP ve free-cooling için). */
  iklim: ClimateSettings
  /** Şebeke elektriğinin karbon emisyon faktörü, kg CO₂/kWh. */
  emisyon: number
  /** Jeneratör aşırı yüklenince öncelik sırasıyla yük at (simülasyon). */
  yukAtma: boolean
  /** Jeneratör yakıt özerkliği hedefi, saat. */
  yakitHedefSaat: number
  /** Motor kalkışında jeneratör gerilim çökmesi sınırı, %. */
  gerilimCokmesiSiniri: number
  /** Kablo ve busbar hat arıza verisi (güvenilirlik): MTBF / MTTR, saat. */
  kabloMtbf: number
  kabloMttr: number
  busbarMtbf: number
  busbarMttr: number
  /** Ark flaşı: çalışma mesafesi ve iletken aralığı, mm. */
  arkMesafe: number
  arkAralik: number
  /** Kablo seçimi: ortam sıcaklığı °C, gruplama faktörü, gerilim düşümü sınırı %, kısa devre süresi sn. */
  kabloOrtam: number
  kabloGruplama: number
  kabloDusum: number
  kabloKscSure: number
}

/** İklim: 12 aylık ortalama sıcaklık ve günlük genlik (±K); isteğe bağlı 8760 saatlik veri (varsa aylık-saatlik ortalaması kullanılır). */
export interface ClimateSettings {
  aylikOrt: number[]
  aylikGenlik: number[]
  saatlik: number[] | null
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
  salonSetpoint: 24,
  iklim: {
    // Ilıman kıyı iklimi için tipik değerler (°C); kendi lokasyonunuzla değiştirin.
    aylikOrt: [6, 6.5, 8.5, 13, 18, 23, 25.5, 25.5, 21.5, 16.5, 11.5, 8],
    aylikGenlik: [3, 3.5, 4, 5, 5.5, 6, 6, 6, 5.5, 4.5, 3.5, 3],
    saatlik: null,
  },
  emisyon: 0.45,
  yukAtma: true,
  yakitHedefSaat: 24,
  gerilimCokmesiSiniri: 20,
  kabloMtbf: 1_500_000,
  kabloMttr: 24,
  busbarMtbf: 3_000_000,
  busbarMttr: 12,
  arkMesafe: 455,
  arkAralik: 32,
  kabloOrtam: 35,
  kabloGruplama: 0.8,
  kabloDusum: 3,
  kabloKscSure: 0.5,
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
  const ik = o.iklim && typeof o.iklim === 'object' ? (o.iklim as Record<string, unknown>) : {}
  const arr12 = (v: unknown, def: number[], lo: number, hi: number): number[] =>
    Array.isArray(v) && v.length === 12 ? v.map((x, i) => numIn(x, lo, hi, def[i])) : [...def]
  const hourly = Array.isArray(ik.saatlik) && (ik.saatlik.length === 8760 || ik.saatlik.length === 8784) ? (ik.saatlik as unknown[]).map((x) => numIn(x, -60, 70, 15)) : null
  return {
    iklim: { aylikOrt: arr12(ik.aylikOrt, d.iklim.aylikOrt, -60, 70), aylikGenlik: arr12(ik.aylikGenlik, d.iklim.aylikGenlik, 0, 30), saatlik: hourly },
    salonSetpoint: numIn(o.salonSetpoint, 10, 40, d.salonSetpoint),
    emisyon: numIn(o.emisyon, 0, 5, d.emisyon),
    yukAtma: typeof o.yukAtma === 'boolean' ? o.yukAtma : d.yukAtma,
    yakitHedefSaat: numIn(o.yakitHedefSaat, 0, 10000, d.yakitHedefSaat),
    gerilimCokmesiSiniri: numIn(o.gerilimCokmesiSiniri, 1, 60, d.gerilimCokmesiSiniri),
    kabloMtbf: numIn(o.kabloMtbf, 1, 1e9, d.kabloMtbf),
    kabloMttr: numIn(o.kabloMttr, 0.01, 1e5, d.kabloMttr),
    busbarMtbf: numIn(o.busbarMtbf, 1, 1e9, d.busbarMtbf),
    busbarMttr: numIn(o.busbarMttr, 0.01, 1e5, d.busbarMttr),
    arkMesafe: numIn(o.arkMesafe, 100, 2000, d.arkMesafe),
    arkAralik: numIn(o.arkAralik, 5, 200, d.arkAralik),
    kabloOrtam: numIn(o.kabloOrtam, -20, 80, d.kabloOrtam),
    kabloGruplama: numIn(o.kabloGruplama, 0.3, 1, d.kabloGruplama),
    kabloDusum: numIn(o.kabloDusum, 0.1, 20, d.kabloDusum),
    kabloKscSure: numIn(o.kabloKscSure, 0.01, 5, d.kabloKscSure),
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

export const cloneSettings = (s: ProjectSettings): ProjectSettings => ({
  ...s,
  profilIt: [...s.profilIt],
  profilMek: [...s.profilMek],
  iklim: { aylikOrt: [...s.iklim.aylikOrt], aylikGenlik: [...s.iklim.aylikGenlik], saatlik: s.iklim.saatlik ? [...s.iklim.saatlik] : null },
})
