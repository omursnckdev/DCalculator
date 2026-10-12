import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { analyze } from '../engine'
import { Symbol } from '../ui/Symbol'
import { EQUIPMENT, PALETTE_GROUPS, defsInGroup, portCount } from './equipment'
import type { EquipmentType, Params, ProjectEdge, ProjectNode } from '../model/types'
import { EQUIPMENT_TYPES } from '../model/types'

const NEW_COOLING: EquipmentType[] = ['chiller', 'crah', 'crac', 'fanwall', 'inrow', 'rdhx', 'kuruSogutucu', 'sogutmaKulesi', 'pompa', 'ahu', 'fan', 'nemlendirici']
const NEW_LOADS: EquipmentType[] = ['rack', 'depolama', 'guvenlik', 'yangin', 'asansor', 'yukBankasi', 'ofis']

let seq = 0
function node(id: string, type: EquipmentType, params: Params = {}): ProjectNode {
  return { id, type, ad: id, etiket: '', grup: '', notlar: '', x: 0, y: seq++, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, girisSayisi: 12, cikisSayisi: 12, ...params } }
}
let ports = new Map<string, number>()
const next = (k: string) => {
  const v = ports.get(k) ?? 0
  ports.set(k, v + 1)
  return v
}
function edge(source: string, target: string): ProjectEdge {
  return {
    id: `${source}>${target}`, source, target, tip: 'kablo', uzunluk: 1, akimKapasitesi: 1e6, r: 0, x: 0, gerilim: 400,
    pay: null, isiKonum: 'elektrik', durum: 'kapali', ad: '', aciklama: '', kaynakPort: next(`${source}:o`), hedefPort: next(`${target}:i`),
  }
}
const feed = (...loads: ProjectNode[]) => {
  ports = new Map()
  return { nodes: [node('g', 'sebeke', { gerilim: 400 }), node('m', 'mdb'), ...loads], edges: [edge('g', 'm'), ...loads.map((l) => edge('m', l.id))] }
}

describe('yeni ekipman tipleri', () => {
  it('her tip tanımlı; palette görünür; port ve etiket tutarlı', () => {
    for (const t of [...NEW_COOLING, ...NEW_LOADS, 'rpp'] as EquipmentType[]) {
      expect(EQUIPMENT_TYPES).toContain(t)
      const d = EQUIPMENT[t]
      expect(d.label, t).toBeTruthy()
      expect(PALETTE_GROUPS.some((g) => defsInGroup(g).some((x) => x.type === t)), t).toBe(true)
      expect(portCount(t, d.defaults, 'in'), t).toBeGreaterThan(0)
    }
    expect(new Set(EQUIPMENT_TYPES.map((t) => EQUIPMENT[t].label)).size).toBe(EQUIPMENT_TYPES.length)
    expect(defsInGroup('sogutma').map((d) => d.type)).toEqual(expect.arrayContaining(['chiller', 'crah', 'crac', 'fanwall']))
  })

  it('her yeni tipin kendi ikonu var (varsayılan simge kullanılmaz)', () => {
    const fallback = renderToStaticMarkup(<Symbol type={'bilinmeyen' as EquipmentType} color="#000" />)
    const seen = new Set<string>()
    for (const t of [...NEW_COOLING, ...NEW_LOADS]) {
      const svg = renderToStaticMarkup(<Symbol type={t} color="#000" />)
      expect(svg, t).not.toBe(fallback)
      expect(seen.has(svg), `${t} başka bir ikonla aynı`).toBe(false)
      seen.add(svg)
    }
  })

  it.each([...NEW_COOLING, ...NEW_LOADS])('%s: yük olarak çözülür, gücü ısıya yazılır, hata yok', (t) => {
    const d = EQUIPMENT[t]
    const a = analyze(feed(node('x', t)))
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
    const kw = (d.defaults.kuruluKw as number) * (d.defaults.df as number)
    expect(a.nodes.x.totalKw).toBeCloseTo(kw, 6)
    expect(a.totals.totalKw).toBeCloseTo(kw, 6)
    expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 6)
    // IT kategorisi yalnız rack ve depolamada
    expect(a.totals.itKw > 0).toBe(t === 'rack' || t === 'depolama')
    // varsayılan ısı konumu
    const room = d.defaults.isiKonum as 'salon' | 'elektrik' | 'dis'
    expect(room === 'salon' ? a.heat.salonKw : room === 'dis' ? a.heat.disKw : a.heat.elektrikKw).toBeCloseTo(kw, 6)
  })

  it('RPP: panel olarak yük taşır ve iç bara kaybı hesaplanır', () => {
    ports = new Map()
    const f = {
      nodes: [node('g', 'sebeke', { gerilim: 400 }), node('r', 'rpp', { baraUzunluk: 2, baraDirenc: 0.1 }), node('l', 'rack', { kuruluKw: 100, pf: 1 })],
      edges: [edge('g', 'r'), edge('r', 'l')],
    }
    const a = analyze(f)
    expect(a.nodes.r.ownLossKw).toBeGreaterThan(0)
    expect(a.losses.panelKw).toBeGreaterThan(0)
    expect(a.nodes.r.loadingPct).toBeDefined()
  })
})

describe('soğutma rolleri: chiller → hava tarafı zinciri', () => {
  const cool = (...u: [string, EquipmentType, number][]) => {
    const loads = u.map(([id, t, kw]) => node(id, t, { sogutmaKw: kw, kuruluKw: 10, pf: 1, df: 1 }))
    const f = feed(node('it', 'rack', { kuruluKw: 300, pf: 1, df: 1 }), ...loads)
    return analyze(f).cooling!
  }

  it('chiller 1000 + CRAH 300 → etkin 300 (min); toplanmaz', () => {
    const c = cool(['ch', 'chiller', 1000], ['cr', 'crah', 300])
    expect(c.produceKw).toBe(1000)
    expect(c.airKw).toBe(300)
    expect(c.capacityKw).toBe(300)
  })

  it('chiller 200 + CRAH 300 → etkin 200; CRAC doğrudan eklenir', () => {
    const c = cool(['ch', 'chiller', 200], ['cr', 'crah', 300], ['dx', 'crac', 90])
    expect(c.capacityKw).toBe(290)
    expect(c.directKw).toBe(90)
  })

  it('yalnız CRAH (soğuk su dışarıdan) → hava tarafı; yalnız chiller → chiller; fan wall ve in-row hava tarafıdır', () => {
    expect(cool(['cr', 'crah', 300]).capacityKw).toBe(300)
    expect(cool(['ch', 'chiller', 700]).capacityKw).toBe(700)
    const c = cool(['ch', 'chiller', 1000], ['fw', 'fanwall', 250], ['ir', 'inrow', 35], ['rd', 'rdhx', 30])
    expect(c.airKw).toBe(315)
    expect(c.capacityKw).toBe(315)
  })

  it('arızalı CRAH hava tarafı kapasitesini düşürür; kapasite alanı 0 olan soğutma birimi sayılmaz', () => {
    const loads = [node('c1', 'crah', { sogutmaKw: 200 }), node('c2', 'crah', { sogutmaKw: 200 }), node('ch', 'chiller', { sogutmaKw: 1000 })]
    const f = feed(node('it', 'rack', { kuruluKw: 300, pf: 1, df: 1 }), ...loads)
    const a = analyze(f, undefined, { id: 's', ad: 's', failedNodes: ['c1'], edgeStates: {}, nodeStates: {} })
    expect(a.cooling!.airKw).toBe(200)
    expect(a.cooling!.capacityKw).toBe(200)
    expect(a.cooling!.deficitKw).toBeGreaterThan(0)
    const none = analyze(feed(node('p', 'pompa'), node('k', 'kuruSogutucu')))
    expect(none.cooling).toBeUndefined()
  })
})
