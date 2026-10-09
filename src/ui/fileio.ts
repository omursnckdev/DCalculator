import { parseProject, serializeProject } from '../model/project'
import type { Project } from '../model/types'

export function downloadProject(p: Project): void {
  saveBlob(new Blob([serializeProject(p)], { type: 'application/json' }), `${safeName(p.name)}.dcalc.json`)
}

export async function readProjectFile(file: File): Promise<Project> {
  return parseProject(await file.text())
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const safeName = (name: string): string => name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'proje'
