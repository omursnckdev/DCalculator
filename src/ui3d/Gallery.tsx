import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { defaultDims } from '../layout3d/dims'
import { EQUIPMENT } from '../library/equipment'
import { EQUIPMENT_TYPES } from '../model/types'
import type { EquipmentType, Params } from '../model/types'
import { bodyMaterial, equipGeometry, fixedMaterial } from './geoms'

/**
 * Model galerisi (`#galeri`): yerleşik ekipman modellerini tek tek (veya yan yana) inceleme sayfası. Adres parametreleri:
 *   #galeri?t=trafo,mdb   hangi türler (boşsa hepsi)    &az=35 &el=18   kamera yönü (derece)    &v=kuru   tür varyantı
 * Fare ile döndürülür/yakınlaştırılır. Boyutlar tür varsayılanıdır (3D sekmesindeki ile aynı).
 */
function parse(): { types: EquipmentType[]; az: number; el: number; variant: string; params: Params } {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const want = (q.get('t') ?? '').split(',').filter((t): t is EquipmentType => EQUIPMENT_TYPES.includes(t as EquipmentType))
  const params: Params = {}
  for (const [k, v] of q.entries()) if (k.startsWith('p.')) params[k.slice(2)] = Number.isFinite(Number(v)) ? Number(v) : v
  return { types: want.length ? want : EQUIPMENT_TYPES.filter((t) => t !== 'kesici' && t !== 'yardimci'), az: Number(q.get('az') ?? 30), el: Number(q.get('el') ?? 18), variant: q.get('v') ?? '', params }
}

export default function Gallery() {
  const { types, az, el, variant, params } = useMemo(parse, [])
  const items = useMemo(() => {
    let x = 0
    return types.map((t) => {
      const p = { ...EQUIPMENT[t].defaults, ...params }
      const dm = defaultDims({ type: t, params: p })
      const cx = x + dm.g / 2
      x += dm.g + 2.2
      const count = Math.max(1, Math.min(6, Math.round(dm.g / 0.6)))
      return { t, dm, cx, geo: equipGeometry(t, dm.g, dm.d, dm.y, t === 'rack' || t === 'itYuku' ? count : 1, variant), color: EQUIPMENT[t].color }
    })
  }, [types, variant, params])
  const total = items.length ? items[items.length - 1].cx + items[items.length - 1].dm.g / 2 : 4
  const mid = total / 2
  const maxH = Math.max(...items.map((i) => i.dm.y), 2)
  const dist = types.length === 1 ? Math.max(5, total * 1.5 + 2.5) : Math.max(5, Math.min(total * 0.9 + 3, 80))
  const a = (az * Math.PI) / 180
  const e = (el * Math.PI) / 180
  return (
    <div className="h-screen w-screen bg-slate-50">
      <Canvas camera={{ position: [mid + Math.sin(a) * Math.cos(e) * dist, maxH * 0.5 + Math.sin(e) * dist, Math.cos(a) * Math.cos(e) * dist], fov: 35, far: 600 }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
        <color attach="background" args={['#eef2f7']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[mid + 12, 30, 20]} intensity={1.1} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.4]} />
        <gridHelper args={[Math.max(40, total * 1.5), Math.max(40, total * 1.5), '#94a3b8', '#cbd5e1']} position={[mid, 0, 0]} />
        {items.map((i) => (
          <group key={i.t} position={[i.cx, 0, 0]}>
            <mesh geometry={i.geo.main} material={bodyMaterial(i.color)} />
            {i.geo.fixed && <mesh geometry={i.geo.fixed} material={fixedMaterial} />}
          </group>
        ))}
        <OrbitControls target={[mid, maxH * 0.4, 0]} makeDefault />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-white/90 px-2 py-1 text-xs text-slate-700 shadow">
        Model galerisi · {items.map((i) => `${i.t} ${i.dm.g}×${i.dm.d}×${i.dm.y} m`).join(' · ')}
      </div>
    </div>
  )
}
