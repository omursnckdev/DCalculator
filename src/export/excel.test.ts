import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { analyze } from '../engine'
import { EQUIPMENT } from '../library/equipment'
import { emptyProject } from '../model/project'
import type { EquipmentType, Params, Project } from '../model/types'
import { buildWorkbook, workbookToBlob } from './excel'

function project(): Project {
  const p = emptyProject('Test Tesisi')
  const n = (id: string, type: EquipmentType, ad: string, params: Params = {}) => ({
    id, type, ad, etiket: '', grup: '', notlar: '', x: 0, y: 0, params: { ...EQUIPMENT[type].defaults, baraUzunluk: 0, ...params },
  })
  p.nodes = [
    n('g', 'sebeke', 'Şebeke', { gerilim: 400 }),
    n('m', 'mdb', 'MDB'),
    n('it', 'itYuku', 'IT Yükü', { kuruluKw: 100, pf: 1, df: 1 }),
    n('mek', 'mekanikYuk', 'Chiller', { kuruluKw: 50, pf: 1, df: 1 }),
  ]
  const used = new Map<string, number>()
  const nx = (k: string) => { const n = used.get(k) ?? 0; used.set(k, n + 1); return n }
  const e = (s: string, t: string) => ({ kaynakPort: nx(`${s}:o`), hedefPort: nx(`${t}:i`),
    id: `${s}>${t}`, source: s, target: t, tip: 'kablo' as const, uzunluk: 10, akimKapasitesi: 5000,
    r: 0, x: 0, gerilim: 400, pay: null, isiKonum: 'elektrik' as const, durum: 'kapali' as const, ad: '', aciklama: '',
  })
  p.edges = [e('g', 'm'), e('m', 'it'), e('m', 'mek')]
  return p
}

async function roundTrip() {
  const p = project()
  const a = analyze({ nodes: p.nodes, edges: p.edges })
  const blob = await workbookToBlob(await buildWorkbook(p, a))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return { wb, a }
}

const cellText = (ws: ExcelJS.Worksheet) => {
  const out: Record<string, ExcelJS.CellValue> = {}
  ws.eachRow((row) => {
    const label = row.getCell(1).value
    if (typeof label === 'string') out[label] = row.getCell(2).value
  })
  return out
}

describe('Excel çıktısı', () => {
  it('üç sayfa üretir', async () => {
    const { wb } = await roundTrip()
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ekipman', 'Hatlar', 'Özet'])
  })

  it('ekipman sayfasında girdiler ve sonuçlar sayı olarak yazılır', async () => {
    const { wb } = await roundTrip()
    const ws = wb.getWorksheet('Ekipman')!
    expect(ws.rowCount).toBe(5) // başlık + 4 ekipman
    const headers = (ws.getRow(1).values as string[]).filter(Boolean)
    const iToplam = headers.findIndex((h) => h.startsWith('Toplam')) + 1
    // MDB satırı (2): toplam = 150 kW
    expect(ws.getRow(3).getCell(1).value).toBe('MDB')
    expect(ws.getRow(3).getCell(iToplam).value).toBeCloseTo(150, 6)
    // IT yükü kurulu gücü 100
    const iKurulu = headers.findIndex((h) => h.startsWith('Kurulu güç')) + 1
    expect(ws.getRow(4).getCell(iKurulu).value).toBe(100)
  })

  it('özet sayfası: toplamlar, PUE, ısıl yük ve sorumluluk uyarısı', async () => {
    const { wb, a } = await roundTrip()
    const s = cellText(wb.getWorksheet('Özet')!)
    expect(s['IT']).toBeCloseTo(100, 6)
    expect(s['Mekanik']).toBeCloseTo(50, 6)
    expect(s['Toplam']).toBeCloseTo(150, 6)
    expect(s['PUE (yaklaşık)']).toBeCloseTo(1.5, 6)
    expect(s['Veri salonu']).toBeCloseTo(a.heat.salonKw, 6) // 100 kW
    expect(s['Dış ortam']).toBeCloseTo(50, 6)
    const all = Object.keys(s).join('\n')
    expect(all).toContain('ön tasarım tahminidir')
  })

  it('hat sayfasında akım ve kayıp sütunları var', async () => {
    const { wb } = await roundTrip()
    const wl = wb.getWorksheet('Hatlar')!
    expect(wl.rowCount).toBe(4)
    const headers = (wl.getRow(1).values as string[]).filter(Boolean)
    expect(headers.some((h) => h.startsWith('Akım ('))).toBe(true)
    expect(headers.some((h) => h.startsWith('Hat kaybı'))).toBe(true)
  })
})
