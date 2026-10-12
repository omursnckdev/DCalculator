import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Özel 3D model kütüphanesi (GLB): tarayıcının IndexedDB'sinde saklanır (projeye gömülmez; proje dosyası yalnız model kimliğini taşır).
 * Aynı dosya aynı kimliği alır (içerik özeti), böylece iki kez yüklemek çoğaltmaz.
 */
export interface ModelMeta {
  id: string
  ad: string
  boyut: number
  lisans: string
  eklendi: string
}
interface ModelRec extends ModelMeta {
  buf: ArrayBuffer
}

export const MAX_MODEL_BYTES = 60 * 1024 * 1024

const DB_NAME = 'dcalculator-models'
const STORE = 'models'
let dbp: Promise<IDBPDatabase> | null = null
const db = () =>
  (dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: 'id' })
    },
  }))

let version = 0
const listeners = new Set<() => void>()
const bump = () => {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

async function digest(buf: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf))
    return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Güvenli olmayan bağlamda (crypto.subtle yok): basit FNV özeti
  let x = 2166136261
  const v = new Uint8Array(buf)
  for (let i = 0; i < v.length; i += 7) x = Math.imul(x ^ v[i], 16777619)
  return (x >>> 0).toString(16).padStart(8, '0') + v.length.toString(16)
}

/** GLB dosyası ("glTF" ikili): ilk dört bayt 'glTF'. */
export const isGlb = (buf: ArrayBuffer): boolean => buf.byteLength > 12 && new DataView(buf).getUint32(0, true) === 0x46546c67

export async function saveModel(file: File): Promise<ModelMeta> {
  if (file.size > MAX_MODEL_BYTES) throw new Error(`Model çok büyük (en çok ${MAX_MODEL_BYTES / 1024 / 1024} MB).`)
  const buf = await file.arrayBuffer()
  if (!isGlb(buf)) throw new Error('Yalnızca .glb (ikili glTF) dosyası desteklenir. .gltf + dokular için dosyayı GLB olarak dışa aktarın.')
  const id = `m_${await digest(buf)}`
  const d = await db()
  const old = (await d.get(STORE, id)) as ModelRec | undefined
  if (old) return { id: old.id, ad: old.ad, boyut: old.boyut, lisans: old.lisans, eklendi: old.eklendi }
  const rec: ModelRec = { id, ad: file.name.replace(/\.glb$/i, ''), boyut: buf.byteLength, lisans: '', eklendi: new Date().toISOString(), buf }
  await d.put(STORE, rec)
  bump()
  return { id, ad: rec.ad, boyut: rec.boyut, lisans: rec.lisans, eklendi: rec.eklendi }
}

export async function listModels(): Promise<ModelMeta[]> {
  const all = (await (await db()).getAll(STORE)) as ModelRec[]
  return all.map(({ id, ad, boyut, lisans, eklendi }) => ({ id, ad, boyut, lisans, eklendi })).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'))
}

export async function getModelBuffer(id: string): Promise<ArrayBuffer | undefined> {
  return ((await (await db()).get(STORE, id)) as ModelRec | undefined)?.buf
}

export async function updateModelMeta(id: string, patch: Partial<Pick<ModelMeta, 'ad' | 'lisans'>>): Promise<void> {
  const d = await db()
  const rec = (await d.get(STORE, id)) as ModelRec | undefined
  if (!rec) return
  await d.put(STORE, { ...rec, ...patch })
  bump()
}

export async function deleteModel(id: string): Promise<void> {
  await (await db()).delete(STORE, id)
  const u = urlCache.get(id)
  if (u) URL.revokeObjectURL(u)
  urlCache.delete(id)
  pending.delete(id)
  bump()
}

const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

/** Modelin blob adresi (önbellekli). Kayıt yoksa null. */
export function modelUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id)
  if (hit) return Promise.resolve(hit)
  let p = pending.get(id)
  if (!p) {
    p = getModelBuffer(id).then((buf) => {
      if (!buf) return null
      const u = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }))
      urlCache.set(id, u)
      return u
    })
    pending.set(id, p)
  }
  return p
}

/** Model kimliğinin blob adresi; yüklenene kadar (veya kayıt yoksa) null. */
export function useModelUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(() => urlCache.get(id) ?? null)
  const v = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    let live = true
    if (!id) {
      setUrl(null)
      return
    }
    void modelUrl(id).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [id, v])
  return id ? url : null
}

/** Kütüphane listesi (yükleme/silme/yeniden adlandırma ile güncellenir). */
export function useModelList(): ModelMeta[] {
  const [list, setList] = useState<ModelMeta[]>([])
  const v = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    let live = true
    void listModels().then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [v])
  return list
}
