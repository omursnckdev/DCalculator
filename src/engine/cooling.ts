import type { ProjectSettings } from '../model/settings'

/** Havanın hacimsel ısı kapasitesi: ρ·cp ≈ 1,2 kJ/(m³·K). */
export const AIR_RHO_CP = 1.2

/**
 * Soğutma kesilince (veya yetersizken) salonun izin verilen sıcaklık artışına ulaşma süresi, dakika.
 * Enerji = ρ·cp · V · kütle çarpanı · ΔT; süre = enerji / açık (kW). Açık yoksa `Infinity`.
 * Ekipman ve yapı kütlesi `isilKutle` çarpanıyla havaya eklenir (tipik 5–15).
 */
export function rideThroughMinutes(deficitKw: number, s: Pick<ProjectSettings, 'salonHacmi' | 'isilKutle' | 'izinliArtis'>): number {
  if (deficitKw <= 0.5) return Infinity
  const kJ = AIR_RHO_CP * s.salonHacmi * s.isilKutle * s.izinliArtis
  return kJ / deficitKw / 60
}

/** Sıcaklık artış hızı, K/dk (açık kW'a göre). */
export function riseRateKPerMin(deficitKw: number, s: Pick<ProjectSettings, 'salonHacmi' | 'isilKutle'>): number {
  return (deficitKw * 60) / (AIR_RHO_CP * s.salonHacmi * s.isilKutle)
}
