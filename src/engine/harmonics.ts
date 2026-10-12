/**
 * Harmonik etkisi (basitleştirilmiş): yükün akım THD'sinden tipik bir harmonik spektrumu türetilir,
 * K-faktörü ve trafo ek kayıpları/yük düşürme (IEEE C57.110 yaklaşımı) hesaplanır.
 */

/** Tipik harmonik spektrumu: [derece, göreli genlik]. THD'ye göre ölçeklenir. */
const SPECTRUM: [number, number][] = [
  [3, 0.6],
  [5, 0.8],
  [7, 0.55],
  [9, 0.25],
  [11, 0.3],
  [13, 0.2],
]

const NORM = Math.sqrt(SPECTRUM.reduce((a, [, w]) => a + w * w, 0))

/** Akım THD'sinden (%) K-faktörü: Σ(I_h/I_rms)²·h². THD = 0 ise 1. */
export function kFactor(thdPct: number): number {
  const t = Math.max(0, thdPct) / 100
  if (t === 0) return 1
  let s = 0
  let sh = 0
  for (const [h, w] of SPECTRUM) {
    const r = (t * w) / NORM // I_h / I_1
    s += r * r
    sh += r * r * h * h
  }
  return (1 + sh) / (1 + s)
}

/** Trafo yük kaybı çarpanı: (1 + K·Pec-R) / (1 + Pec-R). K = 1 iken 1. */
export function harmonicLossFactor(pecR: number, k: number): number {
  return (1 + k * pecR) / (1 + pecR)
}

/** Trafo yük düşürme çarpanı (0..1): √((1 + Pec-R) / (1 + K·Pec-R)). */
export function deratingFactor(pecR: number, k: number): number {
  return Math.sqrt((1 + pecR) / (1 + k * pecR))
}
