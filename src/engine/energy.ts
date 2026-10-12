import { EQUIPMENT } from '../library/equipment'
import type { ProjectSettings } from '../model/settings'
import type { ProjectNode, Scenario } from '../model/types'
import { analyze } from './analyze'
import { MONTH_DAYS, coolingElectricKw, freeCoolingFraction, monthHourTemps } from './climate'
import { coolingKw, coolingRole } from './coolingUnits'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Analysis, LossItem, Model, Thresholds } from './types'

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
  /** Dış sıcaklık, °C (iklim modeli). */
  tempC?: number
  /** Soğutma birimlerinin (chiller/CRAC) toplam elektrik gücü, kW (iklime bağlı model). */
  coolingElecKw?: number
}

export interface MonthRow {
  month: number
  days: number
  avgTempC: number
  itKwh: number
  mechKwh: number
  lossKwh: number
  totalKwh: number
  pue?: number
  /** Free-cooling'in ortalama devrede olma payı, % (free-cooling'li chiller varsa). */
  freeCoolingPct?: number
  waterM3?: number
}

export interface EnergyReport {
  /** Ortalama gün (12 ayın gün ağırlıklı ortalaması), saatlik. */
  hours: HourRow[]
  /** Aylık temsilî günler (12 × 24), dış sıcaklıkla. */
  monthHours: HourRow[][]
  months: MonthRow[]
  /** Ortalama günlük enerji, kWh. */
  daily: { itKwh: number; mechKwh: number; lossKwh: number; totalKwh: number }
  peakKw: number
  /** Enerji ağırlıklı ortalama PUE (toplam kWh / IT kWh). */
  avgPue?: number
  annual: { totalKwh: number; itKwh: number; lossKwh: number; cost: number; lossCost: number; monthlyCost: number }
  /** Hedef PUE'ye inilirse yıllık tasarruf (hedef ortalama PUE'nin altındaysa). */
  saving?: { kwh: number; cost: number; targetPue: number }
  /** En çok kayıp yapan kalemler, yıllık enerji ve maliyet (profil ağırlıklı). */
  topLosses: { id: string; name: string; kind: LossItem['kind']; annualKwh: number; cost: number }[]
  /** Soğutma birimleri iklime bağlı modellendi mi (chiller/CRAC kapasitesi tanımlıysa). */
  climateCoupled: boolean
  /** Yıllık su tüketimi (m³) ve WUE (L/kWh IT); kule tanımlıysa. */
  waterM3?: number
  wue?: number
  /** Yıllık karbon emisyonu, ton CO₂. */
  co2Tons: number
  /** Soğutma birimlerinin yıllık elektrik enerjisi, kWh (iklime bağlıysa). */
  coolingKwh?: number
}

/** Yük kategorisi: 'IT' ise IT profili, aksi halde mekanik profil uygulanır. */
function isItLoad(n: Model['nodes'][number]): boolean {
  if (EQUIPMENT[n.type].hasOutput) return false
  const k = n.params.kategori ?? EQUIPMENT[n.type].defaults.kategori
  return k === 'IT'
}

const dfOf = (n: ProjectNode): number => {
  const v = n.params.df ?? EQUIPMENT[n.type].defaults.df
  return typeof v === 'number' ? v : 1
}

/**
 * Yük profiline (24 saat) ve dış sıcaklığa (12 ay × 24 saat) göre yıllık enerji, ortalama PUE ve maliyet.
 * Chiller ve CRAC gibi soğutma üreten birimlerin elektrik gücü sabit değildir: o saatin soğutma ihtiyacına ve dış
 * sıcaklığa göre COP(T) ile (ve free-cooling payıyla) hesaplanır; diğer yükler profil çarpanıyla ölçeklenir.
 * Her çözümde yükler yeniden çözülür (kayıplar ve ısı yükle birlikte değişir).
 */
export function energyReport(model: Model, s: ProjectSettings, th: Thresholds = DEFAULT_THRESHOLDS, scenario?: Scenario): EnergyReport {
  const producers = model.nodes.filter((n) => {
    const r = coolingRole(n)
    return r === 'produce' || r === 'direct'
  })
  const coupled = producers.length > 0
  const temps = monthHourTemps(s.iklim)

  const scale = (fi: number, fm: number, override?: Map<string, number>): Model => ({
    edges: model.edges,
    nodes: model.nodes.map((n) => {
      if (EQUIPMENT[n.type].hasOutput) return n
      const kw = n.params.kuruluKw ?? EQUIPMENT[n.type].defaults.kuruluKw
      if (typeof kw !== 'number') return n
      const eff = override?.has(n.id) ? override.get(n.id)! : kw * (isItLoad(n) ? fi : fm)
      return { ...n, params: { ...n.params, kuruluKw: eff } }
    }),
  })
  const solve = (m: Model): Analysis => analyze(m, th, scenario, undefined, { studies: false })

  const base = new Map<string, Analysis>()
  const pass1 = (fi: number, fm: number): Analysis => {
    const key = `${fi}|${fm}`
    let a = base.get(key)
    if (!a) {
      a = solve(scale(fi, fm))
      base.set(key, a)
    }
    return a
  }
  const final = new Map<string, { a: Analysis; elec: number; chillerElec: number; chillerHeat: number }>()

  const monthHours: HourRow[][] = []
  const lossAcc = new Map<string, { name: string; kind: LossItem['kind']; kwh: number }>()
  const months: MonthRow[] = []
  const towers = model.nodes.filter((n) => n.type === 'sogutmaKulesi')
  let annualWaterL = 0

  for (let m = 0; m < 12; m++) {
    const rows: HourRow[] = []
    let fcSum = 0
    let fcN = 0
    let waterL = 0
    for (let h = 0; h < 24; h++) {
      const fi = (s.profilIt[h] ?? 100) / 100
      const fm = (s.profilMek[h] ?? 100) / 100
      const t = temps[m][h]
      let a: Analysis
      let elec = 0
      let chillerElec = 0
      let chillerHeat = 0
      if (!coupled) {
        a = pass1(fi, fm)
      } else {
        const tb = Math.round(t * 2) / 2
        const key = `${fi}|${fm}|${tb}`
        let hit = final.get(key)
        if (!hit) {
          const a1 = pass1(fi, fm)
          const cool = a1.cooling
          const demand = cool ? Math.min(cool.demandKw, cool.capacityKw) : 0
          const live = producers.filter((n) => a1.nodes[n.id]?.energized)
          const totalC = live.reduce((x, n) => x + coolingKw(n), 0)
          const override = new Map<string, number>()
          let ce = 0
          let cheat = 0
          let tot = 0
          for (const n of producers) {
            const cap = coolingKw(n)
            const d = a1.nodes[n.id]?.energized && totalC > 0 ? (demand * cap) / totalC : 0
            const p = coolingElectricKw(n, d, cap, tb)
            const df = dfOf(n)
            if (df > 0) override.set(n.id, p / df)
            tot += p
            if (coolingRole(n) === 'produce') {
              ce += p
              cheat += d
            }
          }
          const a2 = solve(scale(fi, fm, override))
          hit = { a: a2, elec: tot, chillerElec: ce, chillerHeat: cheat }
          final.set(key, hit)
        }
        a = hit.a
        elec = hit.elec
        chillerElec = hit.chillerElec
        chillerHeat = hit.chillerHeat
      }
      rows.push({
        hour: h,
        itFactor: fi,
        mechFactor: fm,
        itKw: a.totals.itKw,
        mechKw: a.totals.mechKw,
        lossKw: a.totals.lossKw,
        totalKw: a.totals.totalKw,
        coolingKw: a.heat.salonKw + a.heat.elektrikKw,
        pue: a.pue,
        tempC: t,
        coolingElecKw: coupled ? elec : undefined,
      })
      const days = MONTH_DAYS[m]
      for (const it of a.lossItems) {
        const e = lossAcc.get(`${it.kind}:${it.id}`) ?? { name: it.name, kind: it.kind, kwh: 0 }
        e.kwh += it.kw * days // temsilî günün saatlik kW'ı × o aydaki gün sayısı
        lossAcc.set(`${it.kind}:${it.id}`, e)
      }
      // Free-cooling payı ve kule su tüketimi
      for (const n of producers) {
        if (coolingRole(n) !== 'produce' || (n.params.freeCooling ?? EQUIPMENT[n.type].defaults.freeCooling) !== 'var') continue
        fcSum += freeCoolingFraction(n, t)
        fcN++
      }
      if (towers.length > 0) {
        const rejected = chillerHeat + chillerElec // kW ısı atımı (soğutma yükü + kompresör gücü)
        for (const tw of towers) {
          const share = Number(tw.params.isiPayi ?? EQUIPMENT.sogutmaKulesi.defaults.isiPayi) / 100
          const lPerKwh = Number(tw.params.suTuketimi ?? EQUIPMENT.sogutmaKulesi.defaults.suTuketimi)
          waterL += rejected * share * lPerKwh * MONTH_DAYS[m] // (kW × 1 saat) × L/kWh × gün
        }
      }
    }
    monthHours.push(rows)
    const days = MONTH_DAYS[m]
    const sum = (f: (r: HourRow) => number) => rows.reduce((x, r) => x + f(r), 0) * days
    const itKwh = sum((r) => r.itKw)
    const totalKwh = sum((r) => r.totalKw)
    months.push({
      month: m,
      days,
      avgTempC: rows.reduce((x, r) => x + (r.tempC ?? 0), 0) / 24,
      itKwh,
      mechKwh: sum((r) => r.mechKw),
      lossKwh: sum((r) => r.lossKw),
      totalKwh,
      pue: itKwh > 0 ? totalKwh / itKwh : undefined,
      freeCoolingPct: fcN > 0 ? (fcSum / fcN) * 100 : undefined,
      waterM3: towers.length > 0 ? waterL / 1000 : undefined,
    })
    annualWaterL += waterL
  }

  const totalDays = 365
  const annualSum = (f: (r: MonthRow) => number) => months.reduce((x, r) => x + f(r), 0)
  const annual = {
    totalKwh: annualSum((r) => r.totalKwh),
    itKwh: annualSum((r) => r.itKwh),
    lossKwh: annualSum((r) => r.lossKwh),
    cost: annualSum((r) => r.totalKwh) * s.tarife,
    lossCost: annualSum((r) => r.lossKwh) * s.tarife,
    monthlyCost: (annualSum((r) => r.totalKwh) * s.tarife) / 12,
  }
  const daily = { itKwh: annual.itKwh / totalDays, mechKwh: annualSum((r) => r.mechKwh) / totalDays, lossKwh: annual.lossKwh / totalDays, totalKwh: annual.totalKwh / totalDays }
  // Ortalama gün: her saatin gün ağırlıklı ortalaması
  const hours: HourRow[] = Array.from({ length: 24 }, (_, h) => {
    const avg = (f: (r: HourRow) => number) => monthHours.reduce((x, rows, m) => x + f(rows[h]) * MONTH_DAYS[m], 0) / totalDays
    const it = avg((r) => r.itKw)
    const tot = avg((r) => r.totalKw)
    return {
      hour: h,
      itFactor: monthHours[0][h].itFactor,
      mechFactor: monthHours[0][h].mechFactor,
      itKw: it,
      mechKw: avg((r) => r.mechKw),
      lossKw: avg((r) => r.lossKw),
      totalKw: tot,
      coolingKw: avg((r) => r.coolingKw),
      pue: it > 0 ? tot / it : undefined,
      tempC: avg((r) => r.tempC ?? 0),
      coolingElecKw: coupled ? avg((r) => r.coolingElecKw ?? 0) : undefined,
    }
  })
  const avgPue = annual.itKwh > 0 ? annual.totalKwh / annual.itKwh : undefined
  let saving: EnergyReport['saving']
  if (avgPue !== undefined && s.hedefPue < avgPue) {
    const kwh = (avgPue - s.hedefPue) * annual.itKwh
    saving = { kwh, cost: kwh * s.tarife, targetPue: s.hedefPue }
  }
  const topLosses = [...lossAcc.entries()]
    .map(([k, v]) => ({ id: k.split(':').slice(1).join(':'), name: v.name, kind: v.kind, annualKwh: v.kwh, cost: v.kwh * s.tarife }))
    .filter((x) => x.annualKwh > 0.01)
    .sort((a, b) => b.annualKwh - a.annualKwh)
    .slice(0, 12)
  const coolingKwh = coupled ? monthHours.reduce((x, rows, m) => x + rows.reduce((y, r) => y + (r.coolingElecKw ?? 0), 0) * MONTH_DAYS[m], 0) : undefined
  const waterM3 = towers.length > 0 ? annualWaterL / 1000 : undefined
  return {
    hours,
    monthHours,
    months,
    daily,
    peakKw: Math.max(0, ...monthHours.flat().map((r) => r.totalKw)),
    avgPue,
    annual,
    saving,
    topLosses,
    climateCoupled: coupled,
    waterM3,
    wue: waterM3 !== undefined && annual.itKwh > 0 ? (waterM3 * 1000) / annual.itKwh : undefined,
    co2Tons: (annual.totalKwh * s.emisyon) / 1000,
    coolingKwh,
  }
}
