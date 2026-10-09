import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { migrate } from '../model/project'
import type { Project } from '../model/types'

interface Schema extends DBSchema {
  projects: { key: string; value: Project }
}

const DB_NAME = 'dcalculator'
const LAST_KEY = 'dcalculator:lastProjectId'

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null
function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' })
    },
  })
  return dbPromise
}

export async function saveProjectToDb(p: Project): Promise<void> {
  await (await db()).put('projects', p)
  try {
    localStorage.setItem(LAST_KEY, p.id)
  } catch {
    /* localStorage kullanılamıyor; sorun değil. */
  }
}

export async function loadProjectFromDb(id: string): Promise<Project | undefined> {
  const raw = await (await db()).get('projects', id)
  return raw ? migrate(raw) : undefined
}

export async function listProjectsInDb(): Promise<Project[]> {
  const all = await (await db()).getAll('projects')
  return all
    .map((r) => {
      try {
        return migrate(r)
      } catch {
        return null
      }
    })
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  await (await db()).delete('projects', id)
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}
