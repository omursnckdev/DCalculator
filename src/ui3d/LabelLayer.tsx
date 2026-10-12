import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { isMinor } from '../layout3d/dims'
import { floorVisible } from '../layout3d/floors'
import { polylineLength, routePoints } from '../layout3d/route'
import { tr } from '../i18n/tr'
import { fmtNum } from '../ui/status'
import { useStore } from '../store/useStore'
import { useScene } from './sceneData'
import { use3dStore } from './use3dStore'

interface Spec {
  key: string
  lines: string[]
  x: number
  y: number
  z: number
  cls: string
  /** Kameraya bu mesafeden (m) uzakta gizlenir; ortografik kamerada yakınlaştırma < 9 px/m iken gizlenir. */
  cull?: number
}

/** Plan etiketi: ad (ör. "UPS.PL1.1 (IT UPS)") veya Etiket alanı → kısa ad (ilk sözcük). */
const shortName = (ad: string, etiket: string): string => etiket || ad.split(/\s+/)[0] || ad

const BASE = 'absolute left-0 top-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-tight will-change-transform'
const DARK = `${BASE} bg-slate-900/80 text-white`

/**
 * Etiketler: Canvas dışındaki sade bir DOM katmanında elle yönetilir (drei <Html> React 19'da sahne kapanırken
 * "removeChild" hatası verdiği için kullanılmaz). Konumlar her çizimde kameraya göre izdüşürülür.
 */
export function LabelLayer() {
  const sc = useScene()
  const { gl, camera, size } = useThree()
  const hoverId = use3dStore((s) => s.hoverId)
  const showLabels = use3dStore((s) => s.showLabels)
  const floor = use3dStore((s) => s.floor)
  const hasPlan = useStore((s) => s.plan3d !== null)
  const measurePts = use3dStore((s) => s.measurePts)
  const layer = useRef<HTMLDivElement | null>(null)
  const els = useRef(new Map<string, HTMLDivElement>())
  const specs = useRef<Spec[]>([])

  const list = useMemo(() => {
    const out: Spec[] = []
    const seen = new Set<string>() // aynı dolaptaki (aynı etiket, aynı yer) baralar tek etiket
    for (const n of sc.nodes) {
      const b = sc.boxById.get(n.id)
      if (!b || !floorVisible(floor, b.elev)) continue
      const sel = sc.selected.has(n.id)
      const hov = hoverId === n.id
      if (!(sel || hov || (showLabels && !isMinor(n.type)))) continue
      if (hasPlan && !sel && !hov) {
        const k = `${shortName(n.ad, n.etiket)}|${b.x.toFixed(1)}|${b.z.toFixed(1)}`
        if (seen.has(k)) continue
        seen.add(k)
      }
      const r = sc.analysis.nodes[n.id]
      // Kat planı varken ekipmanın üstünde kısa plan etiketi (ör. UPS.PL1.1), yoksa ad
      const lines = [hasPlan && !hov ? shortName(n.ad, n.etiket) : n.ad]
      if (hov && r) {
        const parts = [`${fmtNum(r.totalKw, 0)} kW · ${fmtNum(r.kva, 0)} kVA`]
        if (r.loadingPct !== undefined) parts.push(`${tr.tbl3d.fill} %${fmtNum(r.loadingPct, 0)}`)
        if (r.iscKa !== undefined) parts.push(`Isc ${fmtNum(r.iscKa, 1)} kA`)
        if (r.fuelHours !== undefined && Number.isFinite(r.fuelHours)) parts.push(`${tr.tbl3d.fuel} ${fmtNum(r.fuelHours, 1)} sa`)
        if (r.shed) parts.push(tr.tbl3d.shed)
        lines.push(parts.join(' · '))
      }
      out.push({ key: `n:${n.id}`, lines, x: b.x, y: b.elev + b.h + (hasPlan ? 0.35 : 0.8), z: b.z, cls: DARK, ...(hasPlan && !sel && !hov ? { cull: 28 } : {}) })
    }
    for (const r of hasPlan ? [] : sc.rooms) {
      if (!floorVisible(floor, r.elev ?? 0)) continue
      const hot = r.tur === 'salon' && sc.tempC !== undefined && sc.tempShift >= 1
      out.push({
        key: `r:${r.id}`,
        lines: [r.tur === 'salon' && sc.tempC !== undefined ? `${r.ad} · ${fmtNum(sc.tempC, 1)} °C` : r.ad],
        x: r.x + 0.2,
        y: (r.elev ?? 0) + 0.1,
        z: r.z + 0.2,
        cls: `${BASE} ${hot ? 'bg-red-600 text-white' : 'bg-white/80 text-slate-700'}`,
      })
    }
    const e = sc.edges.find((x) => x.id === sc.selectedEdge)
    const a = e && sc.boxById.get(e.source)
    const bb = e && sc.boxById.get(e.target)
    if (e && a && bb) {
      const pts = routePoints(e, a, bb, sc.lanes.get(e.id) ?? 0)
      const mid = pts[Math.floor(pts.length / 2)]
      out.push({ key: 'edge', lines: [`${e.ad || e.id} · ${polylineLength(pts).toFixed(1)} m`], x: mid.x, y: mid.y + 0.6, z: mid.z, cls: `${BASE} bg-violet-700/90 text-white` })
    }
    if (measurePts.length === 2) {
      const [p, q] = measurePts
      out.push({ key: 'measure', lines: [`${Math.hypot(q[0] - p[0], q[1] - p[1]).toFixed(2)} m`], x: (p[0] + q[0]) / 2, y: 0.6, z: (p[1] + q[1]) / 2, cls: `${BASE} bg-sky-600 text-white font-medium` })
    }
    return out
  }, [sc, hoverId, showLabels, measurePts, floor, hasPlan])

  // Katman (Canvas'ın kardeşi olarak, elle)
  useEffect(() => {
    const host = gl.domElement.parentElement
    if (!host) return
    const div = document.createElement('div')
    div.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5'
    host.appendChild(div)
    layer.current = div
    const map = els.current
    return () => {
      map.clear()
      div.remove()
      layer.current = null
    }
  }, [gl])

  const place = useMemo(() => {
    const v = new THREE.Vector3()
    const cullV = new THREE.Vector3()
    return () => {
      for (const s of specs.current) {
        const el = els.current.get(s.key)
        if (!el) continue
        const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera
        if (s.cull !== undefined && (ortho ? (camera as THREE.OrthographicCamera).zoom < 9 : camera.position.distanceTo(cullV.set(s.x, s.y, s.z)) > s.cull)) {
          el.style.display = 'none'
          continue
        }
        v.set(s.x, s.y, s.z).project(camera)
        if (v.z > 1 || v.z < -1) {
          el.style.display = 'none'
          continue
        }
        el.style.display = ''
        const px = ((v.x + 1) / 2) * size.width
        const py = ((1 - v.y) / 2) * size.height
        el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`
      }
    }
  }, [camera, size])

  useEffect(() => {
    const div = layer.current
    if (!div) return
    const keep = new Set(list.map((s) => s.key))
    for (const [k, el] of els.current) {
      if (!keep.has(k)) {
        el.remove()
        els.current.delete(k)
      }
    }
    for (const s of list) {
      let el = els.current.get(s.key)
      if (!el) {
        el = document.createElement('div')
        div.appendChild(el)
        els.current.set(s.key, el)
      }
      el.className = s.cls
      el.replaceChildren(
        ...s.lines.map((t, i) => {
          const line = document.createElement('div')
          line.textContent = t
          if (i > 0) line.className = 'text-[10px] text-slate-200'
          return line
        }),
      )
    }
    specs.current = list
    place()
  }, [list, place])

  useFrame(place)
  return null
}
