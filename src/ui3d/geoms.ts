import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { partsOf } from '../layout3d/shapes'
import type { Part } from '../layout3d/shapes'
import type { EquipmentType } from '../model/types'

/**
 * Ekipman başına birleştirilmiş geometri: tüm parçalar köşe renkleriyle iki geometriye (gövde+vurgu | sabit koyu/metal)
 * birleşir, böylece ekipman başına 2 çizim çağrısı olur (önceden parça sayısı kadar). Aynı tür ve boyut paylaşılır.
 */
export interface EquipGeo {
  /** Gövde: köşe rengi beyaz (gövde) veya gri çarpan (vurgu); malzeme rengi durum rengidir. */
  main: THREE.BufferGeometry
  /** Koyu/metal parçalar: köşe renkleri sabittir; malzeme rengi beyazdır. */
  fixed: THREE.BufferGeometry | null
}

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
const cache = new Map<string, EquipGeo>()
const MAX_CACHE = 400

const TONE_RGB: Record<Part['tone'], [number, number, number]> = (() => {
  const c = (hex: string): [number, number, number] => {
    const k = new THREE.Color(hex)
    return [k.r, k.g, k.b]
  }
  return { body: [1, 1, 1], accent: [0.62, 0.62, 0.62], dark: c('#334155'), metal: c('#cbd5e1'), glass: c('#7dd3fc'), led: c('#22c55e'), warn: c('#f59e0b') }
})()

function partGeometry(p: Part): THREE.BufferGeometry {
  const g = (p.kind === 'box' ? unitBox : unitCyl).clone()
  g.deleteAttribute('uv')
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])))
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p.pos), q, new THREE.Vector3(...p.size)))
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3)
  const [r, gg, b] = TONE_RGB[p.tone]
  for (let i = 0; i < n; i++) col.set([r, gg, b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

const merge = (parts: Part[]): THREE.BufferGeometry | null => {
  if (parts.length === 0) return null
  const geos = parts.map(partGeometry)
  const out = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  return out
}

export function equipGeometry(type: EquipmentType, g: number, d: number, h: number, count: number, variant = ''): EquipGeo {
  const key = `${type}|${g.toFixed(2)}|${d.toFixed(2)}|${h.toFixed(2)}|${count}|${variant}`
  const hit = cache.get(key)
  if (hit) return hit
  const parts = partsOf(type, { g, d, y: h }, count, variant)
  const main = merge(parts.filter((p) => p.tone === 'body' || p.tone === 'accent'))
  const fixed = merge(parts.filter((p) => p.tone !== 'body' && p.tone !== 'accent'))
  const geo: EquipGeo = { main: main ?? new THREE.BufferGeometry(), fixed }
  if (cache.size >= MAX_CACHE) {
    // En eski kaydı at (kaynaklar GPU'dan bırakılır).
    const first = cache.keys().next().value as string
    const old = cache.get(first)
    old?.main.dispose()
    old?.fixed?.dispose()
    cache.delete(first)
  }
  cache.set(key, geo)
  return geo
}

const matCache = new Map<string, THREE.MeshStandardMaterial>()
/** Durum rengine göre paylaşılan malzeme (renk sayısı sınırlıdır). */
export function bodyMaterial(color: string): THREE.MeshStandardMaterial {
  let m = matCache.get(color)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.6, metalness: 0.1 })
    matCache.set(color, m)
  }
  return m
}
export const fixedMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.65, metalness: 0.2 })

/** Test/ölçüm: önbellekteki geometri sayısı. */
export const geoCacheSize = (): number => cache.size
