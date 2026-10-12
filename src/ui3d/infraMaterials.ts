import * as THREE from 'three'

const cache = new Map<string, THREE.MeshStandardMaterial>()

/** Renge göre paylaşılan malzeme (tava, boru). `metalness` boru için biraz yüksek. */
export function infraMaterial(color: string, metalness = 0.15): THREE.MeshStandardMaterial {
  const key = `${color}|${metalness}`
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness })
    cache.set(key, m)
  }
  return m
}
