import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareModel } from './modelPrep'

const load = async (f: string) => {
  const b = readFileSync(new URL(`../assets/models/${f}`, import.meta.url))
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '')).scene
}
const size = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())

describe('Socomec Delphys XM modeli', () => {
  it('servis boşluğu hacimleri kaldırılır; kabin ölçüsü 0,8 × 2,0 × ~1,0 m', async () => {
    const root = await load('socomec-delphys-xm.glb')
    const raw = size(root)
    expect(prepareModel(root)).toBe(3)
    const s = size(root)
    expect(raw.z).toBeGreaterThan(s.z + 0.9) // boşluklar önde/arkada 0,5'er m ekliyordu
    expect(raw.y).toBeGreaterThan(s.y) // üstte 0,5 m
    expect(s.y).toBeCloseTo(2.0, 2)
    expect(s.x).toBeGreaterThan(0.79)
    expect(s.x).toBeLessThan(0.9)
    expect(s.z).toBeGreaterThan(0.99)
    expect(s.z).toBeLessThan(1.05)
  })

  it('yan kabinli model 1,2 m genişliğindedir', async () => {
    const root = await load('socomec-delphys-xm-yan-kabin.glb')
    expect(prepareModel(root)).toBe(3)
    expect(size(root).x).toBeCloseTo(1.2, 2)
  })

  it('malzemesiz parçalar nötr renk alır (metalik-1 siyah varsayılan kalmaz); ekran koyu', async () => {
    const root = await load('socomec-delphys-xm.glb')
    prepareModel(root)
    let screens = 0
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = m.material as THREE.MeshStandardMaterial
      expect(mat.metalness).toBeLessThan(0.5)
      if (/ecran/i.test(m.name) || /ecran/i.test(m.parent?.name ?? '')) {
        screens++
        expect(mat.color.getHex()).toBe(0x111827)
      }
    })
    expect(screens).toBeGreaterThan(0)
  })
})
