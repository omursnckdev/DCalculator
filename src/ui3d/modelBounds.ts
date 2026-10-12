import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getModelBuffer } from '../store/modelStore'
import type { Size3 } from '../layout3d/customModel'

const cache = new Map<string, Size3>()

/** Modelin sınır kutusu boyutu (x, y, z; model birimi, glTF'te metre). Ayrı parçada yüklenir (üç.js ağır). */
export async function modelBounds(id: string): Promise<Size3 | undefined> {
  const hit = cache.get(id)
  if (hit) return hit
  const buf = await getModelBuffer(id)
  if (!buf) return undefined
  const gltf = await new GLTFLoader().parseAsync(buf.slice(0), '')
  const s = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3())
  const out = { x: s.x, y: s.y, z: s.z }
  cache.set(id, out)
  return out
}
