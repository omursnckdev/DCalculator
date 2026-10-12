import { snap } from '../layout3d/geometry'
import { useStore } from '../store/useStore'
import { use3dStore } from './use3dStore'

/** Yeni tava/boru varsayılanları (çizim modu). */
export const DRAW_DEFAULTS = {
  tray: { g: 0.4, h: 0.1, y: 3, sinir: 40 },
  pipe: { dn: 100, y: 3.8 },
}

/** Çizim moduna zemin noktası ekler (ızgaraya yapışır). */
export function addDrawPoint(x: number, z: number): void {
  const step = use3dStore.getState().snapStep
  use3dStore.getState().addDrawPt({ x: snap(x, step), z: snap(z, step) })
}

/** Çizimi bitirir: en az 2 nokta varsa tava veya boru olarak kaydeder ve seçer; yoksa vazgeçer. Oluşturulan nesnenin kimliğini döndürür. */
export function finishDraw(): string | null {
  const st = use3dStore.getState()
  const d = st.draw
  st.cancelDraw()
  if (!d || d.pts.length < 2) return null
  const store = useStore.getState()
  if (d.kind === 'tray') {
    const n = store.tavalar3d.length + 1
    const id = store.addTava3d({ ad: `Tava ${n}`, tur: 'guc', ...DRAW_DEFAULTS.tray, noktalar: d.pts })
    st.setSelObj({ kind: 'tray', id })
    return id
  }
  const n = store.borular3d.length + 1
  const y = DRAW_DEFAULTS.pipe.y
  const id = store.addBoru3d({
    ad: `Boru ${n}`,
    tur: 'sogukSu',
    yon: 'besleme',
    dn: DRAW_DEFAULTS.pipe.dn,
    dnElle: true,
    kw: 0,
    noktalar: d.pts.map((p) => ({ x: p.x, y, z: p.z })),
    uretici: [],
    pompalar: [],
    otomatik: false,
  })
  st.setSelObj({ kind: 'pipe', id })
  return id
}
