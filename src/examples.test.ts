import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyze, runN1 } from './engine'
import { parseProject } from './model/project'

const load = (name: string) => parseProject(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'))

describe('örnek projeler', () => {
  it('Faz 3 referansı: toplam 874,5 kW ve PUE ≈ 1,749', () => {
    const p = load('faz3-referans.dcalc.json')
    const a = analyze(p)
    expect(a.totals.totalKw).toBeCloseTo(874.5, 1)
    expect(a.pue).toBeCloseTo(1.749, 3)
  })

  describe('Faz 4: 2N örnek', () => {
    const p = load('faz4-2n-senaryolar.dcalc.json')
    const byId = (id: string) => p.scenarios.find((s) => s.id === id)!

    it('temel durumda hata yok, yük kaybı yok', () => {
      const a = analyze(p)
      expect(a.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(a.unserved.totalKw).toBe(0)
      expect(a.nodes.gen.totalKw).toBe(0) // yedek jeneratör boşta
    })

    it('IT yükü iki UPS arasında paylaşılır', () => {
      const a = analyze(p)
      expect(a.nodes.upsa.itKw).toBeCloseTo(300, 6)
      expect(a.nodes.upsb.itKw).toBeCloseTo(300, 6)
    })

    it('Trafo B arızası, kuplaj kapalıyken mekanik yükü kaybettirir ama IT kalır', () => {
      const a = analyze(p, undefined, byId('sen_t2'))
      expect(a.unserved.itKw).toBe(0)
      expect(a.unserved.mechKw).toBeCloseTo(320, 6) // 400 kW × DF 0,8
      // UPS-B enerjisiz → UPS-A tüm IT yükünü taşır
      expect(a.nodes.upsa.itKw).toBeCloseTo(600, 6)
    })

    it('kuplaj kapatılınca hiçbir yük kaybedilmez', () => {
      const a = analyze(p, undefined, byId('sen_t2k'))
      expect(a.unserved.totalKw).toBe(0)
      expect(a.nodes.mdbb.energized).toBe(true)
    })

    it('şebeke kesintisinde jeneratör tüm tesisi taşır', () => {
      const a = analyze(p, undefined, byId('sen_grid'))
      expect(a.unserved.totalKw).toBe(0)
      expect(a.nodes.gen.totalKw).toBeGreaterThan(900)
      expect(a.nodes.gen.status).not.toBe('none')
    })

    it('N-1: trafo A ve şebeke yedekli, trafo B tekil mekanik yük nedeniyle sağlanmıyor', () => {
      const rows = runN1(p)
      const row = (id: string) => rows.find((r) => r.id === id)!
      expect(row('t1').lostItKw + row('t1').lostMechKw).toBe(0)
      expect(row('t2').lostMechKw).toBeCloseTo(320, 6)
      expect(row('t2').ok).toBe(false)
      expect(row('upsa').lostItKw).toBe(0)
    })
  })
})
