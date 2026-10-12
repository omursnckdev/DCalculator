import type { Nokta3D, ProjectEdge } from '../model/types'
import type { Box } from './geometry'

/** Ekipmanın kablo bağlantı noktası: üst orta (kablo tavasından iner). */
export const anchorOf = (b: Box): Nokta3D => ({ x: b.x, y: b.elev + b.h, z: b.z })

/** Kablo tavası (varsayılan) yüksekliği, m. */
export const TRAY_MIN = 3

/** İki ekipman arası ortogonal (Manhattan) güzergâh ara noktaları: yukarı çık, x boyunca, z boyunca, in. `lane` paralel hatları ayırır. */
export function defaultRoute(a: Box, b: Box, lane = 0): Nokta3D[] {
  const A = anchorOf(a)
  const B = anchorOf(b)
  const y = Math.max(TRAY_MIN, A.y + 0.5, B.y + 0.5) + lane * 0.12
  const pts: Nokta3D[] = [
    { x: A.x, y, z: A.z },
    { x: B.x, y, z: A.z },
    { x: B.x, y, z: B.z },
  ]
  // Ardışık yinelenen noktaları at (aynı x/z üzerindeki ekipman).
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z) > 1e-9)
}

/** Tam çokgen: bağlantı noktası → (kullanıcı ara noktaları veya varsayılan güzergâh) → bağlantı noktası. */
export function routePoints(edge: Pick<ProjectEdge, 'guzergah3d'>, a: Box, b: Box, lane = 0): Nokta3D[] {
  const mid = edge.guzergah3d && edge.guzergah3d.length > 0 ? edge.guzergah3d : defaultRoute(a, b, lane)
  return [anchorOf(a), ...mid, anchorOf(b)]
}

export function polylineLength(pts: Nokta3D[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z)
  return s
}

/** Ekipman girişi/payı: toplam uzunluğa eklenen oran (çıkış ve bağlantı ekleri için). */
export const ROUTE_PAD = 0.05

/** Hat uzunluğu (m): güzergâh çokgeni × (1 + pay); 0,1 m'ye yuvarlanır, en az 0,1. */
export function routeLengthM(pts: Nokta3D[], pad = ROUTE_PAD): number {
  return Math.max(0.1, Math.round(polylineLength(pts) * (1 + pad) * 10) / 10)
}

/** Aynı kaynaktan çıkan hatları ayırmak için şerit numarası (kaynak başına sıra); yalnız görsel yükseklik farkıdır. */
export function laneMap(edges: Pick<ProjectEdge, 'id' | 'source'>[]): Map<string, number> {
  const count = new Map<string, number>()
  const out = new Map<string, number>()
  for (const e of edges) {
    const k = count.get(e.source) ?? 0
    count.set(e.source, k + 1)
    out.set(e.id, k % 6)
  }
  return out
}
