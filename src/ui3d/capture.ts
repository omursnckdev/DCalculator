/** 3D sahnenin PNG'sini alan işlev (sahne açıkken kayıtlıdır) ve son alınan görüntü (rapor için). */
let capture: (() => string | null) | null = null
let last: string | null = null

export const registerCapture = (fn: (() => string | null) | null): void => {
  capture = fn
}

/** Sahne açıksa yeni görüntü alır; kapalıysa (sekmeden çıkarken kaydedilen) son görüntüyü döndürür. */
export function capture3d(): string | null {
  const now = capture?.()
  if (now) last = now
  return last
}

export const rememberCapture = (png: string | null): void => {
  if (png) last = png
}

/** Güncel kamera (kayıtlı görünüm için). */
export interface CamSnapshot {
  pos: [number, number, number]
  target: [number, number, number]
  ortho: boolean
}
let camGetter: (() => CamSnapshot | null) | null = null
export const registerCamGetter = (fn: (() => CamSnapshot | null) | null): void => {
  camGetter = fn
}
export const currentCamera = (): CamSnapshot | null => camGetter?.() ?? null

/** Ekran noktasından zemin (x, z) bulucu (sürükle-bırak için); sahne açıkken kayıtlıdır. */
let picker: ((clientX: number, clientY: number) => { x: number; z: number } | null) | null = null
export const registerPicker = (fn: typeof picker): void => {
  picker = fn
}
export const pickGround = (clientX: number, clientY: number): { x: number; z: number } | null => picker?.(clientX, clientY) ?? null
