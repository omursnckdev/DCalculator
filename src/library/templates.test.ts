import { describe, expect, it } from 'vitest'
import { analyze, redundancyReport } from '../engine'
import { parseProject, serializeProject } from '../model/project'
import { portCount } from './equipment'
import { TEMPLATES } from './templates'

describe('hazır şablonlar', () => {
  for (const t of TEMPLATES) {
    describe(t.ad, () => {
      const p = t.build()
      const a = analyze(p)

      it('geçerli proje: id benzersiz, portlar mevcut ve her porta tek hat, serileştirilebilir', () => {
        expect(new Set(p.nodes.map((n) => n.id)).size).toBe(p.nodes.length)
        const used = new Set<string>()
        for (const e of p.edges) {
          const s = p.nodes.find((n) => n.id === e.source)!
          const d = p.nodes.find((n) => n.id === e.target)!
          expect(e.kaynakPort).toBeLessThan(portCount(s.type, s.params, 'out'))
          expect(e.hedefPort).toBeLessThan(portCount(d.type, d.params, 'in'))
          for (const k of [`${e.source}:o:${e.kaynakPort}`, `${e.target}:i:${e.hedefPort}`]) {
            expect(used.has(k), k).toBe(false)
            used.add(k)
          }
        }
        expect(parseProject(serializeProject(p)).nodes).toHaveLength(p.nodes.length)
      })

      it('temel durumda hata yok, yük kaybı yok, IT 400 kW', () => {
        expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
        expect(a.unserved.totalKw).toBe(0)
        expect(a.totals.itKw).toBeCloseTo(400 * 0.95 * 0 + 400, 6)
        expect(a.pue).toBeGreaterThan(1)
        expect(a.pue).toBeLessThan(2)
        expect(a.heat.totalKw).toBeCloseTo(a.totals.totalKw, 6)
      })
    })
  }

  it('yedeklilik karakteri: tek hat N-1 başarısız; jeneratörlü N+1 UPS ve jeneratör uygun; 2N hiçbir tek arıza yük kaybettirmez', () => {
    const [single, gen, two] = TEMPLATES.map((t) => redundancyReport(t.build()))
    expect(single.checks.find((c) => c.id === 'n1')!.status).toBe('fail')
    expect(gen.checks.find((c) => c.id === 'ups')!.status).toBe('ok')
    expect(gen.checks.find((c) => c.id === 'gen')!.status).toBe('ok')
    expect(gen.checks.find((c) => c.id === 'cooling')!.status).toBe('ok')
    expect(two.spof).toHaveLength(0)
    expect(two.checks.find((c) => c.id === 'n1')!.status).toBe('ok')
  })
})
