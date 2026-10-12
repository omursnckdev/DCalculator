import { invalidate, useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { nodeColor } from '../layout3d/colors'
import { isCoolingSystem } from '../engine/coolingUnits'
import { clearanceOf, rackCount } from '../layout3d/dims'
import { partsOf } from '../layout3d/shapes'
import type { Part } from '../layout3d/shapes'
import type { ProjectNode } from '../model/types'
import { beginNodeDrag, drag, groundFromRay } from './drag'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 20)
const rad = (d: number) => (d * Math.PI) / 180

function tone(base: string, t: Part['tone']): string {
  if (t === 'body') return base
  if (t === 'dark') return '#334155'
  if (t === 'metal') return '#cbd5e1'
  const c = new THREE.Color(base)
  c.multiplyScalar(0.62)
  return `#${c.getHexString()}`
}

/** Sim/durum göstergesi (yanıp sönen küre): çalışan jeneratör yeşil, bataryadaki UPS sarı. */
function Beacon({ y, color }: { y: number; color: string }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5))
    invalidate()
  })
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[0.18, 12, 12]} />
      <meshStandardMaterial ref={ref} color={color} emissive={color} />
    </mesh>
  )
}

/** Simülasyon adımında durumu değişen ekipmanın etrafında nabız atan çerçeve. */
function Pulse({ g, h, d, color = '#f59e0b' }: { g: number; h: number; d: number; color?: string }) {
  const ref = useRef<THREE.LineBasicMaterial>(null)
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(g + 0.3, h + 0.3, d + 0.3)), [g, h, d])
  useFrame(({ clock }) => {
    if (ref.current) ref.current.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 6))
    invalidate()
  })
  return (
    <lineSegments geometry={geo} position={[0, h / 2, 0]}>
      <lineBasicMaterial ref={ref} color={color} transparent />
    </lineSegments>
  )
}

export function Equipment({ n }: { n: ProjectNode }) {
  const sc = useScene()
  const box = sc.boxById.get(n.id)
  const r = sc.analysis.nodes[n.id]
  const selected = sc.selected.has(n.id)
  const overlap = sc.overlaps.has(n.id)
  const setHover = use3dStore((s) => s.setHover)
  const color = nodeColor(n, r, sc.colorCtx)
  const g = box?.g ?? 1
  const d = box?.d ?? 1
  const h = box?.h ?? 1
  const count = rackCount(n)
  const parts = useMemo(() => partsOf(n.type, { g, d, y: h }, count), [n.type, g, d, h, count])
  const mats = useMemo(() => {
    const m: Record<Part['tone'], THREE.MeshStandardMaterial> = {
      body: new THREE.MeshStandardMaterial({ color: tone(color, 'body'), roughness: 0.6, metalness: 0.1 }),
      accent: new THREE.MeshStandardMaterial({ color: tone(color, 'accent'), roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: tone(color, 'dark'), roughness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: tone(color, 'metal'), roughness: 0.4, metalness: 0.5 }),
    }
    return m
  }, [color])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(g + 0.06, h + 0.06, d + 0.06)), [g, d, h])
  const clearance = useMemo(() => clearanceOf(n.type), [n.type])
  // Soğutma açığı varken soğutma zincirinin (chiller, CRAH, pompa, kule...) enerjili ekipmanı mavi çerçeveyle vurgulanır.
  const coolAffected = !!sc.analysis.cooling && sc.analysis.cooling.deficitKw > 0.5 && !!r?.energized && !r.failed && isCoolingSystem(n)
  if (!box) return null

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (use3dStore.getState().measure) {
      use3dStore.getState().addMeasurePt([e.point.x, e.point.z])
      return
    }
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    beginNodeDrag(n.id, groundFromRay(e.ray), e.shiftKey || e.ctrlKey)
  }

  return (
    <group
      position={[box.x, box.elev, box.z]}
      rotation={[0, rad(box.rot), 0]}
      onPointerDown={onDown}
      // Tıklama zemine ulaşıp seçimi temizlemesin (özellikler paneli açık kalsın).
      onClick={(e) => e.stopPropagation()}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (!drag.current) setHover(n.id)
      }}
      onPointerOut={() => setHover(null)}
    >
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.kind === 'box' ? BOX : CYL} material={mats[p.tone]} position={p.pos} scale={p.size} />
      ))}
      {(selected || overlap) && <lineSegments geometry={outline} position={[0, h / 2, 0]}>
        <lineBasicMaterial color={overlap ? '#ef4444' : '#2563eb'} />
      </lineSegments>}
      {selected && (clearance.front > 0 || clearance.back > 0) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, (clearance.front - clearance.back) / 2]}>
          <planeGeometry args={[g, d + clearance.front + clearance.back]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
      {sc.changed.has(n.id) && <Pulse g={g} h={h} d={d} />}
      {!sc.changed.has(n.id) && coolAffected && <Pulse g={g} h={h} d={d} color="#0ea5e9" />}
      {r?.running && <Beacon y={h + 0.35} color="#22c55e" />}
      {r?.onBattery && !r.failed && <Beacon y={h + 0.35} color="#facc15" />}
    </group>
  )
}
