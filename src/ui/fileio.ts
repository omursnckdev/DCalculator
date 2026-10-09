import { parseProject, serializeProject } from '../model/project'
import type { Project } from '../model/types'

export function downloadProject(p: Project): void {
  const blob = new Blob([serializeProject(p)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'proje'}.dcalc.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function readProjectFile(file: File): Promise<Project> {
  return parseProject(await file.text())
}
