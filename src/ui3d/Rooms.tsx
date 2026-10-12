import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { coolingKw } from '../engine/coolingUnits'
import { heatKwOf } from '../layout3d/colors'
import { roomAt } from '../layout3d/geometry'
import { heatGrid, heatRgb } from '../layout3d/heat'
import type { Oda3D } from '../model/types'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

const FLOOR: Record<Oda3D['tur'], string> = { elektrik: '#fde68a', salon: '#bfdbfe', jenerator: '#fecaca', dis: '#d9f99d' }

function Heat({ room }: { room: Oda3D }) {
  const sc = useScene()
  const tex = useMemo(() => {
    const heat: { x: number; z: number; kw: number }[] = []
    const cool: { x: number; z: number; kw: number }[] = []
    let unitSum = 0
    for (const n of sc.nodes) {
      const l = n.yerlesim3d
      if (!l) continue
      const inRoom = l.oda ? l.oda === room.id : roomAt([room], l.x, l.z) !== undefined
      if (!inRoom) continue
      const r = sc.analysis.nodes[n.id]
      const c = coolingKw(n)
      if (c > 0) {
        if (r?.energized) {
          cool.push({ x: l.x, z: l.z, kw: c })
          unitSum += c
        }
      } else {
        const kw = heatKwOf(n, r)
        if (kw > 0) heat.push({ x: l.x, z: l.z, kw })
      }
    }
    // Zincir/yetersizlik nedeniyle etkin soğutma kapasitesi birim toplamından düşükse soğutma payı orantılı azalır.
    const cap = sc.analysis.cooling?.capacityKw
    const scale = cap !== undefined && unitSum > 0 ? Math.min(1.2, Math.max(0, cap / unitSum)) : 1
    const grid = heatGrid(room, heat, cool.map((c) => ({ ...c, kw: c.kw * scale })), 0.5)
    const data = new Uint8Array(grid.nx * grid.nz * 4)
    const shift = sc.tempShift
    for (let iz = 0; iz < grid.nz; iz++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        const v = grid.values[iz * grid.nx + ix]
        const t = Math.min(1, v * (1 - 0.5 * shift) + 0.5 * shift * (v > 0.02 ? 1 : 0))
        const [r, g, b] = heatRgb(t)
        const row = grid.nz - 1 - iz // doku satırı yukarı = dünya -z
        const o = (row * grid.nx + ix) * 4
        data[o] = r
        data[o + 1] = g
        data[o + 2] = b
        data[o + 3] = v > 0.02 ? 255 : 70
      }
    }
    const t = new THREE.DataTexture(data, grid.nx, grid.nz, THREE.RGBAFormat)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [sc.nodes, sc.analysis, sc.tempShift, room])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[room.x + room.g / 2, 0.03, room.z + room.d / 2]}>
      <planeGeometry args={[Math.ceil(room.g / 0.5) * 0.5, Math.ceil(room.d / 0.5) * 0.5]} />
      <meshBasicMaterial map={tex} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  )
}

export function Rooms() {
  const sc = useScene()
  const hideWalls = use3dStore((s) => s.hideWalls)
  const showHeat = use3dStore((s) => s.showHeat)
  return (
    <>
      {sc.rooms.map((r) => {
        const hot = r.tur === 'salon' && sc.tempC !== undefined && sc.tempShift >= 1
        const wallColor = hot ? '#ef4444' : '#64748b'
        const walls = !hideWalls && r.tur !== 'dis'
        return (
          <group key={r.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[r.x + r.g / 2, 0, r.z + r.d / 2]}>
              <planeGeometry args={[r.g, r.d]} />
              <meshStandardMaterial color={FLOOR[r.tur]} transparent opacity={0.5} />
            </mesh>
            {walls && (
              <>
                {[
                  [r.x + r.g / 2, r.z, r.g, 0.08],
                  [r.x + r.g / 2, r.z + r.d, r.g, 0.08],
                  [r.x, r.z + r.d / 2, 0.08, r.d],
                  [r.x + r.g, r.z + r.d / 2, 0.08, r.d],
                ].map(([x, z, w, d], i) => (
                  <mesh key={i} position={[x, r.y / 2, z]} raycast={() => null}>
                    <boxGeometry args={[w, r.y, d]} />
                    <meshStandardMaterial color={wallColor} transparent opacity={0.1} depthWrite={false} />
                  </mesh>
                ))}
              </>
            )}
            {showHeat && r.tur === 'salon' && <Heat room={r} />}
          </group>
        )
      })}
    </>
  )
}
