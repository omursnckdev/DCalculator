import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { floorVisible } from '../layout3d/floors'
import { useStore } from '../store/useStore'
import { use3dStore } from './use3dStore'

/** Plan duvarı: kalınlık ve yükseklik (m). Çizimdeki çift çizgili duvarlar iki ince duvar olarak görünür. */
export const PLAN_WALL_T = 0.12
export const PLAN_WALL_H = 3.5


/** Kat planı duvarları: tek birleşik geometri (≈ 1 600 kutu, tek çizim). "Duvarlar" (H) ile gizlenir; zemin kat süzgecine bağlıdır. */
export function PlanWalls() {
  const plan = useStore((s) => s.plan3d)
  const hideWalls = use3dStore((s) => s.hideWalls)
  const floor = use3dStore((s) => s.floor)
  const opacity = use3dStore((s) => s.wallOpacity)
  // Opak (≥ %99) duvar derinlik yazar; saydamda yazmaz (içindeki ekipman görünsün).
  const material = useMemo(() => {
    const solid = opacity >= 0.99
    return new THREE.MeshStandardMaterial({ color: solid ? '#cbd5e1' : '#94a3b8', transparent: !solid, opacity, depthWrite: solid, roughness: 0.9 })
  }, [opacity])
  useEffect(() => () => material.dispose(), [material])
  const geo = useMemo(() => {
    if (!plan || plan.duvarlar.length === 0) return null
    const unit = new THREE.BoxGeometry(1, 1, 1)
    unit.deleteAttribute('uv')
    const parts: THREE.BufferGeometry[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (const [x1, z1, x2, z2] of plan.duvarlar) {
      const L = Math.hypot(x2 - x1, z2 - z1)
      if (L < 0.05) continue
      e.set(0, -Math.atan2(z2 - z1, x2 - x1), 0)
      q.setFromEuler(e)
      m.compose(new THREE.Vector3((x1 + x2) / 2, PLAN_WALL_H / 2, (z1 + z2) / 2), q, new THREE.Vector3(L + PLAN_WALL_T, PLAN_WALL_H, PLAN_WALL_T))
      const g = unit.clone()
      g.applyMatrix4(m)
      parts.push(g)
    }
    const out = parts.length ? mergeGeometries(parts, false) : null
    for (const g of parts) g.dispose()
    return out
  }, [plan])
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo || hideWalls || !floorVisible(floor, 0)) return null
  return <mesh geometry={geo} material={material} raycast={() => null} />
}
