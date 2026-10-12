import { describe, expect, it } from 'vitest'
import { analyze } from '../engine'
import { EQUIPMENT } from '../library/equipment'
import { BUILTIN_CATALOG } from '../library/catalog'
import { buildImport, matchType, parseCsv, parseNum, parseTable, TEMPLATE_CSV } from './equipmentImport'

describe('CSV ve sayı ayrıştırma', () => {
  it('ayraç otomatik, tırnaklı alan, BOM', () => {
    expect(parseCsv('﻿Ad;Tip\r\n"A;B";Trafo\r\n')).toEqual([['Ad', 'Tip'], ['A;B', 'Trafo']])
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('TR/EN ondalık', () => {
    expect(parseNum('1.250,5')).toBe(1250.5)
    expect(parseNum('1,250.5')).toBe(1250.5)
    expect(parseNum('0,85')).toBe(0.85)
    expect(parseNum('12.5')).toBe(12.5)
    expect(parseNum('1.250.000')).toBe(1250000)
    expect(parseNum('abc')).toBeUndefined()
  })
  it('tip eşleme: Türkçe, İngilizce, kısaltma', () => {
    expect(matchType('Jeneratör')).toBe('jenerator')
    expect(matchType('transformer')).toBe('trafo')
    expect(matchType('CRAH')).toBe('crah')
    expect(matchType('Ana dağıtım panosu')).toBe('mdb')
    expect(matchType('Chiller')).toBe('chiller')
    expect(matchType('bilinmeyen şey')).toBeUndefined()
  })
})

describe('tablo içe aktarma', () => {
  const parsed = parseTable(parseCsv(TEMPLATE_CSV))
  it('şablon ayrıştırılır: adet çoğaltır, güç alanlarını doğru eşler', () => {
    expect(parsed.items).toHaveLength(1 + 1 + 1 + 2 + 4 + 1)
    const ch = parsed.items.filter((i) => i.type === 'chiller')
    expect(ch.map((c) => c.ad)).toEqual(['Chiller 1', 'Chiller 2'])
    expect(ch[0].params).toMatchObject({ kuruluKw: 250, sogutmaKw: 1000, oncelik: 2 })
    const tr = parsed.items.find((i) => i.type === 'trafo')!
    expect(tr.params.nominalKva).toBe(2500)
    expect(tr.besleyen).toEqual(['Şebeke'])
    expect(parsed.items.find((i) => i.type === 'itYuku')!.params.kuruluKw).toBe(400)
  })
  it('tanınmayan tip uyarı verir ve atlanır; bozuk sayı uyarı verir', () => {
    const r = parseTable([['Ad', 'Tip', 'kW'], ['X', 'uzay gemisi', '5'], ['Y', 'IT yükü', 'abc']])
    expect(r.items).toHaveLength(1)
    expect(r.warnings.join(' ')).toContain('tanınmadı')
    expect(r.warnings.join(' ')).toContain('sayı değil')
  })
  it('tipe özgü alanlar etiket veya anahtarla tanınır; kesici tipi tip metninden', () => {
    const r = parseTable([['Ad', 'Tip', 'nominalAkim', 'Kesme kapasitesi (kA)'], ['Q1', 'MCCB', '630', '50']])
    expect(r.items[0].params).toMatchObject({ tip: 'MCCB', nominalAkim: 630 })
  })
  it('kurulum: hatlar, port ayırma ve çalışan analiz', () => {
    const b = buildImport(parsed.items, [], [])
    expect(b.warnings).toEqual([])
    expect(b.nodes).toHaveLength(parsed.items.length)
    // 2 chiller + 4 CRAH + IT + mdb(<-tr) + tr(<-şebeke) ... hat sayısı: 1+1+2+4+1 = 9
    expect(b.edges).toHaveLength(9)
    // MDB'nin çıkış portları 7'ye kadar artırılmış olmalı
    const mdb = b.nodes.find((n) => n.type === 'mdb')!
    expect(Number(mdb.params.cikisSayisi)).toBeGreaterThanOrEqual(7)
    const ports = b.edges.filter((e) => e.source === mdb.id).map((e) => e.kaynakPort)
    expect(new Set(ports).size).toBe(ports.length)
    const a = analyze({ nodes: b.nodes, edges: b.edges })
    expect(a.nodes[mdb.id].energized).toBe(true)
    expect(a.totals.itKw).toBeCloseTo(400, 0)
  })
  it('ad çakışması ve bulunmayan besleyen uyarı verir', () => {
    const first = buildImport(parseTable(parseCsv(TEMPLATE_CSV)).items, [], [])
    const again = buildImport(parseTable(parseCsv('Ad;Tip;Besleyen\r\nTR1;Trafo;Yok Böyle\r\nYeni;IT yükü;TR1')).items, first.nodes, first.edges)
    expect(again.warnings.some((w) => w.includes('zaten var'))).toBe(true)
    expect(again.warnings.some((w) => w.includes('bulunamadı'))).toBe(true)
    // "TR1" mevcut şemadaki TR1'e bağlanır (yeni "TR1 (2)" değil)
    const edge = again.edges[0]
    expect(first.nodes.some((n) => n.id === edge.source)).toBe(true)
  })
})

describe('hazır katalog', () => {
  it('kimlikler benzersiz ve her parametre tipin tanımında var', () => {
    expect(new Set(BUILTIN_CATALOG.map((c) => c.id)).size).toBe(BUILTIN_CATALOG.length)
    for (const c of BUILTIN_CATALOG) {
      for (const k of Object.keys(c.params)) expect(k in EQUIPMENT[c.type].defaults, `${c.id}.${k}`).toBe(true)
    }
  })
})

describe('xlsx okuma ve depo', () => {
  it('xlsx dosyası aynı sonucu verir', async () => {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Liste')
    ws.addRow(['Ad', 'Tip', 'kW', 'Besleyen'])
    ws.addRow(['Pano', 'Dağıtım panosu', null, null])
    ws.addRow(['Rack A', 'Rack', 42.5, 'Pano'])
    const buf = await wb.xlsx.writeBuffer()
    const { readTable } = await import('./equipmentImport')
    const file = new File([buf as ArrayBuffer], 'liste.xlsx')
    const parsed = parseTable(await readTable(file))
    expect(parsed.items.map((i) => i.ad)).toEqual(['Pano', 'Rack A'])
    expect(parsed.items[1].params.kuruluKw).toBe(42.5)
    expect(parsed.items[1].besleyen).toEqual(['Pano'])
  })
  it('importEquipment ve katalogdan ekleme', async () => {
    const { useStore } = await import('../store/useStore')
    const s = useStore.getState()
    s.newProject()
    const b = buildImport(parseTable(parseCsv(TEMPLATE_CSV)).items, [], [])
    useStore.getState().importEquipment(b.nodes, b.edges)
    const st = useStore.getState()
    expect(st.nodes).toHaveLength(b.nodes.length)
    expect(st.edges).toHaveLength(b.edges.length)
    const cat = BUILTIN_CATALOG.find((c) => c.id === 'jen-1250')!
    const id = useStore.getState().addNode(cat.type, 0, 0, { ad: cat.ad, params: cat.params })
    const n = useStore.getState().nodes.find((x) => x.id === id)!
    expect(n.data.ad).toBe('Dizel jeneratör 1250 kVA')
    expect(n.data.params.nominalKva).toBe(1250)
    expect(n.data.params.xd).toBe(15) // varsayılan korunur
  })
})
