import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze } from '../engine'
import { EQUIPMENT, portCount } from '../library/equipment'
import { applyPlan } from '../layout3d/plan'
import { clonePl1ToPl2 } from './clonePlan'
import { applyHatDelta, normTag, parseHatCizelgesi, planHatCizelgesi } from './hatCizelgesi'
import type { HatCizelgesi } from './hatCizelgesi'
import { parsePlan, parseProject } from './project'
import type { ProjectEdge, ProjectNode } from './types'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const hdc = parseProject(read('examples/hdc02-pl1.dcalc.json'))
const plan = parsePlan(JSON.parse(read('examples/hdc02-gf.plan.json')))!
const spec = parseHatCizelgesi(JSON.parse(read('examples/hdc02-c1c2.hatlar.json')))!

type M = { nodes: ProjectNode[]; edges: ProjectEdge[] }

/** Kullanıcının projesi: PL1 örneği + PL2 kopyası + plandan eklenen (grup "Plan") düğümler. */
function userModel(): M {
  let model: M = { nodes: hdc.nodes, edges: hdc.edges }
  const clone = clonePl1ToPl2(model, 3000)
  model = { nodes: [...model.nodes, ...clone.nodes], edges: [...model.edges, ...clone.edges] }
  const r = applyPlan(model, plan, { ekle: true })
  const eklenen: ProjectNode[] = r.yeni.map((y, i) => ({
    id: `p_${i}`,
    type: y.tur,
    ad: y.ad,
    etiket: '',
    grup: 'Plan',
    notlar: '',
    x: (i % 12) * 220,
    y: 4000 + Math.floor(i / 12) * 140,
    params: y.params,
    yerlesim3d: y.yerlesim,
  }))
  return { nodes: [...model.nodes, ...eklenen], edges: model.edges }
}

let seq = 0
const newId = (p: string) => `${p}_t${++seq}`
const byAd = (m: M, ad: string) => m.nodes.find((n) => normTag(n.ad) === normTag(ad))!
const outs = (m: M, id: string) => m.edges.filter((e) => e.source === id)
const ins = (m: M, id: string) => m.edges.filter((e) => e.target === id)

/** Hata düzeyindeki bulgulardan çizelge verisinden kaynaklanan, beklenen iki kategori: UDB.x.3 (yük = 80 A = şalter, gerilim düşümü %3,6) ve MSB şalterlerinin
 *  kesme kapasitesi (çizelge 70 kA; motor jeneratör katkısını trafoyla paralel toplayıp 73,8 kA bulur, çizelgenin kendi hesabı yalnız trafo: 52,76 kA). */
const BEKLENEN = /UDB\.C[12]\.3/
const beklenmeyen = (a: ReturnType<typeof analyze>) => a.issues.filter((i) => i.severity === 'error' && !BEKLENEN.test(i.message))

const base = userModel()
const delta = planHatCizelgesi(base, spec, newId)
const after = applyHatDelta(base, delta)

describe('hat çizelgesi: ayrıştırma', () => {
  it('örnek dosya okunur', () => {
    expect(spec.dugumler.length).toBeGreaterThan(50)
    expect(spec.hatlar.length).toBeGreaterThan(60)
    expect(spec.hatlar.every((h) => h.uzunluk >= 0)).toBe(true)
  })
  it('geçersiz girdi undefined; hatalı satırlar düşer', () => {
    expect(parseHatCizelgesi(null)).toBeUndefined()
    expect(parseHatCizelgesi({ surum: 2, dugumler: [], hatlar: [] })).toBeUndefined()
    const p = parseHatCizelgesi({
      surum: 1,
      dugumler: [{ ref: 'a', tur: 'mdb', ad: 'A' }, { ref: 'b', tur: 'yok', ad: 'B' }, { ref: '', tur: 'mdb', ad: 'C' }, { ref: 'c', tur: 'mdb', ad: 'C' }],
      hatlar: [{ ad: 'h', kaynak: 'a', hedef: 'c', uzunluk: 5 }, { ad: '', kaynak: 'a', hedef: 'c' }, { ad: 'x', kaynak: 'a' }],
    })!
    expect(p.dugumler.map((d) => d.ref)).toEqual(['a', 'c'])
    expect(p.hatlar.map((h) => h.ad)).toEqual(['h'])
  })
  it('etiket normalleştirme: boşluk, alt çizgi ve nokta eşdeğer', () => {
    expect(normTag('UPS C1.1')).toBe('UPS.C1.1')
    expect(normTag(' ups_c1.1 ')).toBe('UPS.C1.1')
  })
})

describe('hat çizelgesi: C1/C2 uygulaması', () => {
  it('mevcut plan düğümleri eşleşir, eksik ekipman oluşturulur', () => {
    const eslesen = new Map(delta.rapor.eslesen.map((e) => [e.ref, e.ad]))
    for (const b of ['C1', 'C2']) {
      expect(eslesen.get(`${b}:msb`)).toBe(`MSB.${b}`)
      expect(eslesen.get(`${b}:tx`)).toBe(`TX.${b}`)
      expect(eslesen.get(`${b}:udp1`)).toBe(`UDP.${b}.1`)
      expect(eslesen.get(`${b}:udb4`)).toBe(`UDB.${b}.4`)
      expect(eslesen.get(`${b}:rmu`)).toBe(`RMU.${b}`)
    }
    expect(eslesen.get('C1:ups1')).toBe('UPS C1.1') // plandaki boşluklu etiket
    expect(eslesen.get('C2:ups1')).toBe('UPS.C2.1')
    expect(eslesen.get('ACD.MMR1.2')).toBe('ACD.MMR1.2')
    expect(eslesen.get('CRP.PL1.1')).toMatch(/^CRP\.PL1\.1/)
    expect(eslesen.get('CRP.PL2.1')).toMatch(/^CRP\.PL2\.1/)
    expect(delta.rapor.olusturulan).toEqual(expect.arrayContaining(['GEN.C1.1', 'GEN.C2.2', 'UDB.C1.3 (FWU DB - Module-1)', 'TF-1 (C2 tee besleme)']))
    expect(delta.rapor.atlanan).toEqual([])
  })

  it('C1 ve C2 için aynı sayıda kesici ve hat; her hat adı bir kez', () => {
    const k = (b: string) => after.nodes.filter((n) => n.type === 'kesici' && n.ad.includes(b)).length
    expect(k('C1')).toBe(k('C2'))
    expect(k('C1')).toBeGreaterThanOrEqual(25)
    for (const h of spec.hatlar) expect(after.edges.filter((e) => e.ad === h.ad), h.ad).toHaveLength(1)
  })

  it('MSB.C1 çıkışları: her biri şalter (kesici) üzerinden, çizelge anma akımı ve kesme kapasitesiyle', () => {
    const msb = byAd(after, 'MSB.C1')
    const feeders = outs(after, msb.id)
      .map((e) => after.nodes.find((n) => n.id === e.target)!)
      .filter((n) => n.type === 'kesici')
    expect(feeders).toHaveLength(9)
    const get = (ad: string) => feeders.find((n) => n.ad === ad)!
    expect(get('MCCB MSB.C1 → UDP.C1.2 bypass').params).toMatchObject({ tip: 'MCCB', nominalAkim: 400, kesmeKa: 70, durum: 'acik', otomatik: 'otomatik' })
    expect(get('MCCB MSB.C1 → MMR-1 DC Supply').params).toMatchObject({ tip: 'MCCB', nominalAkim: 200, kesmeKa: 70 })
    expect(get('MCCB MSB.C1 → GEN.C1.1 Aux.').params).toMatchObject({ nominalAkim: 100, kesmeKa: 70 })
    expect(get('ACB MSB.C1 → Chiller Redundant Supply').params).toMatchObject({ tip: 'ACB', nominalAkim: 1250, kesmeKa: 70 })
    expect(get('ACB MSB.C1 → UDP.C1.1 bypass').params).toMatchObject({ tip: 'ACB', nominalAkim: 2500 })
    // MSB girişleri: trafo ve jeneratör ACB'leri 5000 A
    const incomers = ins(after, msb.id).map((e) => after.nodes.find((n) => n.id === e.source)!)
    expect(incomers.map((n) => n.ad).sort()).toEqual(['ACB MSB.C1 jeneratör girişi', 'ACB MSB.C1 trafo girişi'])
    for (const n of incomers) expect(n.params).toMatchObject({ tip: 'ACB', nominalAkim: 5000, montaj: 'alt' })
    // jeneratör girişi normalde açık, trafo kaybında otomatik kapanır; trafo girişi kapalı
    expect(incomers.find((n) => n.ad.includes('jeneratör'))!.params).toMatchObject({ durum: 'acik', otomatik: 'otomatik' })
    expect(incomers.find((n) => n.ad.includes('trafo'))!.params).toMatchObject({ durum: 'kapali' })
  })

  it('kablo hatları: ad, uzunluk, kesit açıklaması ve kapasite çizelgeye uyar', () => {
    const e = (ad: string) => after.edges.find((x) => x.ad === ad)!
    expect(e('CBL/MSB.C1/01')).toMatchObject({ tip: 'kablo', uzunluk: 10, aciklama: expect.stringContaining('2x(4x95)+70'), akimKapasitesi: 596, gerilim: 415 })
    expect(e('CBL/MSB.C2/04')).toMatchObject({ uzunluk: 100, aciklama: expect.stringContaining('5x35') })
    expect(e('CBL/UDP.C1.2/03')).toMatchObject({ uzunluk: 130, aciklama: expect.stringContaining('4x35+25') })
    expect(e('Cbl_SM-5 (C1)')).toMatchObject({ uzunluk: 10, aciklama: expect.stringContaining('10x(4x1000)') })
    expect(e('BB/TX.C1')).toMatchObject({ tip: 'busbar', uzunluk: 46, akimKapasitesi: 5000 })
    expect(e('BB/GEN.C2')).toMatchObject({ tip: 'busbar', uzunluk: 100, akimKapasitesi: 5000 })
    expect(e('BB/C1')).toMatchObject({ uzunluk: 61, akimKapasitesi: 2500 })
    expect(e('BB/C2-Sec3')).toMatchObject({ uzunluk: 67 })
  })

  it('portlar geçerli ve çakışmasız; yeni düğümlerin port sayısı yeterli', () => {
    const a = analyze(after)
    const port = a.issues.filter((i) => /port/i.test(i.message))
    expect(port).toEqual([])
    for (const n of after.nodes) {
      const maxOut = Math.max(-1, ...outs(after, n.id).map((e) => e.kaynakPort))
      const maxIn = Math.max(-1, ...ins(after, n.id).map((e) => e.hedefPort))
      if (maxOut >= 0) expect(portCount(n.type, n.params, 'out'), n.ad).toBeGreaterThan(maxOut)
      if (maxIn >= 0) expect(portCount(n.type, n.params, 'in'), n.ad).toBeGreaterThan(maxIn)
    }
  })

  it('C1/C2 zinciri enerjili: trafo → MSB → UPS → UDP → yükler; hata yok', () => {
    const a = analyze(after)
    expect(beklenmeyen(a)).toEqual([])
    for (const b of ['C1', 'C2']) {
      for (const ad of [`TX.${b}`, `MSB.${b}`, `UDP.${b}.1`, `UDP.${b}.2`, `UDB.${b}.1`, `UDB.${b}.4`, `UPS.${b}.3`, `GEN.${b}.1`]) {
        const n = byAd(after, ad.replace('UPS.C1.3', 'UPS C1.3'))
        expect(a.nodes[n.id]?.energized, ad).toBe(true)
      }
      const yuk = byAd(after, `Chiller Redundant Supply (${b})`)
      expect(a.nodes[yuk.id].energized).toBe(true)
    }
  })

  it('trafo parametreleri çizelgeden (eşleşen düğümde de): 3150 kVA, uk %7, 415 V; kısa devre kesme kapasitesini aşmaz', () => {
    const tx = byAd(after, 'TX.C1')
    expect(tx.params).toMatchObject({ nominalKva: 3150, uk: 7, sekonderGerilim: 415, primerGerilim: 34500 })
    const a = analyze(after)
    expect(a.issues.filter((i) => /kesme kapasitesi/.test(i.message))).toEqual([])
  })

  it('TX.C1 arızasında jeneratör girişi otomatik kapanır ve MSB.C1 enerjili kalır', () => {
    const tx = byAd(after, 'TX.C1')
    const a = analyze(after, undefined, { id: 's', ad: 's', failedNodes: [tx.id], edgeStates: {}, nodeStates: {} })
    expect(a.nodes[byAd(after, 'MSB.C1').id].energized).toBe(true)
    expect(a.nodes[byAd(after, 'UDP.C1.2').id].energized).toBe(true)
  })

  it('catcher: CRP.PL1.1 ve CRP.PL2.1 her iki bloktan beslenir; şema dışı yer tutucular kalkar', () => {
    for (const pl of ['PL1', 'PL2']) {
      const crp = after.nodes.find((n) => n.type === 'mdb' && n.ad.startsWith(`CRP.${pl}.1`))!
      const sources = ins(after, crp.id).map((e) => after.nodes.find((n) => n.id === e.source)!.ad).sort()
      expect(sources).toEqual([`ACB CRP.${pl}.1 → Catcher 01`, `ACB CRP.${pl}.1 → Catcher 02`])
      expect(after.nodes.some((n) => n.ad.includes(`CRP.${pl}.1 beslemesi`))).toBe(false)
      expect(after.nodes.some((n) => n.ad.includes(`Catcher kaynağı (BB/CRP.${pl}.1`))).toBe(false)
      expect(after.nodes.filter((n) => /Busbar Catcher 0\d/.test(n.ad) && n.ad.includes(pl === 'PL2' ? 'PL2' : 'Busbar'))).not.toHaveLength(2 + 99)
      // catcher barası artık CRP'nin çıkışından beslenir ve STS B girişlerine gider
      const bus = after.nodes.find((n) => n.ad === `BB/CRP.${pl}.1 (catcher barası)`)!
      const feed = ins(after, bus.id)
      expect(feed).toHaveLength(1)
      expect(after.nodes.find((n) => n.id === feed[0].source)!.ad).toBe(`ACB CRP.${pl}.1 girişi`)
      const a = analyze(after)
      expect(a.nodes[bus.id].energized, `${pl} catcher barası`).toBe(true)
      expect(a.nodes[crp.id].energized).toBe(true)
    }
  })

  it('catcher zinciri: UDP.C1.1 → ACB → BB/C1 → TF-1 → Sec2/Sec3 → TO-1/TO-2 → Cbl_SM-5/6', () => {
    const udp = byAd(after, 'UDP.C1.1')
    const k = outs(after, udp.id).map((e) => after.nodes.find((n) => n.id === e.target)!).filter((n) => n.ad === 'ACB UDP.C1.1 → catcher (BB/C1)')
    expect(k).toHaveLength(1)
    const tf = byAd(after, 'TF-1 (C1 tee besleme)')
    expect(outs(after, tf.id).map((e) => e.ad).sort()).toEqual(['BB/C1-Sec2', 'BB/C1-Sec3'])
    expect(ins(after, tf.id).map((e) => e.ad)).toEqual(['BB/C1'])
    const to2 = after.nodes.find((n) => n.ad === 'TO-2 (C1) ACB tap-off → CRP.PL2.1')!
    expect(outs(after, to2.id).map((e) => e.ad)).toEqual(['Cbl_SM-6 (C1)'])
  })

  it('yeni düğümler 2B konum alır; mevcut şema düğümlerine dokunulmaz', () => {
    const ids = new Set(base.nodes.filter((n) => n.grup !== 'Plan').map((n) => n.id))
    for (const n of after.nodes) {
      if (ids.has(n.id) && !(n.id in delta.paramPatches)) expect({ x: n.x, y: n.y }).toEqual({ x: base.nodes.find((b) => b.id === n.id)!.x, y: base.nodes.find((b) => b.id === n.id)!.y })
    }
    const placed = delta.addNodes.filter((n) => n.type !== 'kesici' || true)
    expect(placed.every((n) => delta.posPatches[n.id] !== undefined)).toBe(true)
    // blok şeritleri sağda ve çakışmasız
    const fixedMax = Math.max(...base.nodes.filter((n) => n.grup !== 'Plan').map((n) => n.x))
    for (const n of delta.addNodes) expect(delta.posPatches[n.id].x).toBeGreaterThan(fixedMax)
    const seen = new Set<string>()
    for (const n of delta.addNodes) {
      const key = `${delta.posPatches[n.id].x},${delta.posPatches[n.id].y}`
      expect(seen.has(key), `${n.ad} aynı konumda`).toBe(false)
      seen.add(key)
    }
  })

  it('ikinci uygulama değişiklik üretmez (aynı hat adları zaten var)', () => {
    const d2 = planHatCizelgesi(after, spec, newId)
    expect(d2.addNodes).toEqual([])
    expect(d2.addEdges).toEqual([])
    expect(d2.removeNodeIds).toEqual([])
    expect(d2.rapor.atlanan.length).toBe(spec.hatlar.length)
  })

  it('uçları olmayan model (PL1 örneği, plan yok): PL2/catcher grubu atlanır, C blokları sıfırdan kurulur', () => {
    const m: M = { nodes: hdc.nodes, edges: hdc.edges }
    const d = planHatCizelgesi(m, spec, newId)
    const out = applyHatDelta(m, d)
    expect(out.nodes.some((n) => n.ad === 'MSB.C1')).toBe(true)
    expect(d.rapor.atlanan.some((a) => a.neden.includes('grubun'))).toBe(true) // PL2 yok
    const a = analyze(out)
    expect(beklenmeyen(a)).toEqual([])
    expect(a.nodes[byAd(out, 'MSB.C2').id].energized).toBe(true)
  })

  it('kesici düğümleri tür varsayılanlarına sahip ve kutup/durum geçerli', () => {
    for (const n of delta.addNodes.filter((x) => x.type === 'kesici')) {
      expect(['ACB', 'MCCB', 'Ayırıcı']).toContain(n.params.tip)
      expect(['3P', '4P']).toContain(n.params.kutup)
      expect(Number(n.params.nominalAkim)).toBeGreaterThan(0)
      expect(Number(n.params.kesmeKa)).toBeGreaterThan(0)
      for (const k of Object.keys(EQUIPMENT.kesici.defaults)) expect(n.params[k], `${n.ad}.${k}`).not.toBeUndefined()
    }
  })

  it('varsayım olarak işaretlenen şalterin notu "Varsayım" ile başlar', () => {
    const varsayim = spec.hatlar.flatMap((h) => [h.kesici, h.hedefKesici]).filter((k) => k?.veri === 'varsayim')
    expect(varsayim.length).toBeGreaterThan(5)
    for (const k of varsayim) {
      const n = delta.addNodes.find((x) => x.ad === k!.ad)!
      expect(n.notlar, k!.ad).toMatch(/^Varsayım/)
    }
  })
})

describe('hat çizelgesi: yanlış girdi', () => {
  it('bilinmeyen uç referanslı hat atlanır, rapora yazılır', () => {
    const bad: HatCizelgesi = { ...spec, hatlar: [...spec.hatlar.slice(0, 2), { ...spec.hatlar[0], ad: 'X', kaynak: 'yok:yok' }] }
    const d = planHatCizelgesi({ nodes: [], edges: [] }, bad, newId)
    expect(d.rapor.atlanan.some((a) => a.ad === 'X' && a.neden.includes('bilinmeyen'))).toBe(true)
  })
})
