import { EQUIPMENT } from '../library/equipment'
import type { ProjectEdge, ProjectNode, Scenario } from '../model/types'
import { energize } from './energize'
import { isAutoClosing, switchState } from './switches'
import type { Analysis, Model } from './types'

/** Simülasyon/otomasyon seçenekleri. Varsayılan: tüm otomasyonlar çalışır (kararlı durum). */
export interface SimOptions {
  /** Otomatik kapanan (yedek/bypass) kesiciler çalışır. */
  autoBypass: boolean
  /** Senkron panosu yük sıralaması (yük azalınca fazla jeneratör kapanır). */
  staging: boolean
  /** Jeneratörler devrede. false: henüz çalışmıyor (ölü kaynak). */
  genOnline: boolean
  /** UPS girişi kaybolunca bataryadan beslemeye devam eder. */
  battery: boolean
  /** Transfer düğümü -> kilitli giriş hattı id (transfer henüz olmadı). */
  hold?: Record<string, string>
  /** Arıza giderilirken bypass kesicileri henüz geri açılmadı: bu kesiciler kapalı kalır. */
  keepClosed?: string[]
}

export const FULL_AUTOMATION: SimOptions = { autoBypass: true, staging: true, genOnline: true, battery: false }

export const withDefaults = (o?: Partial<SimOptions>): SimOptions => ({ ...FULL_AUTOMATION, ...o })

function presentEdges(model: Model, scenario?: Scenario): ProjectEdge[] {
  const ids = new Set(model.nodes.map((n) => n.id))
  return model.edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && (scenario?.edgeStates[e.id] ?? e.durum) === 'kapali',
  )
}

/**
 * Otomatik kapanan kesicileri çözer. Bir "otomatik" kesiciden (ve ardışık kesicilerden) oluşan zincirin
 * ucundaki pano/bara başka hiçbir yoldan enerjili değilse ve zincirin kaynak ucu enerjiliyse, zincirdeki
 * otomatik kesiciler kapanır (ör. UPS arızasında hard bypass). Kapanış bir sonrakini etkileyebilir; durana
 * kadar sırayla tekrarlanır.
 */
export function resolveAutoClosed(model: Model, scenario: Scenario | undefined, opts: SimOptions, standby: Set<string>): Set<string> {
  const closed = new Set<string>()
  if (!opts.autoBypass) return closed
  const auto = model.nodes.filter((n) => isAutoClosing(n, scenario) && switchState(n, scenario) === 'acik')
  if (auto.length === 0) return closed
  for (const id of opts.keepClosed ?? []) if (auto.some((n) => n.id === id)) closed.add(id)

  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const edges = presentEdges(model, scenario)
  const outE = new Map<string, ProjectEdge[]>()
  const inE = new Map<string, ProjectEdge[]>()
  for (const n of model.nodes) {
    outE.set(n.id, [])
    inE.set(n.id, [])
  }
  for (const e of edges) {
    outE.get(e.source)!.push(e)
    inE.get(e.target)!.push(e)
  }
  const failed = new Set(scenario?.failedNodes ?? [])

  const deadSet = (): Set<string> => {
    const dead = new Set<string>(failed)
    for (const n of model.nodes) {
      if (switchState(n, scenario) === 'acik' && !closed.has(n.id)) dead.add(n.id)
      if (n.type === 'jenerator' && (!opts.genOnline || standby.has(n.id))) dead.add(n.id)
    }
    return dead
  }

  for (let iter = 0; iter < 30; iter++) {
    const { energized } = energize({ nodes: model.nodes, edges, dead: deadSet(), battery: opts.battery, hold: opts.hold })
    let progress = false
    for (const b of auto) {
      if (closed.has(b.id)) continue
      // Kaynak ucu enerjili mi?
      if (!(inE.get(b.id) ?? []).some((e) => energized.has(e.source))) continue
      // Zinciri aşağı doğru izle: yalnızca kesicilerden geçip ilk pano/baraya (T) ulaş.
      const chain: ProjectNode[] = [b]
      let cur = b
      let target: ProjectNode | undefined
      let ok = true
      for (let guard = 0; guard < 20; guard++) {
        const outs = outE.get(cur.id) ?? []
        if (outs.length !== 1) {
          ok = false
          break
        }
        const next = byId.get(outs[0].target)!
        if (next.type === 'kesici') {
          const blockedManually = switchState(next, scenario) === 'acik' && !isAutoClosing(next, scenario)
          if (failed.has(next.id) || blockedManually) {
            ok = false
            break
          }
          chain.push(next)
          cur = next
          continue
        }
        target = next
        break
      }
      if (!ok || !target || failed.has(target.id) || energized.has(target.id)) continue
      for (const c of chain) if (isAutoClosing(c, scenario) && switchState(c, scenario) === 'acik') closed.add(c.id)
      progress = true
      break // durumu yeniden hesapla
    }
    if (!progress) break
  }
  return closed
}

/** Senkron panosuna bağlı jeneratör kolu: jeneratör ve panoya en yakın eleman (hat enerjili mi bakılır). */
export interface SyncMember {
  gen: ProjectNode
  branch: ProjectNode
}

/** Senkron panosuna bağlı jeneratörler (giriş port sırasıyla = çalışma önceliği). */
export function syncMembers(model: Model, sync: ProjectNode): SyncMember[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const members: SyncMember[] = []
  const ins = model.edges.filter((e) => e.target === sync.id).sort((a, b) => a.hedefPort - b.hedefPort)
  for (const e of ins) {
    const branch = byId.get(e.source)
    let cur = branch
    for (let guard = 0; cur && branch && guard < 20; guard++) {
      if (cur.type === 'jenerator') {
        members.push({ gen: cur, branch })
        break
      }
      if (cur.type !== 'kesici' && cur.type !== 'bara') break
      const upstream = model.edges.filter((x) => x.target === cur!.id)
      if (upstream.length !== 1) break
      cur = byId.get(upstream[0].source)
    }
  }
  return members
}

const num = (n: ProjectNode, key: string): number => {
  const v = n.params[key] ?? EQUIPMENT[n.type].defaults[key]
  return typeof v === 'number' ? v : 0
}

/**
 * Jeneratör yük sıralaması: senkron panosuna paralel bağlı jeneratörler yükü paylaşırken toplam yük,
 * (çalışan sayısı − 1) jeneratörün kapasitesinin eşik (%70) değerine inerse sondaki jeneratör kapanır.
 * 1. Jeneratör (en düşük giriş portu) önceliklidir. Yalnızca jeneratörler gerçekten yük taşıyorsa çalışır.
 */
export function stagingStandby(model: Model, res: Analysis, scenario?: Scenario): Set<string> {
  const standby = new Set<string>()
  const failed = new Set(scenario?.failedNodes ?? [])
  for (const sync of model.nodes.filter((n) => n.type === 'senkron')) {
    const mode = sync.params.mod ?? EQUIPMENT.senkron.defaults.mod
    if (mode === 'esit') continue
    // Canlı üye: jeneratör sağlam ve panoya giden kol (kesiciler dahil) enerjili.
    const live = syncMembers(model, sync)
      .filter((m) => !failed.has(m.gen.id) && res.nodes[m.gen.id]?.energized && res.nodes[m.branch.id]?.energized)
      .map((m) => m.gen)
    if (live.length < 2) continue
    const total = res.nodes[sync.id]?.kva ?? 0
    if (total <= 1e-9) continue
    const thr = Math.max(1, num(sync, 'esik')) / 100
    let cap = 0
    let run = live.length
    for (let r = 1; r <= live.length; r++) {
      cap += num(live[r - 1], 'nominalKva')
      if (total <= thr * cap + 1e-9) {
        run = r
        break
      }
    }
    for (const g of live.slice(run)) standby.add(g.id)
  }
  return standby
}
