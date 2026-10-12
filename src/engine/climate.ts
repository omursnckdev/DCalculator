import { EQUIPMENT } from '../library/equipment'
import type { ClimateSettings } from '../model/settings'
import type { ProjectNode } from '../model/types'

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const MONTH_STARTS: number[] = MONTH_DAYS.map((_, i) => MONTH_DAYS.slice(0, i).reduce((a, d) => a + d, 0))

/** Gün içi sıcaklık tepesi (saat 15:00); sinüs profili. */
const PEAK_HOUR = 15

/**
 * Her ay için 24 saatlik temsilî gün sıcaklığı (°C). 8760 saatlik veri varsa aylık-saatlik ortalaması, yoksa
 * aylık ortalama + genlik·cos(2π(saat − 15)/24).
 */
export function monthHourTemps(c: ClimateSettings): number[][] {
  const out: number[][] = []
  for (let m = 0; m < 12; m++) {
    const row: number[] = []
    for (let h = 0; h < 24; h++) {
      if (c.saatlik) {
        let sum = 0
        for (let d = 0; d < MONTH_DAYS[m]; d++) sum += c.saatlik[(MONTH_STARTS[m] + d) * 24 + h] ?? c.aylikOrt[m]
        row.push(sum / MONTH_DAYS[m])
      } else {
        row.push(c.aylikOrt[m] + c.aylikGenlik[m] * Math.cos((2 * Math.PI * (h - PEAK_HOUR)) / 24))
      }
    }
    out.push(row)
  }
  return out
}

const num = (n: ProjectNode, key: string): number => {
  const v = n.params[key] ?? EQUIPMENT[n.type].defaults[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Birim COP'si: girilmemişse nominal soğutma / elektrik gücü (nominal koşulda elektrik gücü = kuruluKw). */
export function nominalCop(n: ProjectNode): number {
  const cop = num(n, 'cop')
  if (cop > 0) return cop
  const kw = num(n, 'kuruluKw')
  return kw > 0 ? num(n, 'sogutmaKw') / kw : 1
}

/** Dış sıcaklıkta COP: nominal sıcaklığın üstünde her K için %copEgim düşer, altında artar (en çok +%40); alt sınır 1. */
export function copAt(n: ProjectNode, tC: number): number {
  const slope = num(n, 'copEgim') / 100
  const factor = 1 - slope * (tC - num(n, 'copTnom'))
  return Math.max(1, nominalCop(n) * Math.min(1.4, Math.max(0.3, factor)))
}

/** Free-cooling payı (0..1): fcUst'un üstünde 0, fcAlt'ın altında 1, arada doğrusal. Free-cooling "var" değilse 0. */
export function freeCoolingFraction(n: ProjectNode, tC: number): number {
  if ((n.params.freeCooling ?? EQUIPMENT[n.type].defaults.freeCooling) !== 'var') return 0
  const lo = num(n, 'fcAlt')
  const hi = num(n, 'fcUst')
  if (hi <= lo) return tC <= lo ? 1 : 0
  return Math.min(1, Math.max(0, (hi - tC) / (hi - lo)))
}

/**
 * Soğutma biriminin elektrik gücü (kW): `d` kadar ısı (termal kW) çeker. Free-cooling payı φ için pompa/fan gücü
 * (fcOran·kuruluKw·doluluk), kalan kısım için d/COP(T).
 */
export function coolingElectricKw(n: ProjectNode, dThermalKw: number, capacityKw: number, tC: number): number {
  const util = capacityKw > 0 ? Math.min(1, dThermalKw / capacityKw) : 0
  const phi = freeCoolingFraction(n, tC)
  const fc = phi * (num(n, 'fcOran') / 100) * num(n, 'kuruluKw') * util
  return fc + (1 - phi) * (dThermalKw / copAt(n, tC))
}
