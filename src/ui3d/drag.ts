import * as THREE from 'three'
import { alignGuides, boxOf, roomAt, snap } from '../layout3d/geometry'
import type { Box } from '../layout3d/geometry'
import { dimsOf } from '../layout3d/dims'
import { followersOf } from '../layout3d/autoLayout'
import { toProjectEdges, toProjectNodes } from '../model/project'
import type { Nokta3D, Oda3D, ProjectEdge } from '../model/types'
import { useStore } from '../store/useStore'
import { use3dStore } from './use3dStore'

/** Sürükleme durumu (modül düzeyi: pointer olayları sahne bileşenleri arasında paylaşılır). */
type Drag =
  | { kind: 'nodes'; ids: string[]; start: Record<string, { x: number; z: number }>; startGround: { x: number; z: number }; primary: string; grab: boolean }
  | { kind: 'wp'; edgeId: string; index: number; y: number; pts: Nokta3D[] }

export const drag: { current: Drag | null; last: { x: number; z: number } } = { current: null, last: { x: 0, z: 0 } }

/** Seçim kutusu (zeminde Shift+sürükle) durumu. */
export const marq: { active: boolean; x0: number; y0: number } = { active: false, x0: 0, y0: 0 }

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()

/** Işının y = height düzlemiyle kesişimi (x, z); kesişmezse null. */
export function groundFromRay(ray: THREE.Ray, height = 0): { x: number; z: number } | null {
  plane.constant = -height
  return ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null
}

export const selectedIds = (): string[] =>
  useStore
    .getState()
    .nodes.filter((n) => n.selected)
    .map((n) => n.id)

export function setSelection(ids: string[], edgeId?: string): void {
  const set = new Set(ids)
  useStore.setState((s) => ({
    nodes: s.nodes.map((n) => (n.selected === set.has(n.id) ? n : { ...n, selected: set.has(n.id) })),
    edges: s.edges.map((e) => (!!e.selected === (e.id === edgeId) ? e : { ...e, selected: e.id === edgeId })),
  }))
}

/** Ekipman üzerinde pointerdown: seçimi günceller ve (grab=false ise) sürüklemeyi başlatır. */
export function beginNodeDrag(id: string, ground: { x: number; z: number } | null, shift: boolean, grab = false): void {
  const sel = new Set(selectedIds())
  if (shift) {
    if (sel.has(id)) sel.delete(id)
    else sel.add(id)
    setSelection([...sel])
    if (!sel.has(id)) return
  } else if (!sel.has(id)) {
    sel.clear()
    sel.add(id)
    setSelection([id])
  }
  if (!ground) return
  const st = useStore.getState()
  const nodes = st.nodes
  const ids = [...sel]
  // Ana ekipmanla birlikte taşınan küçük elemanlar (kesici, ölçü): bağlı oldukları ekipman seçiliyse onlar da gelir.
  const follow = followersOf({ nodes: toProjectNodes(nodes), edges: toProjectEdges(st.edges) })
  for (const id of [...sel]) for (const f of follow.get(id) ?? []) if (!sel.has(f)) ids.push(f)
  const start: Record<string, { x: number; z: number }> = {}
  const moving = new Set(ids)
  for (const n of nodes) if (moving.has(n.id) && n.data.yerlesim3d) start[n.id] = { x: n.data.yerlesim3d.x, z: n.data.yerlesim3d.z }
  drag.current = { kind: 'nodes', ids: ids.filter((i) => start[i]), start, startGround: ground, primary: id, grab }
}

export function beginWaypointDrag(edgeId: string, index: number, y: number, pts: Nokta3D[]): void {
  drag.current = { kind: 'wp', edgeId, index, y, pts }
}

/** Sürükleme sırasında konumu günceller (ızgaraya yapışma + hizalama kılavuzları). */
export function moveDrag(ground: { x: number; z: number }, boxes: Box[], rooms: Oda3D[]): void {
  const d = drag.current
  if (!d) return
  const st = useStore.getState()
  if (d.kind === 'wp') {
    const step = use3dStore.getState().snapStep
    const next = d.pts.map((p, i) => (i === d.index ? { x: snap(ground.x, step), y: p.y, z: snap(ground.z, step) } : p))
    st.setEdgeRoute3d(d.edgeId, next)
    return
  }
  const step = use3dStore.getState().snapStep
  const p0 = d.start[d.primary]
  if (!p0) return
  const dx = ground.x - d.startGround.x
  const dz = ground.z - d.startGround.z
  let nx = snap(p0.x + dx, step)
  let nz = snap(p0.z + dz, step)
  const prim = st.nodes.find((n) => n.id === d.primary)
  if (prim?.data.yerlesim3d) {
    const pn = toProjectNodes([prim])[0]
    const l = prim.data.yerlesim3d
    const moving = boxOf(prim.id, pn.type, { x: nx, z: nz, rot: l.rot, elev: l.elev }, dimsOf(pn))
    const others = boxes.filter((b) => !d.ids.includes(b.id))
    const g = alignGuides(moving, others, rooms)
    nx += g.dx
    nz += g.dz
    use3dStore.getState().setGuides(g.guides)
  }
  const patches: Record<string, { x: number; z: number }> = {}
  for (const id of d.ids) patches[id] = { x: d.start[id].x + (nx - p0.x), z: d.start[id].z + (nz - p0.z) }
  st.setLayout3d(patches)
}

/** Sürükleme bitti: taşınan ekipmanın odası yeniden belirlenir. */
export function endDrag(): void {
  const d = drag.current
  drag.current = null
  use3dStore.getState().setGuides([])
  if (!d || d.kind !== 'nodes') return
  const st = useStore.getState()
  const patches: Record<string, { oda: string | undefined }> = {}
  for (const id of d.ids) {
    const l = st.nodes.find((n) => n.id === id)?.data.yerlesim3d
    if (!l) continue
    const room = roomAt(st.odalar3d, l.x, l.z)
    if (room?.id !== l.oda) patches[id] = { oda: room?.id }
  }
  if (Object.keys(patches).length) st.setLayout3d(patches as never)
}

/** Seçili ekipmanı Y ekseni etrafında döndürür (derece). */
export function rotateSelected(deg: number): void {
  const st = useStore.getState()
  const patches: Record<string, { rot: number }> = {}
  for (const n of st.nodes) if (n.selected && n.data.yerlesim3d) patches[n.id] = { rot: (((n.data.yerlesim3d.rot ?? 0) + deg) % 360 + 360) % 360 }
  if (Object.keys(patches).length) st.setLayout3d(patches)
}

export type EdgeLike = Pick<ProjectEdge, 'id'>
