import { EQUIPMENT } from '../library/equipment'
import type { ProjectSettings } from '../model/settings'
import type { Scenario } from '../model/types'
import { analyze } from './analyze'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { LossItem, Model, Thresholds } from './types'

export interface HourRow {
  hour: number
  itFactor: number
  mechFactor: number
  itKw: number
  mechKw: number
  lossKw: number
  totalKw: number
  /** Elektrik odası + salon ısı yükü (soğutma ihtiyacı), kW. */
  coolingKw: number
  pue?: number
}

export interface EnergyReport {
  hours: HourRow[]
  /** Günlük enerji, kWh. */
  daily: { itKwh: number; mechKwh: number; lossKwh: number; totalKwh: number }
  peakKw: number
  /** Enerji ağırlıklı ortalama PUE (toplam kWh / IT kWh). */
  avgPue?: number
  annual: { totalKwh: number; itKwh: number; lossKwh: number; cost: number; lossCost: number; monthlyCost: number }
  /** Hedef PUE'ye inilirse yıllık tasarruf (hedef ortalama PUE'nin altındaysa). */
  saving?: { kwh: number; cost: number; targetPue: number }
  /** En çok kayıp yapan kalemler, yıllık enerji ve maliyet (profil ağırlıklı). */
  topLosses: { id: string; name: string; kind: LossItem['kind']; annualKwh: number; cost: number }[]
}

/** Yük kategorisi: 'IT' ise IT profili, aksi halde mekanik profil uygulanır. */
function isItLoad(n: Model['nodes'][number]): boolean {
  if (EQUIPMENT[n.type].hasOutput) return false
  const k = n.params.kategori ?? EQUIPMENT[n.type].defaults.kategori
  return k === 'IT'
}

/**
 * 24 saatlik yük profiline göre günlük/yıllık enerji, ortalama PUE ve maliyet. Her saat için yükler profil
 * çarpanıyla ölçeklenip analiz yeniden çözülür (kayıplar ve soğutma yükle birlikte değişir).
 */
export function energyReport(model: Model, s: ProjectSettings, th: Thresholds = DEFAULT_THRESHOLDS, scenario?: Scenario): EnergyReport {
  const cache = new Map<string, ReturnType<typeof analyze>>()
  const solve = (fi: number, fm: number) => {
    const key = `${fi}|${fm}`
    let a = cache.get(key)
    if (!a) {
      const scaled: Model = {
        edges: model.edges,
        nodes: model.nodes.map((n) => {
          if (EQUIPMENT[n.type].hasOutput) return n
          const kw = n.params.kuruluKw ?? EQUIPMENT[n.type].defaults.kuruluKw
          if (typeof kw !== 'number') return n
          return { ...n, params: { ...n.params, kuruluKw: kw * (isItLoad(n) ? fi : fm) } }
        }),
      }
      a = analyze(scaled, th, scenario)
      cache.set(key, a)
    }
    return a
  }

  const hours: HourRow[] = []
  const lossAcc = new Map<string, { name: string; kind: LossItem['kind']; kwh: number }>()
  for (let h = 0; h < 24; h++) {
    const fi = (s.profilIt[h] ?? 100) / 100
    const fm = (s.profilMek[h] ?? 100) / 100
    const a = solve(fi, fm)
    hours.push({
      hour: h,
      itFactor: fi,
      mechFactor: fm,
      itKw: a.totals.itKw,
      mechKw: a.totals.mechKw,
      lossKw: a.totals.lossKw,
      totalKw: a.totals.totalKw,
      coolingKw: a.heat.salonKw + a.heat.elektrikKw,
      pue: a.pue,
    })
    for (const it of a.lossItems) {
      const e = lossAcc.get(`${it.kind}:${it.id}`) ?? { name: it.name, kind: it.kind, kwh: 0 }
      e.kwh += it.kw // saatlik kW = o saatin kWh'i
      lossAcc.set(`${it.kind}:${it.id}`, e)
    }
  }
  const sum = (f: (r: HourRow) => number) => hours.reduce((x, r) => x + f(r), 0)
  const daily = { itKwh: sum((r) => r.itKw), mechKwh: sum((r) => r.mechKw), lossKwh: sum((r) => r.lossKw), totalKwh: sum((r) => r.totalKw) }
  const avgPue = daily.itKwh > 0 ? daily.totalKwh / daily.itKwh : undefined
  const annual = {
    totalKwh: daily.totalKwh * 365,
    itKwh: daily.itKwh * 365,
    lossKwh: daily.lossKwh * 365,
    cost: daily.totalKwh * 365 * s.tarife,
    lossCost: daily.lossKwh * 365 * s.tarife,
    monthlyCost: (daily.totalKwh * 365 * s.tarife) / 12,
  }
  let saving: EnergyReport['saving']
  if (avgPue !== undefined && s.hedefPue < avgPue) {
    const kwh = (avgPue - s.hedefPue) * annual.itKwh
    saving = { kwh, cost: kwh * s.tarife, targetPue: s.hedefPue }
  }
  const topLosses = [...lossAcc.entries()]
    .map(([k, v]) => ({ id: k.split(':').slice(1).join(':'), name: v.name, kind: v.kind, annualKwh: v.kwh * 365, cost: v.kwh * 365 * s.tarife }))
    .filter((x) => x.annualKwh > 0.01)
    .sort((a, b) => b.annualKwh - a.annualKwh)
    .slice(0, 12)
  return { hours, daily, peakKw: Math.max(0, ...hours.map((r) => r.totalKw)), avgPue, annual, saving, topLosses }
}
