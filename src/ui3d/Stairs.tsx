import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { autoStairs } from '../layout3d/floors'
import { useScene } from './sceneData'
import { stairGeometry } from './stairGeoms'

const stairMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.7, metalness: 0.15 })

/** Dış merdivenler: üst kat odalarından türetilir (konum: batı duvarı). Yürüme modunda üzerinden 1. kata çıkılır; kat süzgecinden bağımsız görünür. */
export function Stairs() {
  const sc = useScene()
  const stairs = useMemo(() => autoStairs(sc.rooms), [sc.rooms])
  const geos = useMemo(() => stairs.map((s) => stairGeometry(s)), [stairs])
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  return (
    <>
      {stairs.map((s, i) => (
        <mesh key={s.id} geometry={geos[i]} material={stairMaterial} position={[s.x, 0, s.z]} rotation={[0, -s.a, 0]} raycast={() => null} />
      ))}
    </>
  )
}
