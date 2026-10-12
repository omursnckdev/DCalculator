import type { Params } from '../model/types'

/** Ekipmana atanan özel 3D model (GLB): düğüm parametrelerinde saklanır (şema sürümü değişmez). */
export interface ModelSpec {
  /** Model kütüphanesi kimliği (tarayıcı IndexedDB; içerik özeti). */
  id: string
  /** 'gerdir': model ekipman kutusuna (g × y × d) gerilir; 'oran': oran korunarak kutuya sığar. */
  fit: 'gerdir' | 'oran'
  /** Modelin ön yüzünü ekipmanın önüne çevirmek için ek dönüş: 0, 90, 180, 270. */
  rot: number
}

export const MODEL_KEYS = { id: 'model3d', fit: 'model3dSigdir', rot: 'model3dDonus' } as const

export function modelSpecOf(p: Params): ModelSpec | undefined {
  const id = p[MODEL_KEYS.id]
  if (typeof id !== 'string' || !id) return undefined
  const rot = Number(p[MODEL_KEYS.rot] ?? 0)
  return { id, fit: p[MODEL_KEYS.fit] === 'oran' ? 'oran' : 'gerdir', rot: [0, 90, 180, 270].includes(rot) ? rot : 0 }
}

export interface Size3 {
  x: number
  y: number
  z: number
}

/**
 * Modelin kendi boyutunu (x, y, z; m) ekipman kutusuna oturtan ölçek. `rot` 90/270 iken modelin x ekseni kutunun derinliğine denk gelir.
 */
export function fitScale(size: Size3, box: { g: number; d: number; h: number }, fit: ModelSpec['fit'], rot: number): [number, number, number] {
  const sx = Math.max(size.x, 1e-6)
  const sy = Math.max(size.y, 1e-6)
  const sz = Math.max(size.z, 1e-6)
  const swap = rot === 90 || rot === 270
  const bx = swap ? box.d : box.g
  const bz = swap ? box.g : box.d
  if (fit === 'gerdir') return [bx / sx, box.h / sy, bz / sz]
  const k = Math.min(bx / sx, box.h / sy, bz / sz)
  return [k, k, k]
}

/** "Gerçek boyutu kullan": model metre biriminde varsayılır; kutu (g, d, y) modelin boyutuna eşitlenir (döndürülmüşse x/z yer değiştirir). */
export function nativeBox(size: Size3, rot: number): { g: number; d: number; y: number } {
  const swap = rot === 90 || rot === 270
  const r = (v: number) => Math.max(0.1, Math.round(v * 100) / 100)
  return { g: r(swap ? size.z : size.x), d: r(swap ? size.x : size.z), y: r(size.y) }
}

/** Model bulma aramaları: tür başına Sketchfab arama sözcüğü (indirilebilir, lisans süzgeci kullanıcıda). */
export const MODEL_SEARCH: Record<string, string> = {
  trafo: 'dry type transformer',
  jenerator: 'diesel generator container',
  mdb: 'low voltage switchgear panel',
  dagitimPanosu: 'electrical distribution board',
  bara: 'busbar trunking',
  ups: 'UPS cabinet data center',
  upsPanosu: 'electrical switchboard cabinet',
  pdu: 'PDU data center',
  ats: 'automatic transfer switch',
  sts: 'static transfer switch',
  senkron: 'generator control panel',
  kesici: 'circuit breaker ACB',
  rmu: 'ring main unit',
  batarya: 'battery cabinet UPS',
  chiller: 'air cooled chiller',
  crah: 'CRAH data center cooling unit',
  sogutmaKulesi: 'cooling tower',
  pompa: 'centrifugal pump',
}
export const modelSearchUrl = (type: string): string => `https://sketchfab.com/search?features=downloadable&type=models&q=${encodeURIComponent(MODEL_SEARCH[type] ?? type)}`
