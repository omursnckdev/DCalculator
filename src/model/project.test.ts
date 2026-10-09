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
    { id: 'e1', source: 'a', target: 'b', tip: 'busbar', uzunluk: 12, akimKapasitesi: 4000, r: 0.02, x: 0.05, gerilim: 400, pay: null, isiKonum: 'elektrik' },
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
