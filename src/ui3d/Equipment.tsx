import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { isCoolingSystem } from '../engine/coolingUnits'
import { nodeColor } from '../layout3d/colors'
import { clearanceOf, rackCount } from '../layout3d/dims'
import type { EquipmentType } from '../model/types'
import { tick } from './anim'
import { beginNodeDrag, drag, groundFromRay } from './drag'
import { bodyMaterial, equipGeometry, fixedMaterial } from './geoms'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

const rad = (d: number) => (d * Math.PI) / 180

/** Sim/durum göstergesi (yanıp sönen küre): çalışan jeneratör yeşil, bataryadaki UPS sarı. */
function Beacon({ y, color }: { y: number; color: string }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 5))
    tick()
  })
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[0.18, 12, 12]} />
      <meshStandardMaterial ref={ref} color={color} emissive={color} />
    </mesh>
  )
}

/** Çerçeve: nabız atan (sim/soğutma) veya sabit (seçili/üzerine gelinen/çakışan). */
function Frame({ g, h, d, color, pulse = false, pad = 0.06, opacity = 1 }: { g: number; h: number; d: number; color: string; pulse?: boolean; pad?: number; opacity?: number }) {
  const ref = useRef<THREE.LineBasicMaterial>(null)
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(g + pad, h + pad, d + pad)), [g, h, d, pad])
  useFrame(({ clock }) => {
    if (!pulse) return
    if (ref.current) ref.current.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 6))
    tick()
  })
  return (
    <lineSegments geometry={geo} position={[0, h / 2, 0]}>
      <lineBasicMaterial ref={ref} color={color} transparent opacity={opacity} />
    </lineSegments>
  )
}

export interface EqProps {
  id: string
  type: EquipmentType
  x: number
  z: number
  elev: number
  rot: number
  g: number
  d: number
  h: number
  count: number
  color: string
  selected: boolean
  overlap: boolean
  changed: boolean
  coolAffected: boolean
  running: boolean
  battery: boolean
}

/** Tek ekipman. Yalnız ilkel (karşılaştırılabilir) prop alır: sürüklerken sadece taşınan ekipman yeniden çizilir. */
const Equipment = memo(function Equipment(p: EqProps) {
  const hovered = use3dStore((s) => s.hoverId === p.id)
  const setHover = use3dStore((s) => s.setHover)
  const geo = useMemo(() => equipGeometry(p.type, p.g, p.d, p.h, p.count), [p.type, p.g, p.d, p.h, p.count])
  const clearance = clearanceOf(p.type)

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (use3dStore.getState().measure) {
      use3dStore.getState().addMeasurePt([e.point.x, e.point.z])
      return
    }
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // Yürüme modunda tıklama yalnız seçer (taşıma yok).
    if (use3dStore.getState().walk) {
      beginNodeDrag(p.id, null, e.shiftKey || e.ctrlKey)
      return
    }
    beginNodeDrag(p.id, groundFromRay(e.ray), e.shiftKey || e.ctrlKey)
    document.body.style.cursor = 'grabbing'
  }

  return (
    <group
      position={[p.x, p.elev, p.z]}
      rotation={[0, rad(p.rot), 0]}
      onPointerDown={onDown}
      // Tıklama zemine ulaşıp seçimi temizlemesin (özellikler paneli açık kalsın).
      onClick={(e) => e.stopPropagation()}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (!drag.current) {
          setHover(p.id)
          document.body.style.cursor = 'grab'
        }
      }}
      onPointerOut={() => {
        setHover(null)
        document.body.style.cursor = ''
      }}
    >
      <mesh geometry={geo.main} material={bodyMaterial(p.color)} />
      {geo.fixed && <mesh geometry={geo.fixed} material={fixedMaterial} />}
      {(p.selected || p.overlap) && <Frame g={p.g} h={p.h} d={p.d} color={p.overlap ? '#ef4444' : '#2563eb'} />}
      {hovered && !p.selected && !p.overlap && <Frame g={p.g} h={p.h} d={p.d} color="#64748b" pad={0.1} opacity={0.9} />}
      {p.selected && (clearance.front > 0 || clearance.back > 0) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, (clearance.front - clearance.back) / 2]}>
          <planeGeometry args={[p.g, p.d + clearance.front + clearance.back]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
      {p.changed && <Frame g={p.g} h={p.h} d={p.d} color="#f59e0b" pulse pad={0.3} />}
      {!p.changed && p.coolAffected && <Frame g={p.g} h={p.h} d={p.d} color="#0ea5e9" pulse pad={0.3} />}
      {p.running && <Beacon y={p.h + 0.35} color="#22c55e" />}
      {p.battery && <Beacon y={p.h + 0.35} color="#facc15" />}
    </group>
  )
})

/** Tüm ekipman: sahne verisinden ilkel prop'lar üretir. */
export function EquipmentLayer() {
  const sc = useScene()
  return (
    <>
      {sc.nodes.map((n) => {
        const b = sc.boxById.get(n.id)
        if (!b) return null
        const r = sc.analysis.nodes[n.id]
        const cooling = sc.analysis.cooling
        return (
          <Equipment
            key={n.id}
            id={n.id}
            type={n.type}
            x={b.x}
            z={b.z}
            elev={b.elev}
            rot={b.rot}
            g={b.g}
            d={b.d}
            h={b.h}
            count={rackCount(n)}
            color={nodeColor(n, r, sc.colorCtx)}
            selected={sc.selected.has(n.id)}
            overlap={sc.overlaps.has(n.id)}
            changed={sc.changed.has(n.id)}
            // Soğutma açığı varken soğutma zincirinin enerjili ekipmanı vurgulanır.
            coolAffected={!!cooling && cooling.deficitKw > 0.5 && !!r?.energized && !r.failed && isCoolingSystem(n)}
            running={!!r?.running}
            battery={!!r?.onBattery && !r.failed}
          />
        )
      })}
    </>
  )
}
