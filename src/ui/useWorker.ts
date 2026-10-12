import { useEffect, useState } from 'react'
import type { WorkerRequest, WorkerResponse, WorkerResult } from '../engine/worker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: WorkerResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id)
      if (!p) return
      pending.delete(ev.data.id)
      if ('error' in ev.data) p.reject(new Error(ev.data.error))
      else p.resolve(ev.data.result)
    }
  }
  return worker
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Req = DistOmit<WorkerRequest, 'id'>

/** Ağır bir hesabı worker'a gönderir; sonuç gelene kadar bekler. */
export function runInWorker<R extends WorkerResult>(req: Req): Promise<R> {
  const id = ++seq
  return new Promise<R>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: WorkerResult) => void, reject })
    getWorker().postMessage({ ...req, id } as WorkerRequest)
  })
}

/** Worker sonucu hook'u: `deps` değişince yeniden hesaplanır; eski sonuç yenisi gelene kadar görünür kalır. */
export function useWorkerResult<R extends WorkerResult>(req: Req, deps: unknown[]): { value: R | null; busy: boolean; error: string | null } {
  const [value, setValue] = useState<R | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setBusy(true)
    runInWorker<R>(req)
      .then((r) => {
        if (!alive) return
        setValue(r)
        setError(null)
        setBusy(false)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setBusy(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { value, busy, error }
}
