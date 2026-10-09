import { describe, expect, it } from 'vitest'
import {
  ProjectFormatError,
  SCHEMA_VERSION,
  emptyProject,
  fromProjectEdges,
  fromProjectNodes,
  migrate,
  parseProject,
  serializeProject,
  toProjectEdges,
  toProjectNodes,
} from './project'
import type { Project } from './types'

function sample(): Project {
  const p = emptyProject('Örnek')
  p.nodes = [
    { id: 'a', type: 'trafo', ad: 'T1', etiket: 'TR-1', grup: 'A', notlar: '', x: 40, y: 80, params: { nominalKva: 2500 } },
    { id: 'b', type: 'mdb', ad: 'AG', etiket: '', grup: '', notlar: 'not', x: 40, y: 240, params: { nominalAkim: 4000 } },
  ]
  p.edges = [
    { id: 'e1', source: 'a', target: 'b', kaynakPort: 0, hedefPort: 0, tip: 'busbar', uzunluk: 12, akimKapasitesi: 4000, r: 0.02, x: 0.05, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '' },
  ]
  return p
}

describe('proje serileştirme', () => {
  it('JSON gidiş-dönüşünde projeyi aynen korur', () => {
    const p = sample()
    expect(parseProject(serializeProject(p))).toEqual(p)
  })

  it('React Flow dönüşümü kayıpsızdır', () => {
    const p = sample()
    expect(toProjectNodes(fromProjectNodes(p.nodes))).toEqual(p.nodes)
    expect(toProjectEdges(fromProjectEdges(p.edges))).toEqual(p.edges)
  })

  it('güncel sürümü yazar', () => {
    expect(emptyProject().schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('şema sürümü', () => {
  it('v1 dosyasını güncel sürüme çevirir (pay = null, isiKonum = elektrik)', () => {
    const v1 = {
      schemaVersion: 1,
      id: 'p',
      name: 'Eski',
      nodes: [
        { id: 'a', type: 'trafo', ad: 'T', etiket: '', grup: '', notlar: '', x: 0, y: 0, params: {} },
        { id: 'b', type: 'mdb', ad: 'M', etiket: '', grup: '', notlar: '', x: 0, y: 100, params: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0.1, x: 0.1, gerilim: 400 }],
    }
    const p = migrate(v1)
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    expect(p.edges[0].pay).toBeNull()
    expect(p.edges[0].isiKonum).toBe('elektrik')
  })

  it('v2 dosyasına isiKonum ekler, pay değerini korur', () => {
    const v2 = {
      schemaVersion: 2,
      nodes: [
        { id: 'a', type: 'trafo', ad: 'T', etiket: '', grup: '', notlar: '', x: 0, y: 0, params: {} },
        { id: 'b', type: 'mdb', ad: 'M', etiket: '', grup: '', notlar: '', x: 0, y: 100, params: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0.1, x: 0.1, gerilim: 400, pay: 40 }],
    }
    const p = migrate(v2)
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    expect(p.edges[0].pay).toBe(40)
    expect(p.edges[0].isiKonum).toBe('elektrik')
  })

  it('pay değerini korur', () => {
    const p = sample()
    p.edges[0].pay = 50
    expect(parseProject(serializeProject(p)).edges[0].pay).toBe(50)
  })
})

describe('hat adı ve kesici durumu (v6)', () => {
  it('v5 dosyasına ad/aciklama ve senaryolara nodeStates ekler', () => {
    const v5 = {
      schemaVersion: 5,
      nodes: [
        { id: 'a', type: 'trafo', ad: 'T', etiket: '', grup: '', notlar: '', x: 0, y: 0, params: {} },
        { id: 'b', type: 'mdb', ad: 'M', etiket: '', grup: '', notlar: '', x: 0, y: 100, params: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', kaynakPort: 0, hedefPort: 0, tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali' }],
      scenarios: [{ id: 's', ad: 'S', failedNodes: [], edgeStates: {} }],
    }
    const p = migrate(v5)
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    expect(p.edges[0]).toMatchObject({ ad: '', aciklama: '' })
    expect(p.scenarios[0].nodeStates).toEqual({})
  })

  it('hat adı ve açıklaması JSON gidiş-dönüşünde korunur; nodeStates yalnız var olan düğümlere', () => {
    const p = sample()
    p.edges[0].ad = 'BB/MSB.PL1/01'
    p.edges[0].aciklama = '1600 A BUSBAR (5P)'
    p.scenarios = [{ id: 's', ad: 'S', failedNodes: [], edgeStates: {}, nodeStates: { a: 'acik' } }]
    const back = parseProject(serializeProject(p))
    expect(back.edges[0]).toMatchObject({ ad: 'BB/MSB.PL1/01', aciklama: '1600 A BUSBAR (5P)' })
    expect(back.scenarios[0].nodeStates).toEqual({ a: 'acik' })
    const bad = JSON.parse(serializeProject(p))
    bad.scenarios[0].nodeStates = { a: 'acik', yok: 'acik', b: 'yarim' }
    expect(migrate(bad).scenarios[0].nodeStates).toEqual({ a: 'acik' })
  })
})

describe('portlar (v5)', () => {
  const v4 = () => ({
    schemaVersion: 4,
    nodes: [
      { id: 'a', type: 'sebeke', ad: 'G', etiket: '', grup: '', notlar: '', x: 0, y: 0, params: {} },
      { id: 'b', type: 'ats', ad: 'ATS', etiket: '', grup: '', notlar: '', x: 0, y: 100, params: {} },
      { id: 'c', type: 'jenerator', ad: 'GEN', etiket: '', grup: '', notlar: '', x: 100, y: 0, params: {} },
      { id: 'd', type: 'itYuku', ad: 'IT', etiket: '', grup: '', notlar: '', x: 0, y: 200, params: {} },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '' },
      { id: 'e2', source: 'c', target: 'b', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '' },
      { id: 'e3', source: 'b', target: 'd', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '' },
    ],
  })

  it('v4 hatlarına dosya sırasıyla port atar', () => {
    const p = migrate(v4())
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    const by = Object.fromEntries(p.edges.map((e) => [e.id, e]))
    expect([by.e1.kaynakPort, by.e1.hedefPort]).toEqual([0, 0])
    expect([by.e2.kaynakPort, by.e2.hedefPort]).toEqual([0, 1]) // ATS'nin 2. girişi
    expect([by.e3.kaynakPort, by.e3.hedefPort]).toEqual([0, 0])
  })

  it('ekipmanın port sayısını kullanılan port kadar (en az varsayılan) yapar', () => {
    const raw = v4()
    // IT yükü varsayılan 1 giriş; iki hat bağlı → 2 olmalı
    raw.edges.push({ ...raw.edges[2], id: 'e4', source: 'c' })
    raw.edges[3].target = 'd'
    const p = migrate(raw)
    const it = p.nodes.find((n) => n.id === 'd')!
    expect(it.params.girisSayisi).toBe(2)
    const ats = p.nodes.find((n) => n.id === 'b')!
    expect(ats.params.girisSayisi).toBe(2)
    expect(ats.params.cikisSayisi).toBe(1)
  })

  it('portlar JSON gidiş-dönüşünde korunur', () => {
    const p = sample()
    p.edges[0].kaynakPort = 3
    p.edges[0].hedefPort = 1
    const back = parseProject(serializeProject(p)).edges[0]
    expect([back.kaynakPort, back.hedefPort]).toEqual([3, 1])
  })

  it('React Flow dönüşümü portları handle kimliğine çevirip geri okur', () => {
    const p = sample()
    p.edges[0].kaynakPort = 2
    p.edges[0].hedefPort = 1
    const rf = fromProjectEdges(p.edges)
    expect([rf[0].sourceHandle, rf[0].targetHandle]).toEqual(['out-2', 'in-1'])
    expect(toProjectEdges(rf)[0]).toMatchObject({ kaynakPort: 2, hedefPort: 1 })
  })
})

describe('senaryolar (v4)', () => {
  it('v3 dosyasına durum ve boş senaryo listesi ekler', () => {
    const v3 = {
      schemaVersion: 3,
      nodes: [
        { id: 'a', type: 'trafo', ad: 'T', etiket: '', grup: '', notlar: '', x: 0, y: 0, params: {} },
        { id: 'b', type: 'mdb', ad: 'M', etiket: '', grup: '', notlar: '', x: 0, y: 100, params: {} },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', tip: 'kablo', uzunluk: 5, akimKapasitesi: 100, r: 0.1, x: 0.1, gerilim: 400, pay: null, isiKonum: 'elektrik' }],
    }
    const p = migrate(v3)
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)
    expect(p.edges[0].durum).toBe('kapali')
    expect(p.scenarios).toEqual([])
  })

  it('senaryoları kaydeder; var olmayan ekipman/hat başvurularını atar', () => {
    const p = sample()
    p.scenarios = [{ id: 's1', ad: 'T1 arıza', failedNodes: ['a'], edgeStates: { e1: 'acik' }, nodeStates: {} }]
    expect(parseProject(serializeProject(p)).scenarios).toEqual(p.scenarios)

    const bad = JSON.parse(serializeProject(p))
    bad.scenarios[0].failedNodes = ['a', 'yok']
    bad.scenarios[0].edgeStates = { e1: 'acik', hayalet: 'acik', e2: 'yarim' }
    const out = migrate(bad)
    expect(out.scenarios[0].failedNodes).toEqual(['a'])
    expect(out.scenarios[0].edgeStates).toEqual({ e1: 'acik' })
  })
})

describe('migrate / doğrulama', () => {
  it('geçersiz JSON metnini reddeder', () => {
    expect(() => parseProject('{bozuk')).toThrow(ProjectFormatError)
  })

  it('schemaVersion yoksa reddeder', () => {
    expect(() => migrate({ nodes: [], edges: [] })).toThrow(/schemaVersion/)
  })

  it('daha yeni sürümü reddeder', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1, nodes: [], edges: [] })).toThrow(/yeni/)
  })

  it('bilinmeyen ekipman tipini reddeder', () => {
    const p = sample() as unknown as { nodes: { type: string }[] }
    p.nodes[0].type = 'uzayGemisi'
    expect(() => migrate(p)).toThrow(/ekipman tipi/)
  })

  it('var olmayan düğüme bağlı hattı reddeder', () => {
    const p = sample()
    p.edges[0].target = 'yok'
    expect(() => migrate(p)).toThrow(/var olmayan/)
  })

  it('yinelenen düğüm id değerini reddeder', () => {
    const p = sample()
    p.nodes[1].id = 'a'
    expect(() => migrate(p)).toThrow(/Yinelenen/)
  })

  it('eksik hat alanlarına varsayılan değer koyar', () => {
    const p = sample() as unknown as { edges: Record<string, unknown>[] }
    p.edges[0] = { id: 'e1', source: 'a', target: 'b' }
    const out = migrate(p)
    expect(out.edges[0].tip).toBe('kablo')
    expect(out.edges[0].uzunluk).toBeGreaterThan(0)
  })
})
