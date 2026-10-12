import { Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { invalidate, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { autoStairs } from '../layout3d/floors'
import { bounds } from '../layout3d/geometry'
import { routePoints } from '../layout3d/route'
import { useStore } from '../store/useStore'
import { beginNodeDrag, drag, endDrag, groundFromRay, marq, moveDrag, rotateSelected, selectedIds, setSelection } from './drag'
import { addDrawPoint, finishDraw } from './drawing'
import { registerCamGetter, registerCapture, registerPicker, rememberCapture } from './capture'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'
import type { ViewName } from './use3dStore'

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean }

/** Pointer olayları (sürükleme), klavye kısayolları, kamera, yakalama. */
export function Controllers() {
  const sc = useScene()
  const { gl, camera, scene, size, controls } = useThree()
  const camMode = use3dStore((s) => s.camMode)
  const ctl = controls as unknown as Controls | null
  const scRef = useRef(sc)
  scRef.current = sc

  const bbox = () => {
    const bs = [...sc.boxById.values()].map((b) => bounds(b))
    const rs = sc.rooms
    const minX = Math.min(...bs.map((b) => b.minX), ...rs.map((r) => r.x), 0)
    const maxX = Math.max(...bs.map((b) => b.maxX), ...rs.map((r) => r.x + r.g), 10)
    const minZ = Math.min(...bs.map((b) => b.minZ), ...rs.map((r) => r.z), 0)
    const maxZ = Math.max(...bs.map((b) => b.maxZ), ...rs.map((r) => r.z + r.d), 10)
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, sx: maxX - minX, sz: maxZ - minZ }
  }

  // Geliştirme: tarayıcı testleri için ekran izdüşümü.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__v3d = {
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      /** Hat güzergâhının orta noktasının ekran konumu (tıklama testi için). */
      cableMid: (edgeId: string) => {
        const s = scRef.current
        const e = s.edges.find((x) => x.id === edgeId)
        const a = e && s.boxById.get(e.source)
        const b = e && s.boxById.get(e.target)
        if (!e || !a || !b) return null
        const pts = routePoints(e, a, b, s.lanes.get(e.id) ?? 0)
        // En uzun segmentin ortası
        let best = 1
        let bl = -1
        for (let i = 1; i < pts.length; i++) {
          const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z)
          if (l > bl) {
            bl = l
            best = i
          }
        }
        const m = new THREE.Vector3((pts[best].x + pts[best - 1].x) / 2, (pts[best].y + pts[best - 1].y) / 2, (pts[best].z + pts[best - 1].z) / 2).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((m.x + 1) / 2) * r.width, y: r.top + ((1 - m.y) / 2) * r.height }
      },
      marqState: () => ({ ...marq }),
      stairs: () => autoStairs(scRef.current.rooms),
      overlaps: () => [...scRef.current.overlaps].map((id) => scRef.current.byId.get(id)?.ad),
      boxes: () => [...scRef.current.boxById.values()].map((b) => ({ ...b, ad: scRef.current.byId.get(b.id)?.ad })),
      setCam: (pos: [number, number, number], target: [number, number, number]) => {
        camera.position.set(...pos)
        if (ctl) {
          ctl.target.set(...target)
          ctl.update()
        }
        invalidate()
      },
      camPos: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: camera.rotation.y }),
      stats: () => {
        gl.render(scene, camera)
        return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 }
      },
    }
  }, [camera, gl, scene, ctl])

  // --- yakalama (PNG) ve kamera durumu
  useEffect(() => {
    registerCapture(() => {
      gl.render(scene, camera)
      try {
        return gl.domElement.toDataURL('image/png')
      } catch {
        return null
      }
    })
    registerCamGetter(() => (ctl ? { pos: camera.position.toArray() as [number, number, number], target: ctl.target.toArray() as [number, number, number], ortho: (camera as THREE.OrthographicCamera).isOrthographicCamera === true } : null))
    return () => {
      try {
        gl.render(scene, camera)
        rememberCapture(gl.domElement.toDataURL('image/png'))
      } catch {
        /* sahne kapanıyor */
      }
      registerCapture(null)
      registerCamGetter(null)
    }
  }, [gl, scene, camera, ctl])

  // --- hazır görünümler ve odaklanma
  const viewReq = use3dStore((s) => s.viewReq)
  const focusId = use3dStore((s) => s.focusId)
  const camReq = use3dStore((s) => s.camRequest)
  const apply = (name: ViewName) => {
    if (!ctl) return
    const { cx, cz, sx, sz } = bbox()
    const S = Math.max(sx, sz, 8)
    const target: [number, number, number] = [cx, 1, cz]
    let pos: [number, number, number]
    if (name === 'front') pos = [cx, S * 0.35, cz + S * 1.3]
    else if (name === 'side') pos = [cx + S * 1.3, S * 0.35, cz]
    else if (name === 'top') pos = [cx, 200, cz]
    else pos = [cx + S * 0.7, S * 0.65, cz + S * 0.9]
    const top = name === 'top'
    if (use3dStore.getState().camMode !== (top ? 'top' : 'persp')) use3dStore.setState({ camMode: top ? 'top' : 'persp' })
    camera.position.set(...pos)
    ctl.target.set(...target)
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const oc = camera as THREE.OrthographicCamera
      oc.zoom = Math.min(size.width / (sx * 1.25 + 4), size.height / (sz * 1.25 + 4))
      oc.updateProjectionMatrix()
    }
    ctl.update()
    invalidate()
  }
  // Kamera/kontrol nesnesi kamera türü değişince yeniden oluşur; son istenen görünüm yeniden uygulanır.
  const userMoved = useRef(false)
  useEffect(() => {
    if (viewReq) {
      userMoved.current = true
      apply(viewReq.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewReq?.seq, ctl, camMode])
  // İlk açılışta (kullanıcı kamerayı oynatmadan) sahneyi sığdır; kontrol yeniden oluşursa tekrarlanır.
  useEffect(() => {
    if (ctl && !userMoved.current && sc.boxById.size > 0) apply('fit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, sc.boxById.size > 0])
  useEffect(() => {
    if (!focusId || !ctl) return
    userMoved.current = true
    const b = scRef.current.boxById.get(focusId.id)
    if (!b) return
    const dir = camera.position.clone().sub(ctl.target)
    if (dir.length() < 1e-3) dir.set(1, 1, 1)
    dir.normalize()
    // Küçük elemanlar (şalter) yakından, büyükler uzaktan bakılır.
    const dist = Math.max(2.2, Math.max(b.g, b.d, b.h) * 2.5 + (b.h < 1 ? 0 : 3))
    ctl.target.set(b.x, b.elev + b.h / 2, b.z)
    camera.position.copy(ctl.target.clone().add(dir.multiplyScalar(camMode === 'top' ? 0 : dist)))
    if (camMode === 'top') camera.position.set(b.x, 200, b.z)
    ctl.update()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId?.seq])
  useEffect(() => {
    if (!camReq || !ctl) return
    userMoved.current = true
    camera.position.set(...camReq.pos)
    ctl.target.set(...camReq.target)
    ctl.update()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camReq?.seq, ctl, camMode])

  // --- sürükleme
  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const groundOf = (e: PointerEvent, height = 0) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return groundFromRay(ray.ray, height)
    }
    const onMove = (e: PointerEvent) => {
      if (marq.active) {
        if (ctl) ctl.enabled = false
        use3dStore.getState().setMarquee({ x0: marq.x0, y0: marq.y0, x1: e.clientX, y1: e.clientY })
        return
      }
      const d = drag.current
      const g = groundOf(e, d?.kind === 'wp' || d?.kind === 'nodes' || d?.kind === 'room' ? d.y : 0)
      if (g && !d) drag.last = g
      if (!d || !g) return
      if (ctl) ctl.enabled = false
      const s = scRef.current
      moveDrag(g, [...s.boxById.values()], s.rooms)
      invalidate()
    }
    const onUp = (e: PointerEvent) => {
      if (marq.active) {
        marq.active = false
        use3dStore.getState().setMarquee(null)
        if (ctl) ctl.enabled = true
        const r = el.getBoundingClientRect()
        const xs = [marq.x0, e.clientX].sort((a, b) => a - b)
        const ys = [marq.y0, e.clientY].sort((a, b) => a - b)
        if (xs[1] - xs[0] > 4 || ys[1] - ys[0] > 4) {
          const v = new THREE.Vector3()
          const ids: string[] = []
          for (const b of scRef.current.boxById.values()) {
            v.set(b.x, b.elev + b.h / 2, b.z).project(camera)
            const px = r.left + ((v.x + 1) / 2) * r.width
            const py = r.top + ((1 - v.y) / 2) * r.height
            if (v.z < 1 && px >= xs[0] && px <= xs[1] && py >= ys[0] && py <= ys[1]) ids.push(b.id)
          }
          setSelection(e.ctrlKey ? [...new Set([...selectedIds(), ...ids])] : ids)
          invalidate()
        }
        return
      }
      if (drag.current && !(drag.current.kind === 'nodes' && drag.current.grab)) {
        endDrag()
        if (ctl) ctl.enabled = true
      }
    }
    const onDown = () => {
      // "G" ile tutulan ekipman tıklayınca bırakılır.
      if (drag.current?.kind === 'nodes' && drag.current.grab) {
        endDrag()
        if (ctl) ctl.enabled = true
      }
    }
    registerPicker((x, y) => groundOf({ clientX: x, clientY: y } as PointerEvent))
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('pointerdown', onDown, true)
    return () => {
      registerPicker(null)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerdown', onDown, true)
    }
  }, [gl, camera, ctl])

  // --- klavye kısayolları
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const st = use3dStore.getState()
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'd') {
        e.preventDefault()
        if (!st.walk) useStore.getState().duplicateSelected3d()
        invalidate()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (k === 'y') {
        st.setWalk(!st.walk)
        return
      }
      if (k === 'enter' && st.draw) {
        finishDraw()
        invalidate()
        return
      }
      if (k === 'escape' && st.draw) {
        st.cancelDraw()
        invalidate()
        return
      }
      if (st.walk) return // yürürken diğer kısayollar kapalı (Esc ve hareket tuşları Walk'ta)
      if (k === 'r') rotateSelected(e.shiftKey ? -90 : 90)
      else if (k === 'h') st.setPrefs({ hideWalls: !st.hideWalls })
      else if (k === 'f') {
        const id = selectedIds()[0]
        if (id) st.focus(id)
        else st.requestView('fit')
      } else if (k === '1') st.requestView('front')
      else if (k === '2') st.requestView('side')
      else if (k === '3') st.requestView('top')
      else if (k === 'g') {
        const id = selectedIds()[0]
        if (id && drag.last) {
          beginNodeDrag(id, drag.last, false, true, scRef.current.boxById.get(id)?.elev ?? 0)
          if (ctl) ctl.enabled = false
        }
      } else if (k === 'escape') {
        if (drag.current) {
          endDrag()
          if (ctl) ctl.enabled = true
        }
        st.setMeasure(false)
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault()
        const so = st.selObj
        if (so) {
          if (so.kind === 'tray') useStore.getState().removeTava3d(so.id)
          else if (so.kind === 'room') useStore.getState().removeOda3d(so.id)
          else useStore.getState().removeBoru3d(so.id)
          st.setSelObj(null)
        } else useStore.getState().deleteSelection()
      } else return
      invalidate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl])

  return null
}

/** Zemin: boş yere tıklayınca seçimi temizler; ölçüm modunda nokta alır. */
export function Ground() {
  const sc = useScene()
  const guides = use3dStore((s) => s.guides)
  const measure = use3dStore((s) => s.measure)
  const pts = use3dStore((s) => s.measurePts)
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 3) return
    setSelection([])
  }
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} onClick={onClick} onPointerDown={(e) => {
          if (e.button !== 0) return
          if (use3dStore.getState().draw) addDrawPoint(e.point.x, e.point.z)
          else if (measure) use3dStore.getState().addMeasurePt([e.point.x, e.point.z])
          else if ((e.shiftKey || e.ctrlKey) && !use3dStore.getState().walk) {
            // Zeminde Shift/Ctrl+sürükle: seçim kutusu (kamera dönmesin)
            marq.active = true
            marq.x0 = e.nativeEvent.clientX
            marq.y0 = e.nativeEvent.clientY
            use3dStore.setState({ marquee: { x0: marq.x0, y0: marq.y0, x1: marq.x0, y1: marq.y0 } })
          }
        }}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {guides.map((g, i) => (
        <Line key={i} points={g.axis === 'x' ? [[g.at, 0.05, -300], [g.at, 0.05, 300]] : [[-300, 0.05, g.at], [300, 0.05, g.at]]} color="#f43f5e" lineWidth={1} dashed dashSize={0.5} gapSize={0.3} />
      ))}
      {measure && pts.map((p, i) => (
        <mesh key={i} position={[p[0], 0.1, p[1]]}>
          <sphereGeometry args={[0.15, 10, 10]} />
          <meshBasicMaterial color="#0ea5e9" />
        </mesh>
      ))}
      {pts.length === 2 && (
        <>
          <Line points={[[pts[0][0], 0.1, pts[0][1]], [pts[1][0], 0.1, pts[1][1]]]} color="#0ea5e9" lineWidth={2} />
        </>
      )}
      <gridHelper args={[200, 200, '#94a3b8', '#e2e8f0']} position={[0, -0.005, 0]} raycast={() => null} />
      {sc.boxById.size === 0 && null}
    </>
  )
}

/** Kamera + yörünge kontrolü (perspektif veya kuşbakışı ortografik). */
export function Rig() {
  const camMode = use3dStore((s) => s.camMode)
  const top = camMode === 'top'
  return (
    <>
      <PerspectiveCamera makeDefault={!top} fov={45} near={0.1} far={3000} position={[30, 25, 40]} />
      <OrthographicCamera makeDefault={top} near={-500} far={1500} zoom={12} position={[0, 200, 0]} up={[0, 0, -1]} />
      <OrbitControls
        makeDefault
        enableRotate={!top}
        screenSpacePanning
        maxPolarAngle={Math.PI / 2 - 0.02}
        mouseButtons={{ LEFT: top ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        onChange={() => invalidate()}
      />
    </>
  )
}
