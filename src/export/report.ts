import { kwToTr } from '../engine'
import { fmtLocale } from '../util/numfmt'
import { MONTH_NAMES } from '../engine/climate'
import type { Analysis, EnergyReport, RedundancyReport, ReliabilityReport, SimStep } from '../engine'
import { rideThroughMinutes } from '../engine/cooling'
import type { GeneratorStudy } from '../engine/generator'
import { boruLength, hydraulicsOf } from '../layout3d/pipes'
import type { TrayFillRow } from '../layout3d/trays'
import type { ArcFlashRow, SelectivityRow } from '../engine/protection'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import type { ProjectSettings } from '../model/settings'
import type { Boru3D, Project } from '../model/types'

/**
 * Yazdırılabilir rapor (HTML). Tarayıcının "Yazdır → PDF olarak kaydet" özelliğiyle PDF'e çevrilir; sunucu
 * ve ek kütüphane gerekmez. Saf fonksiyondur: yalnızca metin üretir.
 */
export interface ReportInput {
  project: Project
  analysis: Analysis
  scenarioName?: string
  settings: ProjectSettings
  redundancy?: RedundancyReport
  energy?: EnergyReport
  reliability?: ReliabilityReport
  selectivity?: SelectivityRow[]
  arcFlash?: ArcFlashRow[]
  generator?: GeneratorStudy
  /** 3D: kablo tavası doluluğu ve boru hatları (varsa "Kablo tavası ve boru" bölümü eklenir). */
  trays?: TrayFillRow[]
  pipes?: Boru3D[]
  /** Arıza simülasyonu adımları (varsa "Arıza raporu" bölümü eklenir). */
  steps?: SimStep[]
  /** Şema görüntüsü (PNG data URL). */
  diagramPng?: string | null
  /** 3D yerleşim görüntüsü (PNG data URL); 3D sekmesi açılmışsa. */
  view3dPng?: string | null
  /** Hangi bölümler yazılsın (varsayılan: hepsi). */
  sections?: { electrical?: boolean; reliability?: boolean; summary?: boolean; losses?: boolean; loading?: boolean; issues?: boolean; redundancy?: boolean; energy?: boolean; simulation?: boolean; diagram?: boolean; view3d?: boolean; infra?: boolean }
}

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const n0 = (v: number): string => fmtLocale(v, 0)
const n1 = (v: number): string => fmtLocale(v, 1)
const n2 = (v: number): string => fmtLocale(v, 2)
const n3 = (v: number): string => fmtLocale(v, 3)

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 system-ui, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #cbd5e1; break-after: avoid; }
  h3 { font-size: 12px; margin: 10px 0 4px; }
  .meta { color: #475569; margin-bottom: 8px; }
  .disc { border: 1px solid #fcd34d; background: #fffbeb; color: #92400e; padding: 4px 8px; border-radius: 4px; margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; break-inside: auto; }
  th, td { border: 1px solid #e2e8f0; padding: 2px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  .kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 6px 0; }
  .kpi div { border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 8px; }
  .kpi b { display: block; font-size: 15px; }
  .ok { color: #166534; } .warn { color: #b45309; } .fail { color: #b91c1c; font-weight: 600; }
  .chk { border-left: 4px solid #cbd5e1; padding: 3px 8px; margin: 3px 0; }
  .chk.ok { border-color: #16a34a; } .chk.warn { border-color: #d97706; } .chk.fail { border-color: #dc2626; }
  img.diagram { max-width: 100%; border: 1px solid #e2e8f0; }
  ul.ch { margin: 2px 0 0; padding-left: 16px; } ul.ch li { margin: 0; }
  .small { color: #64748b; font-size: 10px; }
  .pb { break-before: page; }
`

function table(head: string[], rows: string[][], rightCols: number[] = []): string {
  const th = head.map((h, i) => `<th${rightCols.includes(i) ? ' class="r"' : ''}>${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${rightCols.includes(i) ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
}

const roomLabel = (v: string): string => (v === 'salon' ? tr.alan.konumSalon : v === 'dis' ? tr.alan.konumDis : tr.alan.konumElektrik)

function summarySection(a: Analysis): string {
  const cooling = a.heat.salonKw + a.heat.elektrikKw
  return `
  <h2>1. Güç ve ısıl yük özeti</h2>
  <div class="kpi">
    <div>${esc(tr.summary.it)}<b>${n1(a.totals.itKw)} kW</b></div>
    <div>${esc(tr.summary.mech)}<b>${n1(a.totals.mechKw)} kW</b></div>
    <div>${esc(tr.summary.loss)}<b>${n1(a.totals.lossKw)} kW</b></div>
    <div>${esc(tr.summary.total)}<b>${n1(a.totals.totalKw)} kW</b></div>
  </div>
  <div class="kpi">
    <div>PUE (yaklaşık)<b>${a.pue === undefined ? '—' : a.pue.toFixed(3).replace('.', ',')}</b></div>
    <div>Görünür güç<b>${n1(a.totals.kva)} kVA</b></div>
    <div>Toplam soğutma ihtiyacı<b>${n1(cooling)} kW (${n1(kwToTr(cooling))} TR)</b></div>
    <div>Toplam ısı<b>${n1(a.heat.totalKw)} kW</b></div>
  </div>
  ${table(
    ['Mekân', 'Isı (kW)', 'TR'],
    [
      [esc(tr.isi.salon), n1(a.heat.salonKw), n1(kwToTr(a.heat.salonKw))],
      [esc(tr.isi.elektrik), n1(a.heat.elektrikKw), n1(kwToTr(a.heat.elektrikKw))],
      [esc(tr.isi.dis), n1(a.heat.disKw), n1(kwToTr(a.heat.disKw))],
    ],
    [1, 2],
  )}
  ${
    a.cooling
      ? `<h3>${esc(tr.isi.coolTitle)}</h3><p>Enerjili soğutma kapasitesi <b>${n1(a.cooling.capacityKw)} kW</b> (${n1(kwToTr(a.cooling.capacityKw))} TR), ihtiyaç <b>${n1(a.cooling.demandKw)} kW</b>` +
        (a.cooling.reservePct !== undefined ? `, yedek <b class="${a.cooling.deficitKw > 0.5 ? 'fail' : 'ok'}">%${n1(a.cooling.reservePct)}</b>` : '') +
        (a.cooling.deficitKw > 0.5 ? `. <span class="fail">Açık: ${n1(a.cooling.deficitKw)} kW.</span>` : '. Kapasite yeterli.') +
        '</p>'
      : ''
  }`
}

function lossSection(a: Analysis): string {
  const items = a.lossItems.filter((i) => i.kw > 0.0005).slice(0, 25)
  return `
  <h2>2. Kayıplar (kalem kalem)</h2>
  ${table(
    ['Kayıp türü', 'kW'],
    [
      [esc(tr.isi.ups), n2(a.losses.upsKw)],
      [esc(tr.isi.trafo), n2(a.losses.trafoKw)],
      [esc(tr.isi.line), n2(a.losses.lineKw)],
      [esc(tr.isi.panel), n2(a.losses.panelKw)],
      [`<b>${esc(tr.summary.loss)}</b>`, `<b>${n2(a.losses.upsKw + a.losses.trafoKw + a.losses.lineKw + a.losses.panelKw)}</b>`],
    ],
    [1],
  )}
  <h3>En büyük ${items.length} kalem</h3>
  ${table(
    ['Kalem', 'Tür', 'Akım (A)', 'Kayıp (kW)', 'Isı nereye'],
    items.map((i) => [esc(i.name), esc(tr.isi.kind[i.kind]), n0(i.currentA), n3(i.kw), esc(roomLabel(i.location))]),
    [2, 3],
  )}`
}

function loadingSection(project: Project, a: Analysis): string {
  const rows = project.nodes
    .map((n) => ({ n, r: a.nodes[n.id] }))
    .filter((x) => x.r && x.r.loadingPct !== undefined && x.r.energized)
    .sort((x, y) => (y.r.loadingPct ?? 0) - (x.r.loadingPct ?? 0))
    .slice(0, 30)
  return `
  <h2>3. Ekipman doluluğu, kısa devre ve gerilim düşümü</h2>
  ${table(
    ['Ekipman', 'Tür', 'Güç (kW)', 'Akım (A)', 'Doluluk (%)', 'Isc (kA)', 'Toplam ΔU (%)'],
    rows.map(({ n, r }) => [
      esc(n.ad),
      esc(EQUIPMENT[n.type].label),
      n1(r.totalKw),
      n0(r.currentA),
      `<span class="${r.status === 'over' ? 'fail' : r.status === 'warning' ? 'warn' : 'ok'}">${n1(r.loadingPct ?? 0)}</span>`,
      r.iscKa === undefined ? '—' : n1(r.iscKa),
      r.chainDropPct === undefined || r.chainDropPct <= 0 ? '—' : n2(r.chainDropPct),
    ]),
    [2, 3, 4, 5, 6],
  )}`
}

function issuesSection(a: Analysis): string {
  const items = a.issues
  return `
  <h2>4. Doğrulama uyarıları</h2>
  ${items.length === 0 ? '<p class="ok">Sorun yok.</p>' : `<ul class="ch">${items.map((i) => `<li class="${i.severity === 'error' ? 'fail' : 'warn'}">${i.severity === 'error' ? '● ' : '▲ '}${esc(i.message)}</li>`).join('')}</ul>`}`
}

function redundancySection(r: RedundancyReport): string {
  const label = { ok: 'Uygun', warn: 'Dikkat', fail: 'Yetersiz' } as const
  return `
  <h2>5. Kapasite ve yedeklilik</h2>
  <p>${esc(tr.red.survive(r.survived, r.total))}.</p>
  ${r.checks.map((c) => `<div class="chk ${c.status}"><b>${esc(c.title)}</b> — <span class="${c.status}">${label[c.status]}</span><br>${esc(c.detail)}</div>`).join('')}
  <h3>${esc(tr.red.spofTitle)}</h3>
  ${
    r.spof.length === 0
      ? '<p class="ok">Tekil arıza noktası yok.</p>'
      : table(['Ekipman / hat', 'Tür', 'Kaybedilen yük (kW)'], r.spof.slice(0, 40).map((s) => [esc(s.label), s.kind === 'node' ? 'Ekipman' : 'Hat', `<span class="fail">${n0(s.lostKw)}</span>`]), [2]) +
        (r.spof.length > 40 ? `<p class="small">… ve ${r.spof.length - 40} satır daha.</p>` : '')
  }`
}

function energySection(e: EnergyReport, s: ProjectSettings): string {
  const money = (v: number): string => `${n0(v)} ${esc(s.para)}`
  return `
  <h2>6. Enerji ve maliyet (24 saatlik yük profili)</h2>
  <div class="kpi">
    <div>Ortalama PUE<b>${e.avgPue === undefined ? '—' : e.avgPue.toFixed(3).replace('.', ',')}</b></div>
    <div>Günlük enerji<b>${n0(e.daily.totalKwh)} kWh</b></div>
    <div>Yıllık enerji<b>${n0(e.annual.totalKwh / 1000)} MWh</b></div>
    <div>Yıllık maliyet<b>${money(e.annual.cost)}</b></div>
  </div>
  <p>Birim fiyat ${n2(s.tarife)} ${esc(s.para)}/kWh. Kayıpların yıllık maliyeti <b>${money(e.annual.lossCost)}</b>.
  ${e.saving ? `PUE ${s.hedefPue.toFixed(2).replace('.', ',')} hedefinde yıllık tasarruf: <b class="ok">${n0(e.saving.kwh / 1000)} MWh · ${money(e.saving.cost)}</b>.` : 'Hedef PUE mevcut ortalamadan düşük değil.'}</p>
  <p>Yıllık CO₂ <b>${n0(e.co2Tons)} t</b> (${n2(s.emisyon)} kg/kWh)${e.waterM3 !== undefined ? `; yıllık su tüketimi <b>${n0(e.waterM3)} m³</b>${e.wue !== undefined ? ` (WUE ${e.wue.toFixed(2).replace('.', ',')} L/kWh)` : ''}` : ''}${e.climateCoupled ? '; soğutma birimleri dış sıcaklığa bağlı (COP/free-cooling) modellendi' : ''}.</p>
  <h3>Aylık</h3>
  ${table(
    ['Ay', 'Ort. sıcaklık (°C)', 'Enerji (MWh)', 'PUE', 'Free-cooling (%)'],
    e.months.map((m) => [esc(MONTH_NAMES[m.month]), n1(m.avgTempC), n1(m.totalKwh / 1000), m.pue === undefined ? '—' : m.pue.toFixed(3).replace('.', ','), m.freeCoolingPct === undefined ? '—' : n0(m.freeCoolingPct)]),
    [1, 2, 3, 4],
  )}
  <h3>Ortalama gün (saatlik)</h3>
  ${table(
    ['Saat', 'IT %', 'Mek. %', 'IT (kW)', 'Mekanik (kW)', 'Kayıp (kW)', 'Toplam (kW)', 'PUE'],
    e.hours.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, n0(h.itFactor * 100), n0(h.mechFactor * 100), n0(h.itKw), n0(h.mechKw), n1(h.lossKw), n0(h.totalKw), h.pue === undefined ? '—' : h.pue.toFixed(3).replace('.', ',')]),
    [1, 2, 3, 4, 5, 6, 7],
  )}
  ${
    e.topLosses.length
      ? `<h3>${esc(tr.enerji.topLosses)}</h3>` +
        table(['Kalem', 'Tür', 'kWh/yıl', 'Maliyet'], e.topLosses.map((l) => [esc(l.name), esc(tr.isi.kind[l.kind]), n0(l.annualKwh), money(l.cost)]), [2, 3])
      : ''
  }`
}

function reliabilitySection(r: ReliabilityReport): string {
  const pct = (a: number): string => `%${(a * 100).toFixed(a > 0.9999 ? 6 : 4).replace('.', ',')}`
  return `
  <h2>8. Erişilebilirlik ve güvenilirlik</h2>
  <div class="kpi">
    <div>Erişilebilirlik<b>${pct(r.availability)}</b></div>
    <div>Yıllık beklenen kesinti<b>${n1(r.downtimeMinPerYear)} dk</b></div>
    <div>Kaç dokuz<b>${Number.isFinite(r.nines) ? n2(r.nines) : '∞'}</b></div>
    <div>Tier kıyası<b>${esc(r.tier ?? 'Tier I altında')}</b></div>
  </div>
  <p class="small">${r.components} bileşen; ${r.counts.single} tekil, ${r.counts.pair} çift, ${r.counts.triple} üçlü kesit kümesi. IT yüklerinden herhangi birinin enerjisiz kalması kesinti sayılır; bileşenler bağımsız, yalnız bağlantı değerlendirilir.${r.truncated ? ' Üçlü kombinasyonlar atlandı.' : ''}</p>
  ${table(
    ['Derece', 'Eşzamanlı arıza', 'Olasılık', 'Pay (%)'],
    r.cutSets.slice(0, 15).map((c) => [String(c.order), esc(c.names.join(' + ')), c.probability.toExponential(2).replace('.', ','), n1(c.share)]),
    [2, 3],
  )}`
}

function generatorBlock(g: GeneratorStudy | undefined): string {
  if (!g || g.rows.length === 0) return ''
  const cls = { ok: 'ok', warn: 'warn', fail: 'fail' } as const
  return (
    '<h3>Jeneratör yakıt özerkliği (şebeke kaybı)</h3>' +
    table(['Jeneratör', 'Yük (kW)', 'Yüklenme (%)', 'Tüketim (L/sa)', 'Tank (L)', 'Özerklik (sa)'], g.rows.map((r) => [esc(r.name), n0(r.loadKw), n0(r.loadingPct), n0(r.lph), n0(r.tankL), `<span class="${cls[r.status]}">${Number.isFinite(r.hours) ? n1(r.hours) : '∞'}</span>`]), [1, 2, 3, 4, 5]) +
    '<h3>Sıralı yük alma ve gerilim çökmesi</h3>' +
    table(['Adım', 't (sn)', 'Yükler', 'Kalkış (kVA)', 'Kümülatif (%)', 'Gerilim çökmesi (%)'], g.steps.map((x) => [String(x.step), n0(x.delaySec), esc(x.names.slice(0, 5).join(', ') + (x.names.length > 5 ? ` … (+${x.names.length - 5})` : '')), n0(x.surgeKva), n0(x.loadPct), `<span class="${x.ok ? 'ok' : 'fail'}">${n1(x.dipPct)}</span>`]), [3, 4, 5]) +
    '<p class="small">Yakıt tüketimi tipik dizel özgül tüketim eğrisiyle; gerilim çökmesi S_kalkış/(S_kalkış+Σ Sn/Xd″) ön tahminidir.</p>'
  )
}

function electricalSection(sel: SelectivityRow[] | undefined, arc: ArcFlashRow[] | undefined, gen?: GeneratorStudy): string {
  const lab = { total: 'Tam seçici', partial: 'Kısmi seçici', none: 'Seçici değil' } as const
  const ppe = (r: ArcFlashRow): string => (r.ppe === 5 ? '&gt; 40: tehlikeli' : r.ppe === 0 ? 'Kategori 0' : `Kategori ${r.ppe}`)
  return `
  <h2>9. Elektrik çalışmaları</h2>
  ${
    sel && sel.length
      ? `<h3>Koruma seçiciliği (en zayıf ${Math.min(15, sel.length)})</h3>` +
        table(['Üst kesici', 'Alt kesici', 'Isc (kA)', 'Seçicilik limiti (kA)', 'Durum'], sel.slice(0, 15).map((r) => [esc(r.upName), esc(r.downName), n1(r.iscKa), n1(r.limitKa), `<span class="${r.status === 'none' ? 'fail' : r.status === 'partial' ? 'warn' : 'ok'}">${lab[r.status]}</span>`]), [2, 3])
      : '<p class="small">Seçicilik değerlendirilecek kesici çifti yok.</p>'
  }
  ${
    arc && arc.length
      ? `<h3>Ark flaşı (IEEE 1584-2002, basitleştirilmiş; en yüksek ${Math.min(15, arc.length)})</h3>` +
        table(['Pano', 'Ibf (kA)', 'Ia (kA)', 'Koruyan kesici', 't (sn)', 'E (cal/cm²)', 'PPE'], arc.slice(0, 15).map((r) => [esc(r.name), n1(r.ibfKa), n1(r.iaKa), esc(r.protectedBy ?? 'yok (2 sn varsayım)'), n2(r.clearingSec), n1(r.energy), `<span class="${r.ppe >= 4 ? 'fail' : r.ppe >= 2 ? 'warn' : 'ok'}">${ppe(r)}</span>`]), [1, 2, 4, 5])
      : ''
  }
  ${generatorBlock(gen)}
  <p class="small">Açma eğrileri tipik ayarlardır; üretici eğrileri ve IEEE 1584-2018 ile doğrulanmalıdır.</p>`
}

function infraSection(trays: TrayFillRow[] | undefined, pipes: Boru3D[] | undefined): string {
  const cls = { ok: 'ok', warn: 'warn', over: 'fail' } as const
  const lab = { ok: 'Uygun', warn: 'Sınırda', over: 'Aşım' } as const
  const t =
    trays && trays.length
      ? '<h3>Kablo tavaları</h3>' +
        table(
          ['Tava', 'Tür', 'Uzunluk (m)', 'G × Y (m)', 'Kablo', 'Doluluk (%)', 'Sınır (%)', 'Durum'],
          trays.map((r) => [esc(r.tray.ad), r.tray.tur === 'veri' ? 'Veri' : 'Güç', n1(r.lengthM), `${r.tray.g} × ${r.tray.h}`, String(r.cables), n1(r.fillPct), n0(r.tray.sinir), `<span class="${cls[r.status]}">${lab[r.status]}</span>`]),
          [2, 4, 5, 6],
        ) +
        '<p class="small">Doluluk = kablo kesitleri toplamı / tava iç kesiti (tipik 4 damarlı XLPE kablo dış çapı); ön tasarım değeridir.</p>'
      : ''
  const p =
    pipes && pipes.length
      ? '<h3>Boru hatları</h3>' +
        table(
          ['Hat', 'Tür', 'Yön', 'DN', 'Yük (kW)', 'Debi (L/sn)', 'Hız (m/sn)', 'Uzunluk (m)', 'Δp (kPa)'],
          pipes.map((b) => {
            const h = hydraulicsOf(b)
            return [esc(b.ad), b.tur === 'sogukSu' ? 'Soğuk su' : 'Kondenser', b.yon === 'besleme' ? 'Besleme' : 'Dönüş', `DN${h.dn}`, n0(b.kw), n1(h.lps), n1(h.velocity), n1(boruLength(b)), n1(h.dpKpa)]
          }),
          [4, 5, 6, 7, 8],
        ) +
        '<p class="small">Debi Q = P/(4,186·ΔT) (ΔT = 5 K); DN hız ≤ 2,5 m/sn için; basınç kaybı Darcy–Weisbach (f = 0,02), yerel kayıplar ve vanalar dahil değildir. Ön tasarım.</p>'
      : ''
  return `<h2>10. Kablo tavası ve boru hatları</h2>${t}${p}`
}

function simulationSection(steps: SimStep[], s: ProjectSettings, names: (id: string) => string): string {
  const last = steps[steps.length - 1]
  const failedAll = [...new Set(steps.flatMap((st) => st.failed))]
  const worst = steps.reduce((m, st) => Math.max(m, st.lostKw), 0)
  const rows = steps.map((st) => {
    const ch = st.changes.map((c) => `<li>${esc(c.text)}</li>`).join('')
    const bat = st.battery.map((b) => `${esc(names(b.id))}: ${b.depleted ? 'tükendi' : `%${n0(b.socPct)}${b.remainingMin !== undefined ? ` (≈ ${n1(b.remainingMin)} dk)` : ''}`}`).join('<br>')
    return [
      esc(st.timeLabel || '—'),
      `<b>${esc(st.title)}</b>${st.phase === 'recovery' ? ' <span class="ok">(giderme)</span>' : ''}`,
      st.lostKw > 0.5 ? `<span class="fail">${n0(st.lostKw)}</span>` : '0',
      n0(st.analysis.totals.totalKw),
      ch ? `<ul class="ch">${ch}</ul>` : '—',
      bat || '—',
    ]
  })
  return `
  <h2>7. Arıza senaryosu simülasyonu</h2>
  <p>Arızalı ekipman: <b>${esc(failedAll.map(names).join(', ') || '—')}</b>. En büyük anlık yük kaybı: <b class="${worst > 0.5 ? 'fail' : 'ok'}">${n0(worst)} kW</b>.
  Son durum: ${esc(last.title)} (${esc(last.timeLabel || '—')}), kaybedilen yük ${n0(last.lostKw)} kW.</p>
  ${table(['Zaman', 'Adım', 'Kayıp yük (kW)', 'Çekilen (kW)', 'Olanlar', 'UPS bataryası'], rows, [2, 3])}
  <p class="small">Süreler tipik cihaz gecikmeleridir (STS ~4 ms, bypass ~100 ms, jeneratör ~10 sn, sıralama ~70 sn, geri transfer ~5 dk, soğutma ~5 dk); her adım kararlı hal çözümüdür, elektromanyetik geçici olay hesabı değildir.
  Soğutma açığında salon sıcaklığı: hacim ${n0(s.salonHacmi)} m³, ısıl kütle çarpanı ${n1(s.isilKutle)}, izinli artış ${n1(s.izinliArtis)} K.</p>`
}

/** Raporun tam HTML belgesini üretir. */
export function buildReportHtml(inp: ReportInput): string {
  const { project, analysis: a, settings } = inp
  const sec = { electrical: true, reliability: true, summary: true, losses: true, loading: true, issues: true, redundancy: true, energy: true, simulation: true, diagram: true, view3d: true, infra: true, ...inp.sections }
  const names = (id: string): string => project.nodes.find((n) => n.id === id)?.ad ?? id
  const parts: string[] = []
  parts.push(`<h1>${esc(tr.app.title)} — ${esc(project.name)}</h1>
  <div class="meta">${esc(new Date().toLocaleString('tr-TR'))}${inp.scenarioName ? ` · ${esc(tr.senaryo.banner(inp.scenarioName))}` : ''} · ${project.nodes.length} ekipman, ${project.edges.length} hat</div>
  <div class="disc">${esc(tr.disclaimer)}</div>`)
  if (sec.summary) parts.push(summarySection(a))
  if (sec.diagram && inp.diagramPng) parts.push(`<h2 class="pb">Şema</h2><img class="diagram" src="${esc(inp.diagramPng)}" alt="Şema">`)
  if (sec.view3d && inp.view3dPng) parts.push(`<h2 class="pb">3D yerleşim</h2><img class="diagram" src="${esc(inp.view3dPng)}" alt="3D yerleşim"><p class="small">3D görünüm ekipman yerleşimini gösterir; ısı haritası yaklaşık bir görselleştirmedir (CFD değildir) ve ekipman boyutları tipik yer tutucudur.</p>`)
  if (sec.losses) parts.push(lossSection(a))
  if (sec.loading) parts.push(loadingSection(project, a))
  if (sec.issues) parts.push(issuesSection(a))
  if (sec.redundancy && inp.redundancy) parts.push(redundancySection(inp.redundancy))
  if (sec.energy && inp.energy) parts.push(energySection(inp.energy, settings))
  if (sec.simulation && inp.steps && inp.steps.length > 1) parts.push(simulationSection(inp.steps, settings, names))
  if (sec.reliability && inp.reliability) parts.push(reliabilitySection(inp.reliability))
  if (sec.infra && ((inp.trays && inp.trays.length) || (inp.pipes && inp.pipes.length))) parts.push(infraSection(inp.trays, inp.pipes))
  if (sec.electrical && (inp.selectivity || inp.arcFlash || inp.generator)) parts.push(electricalSection(inp.selectivity, inp.arcFlash, inp.generator))
  const cool = a.cooling && a.cooling.deficitKw > 0.5 ? rideThroughMinutes(a.cooling.deficitKw, settings) : undefined
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(project.name)} — Rapor</title><style>${CSS}</style></head><body>${parts.join('\n')}${cool !== undefined ? `<p class="small">Soğutma açığı sürerse salon sıcaklığı ≈ ${n0(cool)} dk içinde izinli artışa ulaşır.</p>` : ''}</body></html>`
}

/** Raporu gizli bir iframe'de açıp yazdırma penceresini çağırır (PDF olarak kaydedilebilir). */
export function printHtml(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error('Yazdırma çerçevesi oluşturulamadı.')
  }
  doc.open()
  doc.write(html)
  doc.close()
  const go = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => iframe.remove(), 60_000)
  }
  // Görsel (şema PNG) yüklenince yazdır.
  const imgs = [...doc.images]
  if (imgs.every((i) => i.complete)) setTimeout(go, 100)
  else Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = () => r(null) }))).then(go)
}
