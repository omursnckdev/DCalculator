import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan, parseProject } from '../model/project'
import { clonePl1ToPl2 } from '../model/clonePlan'
import { MODEL_KEYS, modelSpecOf } from './customModel'
import { applyPlan } from './plan'
import { PRESET_MODELS, isItUps, presetId, presetOfId, presetsFor } from './presetModels'

const hdc = parseProject(readFileSync(new URL('../../examples/hdc02-pl1.dcalc.json', import.meta.url), 'utf8'))
const plan = parsePlan(JSON.parse(readFileSync(new URL('../../examples/hdc02-gf.plan.json', import.meta.url), 'utf8')))!

describe('hazır modeller', () => {
  it('kimlik gidiş-dönüş; UPS için iki Socomec modeli, başka türde yok', () => {
    for (const p of PRESET_MODELS) expect(presetOfId(presetId(p.key))).toBe(p)
    expect(presetOfId('m_abc')).toBeUndefined()
    expect(presetsFor('ups').length).toBe(2)
    expect(presetsFor('trafo')).toEqual([])
    // model parametresi olarak okunur
    expect(modelSpecOf({ [MODEL_KEYS.id]: presetId('socomec-delphys-xm') })?.id).toBe('preset:socomec-delphys-xm')
  })

  it('IT UPS: .1/.2 numaralı veya "(IT UPS)" notlu; Essential (.3) ve başka türler hariç', () => {
    const ups = (ad: string) => ({ type: 'ups', ad })
    for (const ad of ['UPS.PL1.1 (IT UPS)', 'UPS.PL2.2', 'UPS.C1.1', 'UPS C1.2', 'UPS_C2.1', 'UPS A (IT UPS)']) expect(isItUps(ups(ad)), ad).toBe(true)
    for (const ad of ['UPS.PL1.3 (Essential UPS)', 'UPS.C1.3', 'UPS.C1.10', 'UPS B']) expect(isItUps(ups(ad)), ad).toBe(false)
    expect(isItUps({ type: 'mdb', ad: 'UPS.PL1.1' })).toBe(false)
  })

  it('HDC02 PL1/PL2: tam 4 IT UPS (PL1.1/.2, PL2.1/.2), .3 hariç', () => {
    const c = clonePl1ToPl2({ nodes: hdc.nodes, edges: hdc.edges }, 3000)
    const names = [...hdc.nodes, ...c.nodes].filter(isItUps).map((n) => n.ad.split(' ')[0]).sort()
    expect(names).toEqual(['UPS.PL1.1', 'UPS.PL1.2', 'UPS.PL2.1', 'UPS.PL2.2'])
  })

  it('plan yeniden uygulanınca hazır modelli UPS kutusu modelin ölçüsünde kalır, konum/yön plandan gelir', () => {
    const pre = PRESET_MODELS[0]
    const nodes = hdc.nodes.map((n) => (isItUps(n) ? { ...n, params: { ...n.params, [MODEL_KEYS.id]: presetId(pre.key) } } : n))
    const r = applyPlan({ nodes, edges: hdc.edges }, plan, {})
    const it = nodes.filter(isItUps)
    expect(it.length).toBe(2)
    for (const n of it) {
      const l = r.placements[n.id]
      expect([l.g, l.d, l.y]).toEqual([pre.g, pre.d, pre.y])
      expect(Number.isFinite(l.x) && Number.isFinite(l.z)).toBe(true)
    }
    // modeli olmayan Essential UPS planın ayak izini alır
    const ess = r.placements[nodes.find((n) => n.type === 'ups' && /UPS\.PL1\.3/.test(n.ad))!.id]
    expect(Math.max(ess.g!, ess.d!)).toBeGreaterThan(1.4)
  })
})
