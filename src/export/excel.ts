import type { Workbook } from 'exceljs'
import { kwToTr } from '../engine/thermal'
import type { Analysis } from '../engine'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { FieldDef } from '../library/equipment'
import type { Project } from '../model/types'

const HEADER_FILL = 'FFE2E8F0'

/** Seçim alanlarının (kategori, ısı konumu, verim modeli) görünen metni. */
function optionLabel(fields: FieldDef[], key: string, value: unknown): unknown {
  const f = fields.find((x) => x.key === key)
  if (f?.kind === 'select') return f.options.find((o) => o.value === value)?.label ?? value
  return value
}

const lineLabel = (v: string): string => (v === 'busbar' ? tr.line.busbar : tr.line.kablo)
const roomLabel = (v: string): string =>
  v === 'salon' ? tr.alan.konumSalon : v === 'dis' ? tr.alan.konumDis : tr.alan.konumElektrik

/**
 * Proje girdilerini ve hesap sonuçlarını üç sayfalık bir çalışma kitabına yazar:
 * Ekipman (girdiler + sonuçlar), Hatlar, Özet (toplamlar, kayıplar, ısıl yük, PUE, uyarılar).
 * Sayılar sayı olarak yazılır (Excel'de işlenebilsin diye).
 */
export async function buildWorkbook(project: Project, a: Analysis): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'DCalculator'
  wb.created = new Date()

  // --- Ekipman -------------------------------------------------------------
  const ws = wb.addWorksheet(tr.export.sheetEquip, { views: [{ state: 'frozen', ySplit: 1 }] })

  // Tüm ekipmanlarda geçen parametrelerin birleşimi (ilk görülen etiketle).
  const paramCols: { key: string; label: string; unit?: string }[] = []
  for (const n of project.nodes) {
    for (const f of EQUIPMENT[n.type].fields) {
      if (!paramCols.some((c) => c.key === f.key)) {
        paramCols.push({ key: f.key, label: f.label, unit: f.kind === 'number' ? f.unit : undefined })
      }
    }
  }
  const head = (label: string, unit?: string) => (unit ? `${label} (${unit})` : label)
  const equipHeaders = [
    tr.props.ad,
    tr.props.type,
    tr.props.etiket,
    tr.props.grup,
    ...paramCols.map((c) => head(c.label, c.unit)),
    head(tr.results.it, 'kW'),
    head(tr.results.mech, 'kW'),
    head(tr.results.loss, 'kW'),
    head(tr.results.total, 'kW'),
    head(tr.results.kva, 'kVA'),
    head(tr.results.current, 'A'),
    head(tr.results.loading, '%'),
    head(tr.results.input, 'kW'),
    tr.props.notlar,
  ]
  ws.addRow(equipHeaders)
  for (const n of project.nodes) {
    const def = EQUIPMENT[n.type]
    const r = a.nodes[n.id]
    ws.addRow([
      n.ad,
      def.label,
      n.etiket,
      n.grup,
      ...paramCols.map((c) => {
        const has = def.fields.some((f) => f.key === c.key)
        if (!has) return null
        const v = n.params[c.key] ?? def.defaults[c.key]
        return optionLabel(def.fields, c.key, v) as string | number
      }),
      r.itKw,
      r.mechKw,
      r.lossKw,
      r.totalKw,
      r.kva,
      r.currentA,
      r.loadingPct ?? null,
      r.inputKw,
      n.notlar,
    ])
  }
  const firstResult = 5 + paramCols.length
  for (let c = firstResult; c < firstResult + 8; c++) ws.getColumn(c).numFmt = '#,##0.00'

  // --- Hatlar --------------------------------------------------------------
  const wl = wb.addWorksheet(tr.export.sheetLines, { views: [{ state: 'frozen', ySplit: 1 }] })
  wl.addRow([
    tr.table.from,
    tr.table.to,
    tr.line.tip,
    head(tr.line.uzunluk, 'm'),
    head(tr.line.akimKapasitesi, 'A'),
    head(tr.line.r, 'Ω/km'),
    head(tr.line.x, 'Ω/km'),
    head(tr.line.gerilim, 'V'),
    head(tr.line.pay, '%'),
    tr.line.isiKonum,
    head(tr.results.flow, 'kW'),
    head(tr.results.kva, 'kVA'),
    head(tr.results.current, 'A'),
    head(tr.results.loading, '%'),
    head(tr.results.drop, '%'),
    head(tr.hesap.lineLoss, 'kW'),
  ])
  const nameOf = (id: string) => project.nodes.find((n) => n.id === id)?.ad ?? id
  for (const e of project.edges) {
    const r = a.edges[e.id]
    wl.addRow([
      nameOf(e.source),
      nameOf(e.target),
      lineLabel(e.tip),
      e.uzunluk,
      e.akimKapasitesi,
      e.r,
      e.x,
      e.gerilim,
      e.pay,
      roomLabel(e.isiKonum),
      r?.p ?? null,
      r?.kva ?? null,
      r?.currentA ?? null,
      r?.loadingPct ?? null,
      r?.voltageDropPct ?? null,
      r?.lossKw ?? null,
    ])
  }
  for (let c = 11; c <= 16; c++) wl.getColumn(c).numFmt = '#,##0.00'

  // --- Özet ----------------------------------------------------------------
  const wsum = wb.addWorksheet(tr.export.sheetSummary)
  const put = (label: string, value?: string | number | null, unit?: string, fmt = '#,##0.00') => {
    const row = wsum.addRow([label, value ?? null, unit ?? ''])
    if (typeof value === 'number') row.getCell(2).numFmt = fmt
    return row
  }
  const section = (title: string) => {
    wsum.addRow([])
    const row = wsum.addRow([title])
    row.font = { bold: true, size: 12 }
  }

  wsum.addRow([`${tr.app.title} — ${project.name}`]).font = { bold: true, size: 14 }
  wsum.addRow([new Date().toLocaleString('tr-TR')])
  const disc = wsum.addRow([tr.disclaimer])
  disc.font = { italic: true, color: { argb: 'FFB45309' } }

  section(tr.summary.title)
  put(tr.summary.it, a.totals.itKw, 'kW')
  put(tr.summary.mech, a.totals.mechKw, 'kW')
  put(tr.summary.loss, a.totals.lossKw, 'kW')
  put(tr.summary.total, a.totals.totalKw, 'kW')
  put(tr.results.kva, a.totals.kva, 'kVA')

  section(tr.isi.losses)
  put(tr.isi.ups, a.losses.upsKw, 'kW')
  put(tr.isi.trafo, a.losses.trafoKw, 'kW')
  put(tr.isi.line, a.losses.lineKw, 'kW')

  section(tr.isi.title)
  const heatRow = (label: string, kw: number) => {
    const row = put(label, kw, 'kW')
    row.getCell(4).value = kwToTr(kw)
    row.getCell(4).numFmt = '#,##0.00'
    row.getCell(5).value = tr.isi.tr
  }
  heatRow(tr.isi.salon, a.heat.salonKw)
  heatRow(tr.isi.elektrik, a.heat.elektrikKw)
  heatRow(tr.isi.dis, a.heat.disKw)
  heatRow(tr.isi.totalHeat, a.heat.totalKw)
  heatRow(tr.isi.cooling, a.heat.salonKw + a.heat.elektrikKw)
  put(tr.isi.pue, a.pue ?? null, undefined, '0.000')
  wsum.addRow([tr.isi.pueHow]).font = { italic: true, color: { argb: 'FF64748B' } }
  wsum.addRow([tr.isi.trNote]).font = { italic: true, color: { argb: 'FF64748B' } }

  section(tr.issues.title)
  if (a.issues.length === 0) wsum.addRow([tr.issues.none])
  for (const i of a.issues) {
    wsum.addRow([i.severity === 'error' ? `● ${i.message}` : `▲ ${i.message}`])
  }
  wsum.getColumn(1).width = 48
  wsum.getColumn(2).width = 16

  // Ortak biçim: başlık satırları, sütun genişlikleri
  for (const sheet of [ws, wl]) {
    const header = sheet.getRow(1)
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', wrapText: true }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    })
    header.height = 32
    sheet.columns.forEach((col) => {
      col.width = Math.max(12, Math.min(28, String(sheet.getRow(1).getCell(col.number ?? 1).value ?? '').length * 0.9))
    })
  }
  wsum.getColumn(1).width = 48
  wsum.getColumn(2).width = 16

  return wb
}

export async function workbookToBlob(wb: Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
