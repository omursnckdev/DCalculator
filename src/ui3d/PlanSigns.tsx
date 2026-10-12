import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { floorVisible } from '../layout3d/floors'
import { roomEntrance } from '../layout3d/planRooms'
import { useStore } from '../store/useStore'
import { use3dStore } from './use3dStore'

const SIGN_W = 2.2
const SIGN_H = 0.5
/** Tabela: kapı üstü (zemin kotundan yükseklik), duvarın dışına bakar. */
const SIGN_Y = 2.55
const OFFSET = 0.14

const texCache = new Map<string, THREE.CanvasTexture>()
function signTexture(text: string): THREE.CanvasTexture {
  let t = texCache.get(text)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 232
  const g = c.getContext('2d')!
  g.fillStyle = '#0f3b66'
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = '#ffffff'
  g.lineWidth = 8
  g.strokeRect(8, 8, c.width - 16, c.height - 16)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Uzun adlar iki satıra bölünür ve sığana kadar küçülür
  const words = text.split(' ')
  const lines = text.length > 18 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text]
  let size = lines.length === 1 ? 110 : 88
  g.font = `600 ${size}px sans-serif`
  while (size > 30 && Math.max(...lines.map((l) => g.measureText(l).width)) > c.width - 60) {
    size -= 4
    g.font = `600 ${size}px sans-serif`
  }
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * size * 1.05))
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texCache.set(text, t)
  return t
}

/**
 * Oda tabelaları: her plan odasının adı, oda girişinin (duvardaki kapı boşluğu) üstünde duvara, dışarı bakacak biçimde yazılır.
 * Kapı boşluğu duvar çizgilerinden bulunur (`roomEntrance`); kapalı odada güney kenar ortasına konur. "Duvarlar" (H) ile gizlenir.
 */
export function PlanSigns() {
  const plan = useStore((s) => s.plan3d)
  const hideWalls = use3dStore((s) => s.hideWalls)
  const floor = use3dStore((s) => s.floor)
  const signs = useMemo(
    () =>
      plan
        ? plan.odalar
            .filter((o) => o.tur !== 'dis' && o.tur !== 'jenerator')
            .map((o) => ({ o, e: roomEntrance(o, plan.duvarlar) }))
            .map(({ o, e }) => ({ key: o.ad, text: o.ad, x: e.x + e.nx * OFFSET, z: e.z + e.nz * OFFSET, ry: Math.atan2(e.nx, e.nz) }))
        : [],
    [plan],
  )
  const geo = useMemo(() => new THREE.PlaneGeometry(SIGN_W, SIGN_H), [])
  useEffect(() => () => geo.dispose(), [geo])
  if (hideWalls || !floorVisible(floor, 0)) return null
  return (
    <>
      {signs.map((s) => (
        <mesh key={s.key} geometry={geo} position={[s.x, SIGN_Y, s.z]} rotation={[0, s.ry, 0]} raycast={() => null} renderOrder={10}>
          {/* transparent: yarı saydam duvarlardan sonra çizilir (renk solmaz) */}
          <meshBasicMaterial map={signTexture(s.text)} toneMapped={false} side={THREE.FrontSide} transparent />
        </mesh>
      ))}
    </>
  )
}
