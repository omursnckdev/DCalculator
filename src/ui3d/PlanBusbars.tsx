import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { floorVisible } from '../layout3d/floors'
import type { BaraTuru } from '../model/types'
import { useStore } from '../store/useStore'
import { use3dStore } from './use3dStore'

/** Bara güzergâhı kotu (merkez, m): yaklaşık; planda yükseklik yoktur. En yüksek ekipmanın (trafo ≈ 2,9 m) üstünde, tavanın (3,5 m) altında. */
export const PLAN_BUSBAR_Y = 3.1

/** Parça rengi: düz bara bakır tonu; dirsek/te parçaları ailesine göre (Tx, Gen, hat, yakalayıcı, yük bankası, chiller, salon). */
export const BARA_RENK: Record<BaraTuru, string> = {
  duz: '#b45309',
  tap: '#334155',
  tx: '#7c3aed',
  gen: '#d97706',
  hat: '#2563eb',
  yakalayici: '#dc2626',
  yukbankasi: '#16a34a',
  chiller: '#0891b2',
  salon: '#db2777',
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 })

/** Busbar planındaki bara parçaları (scripts/busbar-plan.py): tek birleşik geometri, vertex renkli. "Baralar" (Göster menüsü) ile açılır/kapanır. */
export function PlanBusbars() {
  const baralar = useStore((s) => s.plan3d?.baralar)
  const show = use3dStore((s) => s.showBusbars)
  const floor = use3dStore((s) => s.floor)
  const geo = useMemo(() => {
    if (!baralar || baralar.length === 0) return null
    const unit = new THREE.BoxGeometry(1, 1, 1)
    unit.deleteAttribute('uv')
    const parts: THREE.BufferGeometry[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    for (const b of baralar) {
      const h = Math.min(0.45, Math.max(b.t === 'duz' ? 0.15 : 0.3, Math.min(b.g, b.d)))
      m.compose(new THREE.Vector3(b.x, PLAN_BUSBAR_Y, b.z), q, new THREE.Vector3(b.g, h, b.d))
      const g = unit.clone()
      g.applyMatrix4(m)
      col.set(BARA_RENK[b.t])
      const n = g.getAttribute('position').count
      const c = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) col.toArray(c, i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      parts.push(g)
    }
    const out = mergeGeometries(parts, false)
    for (const g of parts) g.dispose()
    return out
  }, [baralar])
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo || !show || !floorVisible(floor, 0)) return null
  return <mesh geometry={geo} material={material} raycast={() => null} />
}
