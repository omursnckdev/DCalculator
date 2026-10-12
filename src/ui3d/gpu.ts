/** Tarayıcının kullandığı grafik işlemci bilgisi ve yazılım (GPU'suz) render tespiti. */
export interface GpuInfo {
  renderer: string
  /** SwiftShader / llvmpipe / Microsoft Basic Render gibi yazılım render: donanım hızlandırma kapalı demektir. */
  software: boolean
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i

export function detectGpu(): GpuInfo | null {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    return { renderer, software: SOFTWARE.test(renderer) }
  } catch {
    return null
  }
}
