import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Boru3D, Tava3D } from '../model/types'

/** Tava ve boru geometrileri (birleştirilmiş, önbellekli). */

const unitBox = new THREE.BoxGeometry(1, 1, 1)

/** Yerel (lx, ly, lz) merkezli, (w, h, d) boyutlu kutu: segment ortasına yerleştirilip y ekseni etrafında θ döndürülmüş. */
function segBox(mx: number, my: number, mz: number, theta: number, lx: number, ly: number, lz: number, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = unitBox.clone()
  g.deleteAttribute('uv')
  const local = new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion(), new THREE.Vector3(w, h, d))
  const world = new THREE.Matrix4().compose(new THREE.Vector3(mx, my, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, theta, 0)), new THREE.Vector3(1, 1, 1))
  g.applyMatrix4(world.multiply(local))
  return g
}

export interface TrayGeo {
  /** Taban plakası: doluluk durumu rengiyle boyanır. */
  plate: THREE.BufferGeometry
  /** Yan kanatlar ve askılar. */
  frame: THREE.BufferGeometry
}

const trayCache = new Map<string, TrayGeo>()

export function trayGeometry(t: Tava3D): TrayGeo {
  const key = `${t.g}|${t.h}|${t.y}|${t.noktalar.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`
  const hit = trayCache.get(key)
  if (hit) return hit
  const plate: THREE.BufferGeometry[] = []
  const frame: THREE.BufferGeometry[] = []
  for (let i = 1; i < t.noktalar.length; i++) {
    const a = t.noktalar[i - 1]
    const b = t.noktalar[i]
    const L = Math.hypot(b.x - a.x, b.z - a.z)
    if (L < 0.01) continue
    const theta = Math.atan2(-(b.z - a.z), b.x - a.x)
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    plate.push(segBox(mx, t.y, mz, theta, 0, 0.01, 0, L, 0.02, t.g))
    for (const s of [-1, 1]) frame.push(segBox(mx, t.y, mz, theta, 0, t.h / 2, s * (t.g / 2 - 0.01), L, t.h, 0.02))
    // Askılar: parça başında ve en çok 2,5 m aralıkla; zemin → tava tabanı
    const n = Math.max(1, Math.ceil(L / 2.5))
    for (let k = 0; k <= n; k++) {
      const lx = -L / 2 + (k * L) / n
      frame.push(segBox(mx, 0, mz, theta, lx, t.y / 2, 0, 0.04, t.y, 0.04), segBox(mx, t.y, mz, theta, lx, -0.02, 0, 0.04, 0.04, t.g + 0.08))
    }
  }
  const merge = (g: THREE.BufferGeometry[]) => (g.length ? mergeGeometries(g, false)! : new THREE.BufferGeometry())
  const geo = { plate: merge(plate), frame: merge(frame) }
  for (const g of [...plate, ...frame]) g.dispose()
  if (trayCache.size >= 300) {
    const first = trayCache.keys().next().value as string
    const old = trayCache.get(first)
    old?.plate.dispose()
    old?.frame.dispose()
    trayCache.delete(first)
  }
  trayCache.set(key, geo)
  return geo
}

const pipeCache = new Map<string, THREE.BufferGeometry>()
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false)

export const pipeRadius = (dn: number): number => Math.max(0.02, dn / 2000)

/** Boru: silindir parçaları + dirsek küreleri + uç flanşları. */
export function pipeGeometry(b: Boru3D): THREE.BufferGeometry {
  const key = `${b.dn}|${b.noktalar.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(';')}`
  const hit = pipeCache.get(key)
  if (hit) return hit
  const r = pipeRadius(b.dn)
  const parts: THREE.BufferGeometry[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const cylBetween = (p: THREE.Vector3, q: THREE.Vector3, rad: number, len?: number) => {
    const dir = q.clone().sub(p)
    const L = len ?? dir.length()
    if (L < 1e-4) return
    dir.normalize()
    const g = unitCyl.clone()
    g.deleteAttribute('uv')
    const mid = len === undefined ? p.clone().add(q).multiplyScalar(0.5) : p.clone().add(dir.clone().multiplyScalar(L / 2))
    g.applyMatrix4(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(up, dir), new THREE.Vector3(rad, L, rad)))
    parts.push(g)
  }
  const pts = b.noktalar.map((p) => new THREE.Vector3(p.x, p.y, p.z))
  for (let i = 1; i < pts.length; i++) cylBetween(pts[i - 1], pts[i], r)
  for (let i = 1; i < pts.length - 1; i++) {
    const s = new THREE.SphereGeometry(r * 1.02, 10, 8)
    s.deleteAttribute('uv')
    s.translate(pts[i].x, pts[i].y, pts[i].z)
    parts.push(s)
  }
  // Uç flanşları
  for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]] as const) {
    if (pts.length < 2) break
    const dir = pts[j].clone().sub(pts[i]).normalize()
    cylBetween(pts[i].clone().add(dir.clone().multiplyScalar(0.02)), pts[j], r * 1.5, 0.04)
  }
  const geo = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry()
  for (const g of parts) g.dispose()
  if (pipeCache.size >= 400) {
    const first = pipeCache.keys().next().value as string
    pipeCache.get(first)?.dispose()
    pipeCache.delete(first)
  }
  pipeCache.set(key, geo)
  return geo
}
