import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RISER } from '../layout3d/floors'
import type { Merdiven } from '../layout3d/floors'

const TONE = { tread: new THREE.Color('#d1d5db'), riser: new THREE.Color('#6b7280'), steel: new THREE.Color('#475569'), rail: new THREE.Color('#f59e0b') }
const unit = new THREE.BoxGeometry(1, 1, 1)

function part(pos: [number, number, number], size: [number, number, number], tone: keyof typeof TONE, rotZ = 0): THREE.BufferGeometry {
  const g = unit.clone()
  g.deleteAttribute('uv')
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotZ)), new THREE.Vector3(...size)))
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3)
  const c = TONE[tone]
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/**
 * Düz kollu dış merdiven (yerel çerçeve: x = çıkış yönü, alt uç x = 0, y yukarı, z yanal): basamak + yükselti, iki yan kiriş,
 * iki yan korkuluk (direk + eğimli küpeşte). Tek birleşik geometri, köşe renkli.
 */
export function stairGeometry(s: Merdiven): THREE.BufferGeometry {
  const rise = s.elev1 - s.elev0
  const n = Math.max(2, Math.round(rise / RISER))
  const r = rise / n
  const t = s.run / n
  const w = s.g
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < n; i++) {
    const top = s.elev0 + (i + 1) * r
    parts.push(part([(i + 0.5) * t, top - 0.02, 0], [t * 1.04, 0.04, w], 'tread'))
    parts.push(part([i * t + 0.01, top - r / 2, 0], [0.02, r, w], 'riser'))
  }
  const len = Math.hypot(s.run, rise)
  const ang = Math.atan2(rise, s.run)
  const mid: [number, number] = [s.run / 2, s.elev0 + rise / 2]
  for (const sz of [-1, 1]) {
    const zc = sz * (w / 2 + 0.03)
    parts.push(part([mid[0], mid[1] - 0.14, zc], [len + 0.2, 0.24, 0.06], 'steel', ang))
    // Korkuluk: eğimli küpeşte (1,0 m) ve her 4 basamakta bir direk
    parts.push(part([mid[0], mid[1] + 0.95, zc], [len, 0.05, 0.05], 'rail', ang))
    parts.push(part([mid[0], mid[1] + 0.5, zc], [len, 0.025, 0.025], 'rail', ang))
    for (let i = 0; i <= n; i += 4) {
      const u = Math.min(s.run, i * t)
      const y = s.elev0 + (u / s.run) * rise
      parts.push(part([u, y + 0.5, zc], [0.05, 1.0, 0.05], 'rail'))
    }
  }
  const out = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return out
}
