import { useGLTF } from '@react-three/drei'
import { Component, Suspense, useMemo } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { fitScale } from '../layout3d/customModel'
import { prepareModel } from './modelPrep'
import type { ModelSpec } from '../layout3d/customModel'

const rad = (d: number) => (d * Math.PI) / 180

interface BoxProps {
  g: number
  d: number
  h: number
}

/** Yüklenen GLB'yi ekipman kutusuna oturtur: tabanı y = 0, merkez x-z'de ortada; tıklama görünmez kutu üzerinden (ağır geometriye ışın atılmaz). */
function Loaded({ url, g, d, h, fit, rot }: BoxProps & { url: string; fit: ModelSpec['fit']; rot: number }) {
  const gltf = useGLTF(url)
  const m = useMemo(() => {
    const root = gltf.scene.clone(true)
    prepareModel(root)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.raycast = () => undefined
    })
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const c = box.getCenter(new THREE.Vector3())
    const s = fitScale({ x: size.x, y: size.y, z: size.z }, { g, d, h }, fit, rot)
    const pos: [number, number, number] = [-c.x * s[0], -box.min.y * s[1], -c.z * s[2]]
    return { root, s, pos }
  }, [gltf, g, d, h, fit, rot])
  return (
    <group rotation={[0, rad(rot), 0]}>
      <group scale={m.s} position={m.pos}>
        <primitive object={m.root} />
      </group>
    </group>
  )
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(): void {
    /* bozuk model: yerleşik model gösterilir */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Özel model; yüklenirken veya bozuksa `fallback` (yerleşik model) görünür. Durum rengi taban plakasıyla belirtilir. */
export function CustomModel({ url, spec, g, d, h, color, fallback }: BoxProps & { url: string; spec: ModelSpec; color: string; fallback: ReactNode }) {
  return (
    <Boundary fallback={fallback} key={url}>
      <Suspense fallback={fallback}>
        <Loaded url={url} g={g} d={d} h={h} fit={spec.fit} rot={spec.rot} />
      </Suspense>
      <mesh position={[0, 0.02, 0]} raycast={() => undefined}>
        <boxGeometry args={[g + 0.06, 0.04, d + 0.06]} />
        <meshStandardMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[g, h, d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </Boundary>
  )
}
