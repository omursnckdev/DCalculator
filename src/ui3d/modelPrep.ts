import * as THREE from 'three'

/** BIM/üretici modellerinde geometri olmayan "servis boşluğu" hacimleri (ör. Revit'ten BIM&CO: "BC_Clearance-zone") görünmesin. */
const CLEARANCE = /clearance|bo[sş]luk/i
/** Ekran/gösterge parçaları koyu çizilir. */
const SCREEN = /ecran|screen|display|lcd/i

const GRAY = new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.15, roughness: 0.55 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.2, roughness: 0.3 })

/** GLTFLoader'ın malzemesiz parçalara verdiği varsayılan (beyaz, metalik 1 → ışıksız ortamda siyah görünür). */
const isLoaderDefault = (m: THREE.Material): boolean => {
  const s = m as THREE.MeshStandardMaterial
  return s.isMeshStandardMaterial === true && s.name === '' && s.metalness === 1 && s.roughness === 1 && !s.map && s.color.getHex() === 0xffffff
}

/** Yüklenen (klonlanmış) model kökünü hazırlar: servis boşluğu parçalarını kaldırır, malzemesiz parçalara nötr renk verir. Kaldırılan parça sayısını döndürür. */
export function prepareModel(root: THREE.Object3D): number {
  const drop: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o !== root && CLEARANCE.test(o.name)) drop.push(o)
  })
  for (const o of drop) o.parent?.remove(o)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material) || !isLoaderDefault(mesh.material)) return
    mesh.material = SCREEN.test(mesh.name) || SCREEN.test(mesh.parent?.name ?? '') ? DARK : GRAY
  })
  return drop.length
}
