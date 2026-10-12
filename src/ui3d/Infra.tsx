import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { pipeLive } from '../layout3d/pipes'
import { tick } from './anim'
import { beginObjectPointDrag, setSelection } from './drag'
import { infraMaterial } from './infraMaterials'
import { pipeGeometry, trayGeometry } from './infraGeoms'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

const PLATE = { ok: '#4ade80', warn: '#fbbf24', over: '#f87171' } as const
const PIPE_COLOR = { sogukSu: { besleme: '#2563eb', donus: '#f59e0b' }, kondenser: { besleme: '#16a34a', donus: '#a16207' } } as const

function select(kind: 'tray' | 'pipe', id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 3) return
    e.stopPropagation()
    setSelection([])
    use3dStore.getState().setSelObj({ kind, id })
  }
}

/** Kablo tavaları: plaka rengi doluluk durumunu (yeşil/sarı/kırmızı), çerçeve metali gösterir. */
export function Trays() {
  const sc = useScene()
  const selObj = use3dStore((s) => s.selObj)
  const draw = use3dStore((s) => s.draw)
  return (
    <>
      {sc.trays.map((t) => (
        <TrayMesh key={t.id} t={t} status={sc.trayFill.get(t.id)?.status ?? 'ok'} selected={selObj?.kind === 'tray' && selObj.id === t.id} />
      ))}
      {selObj?.kind === 'tray' && <PointHandles kind="tray" />}
      {draw && draw.pts.length > 0 && (
        <>
          {draw.pts.map((p, i) => (
            <mesh key={i} position={[p.x, 3.1, p.z]}>
              <sphereGeometry args={[0.15, 10, 10]} />
              <meshBasicMaterial color="#7c3aed" />
            </mesh>
          ))}
          {draw.pts.length > 1 && <Line points={draw.pts.map((p) => [p.x, 3.1, p.z] as [number, number, number])} color="#7c3aed" lineWidth={2} dashed dashSize={0.3} gapSize={0.2} />}
        </>
      )}
    </>
  )
}

function TrayMesh({ t, status, selected }: { t: import('../model/types').Tava3D; status: 'ok' | 'warn' | 'over'; selected: boolean }) {
  const geo = useMemo(() => trayGeometry(t), [t])
  return (
    <group onClick={select('tray', t.id)}>
      <mesh geometry={geo.plate} material={infraMaterial(PLATE[status])} />
      <mesh geometry={geo.frame} material={infraMaterial(selected ? '#7c3aed' : t.tur === 'veri' ? '#0ea5e9' : '#94a3b8')} />
    </group>
  )
}

/** Boru hatları: besleme/dönüş renkli; çalışmayan hat (üretici/pompa enerjisiz) gri; akış yönünü gösteren noktalar. */
export function Pipes() {
  const sc = useScene()
  const selObj = use3dStore((s) => s.selObj)
  const live = useMemo(() => new Map(sc.pipes.map((p) => [p.id, pipeLive(p, sc.analysis)])), [sc.pipes, sc.analysis])
  return (
    <>
      {sc.pipes.map((p) => {
        const on = live.get(p.id) ?? false
        const selected = selObj?.kind === 'pipe' && selObj.id === p.id
        const color = selected ? '#7c3aed' : on ? PIPE_COLOR[p.tur][p.yon] : '#9ca3af'
        return <PipeMesh key={p.id} p={p} color={color} />
      })}
      {selObj?.kind === 'pipe' && <PointHandles kind="pipe" />}
      {sc.flowAnim && <PipeFlow />}
    </>
  )
}

function PipeMesh({ p, color }: { p: import('../model/types').Boru3D; color: string }) {
  const geo = useMemo(() => pipeGeometry(p), [p])
  return <mesh geometry={geo} material={infraMaterial(color, 0.35)} onClick={select('pipe', p.id)} />
}

/** Akış noktaları: çalışan her boru boyunca besleme/dönüş yönünde hareket eder (tek InstancedMesh). */
function PipeFlow() {
  const sc = useScene()
  const ref = useRef<THREE.InstancedMesh>(null)
  const items = useMemo(
    () =>
      sc.pipes
        .filter((p) => pipeLive(p, sc.analysis) && p.noktalar.length >= 2)
        .map((p) => {
          const cum = [0]
          for (let i = 1; i < p.noktalar.length; i++) cum.push(cum[i - 1] + Math.hypot(p.noktalar[i].x - p.noktalar[i - 1].x, p.noktalar[i].y - p.noktalar[i - 1].y, p.noktalar[i].z - p.noktalar[i - 1].z))
          return { pts: p.noktalar, cum, total: cum[cum.length - 1], r: Math.max(0.03, p.dn / 2000 * 0.5) }
        })
        .filter((c) => c.total > 0.3),
    [sc.pipes, sc.analysis],
  )
  const per = 4
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    let k = 0
    for (const c of items) {
      for (let j = 0; j < per; j++) {
        const t = (((clock.elapsedTime * 1.5 + (j * c.total) / per) % c.total) + c.total) % c.total
        let i = 1
        while (i < c.cum.length - 1 && c.cum[i] < t) i++
        const f = (t - c.cum[i - 1]) / Math.max(1e-9, c.cum[i] - c.cum[i - 1])
        dummy.position.set(c.pts[i - 1].x + (c.pts[i].x - c.pts[i - 1].x) * f, c.pts[i - 1].y + (c.pts[i].y - c.pts[i - 1].y) * f, c.pts[i - 1].z + (c.pts[i].z - c.pts[i - 1].z) * f)
        dummy.scale.setScalar(c.r * 1.6)
        dummy.updateMatrix()
        m.setMatrixAt(k++, dummy.matrix)
      }
    }
    m.count = k
    m.instanceMatrix.needsUpdate = true
    tick()
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, items.length * per)]} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#ffffff" />
    </instancedMesh>
  )
}

/** Seçili tava/borunun köşe tutamaçları: x-z'de sürüklenir (ızgaraya yapışır). */
function PointHandles({ kind }: { kind: 'tray' | 'pipe' }) {
  const sc = useScene()
  const selObj = use3dStore((s) => s.selObj)
  if (!selObj || selObj.kind !== kind) return null
  const pts =
    kind === 'tray'
      ? (() => {
          const t = sc.trays.find((q) => q.id === selObj.id)
          return t ? t.noktalar.map((p) => ({ x: p.x, y: t.y + 0.2, z: p.z })) : []
        })()
      : (sc.pipes.find((q) => q.id === selObj.id)?.noktalar ?? [])
  return (
    <>
      {pts.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.y, p.z]}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            beginObjectPointDrag(kind, selObj.id, i, p.y)
          }}
        >
          <sphereGeometry args={[0.22, 12, 12]} />
          <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </>
  )
}
