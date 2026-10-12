import { invalidate } from '@react-three/fiber'

/**
 * Animasyonlar (nabız, yanıp sönme, akış) talep üzerine çizim kipinde yaklaşık 30 kare/sn ile sürülür:
 * sürekli 60 fps yerine yalnız gerektiğinde çizilir (GPU/CPU yükü ve pil tasarrufu).
 */
let pending: ReturnType<typeof setTimeout> | null = null
export function tick(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    invalidate()
  }, 33)
}
