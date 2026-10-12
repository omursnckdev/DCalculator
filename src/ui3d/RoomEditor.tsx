import { useMemo } from 'react'
import * as THREE from 'three'
import type { RoomHandle } from '../layout3d/roomEdit'
import { beginRoomDrag, drag, groundFromRay } from './drag'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

/** Tutamaçlar ekipmanın arkasında kalsa bile tıklanabilsin: isabet uzaklığı 0'a çekilir (R3F en yakını seçer). */
function frontRaycast(this: THREE.Mesh, rc: THREE.Raycaster, hits: THREE.Intersection[]): void {
  const n = hits.length
  THREE.Mesh.prototype.raycast.call(this, rc, hits)
  for (let i = n; i < hits.length; i++) hits[i].distance = 0
}

const CURSOR: Record<RoomHandle, string> = { move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

/** Seçili odanın çerçevesi ve tutamaçları: ortadan taşı, kenardan tek yönde, köşeden iki yönde boyutlandır (ızgaraya yapışır). */
export function RoomEditor() {
  const sc = useScene()
  const sel = use3dStore((s) => s.selObj)
  const room = sel?.kind === 'room' ? sc.rooms.find((r) => r.id === sel.id) : undefined
  const outline = useMemo(() => {
    if (!room) return null
    const { x, z, g, d } = room
    const pts = [new THREE.Vector3(x, 0, z), new THREE.Vector3(x + g, 0, z), new THREE.Vector3(x + g, 0, z + d), new THREE.Vector3(x, 0, z + d), new THREE.Vector3(x, 0, z)]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [room?.x, room?.z, room?.g, room?.d]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!room || !outline) return null
  const elev = room.elev ?? 0
  const y = elev + 0.08
  // Tutamaç boyutu oda boyutuyla ölçeklenir (küçük odada küçük, büyükte büyük; 0,3–1,2 m).
  const hs = Math.min(1.2, Math.max(0.3, Math.min(room.g, room.d) / 14))
  const cx = room.x + room.g / 2
  const cz = room.z + room.d / 2
  const x1 = room.x + room.g
  const z1 = room.z + room.d
  const handles: { mode: RoomHandle; x: number; z: number; kind: 'corner' | 'edge' | 'move' }[] = [
    { mode: 'move', x: cx, z: cz, kind: 'move' },
    { mode: 'n', x: cx, z: room.z, kind: 'edge' },
    { mode: 's', x: cx, z: z1, kind: 'edge' },
    { mode: 'w', x: room.x, z: cz, kind: 'edge' },
    { mode: 'e', x: x1, z: cz, kind: 'edge' },
    { mode: 'nw', x: room.x, z: room.z, kind: 'corner' },
    { mode: 'ne', x: x1, z: room.z, kind: 'corner' },
    { mode: 'sw', x: room.x, z: z1, kind: 'corner' },
    { mode: 'se', x: x1, z: z1, kind: 'corner' },
  ]
  return (
    <group position={[0, y, 0]}>
      <lineLoop geometry={outline} raycast={() => null}>
        <lineBasicMaterial color="#2563eb" />
      </lineLoop>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]} raycast={() => null}>
        <planeGeometry args={[room.g, room.d]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      {handles.map((h) => (
        <mesh
          key={h.mode}
          position={[h.x, hs * 0.35, h.z]}
          renderOrder={999}
          raycast={frontRaycast}
          onClick={(e) => e.stopPropagation()}
          onPointerOver={(e) => {
            e.stopPropagation()
            if (!drag.current) document.body.style.cursor = CURSOR[h.mode]
          }}
          onPointerOut={() => {
            if (!drag.current) document.body.style.cursor = ''
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            beginRoomDrag(room.id, h.mode, groundFromRay(e.ray, elev))
          }}
        >
          {h.kind === 'move' ? <cylinderGeometry args={[hs * 0.7, hs * 0.7, hs * 0.3, 20]} /> : h.kind === 'edge' ? <boxGeometry args={[hs * 1.1, hs * 0.5, hs * 1.1]} /> : <sphereGeometry args={[hs * 0.5, 14, 14]} />}
          <meshStandardMaterial depthTest={false} transparent color={h.kind === 'move' ? '#10b981' : h.kind === 'edge' ? '#f59e0b' : '#2563eb'} emissive={h.kind === 'move' ? '#10b981' : h.kind === 'edge' ? '#f59e0b' : '#2563eb'} emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  )
}
