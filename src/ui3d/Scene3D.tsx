import { Canvas, invalidate } from '@react-three/fiber'
import { useEffect } from 'react'
import { Cables } from './Cables'
import { Pipes, Trays } from './Infra'
import { Controllers, Ground, Rig } from './Controllers'
import { EquipmentLayer } from './Equipment'
import { LabelLayer } from './LabelLayer'
import { PlanWalls } from './PlanWalls'
import { Rooms } from './Rooms'
import { SceneCtx } from './sceneData'
import { Walk } from './Walk'
import type { SceneData } from './sceneData'

/** R3F sahnesi (lazy yüklenir). Veri üst bileşenden (analiz bağlamı Canvas'a geçmediği için) prop olarak gelir. */
export default function Scene3D({ data, dpr }: { data: SceneData; dpr: number }) {
  // Veri değişince (talep üzerine çizim kipinde) yeniden çiz.
  useEffect(() => {
    invalidate()
  }, [data])
  return (
    <Canvas
      className="h-full w-full"
      // Talep üzerine çizim: animasyonlar (akış, nabız) anim.tick ile ~30 kare/sn'de sürülür.
      frameloop="demand"
      dpr={dpr}
      // Hibrit (Intel + NVIDIA/AMD) dizüstülerde tarayıcıya güçlü ekran kartını seçmesini söyler.
      gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance' }}
      // Birleştirilmiş hat çizgileri (LineSegments2) için tıklama toleransı, piksel.
      onCreated={({ raycaster }) => {
        ;(raycaster.params as unknown as Record<string, unknown>).Line2 = { threshold: 6 }
      }}
    >
      <SceneCtx.Provider value={data}>
        <color attach="background" args={['#f8fafc']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, 60, 30]} intensity={1.1} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.4]} />
        <Rig />
        <Controllers />
        <Walk />
        <Ground />
        <Rooms />
        <PlanWalls />
        <EquipmentLayer />
        <Trays />
        <Pipes />
        <Cables />
        <LabelLayer />
      </SceneCtx.Provider>
    </Canvas>
  )
}
