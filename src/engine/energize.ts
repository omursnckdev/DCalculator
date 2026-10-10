import { EQUIPMENT } from '../library/equipment'
import type { ProjectEdge, ProjectNode } from '../model/types'

export interface EnergizeInput {
  nodes: ProjectNode[]
  /** Mevcut (kapalı) hatlar. */
  edges: ProjectEdge[]
  /** Enerjilenemeyen düğümler: arızalı, açık kesici, devre dışı/henüz çalışmayan jeneratör. */
  dead: Set<string>
  /** true: UPS girişi kaybolsa da bataryadan beslemeye devam eder. */
  battery: boolean
  /** Transfer (ATS/STS) düğümü -> kilitli (henüz geçiş yapmamış) giriş hattı. */
  hold?: Record<string, string>
}

/**
 * Yapısal enerji durumu: kaynaklardan (şebeke/jeneratör) ölü düğümlere takılmadan ulaşılan
 * düğümler. Batarya açıksa girişi kaybolan UPS'ler de kaynak gibi davranır.
 */
export function energize(inp: EnergizeInput): { energized: Set<string>; onBattery: Set<string> } {
  const out = new Map<string, ProjectEdge[]>()
  for (const n of inp.nodes) out.set(n.id, [])
  for (const e of inp.edges) out.get(e.source)?.push(e)

  const energized = new Set<string>()
  const queue: string[] = []
  const seed = (id: string) => {
    energized.add(id)
    queue.push(id)
  }
  const drain = () => {
    while (queue.length) {
      const u = queue.pop()!
      for (const e of out.get(u) ?? []) {
        const v = e.target
        if (inp.dead.has(v) || energized.has(v)) continue
        const held = inp.hold?.[v]
        if (held !== undefined && held !== e.id) continue
        energized.add(v)
        queue.push(v)
      }
    }
  }

  for (const n of inp.nodes) if (!EQUIPMENT[n.type].hasInput && !inp.dead.has(n.id)) seed(n.id)
  drain()

  const onBattery = new Set<string>()
  if (inp.battery) {
    for (const n of inp.nodes) {
      if (n.type === 'ups' && !inp.dead.has(n.id) && !energized.has(n.id)) {
        onBattery.add(n.id)
        seed(n.id)
      }
    }
    drain()
  }
  return { energized, onBattery }
}
