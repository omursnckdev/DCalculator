import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { tick } from './anim'
import { STATUS_HEX } from '../layout3d/colors'
import { floorVisible } from '../layout3d/floors'
import { defaultRoute, routePoints } from '../layout3d/route'
import type { Nokta3D, ProjectEdge } from '../model/types'
import { useStore } from '../store/useStore'
import { beginWaypointDrag, groundFromRay, setSelection } from './drag'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

interface Cable {
  edge: ProjectEdge
  pts: Nokta3D[]
  color: string
  width: number
  live: boolean
  open: boolean
}

function useCables(): Cable[] {
  const sc = useScene()
  const mode = use3dStore((s) => s.colorMode)
  const floor = use3dStore((s) => s.floor)
  return useMemo(() => {
    const out: Cable[] = []
    for (const e of sc.edges) {
      const a = sc.boxById.get(e.source)
      const b = sc.boxById.get(e.target)
      if (!a || !b) continue
      if (!floorVisible(floor, a.elev) || !floorVisible(floor, b.elev)) continue
      const r = sc.analysis.edges[e.id]
      const pts = routePoints(e, a, b, sc.lanes.get(e.id) ?? 0)
      const live = !!r?.live && (r?.share ?? 0) > 1e-9
      const open = e.durum === 'acik'
      const base = e.tip === 'busbar' ? '#a16207' : '#2563eb'
      const color = !live ? '#9ca3af' : mode === 'doluluk' ? STATUS_HEX[r?.status ?? 'none'] : base
      const width = 1.2 + 2.6 * Math.min(1, (r?.loadingPct ?? 30) / 100)
      out.push({ edge: e, pts, color: open ? '#f59e0b' : color, width: e.tip === 'busbar' ? width + 1 : width, live, open })
    }
    return out
  }, [sc.edges, sc.boxById, sc.analysis, sc.lanes, mode, floor])
}

/** Enerji akış noktaları: tüm canlı hatlar tek InstancedMesh ile çizilir. */
function FlowDots({ cables }: { cables: Cable[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const live = useMemo(
    () =>
      cables
        .filter((c) => c.live && !c.open)
        .map((c) => {
          const cum = [0]
          for (let i = 1; i < c.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].y - c.pts[i - 1].y, c.pts[i].z - c.pts[i - 1].z))
          return { pts: c.pts, cum, total: cum[cum.length - 1] }
        })
        .filter((c) => c.total > 0.1),
    [cables],
  )
  const per = 3
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    let k = 0
    for (const c of live) {
      for (let j = 0; j < per; j++) {
        const t = ((clock.elapsedTime * 2.5 + (j * c.total) / per) % c.total + c.total) % c.total
        let i = 1
        while (i < c.cum.length - 1 && c.cum[i] < t) i++
        const f = (t - c.cum[i - 1]) / Math.max(1e-9, c.cum[i] - c.cum[i - 1])
        dummy.position.set(c.pts[i - 1].x + (c.pts[i].x - c.pts[i - 1].x) * f, c.pts[i - 1].y + (c.pts[i].y - c.pts[i - 1].y) * f, c.pts[i - 1].z + (c.pts[i].z - c.pts[i - 1].z) * f)
        dummy.updateMatrix()
        m.setMatrixAt(k++, dummy.matrix)
      }
    }
    m.count = k
    m.instanceMatrix.needsUpdate = true
    tick()
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, live.length * per)]} frustumCulled={false}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshBasicMaterial color="#fde047" />
    </instancedMesh>
  )
}

/**
 * Hatlar: kalınlık kovası (1–5 px) ve kesik/sürekli ayrımına göre en fazla ~10 LineSegments2 çizimiyle birleştirilir
 * (hat başına ayrı çizim yerine). Tıklanan segmentten hat bulunur.
 */
function CableBatches({ cables }: { cables: Cable[] }) {
  const batches = useMemo(() => {
    const map = new Map<string, { width: number; dashed: boolean; pos: number[]; col: number[]; edgeOf: string[] }>()
    const c = new THREE.Color()
    for (const cb of cables) {
      const width = Math.min(5, Math.max(1, Math.round(cb.width)))
      const dashed = cb.open || !cb.live
      const key = `${width}|${dashed}`
      let b = map.get(key)
      if (!b) {
        b = { width, dashed, pos: [], col: [], edgeOf: [] }
        map.set(key, b)
      }
      c.set(cb.color)
      for (let i = 1; i < cb.pts.length; i++) {
        const a = cb.pts[i - 1]
        const z = cb.pts[i]
        b.pos.push(a.x, a.y, a.z, z.x, z.y, z.z)
        b.col.push(c.r, c.g, c.b, c.r, c.g, c.b)
        b.edgeOf.push(cb.edge.id)
      }
    }
    return [...map.values()].map((b) => {
      const geo = new LineSegmentsGeometry()
      geo.setPositions(b.pos)
      geo.setColors(b.col)
      const mat = new LineMaterial({ linewidth: b.width, vertexColors: true, dashed: b.dashed, dashSize: 0.4, gapSize: 0.25 })
      const obj = new LineSegments2(geo, mat)
      if (b.dashed) obj.computeLineDistances()
      return { obj, edgeOf: b.edgeOf }
    })
  }, [cables])
  useEffect(
    () => () => {
      for (const b of batches) {
        b.obj.geometry.dispose()
        ;(b.obj.material as THREE.Material).dispose()
      }
    },
    [batches],
  )
  return (
    <>
      {batches.map((b, i) => (
        <primitive
          key={i}
          object={b.obj}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (e.delta > 3) return
            e.stopPropagation()
            const id = b.edgeOf[e.faceIndex ?? -1]
            if (id) setSelection([], id)
          }}
        />
      ))}
    </>
  )
}

export function Cables() {
  const sc = useScene()
  const showCables = use3dStore((s) => s.showCables)
  const cables = useCables()
  if (!showCables) return null
  const sel = cables.find((c) => c.edge.id === sc.selectedEdge)
  return (
    <>
      <CableBatches cables={cables} />
      {sel && <Line points={sel.pts.map((p) => [p.x, p.y, p.z] as [number, number, number])} color="#7c3aed" lineWidth={sel.width + 2.5} raycast={() => null} />}
      {sc.flowAnim && <FlowDots cables={cables} />}
      <RouteEditor />
    </>
  )
}

/** Seçili hattın ara noktaları: sürüklenebilir tutamaçlar (x,z ızgaraya yapışır; yükseklik özellik panelinden). */
function RouteEditor() {
  const sc = useScene()
  const id = sc.selectedEdge
  const edge = sc.edges.find((e) => e.id === id)
  const a = edge && sc.boxById.get(edge.source)
  const b = edge && sc.boxById.get(edge.target)
  if (!edge || !a || !b) return null
  const mid: Nokta3D[] = edge.guzergah3d && edge.guzergah3d.length ? edge.guzergah3d : defaultRoute(a, b, sc.lanes.get(edge.id) ?? 0)
  return (
    <>
      {mid.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.y, p.z]}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0) return
            beginWaypointDrag(edge.id, i, p.y, mid)
            groundFromRay(e.ray, p.y)
          }}
        >
          <sphereGeometry args={[0.22, 12, 12]} />
          <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </>
  )
}

export const edgeSelectedId = (): string | undefined =>
  useStore
    .getState()
    .edges.find((e) => e.selected)?.id
