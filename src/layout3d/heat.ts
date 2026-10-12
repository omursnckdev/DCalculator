import type { Oda3D } from '../model/types'

export interface Source {
  x: number
  z: number
  kw: number
}

export interface HeatGrid {
  nx: number
  nz: number
  cell: number
  x0: number
  z0: number
  /** 0 (serin) … 1 (sıcak), satır-ana: values[iz * nx + ix]. */
  values: Float32Array
}

/** Isı kaynağının etki yarıçapı ve soğutma biriminin kapsama yarıçapı (Gauss σ, m). */
const SIGMA_HEAT = 2
const SIGMA_COOL = 4.5

/**
 * Basit yakınlık tabanlı ısı yoğunluğu (CFD DEĞİL): hücrede skor = H / (H + C); H = Σ q·exp(−d²/2σh²), C = Σ c·exp(−d²/2σc²).
 * Soğutma yoksa (veya tümü enerjisizse) ısı olan her yer sıcak (1), ısı yoksa serin (0) görünür. `uniformCoolKw`: odada
 * konumlanmamış soğutma kapasitesi (odaya düzgün dağılır).
 */
export function heatGrid(room: Pick<Oda3D, 'x' | 'z' | 'g' | 'd'>, heat: Source[], cool: Source[], cell = 0.5, uniformCoolKw = 0): HeatGrid {
  const nx = Math.max(1, Math.ceil(room.g / cell))
  const nz = Math.max(1, Math.ceil(room.d / cell))
  const values = new Float32Array(nx * nz)
  // Odanın içinde olmayan soğutma kapasitesi (ör. dış chiller) odaya düzgün dağılmış kabul edilir (Gauss kapsama alanıyla aynı ölçek).
  const uniform = room.g * room.d > 0 ? (uniformCoolKw * 2 * Math.PI * SIGMA_COOL ** 2) / (room.g * room.d) : 0
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const px = room.x + (ix + 0.5) * cell
      const pz = room.z + (iz + 0.5) * cell
      let h = 0
      let c = uniform
      for (const s of heat) h += s.kw * Math.exp(-((px - s.x) ** 2 + (pz - s.z) ** 2) / (2 * SIGMA_HEAT ** 2))
      for (const s of cool) c += s.kw * Math.exp(-((px - s.x) ** 2 + (pz - s.z) ** 2) / (2 * SIGMA_COOL ** 2))
      values[iz * nx + ix] = h + c <= 1e-9 ? 0 : h / (h + c)
    }
  }
  return { nx, nz, cell, x0: room.x, z0: room.z, values }
}

const STOPS: [number, [number, number, number]][] = [
  [0, [37, 99, 235]],
  [0.35, [34, 197, 94]],
  [0.6, [250, 204, 21]],
  [0.8, [249, 115, 22]],
  [1, [220, 38, 38]],
]

/** 0..1 → [r,g,b] (0..255), mavi → yeşil → sarı → turuncu → kırmızı. */
export function heatRgb(t: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, t))
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1]
      const [t1, c1] = STOPS[i]
      const f = (v - t0) / (t1 - t0)
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

export const heatHex = (t: number): string => {
  const [r, g, b] = heatRgb(t)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
