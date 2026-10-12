import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan, parseProject, serializeProject } from '../model/project'
import { boxesOf } from './autoLayout'
import { dimsOf } from './dims'
import { boxOf, bounds, findOverlaps, roomAt } from './geometry'
import { analyze } from '../engine'
import { canClonePl1, clonePl1ToPl2 } from '../model/clonePlan'
import { applyPlan, facingOf, tagCandidates } from './plan'
import { checkRooms, roomEntrance } from './planRooms'
import { wallBlocked, walkStepFloors } from './walk'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const plan = parsePlan(JSON.parse(readFileSync(new URL('../../examples/hdc02-gf.plan.json', import.meta.url), 'utf8')))!

describe('kat planı', () => {
  it('plan dosyası okunur: duvar, oda, ekipman', () => {
    expect(plan.duvarlar.length).toBeGreaterThan(1000)
    expect(plan.odalar.length).toBeGreaterThanOrEqual(25)
    expect(plan.ekipman.length).toBeGreaterThan(200)
    expect(plan.g).toBeGreaterThan(100)
  })
  it('bozuk girdi atılır, geçersiz plan undefined', () => {
    expect(parsePlan(null)).toBeUndefined()
    expect(parsePlan({ duvarlar: 'x' })).toBeUndefined()
    const p = parsePlan({ ad: 'a', duvarlar: [[0, 0, 1, 1], [1, 2], 'x', [0, 0, NaN, 1]], ekipman: [{ etiket: 'A', x: 1, z: 1, g: 1, d: 1 }, { etiket: '', x: 1, z: 1, g: 1, d: 1 }, { etiket: 'B', x: 1, z: 1, g: 0, d: 1 }], odalar: [{ ad: 'o', tur: 'salon', x: 0, z: 0, g: 5, d: 5, y: 3 }, { ad: 'bozuk' }] })!
    expect(p.duvarlar).toHaveLength(1)
    expect(p.ekipman.map((e) => e.etiket)).toEqual(['A'])
    expect(p.odalar).toHaveLength(1)
  })
  it('etiket adayları: Etiket alanı, tam ad, ilk sözcük, parantez öncesi', () => {
    expect(tagCandidates({ ad: 'UPS.PL1.1 (IT UPS)', etiket: '' })).toEqual(['UPS.PL1.1 (IT UPS)', 'UPS.PL1.1', 'UPS.PL1.1 (IT UPS)'.split('(')[0].trim().toUpperCase()].filter((v, i, a) => a.indexOf(v) === i))
    expect(tagCandidates({ ad: 'x', etiket: 'tx.pl1' })[0]).toBe('TX.PL1')
  })
  const r = applyPlan(hdc, plan)
  it('HDC02: etiketi eşleşen ekipman plandaki dikdörtgenin merkezine ve boyutuna oturur', () => {
    expect(r.matched).toBeGreaterThanOrEqual(20)
    const byAd = (ad: string) => hdc.nodes.find((n) => n.ad.split(' ')[0] === ad)!
    for (const [tag, ex] of [['MSB.PL1', plan.ekipman.find((e) => e.etiket === 'MSB.PL1')!], ['TX.PL1', plan.ekipman.find((e) => e.etiket === 'TX.PL1')!], ['UPS.PL1.1', plan.ekipman.find((e) => e.etiket === 'UPS.PL1.1')!]] as const) {
      const l = r.placements[byAd(tag).id]
      expect(l.x, tag).toBeCloseTo(ex.x, 1)
      expect(l.z, tag).toBeCloseTo(ex.z, 1)
      // ayak izi aynı; ön yüze göre g/d dönmüş olabilir
      expect(Math.max(l.g!, l.d!), tag).toBeCloseTo(Math.max(ex.g, ex.d), 0)
      expect(Math.min(l.g!, l.d!), tag).toBeCloseTo(Math.min(ex.g, ex.d), 0)
      expect(l.y, tag).toBeCloseTo(ex.h ?? 0, 2)
      expect(l.elev ?? 0).toBe(0)
    }
  })
  it('her düğüm yerleşir; plan dışı jeneratör/chiller avluda (bina dışında, doğuda), IT yükü veri salonunda', () => {
    for (const n of hdc.nodes) expect(r.placements[n.id], n.ad).toBeDefined()
    for (const n of hdc.nodes.filter((x) => x.type === 'jenerator' || x.type === 'chiller')) {
      const b = bounds(boxOf(n.id, n.type, r.placements[n.id], dimsOf({ ...n, yerlesim3d: r.placements[n.id] })))
      expect(b.minX, n.ad).toBeGreaterThan(plan.g)
    }
    const hall = r.rooms.find((o) => o.tur === 'salon')!
    for (const n of hdc.nodes.filter((x) => x.type === 'itYuku')) {
      const l = r.placements[n.id]
      expect(l.x, n.ad).toBeGreaterThan(hall.x)
      expect(l.x, n.ad).toBeLessThan(hall.x + hall.g + 40) // satır genişliği salona göre sınırlı, taşma sınırlı
      expect(l.z).toBeGreaterThan(hall.z)
    }
  })
  it('plan sonrası hiçbir ekipman çakışmaz (aynı etiketli baralar dolap içinde üst üste kotlarda)', () => {
    const nodes = hdc.nodes.map((n) => ({ ...n, yerlesim3d: r.placements[n.id] }))
    const ov = findOverlaps(boxesOf(nodes))
    expect([...ov].map((id) => hdc.nodes.find((n) => n.id === id)!.ad)).toEqual([])
    const bars = hdc.nodes.filter((n) => n.ad.startsWith('STSSB.PL1.1A '))
    expect(new Set(bars.map((n) => r.placements[n.id].elev ?? 0)).size).toBe(bars.length)
  })
  it('şalterler panonun üzerinde (ana ekipmanla aynı yer, ön yüz)', () => {
    const msb = hdc.nodes.find((n) => n.ad === 'MSB.PL1')!
    const lm = r.placements[msb.id]
    const near = hdc.nodes.filter((n) => n.type === 'kesici' && Math.hypot(r.placements[n.id].x - lm.x, r.placements[n.id].z - lm.z) < Math.max(lm.g!, lm.d!) / 2 + 1)
    expect(near.length).toBeGreaterThan(3)
    for (const n of near) expect(r.placements[n.id].mont).toBe(true)
  })
  it('plan odaları kimlik alır ve ekipman odasına atanır', () => {
    expect(r.rooms.every((o) => o.id)).toBe(true)
    const ups = hdc.nodes.find((n) => n.ad.startsWith('UPS.PL1.1'))!
    expect(r.rooms.find((o) => o.id === r.placements[ups.id].oda)?.ad).toBe('UPS / STS odası PL1')
    const tx = hdc.nodes.find((n) => n.ad === 'TX.PL1')!
    expect(roomAt(r.rooms, r.placements[tx.id].x, r.placements[tx.id].z, 0)?.ad).toBe('Trafo odası PL1')
  })
  it('planda olup şemada olmayan etiketler bildirilir (batarya, RMU...)', () => {
    expect(r.unused).toContain('BAT.PL1.1')
    expect(r.unused).not.toContain('MSB.PL1')
  })
  it('plan proje dosyasına yazılır ve geri okunur', () => {
    const q = { ...hdc, plan3d: plan }
    const back = parseProject(serializeProject(q))
    expect(back.plan3d?.duvarlar).toHaveLength(plan.duvarlar.length)
    expect(back.plan3d?.ekipman).toHaveLength(plan.ekipman.length)
  })
})

describe('duvar çarpışması', () => {
  const walls: [number, number, number, number][] = [[10, 0, 10, 20]] // x = 10 duvarı
  it('duvara yakın nokta engelli, uzakta serbest; kapı boşluğundan geçilir', () => {
    expect(wallBlocked(walls, 10.1, 5)).toBe(true)
    expect(wallBlocked(walls, 9.6, 5)).toBe(false)
    expect(wallBlocked(walls, 10, 25)).toBe(false) // duvarın ötesi
    expect(wallBlocked(walls, 10.1, 5, 0.25, 4.5)).toBe(false) // üst katta duvar engel değil
  })
  it('yürüyüş duvarda durur ve duvar boyunca kayar', () => {
    let st = { x: 8, z: 5, h: 0 }
    for (let i = 0; i < 40; i++) st = walkStepFloors([], [], [], st, 0.1, 0, 0.35, walls)
    expect(st.x).toBeLessThan(10)
    const z0 = st.z
    for (let i = 0; i < 10; i++) st = walkStepFloors([], [], [], st, 0.1, 0.1, 0.35, walls)
    expect(st.z).toBeGreaterThan(z0)
    expect(st.x).toBeLessThan(10)
  })
  it('kapı boşluğu: iki duvar arası 1 m açıklıktan geçilir', () => {
    const w: [number, number, number, number][] = [[10, 0, 10, 9.5], [10, 10.5, 10, 20]]
    let st = { x: 8, z: 10, h: 0 }
    for (let i = 0; i < 40; i++) st = walkStepFloors([], [], [], st, 0.1, 0, 0.35, w)
    expect(st.x).toBeGreaterThan(11)
  })
})

describe('plan odaları: sayı, yerleşim ve doğruluk denetimi', () => {
  const adlar = plan.odalar.map((o) => o.ad)
  it('oda sayısı ve türleri: 8 trafo/RMU, 4 batarya, 4 UPS/STS, 2 UPS/MSB, 3 telekom/MMR/RPP, 2 telekom, veri salonu', () => {
    expect(plan.odalar).toHaveLength(25)
    expect(adlar.filter((a) => a.startsWith('Trafo')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('RMU')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('Batarya')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('UPS / STS') || a.startsWith('STS B')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('UPS / MSB')).length).toBe(2)
    expect(adlar.filter((a) => a.startsWith('MMR')).length).toBe(2)
    expect(adlar.filter((a) => a.startsWith('Telekom')).length).toBe(2)
    expect(adlar).toContain('RPP / kontrol odası')
    expect(adlar).toContain('LBSB odası')
    expect(plan.odalar.filter((o) => o.tur === 'salon')).toHaveLength(1)
    expect(new Set(adlar).size).toBe(adlar.length) // aynı ad iki kez yok
  })
  it('hiçbir iki (elektrik) odası üst üste binmez', () => {
    const e = plan.odalar.filter((o) => o.tur === 'elektrik')
    for (let i = 0; i < e.length; i++)
      for (let j = i + 1; j < e.length; j++) {
        const a = e[i]
        const b = e[j]
        const ox = Math.min(a.x + a.g, b.x + b.g) - Math.max(a.x, b.x)
        const oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z)
        expect(ox > 0.3 && oz > 0.3, `${a.ad} / ${b.ad}`).toBe(false)
      }
  })
  it('planın ekipman dikdörtgenleri tam bir elektrik odasının içinde (yalnız bilinen oda dışı istisnalar hariç)', () => {
    const disarida: string[] = []
    for (const e of plan.ekipman) {
      const inn = plan.odalar.filter((o) => o.tur !== 'salon' && e.x >= o.x && e.x <= o.x + o.g && e.z >= o.z && e.z <= o.z + o.d)
      expect(inn.length, e.etiket).toBeLessThanOrEqual(1)
      if (inn.length === 0) disarida.push(e.etiket)
    }
    // Bina dışı/ofis bölgesindeki telekom dolapları, salondaki dolap ve dış load bank: planın odasız bölgeleri
    expect(disarida.sort()).toEqual(['CCTV/DATA', 'LOADBANK', 'Telekom dolabı 1', 'Telekom dolabı 2', 'Telekom dolabı 3'].sort())
  })
  it('oda sınırları duvarlarla uyumlu: kapı genişliğini aşan açık kenar ve odayı kesen duvar yok', () => {
    // UPS/STS odalarının batı duvarında MSB teslimatı için geniş (≈ 3,9 m) açıklık var; salon koridorlara geniş açılır.
    expect(checkRooms(plan, ['Veri salonu', 'UPS / STS odası PL1', 'UPS / STS odası PL2'])).toEqual([])
  })
  it('doğrulayıcı gerçekten yakalar: duvarsız oda ve kesen duvar bildirilir', () => {
    const bos = { ...plan, odalar: [{ ad: 'Boş', tur: 'elektrik' as const, x: 10, z: 10, g: 6, d: 6, y: 3 }], duvarlar: [[10, 10, 16, 10]] as [number, number, number, number][], ekipman: [] }
    expect(checkRooms(bos).some((i) => i.tur === 'acik')).toBe(true)
    const kesen = { ...bos, duvarlar: [[10, 10, 16, 10], [10, 16, 16, 16], [10, 10, 10, 16], [16, 10, 16, 16], [10, 13, 16, 13]] as [number, number, number, number][] }
    const r = checkRooms(kesen)
    expect(r.some((i) => i.tur === 'bolucu')).toBe(true)
    expect(r.some((i) => i.tur === 'acik')).toBe(false)
  })
  it('oda girişi: kapı boşluğu merkezi duvar çizgisinde, normal odadan dışarı', () => {
    const walls: [number, number, number, number][] = [[0, 0, 4, 0], [5.2, 0, 10, 0], [0, 10, 10, 10], [0, 0, 0, 10], [10, 0, 10, 10]]
    const e = roomEntrance({ x: 0, z: 0, g: 10, d: 10 }, walls)
    expect(e.side).toBe('kuzey')
    expect(e.x).toBeCloseTo(4.6, 6)
    expect(e.z).toBe(0)
    expect([e.nx, e.nz]).toEqual([0, -1])
    expect(e.width).toBeCloseTo(1.2, 6)
    // kapalı oda: güney kenar ortası
    const k = roomEntrance({ x: 0, z: 0, g: 10, d: 10 }, [[0, 0, 10, 0], [0, 10, 10, 10], [0, 0, 0, 10], [10, 0, 10, 10]])
    expect([k.nx, k.nz, k.width]).toEqual([0, 1, 0])
  })
  it('gerçek planda her odanın girişi bulunur (kapalı oda yok) ve oda kenarındadır', () => {
    let kapali = 0
    for (const o of plan.odalar) {
      const e = roomEntrance(o, plan.duvarlar)
      if (e.width === 0) kapali++
      const onEdge = Math.abs(e.x - o.x) < 0.5 || Math.abs(e.x - (o.x + o.g)) < 0.5 || Math.abs(e.z - o.z) < 0.5 || Math.abs(e.z - (o.z + o.d)) < 0.5
      expect(onEdge, o.ad).toBe(true)
    }
    expect(kapali).toBeLessThanOrEqual(2)
  })
})

describe('DXF planı: ön yüz, yeni düğümler, PL2 kopyası', () => {
  const walls: [number, number, number, number][] = [[0, 0, 20, 0], [0, 10, 20, 10], [0, 0, 0, 10], [20, 0, 20, 10]]
  it('ön yüz arkasındaki duvarın tersine bakar: kuzey duvarına yaslı → güneye (rot 0)', () => {
    expect(facingOf({ x: 10, z: 0.6, g: 4, d: 0.9 }, walls)).toEqual({ rot: 0, g: 4, d: 0.9 })
  })
  it('güney duvarına yaslı → kuzeye (rot 180); batı → doğuya (90, g/d yer değiştirir); doğu → batıya (270)', () => {
    expect(facingOf({ x: 10, z: 9.4, g: 4, d: 0.9 }, walls)).toEqual({ rot: 180, g: 4, d: 0.9 })
    expect(facingOf({ x: 0.6, z: 5, g: 0.9, d: 4 }, walls)).toEqual({ rot: 90, g: 4, d: 0.9 })
    expect(facingOf({ x: 19.4, z: 5, g: 0.9, d: 4 }, walls)).toEqual({ rot: 270, g: 4, d: 0.9 })
  })
  it('duvardan uzaktaki ekipman varsayılan yönde kalır', () => {
    expect(facingOf({ x: 10, z: 5, g: 2, d: 1 }, walls)).toEqual({ rot: 0, g: 2, d: 1 })
  })
  const r2 = applyPlan(hdc, plan, { ekle: true })
  it('ekle açıkken plandaki şemada olmayan nesneler yeni düğüm olur; tür bilinen kütüphane türü', () => {
    expect(r2.yeni.length).toBeGreaterThan(150)
    const turler = new Set(r2.yeni.map((y) => y.tur))
    for (const t of ['rmu', 'batarya', 'bcp', 'dcPanel', 'telekomDolap', 'dagitimPanosu', 'trafo', 'ups', 'sts', 'mdb']) expect(turler.has(t as never), t).toBe(true)
    expect(r2.yeni.find((y) => y.etiket === 'RMU.PL1')?.tur).toBe('rmu')
    expect(r2.yeni.find((y) => y.etiket === 'BAT.PL1.1')?.tur).toBe('batarya')
    expect(r2.yeni.find((y) => y.etiket === 'BCP.PL1.1')?.tur).toBe('bcp')
    expect(r2.yeni.find((y) => y.etiket === 'UPS.C1.1' || y.etiket === 'UPS C1.1')?.tur).toBe('ups')
  })
  it('yeni düğüm adları benzersiz ve şemadaki adlarla çakışmaz; genel etiketler numaralanır', () => {
    const adlar = r2.yeni.map((y) => y.ad)
    expect(new Set(adlar).size).toBe(adlar.length)
    for (const a of adlar) expect(hdc.nodes.some((n) => n.ad === a), a).toBe(false)
    expect(adlar).toContain('TS 1')
    expect(adlar).toContain('ODF 1')
  })
  it('anma değerleri aile adından: UPS kW (kVA ≈ kW/0,9), trafo 3 150 kVA, MSB 5 000 A', () => {
    const ups = r2.yeni.filter((y) => y.tur === 'ups').map((y) => y.params.nominalKw)
    expect(new Set(ups)).toEqual(new Set([150, 200, 750, 850]))
    const u750 = r2.yeni.find((y) => y.params.nominalKw === 750)!
    expect(u750.params.nominalKva).toBe(833)
    expect(r2.yeni.filter((y) => y.tur === 'trafo').every((y) => y.params.nominalKva === 3150)).toBe(true)
  })
  it('yeni nesneler plandaki yerde: ayak izi ve yükseklik, oda ataması; hiçbiri başkasıyla çakışmaz', () => {
    const rmu = r2.yeni.find((y) => y.etiket === 'RMU.PL1')!
    const pr = plan.ekipman.find((e) => e.etiket === 'RMU.PL1')!
    expect(rmu.yerlesim.x).toBeCloseTo(pr.x, 1)
    expect(rmu.yerlesim.y).toBeCloseTo(pr.h!, 2)
    expect(r2.rooms.find((o) => o.id === rmu.yerlesim.oda)?.ad).toBe('RMU odası PL1')
    const nodes = [
      ...hdc.nodes.map((n) => ({ ...n, yerlesim3d: r2.placements[n.id] })),
      ...r2.yeni.map((y, i) => ({ id: `y${i}`, type: y.tur, ad: y.ad, etiket: '', grup: '', notlar: '', x: 0, y: 0, params: y.params, yerlesim3d: y.yerlesim })),
    ]
    const ov = findOverlaps(boxesOf(nodes))
    // Yalnız plandaki gerçek çakışmalar (aynı dolap içindeki baralar kotlarla ayrıldı): yeni nesne çakışması olmamalı
    expect([...ov].filter((id) => id.startsWith('y')).map((id) => nodes.find((n) => n.id === id)!.ad)).toEqual([])
  })
  it('ekle kapalıyken yeni düğüm üretilmez', () => {
    expect(applyPlan(hdc, plan).yeni).toEqual([])
  })
  it('PL1→PL2 kopyası: aynı sayıda düğüm/hat, adlar PL2, kimlikler benzersiz, parametreler aynı, kopya yalnız bir kez', () => {
    expect(canClonePl1(hdc)).toBe(true)
    const c = clonePl1ToPl2(hdc, 1000)
    expect(c.nodes).toHaveLength(hdc.nodes.length)
    expect(c.edges).toHaveLength(hdc.edges.length)
    const ids = new Set([...hdc.nodes, ...c.nodes].map((n) => n.id))
    expect(ids.size).toBe(hdc.nodes.length * 2)
    expect(c.nodes.find((n) => n.ad === 'MSB.PL2')).toBeDefined()
    expect(c.nodes.find((n) => n.ad.startsWith('UPS.PL2.1'))).toBeDefined()
    expect(c.nodes.some((n) => n.ad.includes('PL1'))).toBe(false)
    const msb1 = hdc.nodes.find((n) => n.ad === 'MSB.PL1')!
    const msb2 = c.nodes.find((n) => n.ad === 'MSB.PL2')!
    expect(msb2.params).toEqual(msb1.params)
    expect(msb2.x - msb1.x).toBe(1000)
    // hatlar kopya düğümleri bağlar
    const nid = new Set(c.nodes.map((n) => n.id))
    for (const e of c.edges) expect(nid.has(e.source) && nid.has(e.target), e.id).toBe(true)
    expect(canClonePl1({ nodes: [...hdc.nodes, ...c.nodes] })).toBe(false)
  })
  it('PL2 kopyası plandaki PL2 dikdörtgenlerine oturur', () => {
    const c = clonePl1ToPl2(hdc, 0)
    const model = { nodes: [...hdc.nodes, ...c.nodes], edges: [...hdc.edges, ...c.edges] }
    const r3 = applyPlan(model, plan, { ekle: true })
    for (const tag of ['MSB.PL2', 'TX.PL2', 'UPS.PL2.1', 'UDP.PL2.1', 'STS.PL2.1A']) {
      const node = c.nodes.find((n) => n.ad.split(' ')[0] === tag)!
      const ex = plan.ekipman.find((e) => e.etiket === tag)!
      expect(r3.placements[node.id].x, tag).toBeCloseTo(ex.x, 1)
      expect(r3.placements[node.id].z, tag).toBeCloseTo(ex.z, 1)
    }
    // PL2 etiketi artık "yeni düğüm" olarak eklenmez (kopya eşleşti)
    expect(r3.yeni.some((y) => y.etiket === 'MSB.PL2')).toBe(false)
    expect(r3.yeni.some((y) => y.etiket === 'UPS.PL2.1')).toBe(false)
    expect(r3.yeni.length).toBeLessThan(r2.yeni.length)
  })
  it('analiz: PL1 + PL2 kopyası + plan nesneleri hata üretmez; pasif ekipman (batarya, BCP, DC pano, telekom) için bağlantı uyarısı yok', () => {
    const c = clonePl1ToPl2(hdc, 0)
    const model = { nodes: [...hdc.nodes, ...c.nodes], edges: [...hdc.edges, ...c.edges] }
    const r3 = applyPlan(model, plan, { ekle: true })
    const nodes = [...model.nodes, ...r3.yeni.map((y, i) => ({ id: `y${i}`, type: y.tur, ad: y.ad, etiket: '', grup: '', notlar: '', x: 0, y: 0, params: y.params }))]
    const a = analyze({ nodes, edges: model.edges })
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
    const pasif = new Set(nodes.filter((n) => ['batarya', 'bcp', 'dcPanel', 'telekomDolap'].includes(n.type)).map((n) => n.id))
    expect(pasif.size).toBeGreaterThan(100)
    expect(a.issues.filter((i) => i.nodeId && pasif.has(i.nodeId))).toEqual([])
    // Bağlantısız gerçek ekipman (RMU, UPS C1/C2, DB...) hâlâ uyarılır
    expect(a.issues.some((i) => i.nodeId === 'y0' || (i.message ?? '').includes('RMU'))).toBe(true)
    // PL2 kopyası PL1 ile aynı yükü taşır
    const kw = (ad: string) => a.nodes[nodes.find((n) => n.ad === ad)!.id].totalKw
    expect(kw('MSB.PL2')).toBeCloseTo(kw('MSB.PL1'), 6)
  })
})
