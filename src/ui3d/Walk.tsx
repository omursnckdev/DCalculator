import { invalidate, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BODY_RADIUS, EYE_HEIGHT, forwardOf, freeSpot, rightOf, walkStep } from '../layout3d/walk'
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
  const st = useRef({ x: 0, z: 0, yaw: 0, pitch: 0, keys: new Set<string>(), look: false })

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
    const spot = freeSpot(boxesRef.current, ctl.target.x + back.x * 3, ctl.target.z + back.z * 3)
    s.x = spot.x
    s.z = spot.z
    s.keys.clear()
    cam.fov = FOV
    cam.near = 0.05
    cam.updateProjectionMatrix()
    ctl.enabled = false
    cam.position.set(s.x, EYE_HEIGHT, s.z)
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
      ctl.target.set(s.x + f.x * 6, 1, s.z + f.z * 6)
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
      const p = walkStep(boxesRef.current, s.x, s.z, dx, dz, BODY_RADIUS)
      s.x = p.x
      s.z = p.z
    }
    camera.position.set(s.x, EYE_HEIGHT, s.z)
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    if (turn !== 0 || fwd !== 0 || strafe !== 0 || s.look) invalidate()
  })
  return null
}
