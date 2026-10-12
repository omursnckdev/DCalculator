import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan, parseProject, serializeProject } from '../model/project'
import { boxesOf } from './autoLayout'
import { dimsOf } from './dims'
import { boxOf, bounds, findOverlaps, roomAt } from './geometry'
import { applyPlan, tagCandidates } from './plan'
import { checkRooms, roomEntrance } from './planRooms'
import { wallBlocked, walkStepFloors } from './walk'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const plan = parsePlan(JSON.parse(readFileSync(new URL('../../examples/hdc02-gf.plan.json', import.meta.url), 'utf8')))!

describe('kat planı', () => {
  it('plan dosyası okunur: duvar, oda, ekipman', () => {
    expect(plan.duvarlar.length).toBeGreaterThan(1000)
    expect(plan.odalar.length).toBeGreaterThanOrEqual(10)
    expect(plan.ekipman.length).toBeGreaterThan(50)
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
      expect([l.x, l.z, l.g, l.d], tag).toEqual([ex.x, ex.z, ex.g, ex.d])
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
    const near = hdc.nodes.filter((n) => n.type === 'kesici' && Math.hypot(r.placements[n.id].x - lm.x, r.placements[n.id].z - lm.z) < lm.g! / 2 + 1)
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
    expect(plan.odalar).toHaveLength(24)
    expect(adlar.filter((a) => a.startsWith('Trafo')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('RMU')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('Batarya')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('UPS / STS') || a.startsWith('STS B')).length).toBe(4)
    expect(adlar.filter((a) => a.startsWith('UPS / MSB')).length).toBe(2)
    expect(adlar.filter((a) => a.startsWith('MMR')).length).toBe(2)
    expect(adlar.filter((a) => a.startsWith('Telekom')).length).toBe(2)
    expect(adlar).toContain('RPP / kontrol odası')
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
  it('planın her ekipman dikdörtgeni tam bir elektrik odasının içinde', () => {
    for (const e of plan.ekipman) {
      const inn = plan.odalar.filter((o) => o.tur !== 'salon' && e.x >= o.x && e.x <= o.x + o.g && e.z >= o.z && e.z <= o.z + o.d)
      expect(inn.length, e.etiket).toBe(1)
    }
  })
  it('oda sınırları duvarlarla uyumlu: kapı genişliğini aşan açık kenar ve odayı kesen duvar yok', () => {
    expect(checkRooms(plan, ['Veri salonu'])).toEqual([])
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
