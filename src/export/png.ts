import { getNodesBounds } from '@xyflow/react'
import { toPng } from 'html-to-image'
import type { EquipmentNode } from '../model/types'

const PADDING = 40

/**
 * Şemanın görüntüsünü PNG (data URL) olarak üretir. Yalnızca React Flow
 * görünüm katmanı (düğümler + hatlar + hat etiketleri) alınır; minimap ve
 * kontroller dışarıda kalır. Şema sekmesi açıkken çağrılmalıdır.
 */
export async function renderDiagramPng(nodes: EquipmentNode[]): Promise<string | null> {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport || nodes.length === 0) return null
  const b = getNodesBounds(nodes)
  const width = Math.ceil(b.width + PADDING * 2)
  const height = Math.ceil(b.height + PADDING * 2)
  return toPng(viewport, {
    backgroundColor: '#ffffff',
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${PADDING - b.x}px, ${PADDING - b.y}px) scale(1)`,
    },
  })
}
