import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze, runN1, simulateFailure, simulateRecovery } from './engine'
import { parseProject } from './model/project'
import type { EquipmentType } from './model/types'

/**
 * HDC02-ARP-SC-E-DD-ZZ-ZZ-POWR-6002 (LV Distribution Schematic, Power Line-up 1) şemasının modeli.
 * Ekipman sayıları ve değerleri DXF'ten okunmuştur; şemada olmayan değerler (yükler, kablo uzunlukları,
 * trafo kayıpları, jeneratör kVA) varsayımdır ve düğüm notlarında "Varsayım" ile işaretlidir.
 */
const p = parseProject(readFileSync(new URL('../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const node = (id: string) => p.nodes.find((n) => n.id === id)!
const scn = (id: string) => p.scenarios.find((s) => s.id === id)!
const count = (t: EquipmentType) => p.nodes.filter((n) => n.type === t).length

describe('HDC02 PL1: şemadaki ekipman', () => {
  it('ekipman sayıları DXF ile aynı', () => {
    expect(count('trafo')).toBe(1) // TX.PL1
    expect(count('jenerator')).toBe(2) // GEN.PL1.1/.2
    expect(count('ups')).toBe(3) // UPS.PL1.1/.2/.3
    expect(count('sts')).toBe(4) // STS.PL1.1A/1B/2A/2B
    const acb = p.nodes.filter((n) => n.type === 'kesici' && n.params.tip === 'ACB')
    const iso = p.nodes.filter((n) => n.type === 'kesici' && n.params.tip === 'Ayırıcı')
    expect(acb).toHaveLength(33)
    expect(iso).toHaveLength(8) // STS bakım bypass ayırıcıları
    const yard = p.nodes.filter((n) => n.type === 'yardimci')
    expect(yard.filter((n) => n.params.altTip === 'akimTrafosu')).toHaveLength(4)
    expect(yard.filter((n) => n.params.altTip === 'parafudr')).toHaveLength(4)
    expect(yard.filter((n) => n.params.altTip === 'sayac' || n.params.altTip === 'pqm')).toHaveLength(4)
  })

  it('şemadaki etiket değerleri', () => {
    expect(node('tx').params).toMatchObject({ nominalKva: 3150, primerGerilim: 34500, sekonderGerilim: 415, uk: 7 })
    expect(node('msb').params.nominalAkim).toBe(5000)
    expect(node('udp1').params.nominalAkim).toBe(1600)
    expect(node('udp2').params.nominalAkim).toBe(1600)
    expect(node('udp3').params.nominalAkim).toBe(400)
    expect(node('crp').params.nominalAkim).toBe(2500)
    expect(node('ups1').params).toMatchObject({ nominalKw: 900, nominalKva: 900 })
    expect(node('ups3').params).toMatchObject({ nominalKw: 200, nominalKva: 200 })
    expect(node('1A_sts').params.nominalAkim).toBe(1250)
    expect(node('acb_tx').params).toMatchObject({ nominalAkim: 5000, kutup: '3P' })
    expect(node('uo1_r').params).toMatchObject({ tip: 'MCCB', nominalAkim: 160 })
    expect(node('mf_acc1').params).toMatchObject({ tip: 'MCCB', nominalAkim: 630 })
  })

  it('hat adları şemadaki gibi (bara / kablo etiketleri)', () => {
    const names = new Set(p.edges.map((e) => e.ad).filter(Boolean))
    for (const n of ['BB/TX.PL1', 'BB/GEN.PL1', 'BB/MSB.PL1/01', 'BB/MSB.PL1/04', 'BB/UPS.PL1.2', 'BB/UDP.PL1.1/02', 'BB/STSSB.PL1.2B',
      'CBL/MSB.PL1/08', 'CBL/UPS.PL1.3', 'CBL.UDP.PL1.2/01', 'CBL/UDB.PL1.2/01', 'BB/C1', 'BB/C2', 'BB/CRP.PL1.1']) {
      expect(names.has(n), n).toBe(true)
    }
  })

  it('bakım bypass, load bank ve boş yer kesicileri normalde açık', () => {
    for (const id of ['mb_byp1', 'ud_byp1', 'mb_byp2', 'mb_byp3', 'mf_lb', 'uo1_lb', 'uo2_lb', 'mf_spare', '1A_isoA', '2B_isoB']) {
      expect(node(id).params.durum, id).toBe('acik')
    }
    expect(node('acb_tx').params.durum).toBe('kapali')
  })
})

describe('HDC02 PL1: normal çalışma', () => {
  const a = analyze(p)

  it('doğrulamada hata ve uyarı yok', () => {
    expect(a.issues).toEqual([])
  })

  it('yük toplamları elle toplamla aynı', () => {
    // IT: 4 × 270 (STS çıkışları) + 2 × 82 (RPP.POP.1A/2A)
    expect(a.totals.itKw).toBeCloseTo(4 * 270 + 2 * 82, 6)
    // Mekanik: 2 chiller 289 + 2 jeneratör yardımcı 46 + DB.PL1.1 31 + DB.PL1.2 225 + UDB 40 + 30 + 40
    expect(a.totals.mechKw).toBeCloseTo(2 * 289 + 2 * 46 + 31 + 225 + 40 + 30 + 40, 6)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('TX.PL1 yükü taşır, jeneratörler yedekte (yükte değil)', () => {
    expect(a.nodes.tx.loadingPct).toBeGreaterThan(70)
    expect(a.nodes.tx.loadingPct).toBeLessThan(85)
    expect(a.nodes.gen1.totalKw).toBe(0)
    expect(a.nodes.gen2.totalKw).toBe(0)
  })

  it('UPS\'ler IT yükünü eşit paylaşır, STS A (UPS) tarafını seçer, catcher boşta', () => {
    expect(a.nodes.ups1.itKw).toBeCloseTo(2 * 270 + 82, 6)
    expect(a.nodes.ups2.itKw).toBeCloseTo(2 * 270 + 82, 6)
    expect(a.nodes.ups1.loadingPct).toBeCloseTo(a.nodes.ups2.loadingPct!, 9)
    expect(a.nodes.catcher_src.totalKw).toBe(0)
    expect(a.nodes['1A_sts'].totalKw).toBeCloseTo(270, 0) // + çıkış barası I²R kaybı (~0,2 kW)
  })

  it('UPS.PL1.3 yalnız UDB yüklerini taşır; kayıplar ve ısı korunur', () => {
    expect(a.nodes.ups3.totalKw).toBeGreaterThan(110) // + kablo kayıpları
    expect(a.nodes.ups3.totalKw).toBeLessThan(113)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 6)
    expect(a.losses.upsKw).toBeGreaterThan(0)
    expect(a.losses.trafoKw).toBeGreaterThan(0)
  })
})

describe('HDC02 PL1: senaryolar', () => {
  it('TX.PL1 arızası: iki jeneratör tesisi eşit taşır, yük kaybı yok', () => {
    const a = analyze(p, undefined, scn('sen_tx'))
    expect(a.unserved.totalKw).toBe(0)
    expect(a.nodes.gen1.totalKw).toBeGreaterThan(1000)
    expect(a.nodes.gen1.totalKw).toBeCloseTo(a.nodes.gen2.totalKw, 6)
    expect(a.nodes.gen1.status).not.toBe('over')
    expect(a.nodes.catcher_src.totalKw).toBe(0) // STS tercihi A (UPS), jeneratörlü tarafta da korunur
  })

  it('UPS.PL1.1 arızası: hard bypass otomatik kapanır, UDP doğrudan MSB\'den beslenir, yük kaybı yok', () => {
    const a = analyze(p, undefined, scn('sen_ups1'))
    expect(a.nodes.ups1.energized).toBe(false)
    for (const id of ['mb_byp1', 'ud_byp1']) {
      expect(a.nodes[id].autoClosed, id).toBe(true)
      expect(a.nodes[id].open, id).toBe(false)
    }
    expect(a.nodes.udp1.energized).toBe(true)
    expect(a.unserved.totalKw).toBe(0)
    expect(a.nodes.udp1.itKw).toBeCloseTo(2 * 270 + 82, 0) // UDP.PL1.1 yükü MSB bypass hattından
    expect(a.nodes.catcher_src.totalKw).toBe(0) // STS tercihi A: bypass ile geri enerjili
    // UPS.PL1.2 etkilenmez
    expect(a.nodes.mb_byp2.autoClosed).toBe(false)
  })

  it('UPS.PL1.1 bakım bypass: yük kaybı yok', () => {
    const a = analyze(p, undefined, scn('sen_ups1_byp'))
    expect(a.unserved.totalKw).toBe(0)
    expect(a.nodes.udp1.energized).toBe(true)
    expect(a.nodes.ups1.totalKw).toBe(0)
  })

  it('UPS.PL1.3 arızası: Essential UPS bypass\'ı (MCCB) otomatik kapanır, UDB yükleri korunur', () => {
    const a = analyze(p, undefined, scn('sen_ups3'))
    expect(a.nodes.mb_byp3.autoClosed).toBe(true)
    expect(a.nodes.ud_byp3.autoClosed).toBe(true)
    expect(a.unserved.totalKw).toBe(0)
  })

  it('elle kilitlenen (senaryoda açık bırakılan) bypass otomatik kapanmaz: yük kaybı', () => {
    const lock = { ...scn('sen_ups3'), nodeStates: { mb_byp3: 'acik' as const } }
    const a = analyze(p, undefined, lock)
    expect(a.nodes.mb_byp3.autoClosed).toBe(false)
    expect(a.unserved.mechKw).toBeCloseTo(110, 6)
  })

  it('TX.PL1 + bir jeneratör arızası: kalan jeneratör aşırı yüklenir', () => {
    const a = analyze(p, undefined, scn('sen_tx_gen1'))
    expect(a.nodes.gen2.status).toBe('over')
    expect(a.nodes.gen2.loadingPct).toBeGreaterThan(150)
  })

  it('N-1: TX, UPS.PL1.1/2, tek jeneratör ve STS yolu sağlanır; tekil besleyiciler sağlanmaz', () => {
    const rows = runN1(p)
    const row = (id: string) => rows.find((r) => r.id === id)!
    for (const id of ['tx', 'gen1', 'gen2', 'ups1', 'ups2', 'ups3', '1A_sts']) {
      // STS arızası: STS tek cihaz, çıkışı tekil yük -> sağlanmaz; diğerleri sağlanır
      if (id !== '1A_sts') expect(row(id).ok, id).toBe(true)
    }
    expect(row('1A_sts').ok).toBe(false)
    expect(row('msb').ok).toBe(false)
    expect(row('mf_acc1').lostMechKw).toBeCloseTo(289, 6)
    expect(row('ups1').lostItKw).toBe(0) // otomatik bypass
    expect(row('ups1').ok).toBe(true)
    expect(row('ups3').ok).toBe(true)
  })
})

describe('HDC02 PL1: adım adım simülasyon', () => {
  it('UPS.PL1.1 arızası: STS geçişi, sonra otomatik bypass ve geri transfer', () => {
    const steps = simulateFailure(p, ['ups1'])
    expect(steps.map((s) => s.id)).toEqual(['normal', 'fault', 'sts', 'bypass'])
    const [, fault, sts, bypass] = steps
    // t = 0: UDP.PL1.1 enerjisiz, STS'ler kilitli kaynakta -> UPS.PL1.1 bloğunun tüm yükleri kaybı
    expect(fault.lostKw).toBeCloseTo(2 * 270 + 82, 0)
    // STS'ler catcher'a geçer: IT yükleri geri gelir, yalnız RPP.POP.1A (tekil) kayıp
    expect(sts.lostKw).toBeCloseTo(82, 0)
    expect(sts.changes.some((c) => c.kind === 'transfer' && /STS\.PL1\.1A/.test(c.text))).toBe(true)
    // Bypass kesicileri otomatik kapanır: yük kaybı sıfır, STS tercih edilen kaynağa döner
    expect(bypass.lostKw).toBe(0)
    expect(bypass.changes.filter((c) => c.kind === 'autoClose').length).toBe(2)
    expect(bypass.analysis.nodes['1A_sts'].energized).toBe(true)
  })

  it('TX.PL1 arızası: UPS\'ler bataryada, jeneratörler devreye girer ve yükü paylaşır', () => {
    const steps = simulateFailure(p, ['tx'])
    expect(steps.map((s) => s.id)).toEqual(['normal', 'fault', 'gen'])
    const [, fault, gen] = steps
    expect(fault.analysis.nodes.ups1.onBattery).toBe(true)
    expect(fault.analysis.nodes.ups3.onBattery).toBe(true)
    expect(fault.analysis.nodes['1A_load'].energized).toBe(true) // IT yükleri bataryada
    expect(fault.lostKw).toBeCloseTo(2 * 289 + 2 * 46 + 31 + 225, 0) // mekanik: chiller + aux + DB (UPS3 kapsamındaki UDB hariç)
    expect(gen.lostKw).toBe(0)
    expect(gen.analysis.nodes.gen1.totalKw).toBeCloseTo(gen.analysis.nodes.gen2.totalKw, 6)
    expect(gen.analysis.nodes.gen1.standby).toBe(false) // yük > %70 eşik: iki jeneratör de çalışır
  })

  it('yük azalınca 2. jeneratör kapanır (HDC02 yükleri %40\'a düşürülünce)', () => {
    const light = {
      ...p,
      nodes: p.nodes.map((n) => (typeof n.params.kuruluKw === 'number' ? { ...n, params: { ...n.params, kuruluKw: (n.params.kuruluKw as number) * 0.4 } } : n)),
    }
    const a = analyze(light, undefined, scn('sen_tx'))
    expect(a.nodes.gen2.standby).toBe(true)
    expect(a.nodes.gen2.totalKw).toBe(0)
    expect(a.nodes.gen1.totalKw).toBeGreaterThan(0)
    // tek jeneratör %70 eşiğini aşmaz
    expect(a.nodes.sync.kva).toBeLessThanOrEqual(0.7 * 1800 + 1e-6)
    expect(a.unserved.totalKw).toBe(0)
    const steps = simulateFailure(light, ['tx'])
    expect(steps.map((s) => s.id)).toContain('staging')
  })

  it('TX.PL1 arızası giderilince: STS/ATS geri transfer, jeneratörler yüksüz çalışıp durur', () => {
    const steps = simulateFailure(p, ['tx'])
    const gen = steps[steps.length - 1]
    const rec = simulateRecovery(p, ['tx'], gen, undefined)
    expect(rec.map((r) => r.id)).toEqual(['clear', 'retransfer', 'genStop'])
    // Arıza giderildi ama MSB henüz jeneratörde (geri transfer gecikmesi)
    expect(rec[0].analysis.nodes.tx.energized).toBe(true)
    expect(rec[0].analysis.nodes.gen1.totalKw).toBeGreaterThan(100)
    expect(rec[1].changes.some((c) => c.kind === 'transfer' && /MSB\.PL1/.test(c.text))).toBe(true)
    expect(rec[1].analysis.nodes.gen1.totalKw).toBe(0)
    expect(rec[1].analysis.nodes.gen1.running).toBe(true)
    expect(rec[rec.length - 1].id).toBe('genStop')
    const end = rec[rec.length - 1]
    expect(end.lostKw).toBe(0)
    expect(end.analysis.nodes.gen1.running).toBeFalsy()
    expect(end.analysis.nodes.gen1.totalKw).toBe(0)
    expect(end.analysis.nodes.tx.totalKw).toBeGreaterThan(0)
  })

  it('senkron panosu şemadaki gibi: iki jeneratör, GEN.PL1.1 öncelikli, %70 eşik', () => {
    expect(node('sync').type).toBe('senkron')
    expect(node('sync').params).toMatchObject({ mod: 'sirali', esik: 70 })
    expect(p.edges.filter((e) => e.target === 'sync')).toHaveLength(2)
  })
})
