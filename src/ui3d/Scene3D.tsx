import { Canvas, invalidate } from '@react-three/fiber'
import { useEffect } from 'react'
import { Cables } from './Cables'
import { Controllers, Ground, Rig } from './Controllers'
import { Equipment } from './Equipment'
import { LabelLayer } from './LabelLayer'
import { Rooms } from './Rooms'
import { SceneCtx } from './sceneData'
import type { SceneData } from './sceneData'

/** R3F sahnesi (lazy yüklenir). Veri üst bileşenden (analiz bağlamı Canvas'a geçmediği için) prop olarak gelir. */
export default function Scene3D({ data, frameloopAlways }: { data: SceneData; frameloopAlways: boolean }) {
  // Veri değişince (talep üzerine çizim kipinde) yeniden çiz.
  useEffect(() => {
    invalidate()
  }, [data])
  return (
    <Canvas
      className="h-full w-full"
      frameloop={frameloopAlways ? 'always' : 'demand'}
      dpr={[1, 1.5]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onPointerMissed={() => undefined}
    >
      <SceneCtx.Provider value={data}>
        <color attach="background" args={['#f8fafc']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, 60, 30]} intensity={1.1} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.4]} />
        <Rig />
        <Controllers />
        <Ground />
        <Rooms />
        {data.nodes.map((n) => (n.yerlesim3d ? <Equipment key={n.id} n={n} /> : null))}
        <Cables />
        <LabelLayer />
      </SceneCtx.Provider>
    </Canvas>
  )
}
