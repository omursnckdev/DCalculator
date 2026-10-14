import { useRef, useState } from 'react'
import xmUrl from '../assets/models/socomec-delphys-xm.glb?url'
import xmCabUrl from '../assets/models/socomec-delphys-xm-yan-kabin.glb?url'
import { MODEL_KEYS, modelSearchUrl, modelSpecOf, nativeBox } from '../layout3d/customModel'
import { presetsFor } from '../layout3d/presetModels'
import type { PresetModel } from '../layout3d/presetModels'
import { tr } from '../i18n/tr'
import { deleteModel, saveModel, updateModelMeta, useModelList } from '../store/modelStore'
import { useStore } from '../store/useStore'
import type { EquipmentNode } from '../model/types'

const PRESET_URL: Record<string, string> = { 'socomec-delphys-xm': xmUrl, 'socomec-delphys-xm-yan-kabin': xmCabUrl }
const sel = 'w-full rounded border border-slate-300 px-1.5 py-1 text-xs'
const btn = 'rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50'

/** Seçili ekipmana özel (GLB) 3D model atama: yükle, ata, sığdırma/dönüş, gerçek boyut, türe uygula, kaynak/lisans notu. */
export function ModelSection({ node }: { node: EquipmentNode }) {
  const M = tr.v3d.model
  const models = useModelList()
  const setParam = useStore((s) => s.updateNodeParam)
  const setLayout = useStore((s) => s.setLayout3d)
  const nodes = useStore((s) => s.nodes)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const spec = modelSpecOf(node.data.params)
  const current = models.find((m) => m.id === spec?.id)

  const assign = (ids: string[], key: keyof typeof MODEL_KEYS, value: string | number) => {
    for (const id of ids) setParam(id, MODEL_KEYS[key], value)
  }
  const presets = presetsFor(node.data.kind)
  const usePreset = async (p: PresetModel) => {
    setMsg(M.measuring)
    try {
      const blob = await (await fetch(PRESET_URL[p.key])).blob()
      const m = await saveModel(new File([blob], `${p.ad}.glb`, { type: 'model/gltf-binary' }))
      await updateModelMeta(m.id, { lisans: p.lisans })
      assign([node.id], 'id', m.id)
      assign([node.id], 'fit', 'gerdir')
      assign([node.id], 'rot', 0)
      setLayout({ [node.id]: { g: p.g, d: p.d, y: p.y } })
      setMsg(M.presetDone(p.ad, p.g, p.d, p.y))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : M.failed)
    }
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const m = await saveModel(f)
      assign([node.id], 'id', m.id)
      setMsg(M.loaded(m.ad))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : M.failed)
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const realSize = async () => {
    if (!spec) return
    setMsg(M.measuring)
    try {
      const { modelBounds } = await import('../ui3d/modelBounds')
      const s = await modelBounds(spec.id)
      if (!s) return setMsg(M.failed)
      const b = nativeBox(s, spec.rot)
      setLayout({ [node.id]: { g: b.g, d: b.d, y: b.y } })
      setMsg(M.sized(b.g, b.d, b.y))
    } catch {
      setMsg(M.failed)
    }
  }
  const applyToType = () => {
    if (!spec) return
    const same = nodes.filter((n) => n.data.kind === node.data.kind).map((n) => n.id)
    for (const id of same) {
      setParam(id, MODEL_KEYS.id, spec.id)
      setParam(id, MODEL_KEYS.fit, spec.fit)
      setParam(id, MODEL_KEYS.rot, spec.rot)
    }
    setMsg(M.appliedType(same.length))
  }

  return (
    <details className="mb-3 rounded border border-slate-200 p-2" open={!!spec}>
      <summary className="cursor-pointer text-xs font-semibold">{M.title}</summary>
      <p className="mt-1 text-[11px] text-slate-500">{M.hint}</p>
      <label className="mt-2 block text-xs text-slate-500">
        {M.pick}
        <select className={sel} value={spec?.id ?? ''} onChange={(e) => assign([node.id], 'id', e.target.value)}>
          <option value="">{M.builtin}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.ad} ({(m.boyut / 1024 / 1024).toFixed(1)} MB)
            </option>
          ))}
        </select>
      </label>
      {presets.length > 0 && (
        <label className="mt-2 block text-xs text-slate-500">
          {M.preset}
          <select className={sel} value="" onChange={(e) => { const p = presets.find((x) => x.key === e.target.value); if (p) void usePreset(p) }}>
            <option value="">{M.presetPick}</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.ad} — {p.g} × {p.d} × {p.y} m
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          {M.upload}
        </button>
        <a className={`${btn} text-blue-700`} href={modelSearchUrl(node.data.kind)} target="_blank" rel="noopener noreferrer" title={M.findHint}>
          {M.find} ↗
        </a>
        <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {spec && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              {M.fit}
              <select className={sel} value={spec.fit} onChange={(e) => assign([node.id], 'fit', e.target.value)}>
                <option value="gerdir">{M.fitStretch}</option>
                <option value="oran">{M.fitRatio}</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              {M.rot}
              <select className={sel} value={spec.rot} onChange={(e) => assign([node.id], 'rot', Number(e.target.value))}>
                {[0, 90, 180, 270].map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <button type="button" className={btn} onClick={() => void realSize()} title={M.sizeHint}>
              {M.size}
            </button>
            <button type="button" className={btn} onClick={applyToType}>
              {M.applyType}
            </button>
            <button type="button" className={`${btn} text-red-600`} onClick={() => assign([node.id], 'id', '')}>
              {M.clear}
            </button>
          </div>
        </>
      )}
      {current && (
        <div className="mt-2 border-t border-slate-100 pt-1">
          <label className="block text-xs text-slate-500">
            {M.license}
            <input className={sel} defaultValue={current.lisans} key={current.id} placeholder={M.licensePh} onBlur={(e) => void updateModelMeta(current.id, { lisans: e.target.value })} />
          </label>
          <button
            type="button"
            className="mt-1 text-[11px] text-red-600 underline"
            onClick={() => {
              if (confirm(M.deleteConfirm(current.ad))) void deleteModel(current.id)
            }}
          >
            {M.delete}
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-[11px] font-medium text-emerald-700">{msg}</p>}
    </details>
  )
}
