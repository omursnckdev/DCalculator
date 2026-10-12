import { invalidate, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { autoStairs, floorAt } from '../layout3d/floors'
import { BODY_RADIUS, EYE_HEIGHT, forwardOf, freeSpot, rightOf, walkStepFloors } from '../layout3d/walk'
import { useStore } from '../store/useStore'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean }

const WALK = 3 // m/sn
const RUN = 6.5
const TURN = 1.9 // rad/sn (ok tuşları)
const FOV = 70

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * Yürüme modu (birinci şahıs): ↑↓ / W S ileri-geri, ← → / Q E dön, A D yana kay, Shift koş, fare sürükleyerek bak.
 * Ekipman engel sayılır (yarıçap 0,35 m; yan yüzeyde kayar). Duvarlar engel değildir. Simülasyon sürerken yürünebilir.
 */
export function Walk() {
  const walk = use3dStore((s) => s.walk)
  const { camera, gl, controls } = useThree()
  const sc = useScene()
  const scRef = useRef(sc)
  scRef.current = sc
  const boxes = useMemo(() => [...sc.boxById.values()], [sc.boxById])
  const boxesRef = useRef(boxes)
  boxesRef.current = boxes
  const plan = useStore((s) => s.plan3d)
  const walls = useMemo(() => (plan ? plan.duvarlar : []), [plan])
  const wallsRef = useRef(walls)
  wallsRef.current = walls
  const stairs = useMemo(() => autoStairs(sc.rooms), [sc.rooms])
  const floorsRef = useRef({ rooms: sc.rooms, stairs })
  floorsRef.current = { rooms: sc.rooms, stairs }
  // h: ayak kotu (zemin/üst kat/merdiven); eye: kameranın yumuşatılmış göz kotu
  const st = useRef({ x: 0, z: 0, h: 0, eye: EYE_HEIGHT, yaw: 0, pitch: 0, keys: new Set<string>(), look: false })

  useEffect(() => {
    if (!walk) return
    const ctl = controls as unknown as Controls | null
    if (!ctl) return
    // Ortografik (üst plan) kamerada önce perspektife dönülür; kamera değişince bu etki yeniden çalışır.
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      // Son istenen görünüm (ör. üst plan) kamera değişince yeniden uygulanmasın.
      use3dStore.setState({ camMode: 'persp', viewReq: null, camRequest: null })
      return
    }
    const cam = camera as THREE.PerspectiveCamera
    const prevFov = cam.fov
    const s = st.current
    // Başlangıç: yörünge hedefi (ekipman seçiliyse onun yanı), bakış yönü: kameranın yatay yönü.
    const fx = ctl.target.x - cam.position.x
    const fz = ctl.target.z - cam.position.z
    s.yaw = Math.hypot(fx, fz) > 0.1 ? Math.atan2(-fx, -fz) : 0
    s.pitch = -0.08
    // Hedefin (seçili ekipmanın) 3 m önünde başla, ona bakarak; engelliyse en yakın boş noktaya kay.
    const len = Math.hypot(fx, fz)
    const back = len > 0.1 ? { x: -fx / len, z: -fz / len } : { x: 0, z: 1 }
    const sx = ctl.target.x + back.x * 3
    const sz = ctl.target.z + back.z * 3
    // Hedef (ör. 1. kattaki ekipman) hangi katta ise orada başla.
    const fl = floorsRef.current
    const h0 = floorAt(fl.rooms, fl.stairs, ctl.target.x, ctl.target.z, ctl.target.y)
    const spot = freeSpot(boxesRef.current, sx, sz, BODY_RADIUS, h0)
    s.x = spot.x
    s.z = spot.z
    s.h = floorAt(fl.rooms, fl.stairs, s.x, s.z, h0 + 0.3)
    s.eye = s.h + EYE_HEIGHT
    s.keys.clear()
    cam.fov = FOV
    cam.near = 0.05
    cam.updateProjectionMatrix()
    ctl.enabled = false
    cam.position.set(s.x, s.eye, s.z)
    cam.rotation.set(s.pitch, s.yaw, 0, 'YXZ')

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Escape') {
        use3dStore.getState().setWalk(false)
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
      s.keys.add(e.code)
      if (e.shiftKey) s.keys.add('Shift')
      invalidate()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      s.keys.delete(e.code)
      if (!e.shiftKey) s.keys.delete('Shift')
    }
    const clear = () => s.keys.clear()
    let lx = 0
    let ly = 0
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      s.look = true
      lx = e.clientX
      ly = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (!s.look) return
      s.yaw -= (e.clientX - lx) * 0.004
      s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch - (e.clientY - ly) * 0.004))
      lx = e.clientX
      ly = e.clientY
      cam.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
      invalidate()
    }
    const onUp = () => {
      s.look = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clear)
    gl.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    invalidate()
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
      gl.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      s.keys.clear()
      s.look = false
      // Yörünge kontrolüne dön: bakılan yönün 6 m ilerisi hedef olur.
      cam.fov = prevFov
      cam.near = 0.1
      cam.updateProjectionMatrix()
      const f = forwardOf(s.yaw)
      ctl.target.set(s.x + f.x * 6, s.h + 1, s.z + f.z * 6)
      ctl.enabled = true
      ctl.update()
      invalidate()
    }
  }, [walk, camera, controls, gl])

  useFrame((_, dtRaw) => {
    if (!use3dStore.getState().walk) return
    const s = st.current
    const dt = Math.min(dtRaw, 0.1)
    const k = s.keys
    const turn = (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0)
    const fwd = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0)
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    s.yaw += turn * TURN * dt
    if (fwd !== 0 || strafe !== 0) {
      const v = (k.has('Shift') ? RUN : WALK) * dt
      const f = forwardOf(s.yaw)
      const r = rightOf(s.yaw)
      const len = Math.hypot(fwd, strafe) || 1
      const dx = ((f.x * fwd + r.x * strafe) / len) * v
      const dz = ((f.z * fwd + r.z * strafe) / len) * v
      const fl = floorsRef.current
      const p = walkStepFloors(boxesRef.current, fl.rooms, fl.stairs, { x: s.x, z: s.z, h: s.h }, dx, dz, BODY_RADIUS, wallsRef.current)
      s.x = p.x
      s.z = p.z
      s.h = p.h
    }
    // Göz kotu merdivende/kat geçişinde yumuşak izler.
    const want = s.h + EYE_HEIGHT
    const settling = Math.abs(want - s.eye) > 0.002
    s.eye = settling ? s.eye + (want - s.eye) * Math.min(1, dt * 14) : want
    const wh = s.h > 2.2 ? 4.5 : 0
    if (use3dStore.getState().walkH !== wh) use3dStore.setState({ walkH: wh })
    camera.position.set(s.x, s.eye, s.z)
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    if (turn !== 0 || fwd !== 0 || strafe !== 0 || s.look || settling) invalidate()
  })
  return null
}
