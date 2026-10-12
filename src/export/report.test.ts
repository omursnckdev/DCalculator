import { describe, expect, it } from 'vitest'
import { analyze, energyReport, redundancyReport, simulateFailure } from '../engine'
import { DEFAULT_SETTINGS } from '../model/settings'
import { TEMPLATES } from '../library/templates'
import { generatorStudy } from '../engine/generator'
import { buildWorkbook } from './excel'
import { buildReportHtml, esc } from './report'

describe('yazdırılabilir rapor', () => {
  const project = TEMPLATES[1].build()
  const a = analyze(project)
  const steps = simulateFailure(project, ['tx'])

  it('tüm bölümleri içerir ve sayıları yazar', () => {
    const html = buildReportHtml({
      project,
      analysis: a,
      settings: DEFAULT_SETTINGS,
      redundancy: redundancyReport(project),
      energy: energyReport(project, DEFAULT_SETTINGS),
      steps,
      diagramPng: 'data:image/png;base64,AAAA',
    })
    for (const h of ['1. Güç ve ısıl yük özeti', '2. Kayıplar', '3. Ekipman doluluğu', '4. Doğrulama', '5. Kapasite ve yedeklilik', '6. Enerji ve maliyet', '7. Arıza senaryosu', '<img class="diagram"']) {
      expect(html).toContain(h)
    }
    expect(html).toContain(esc(project.name))
    expect(html).toContain('Sonuçlar ön tasarım tahminidir')
    // 24 saatlik profil tablosu
    expect((html.match(/\d\d:00<\/td>/g) ?? []).length).toBe(24)
    // simülasyon adımları
    expect(html).toContain('Arıza anı')
  })

  it('jeneratör bölümü: yakıt özerkliği ve sıralı yük alma', () => {
    const html = buildReportHtml({ project, analysis: a, settings: DEFAULT_SETTINGS, generator: generatorStudy(project, DEFAULT_SETTINGS) })
    expect(html).toContain('Jeneratör yakıt özerkliği')
    expect(html).toContain('Sıralı yük alma')
  })

  it('bölümler kapatılabilir; simülasyon yoksa 7. bölüm yazılmaz', () => {
    const html = buildReportHtml({ project, analysis: a, settings: DEFAULT_SETTINGS, sections: { losses: false, loading: false, issues: false } })
    expect(html).toContain('1. Güç')
    expect(html).not.toContain('2. Kayıplar')
    expect(html).not.toContain('7. Arıza')
  })

  it('HTML kaçışı: ekipman adındaki özel karakterler çalıştırılmaz', () => {
    const p = { ...project, name: '<script>alert(1)</script>', nodes: project.nodes.map((n, i) => (i === 0 ? { ...n, ad: '"><img src=x onerror=alert(1)>' } : n)) }
    const html = buildReportHtml({ project: p, analysis: analyze(p), settings: DEFAULT_SETTINGS, steps: simulateFailure(p, ['tx']) })
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('Excel: simülasyon adımları varsa Simülasyon sayfası eklenir', async () => {
    const wb = await buildWorkbook(project, a, undefined, steps)
    const ws = wb.getWorksheet('Simülasyon')!
    expect(ws).toBeDefined()
    expect(ws.rowCount).toBe(steps.length + 1)
    const none = await buildWorkbook(project, a)
    expect(none.getWorksheet('Simülasyon')).toBeUndefined()
  })
})
