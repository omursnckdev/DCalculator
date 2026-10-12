import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { EQUIPMENT } from '../library/equipment'
import { EQUIPMENT_TYPES } from '../model/types'
import type { EquipmentType } from '../model/types'
import { useStore } from '../store/useStore'
import { EquipmentNodeView } from './EquipmentNodeView'
import { LineEdgeView } from './LineEdgeView'
import { DND_MIME, Palette } from './Palette'

const nodeTypes = { equipment: EquipmentNodeView }
const edgeTypes = { line: LineEdgeView }
const GRID = 20

const GROUP_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#65a30d']
const hashStr = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Aynı grup adlı ekipmanın çevresine renkli, yarı saydam bir çerçeve ve etiket çizer (akış koordinatlarında). */
function GroupBoxes() {
  const nodes = useStore((s) => s.nodes)
  const boxes = useMemo(() => {
    const m = new Map<string, { x0: number; y0: number; x1: number; y1: number }>()
    for (const n of nodes) {
      const g = n.data.grup?.trim()
      if (!g) continue
      const w = n.measured?.width ?? n.width ?? 60
      const h = n.measured?.height ?? n.height ?? 60
      const b = m.get(g) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
      b.x0 = Math.min(b.x0, n.position.x)
      b.y0 = Math.min(b.y0, n.position.y)
      b.x1 = Math.max(b.x1, n.position.x + w)
      b.y1 = Math.max(b.y1, n.position.y + h)
      m.set(g, b)
    }
    return [...m.entries()].map(([name, b]) => ({ name, ...b, color: GROUP_COLORS[hashStr(name) % GROUP_COLORS.length] }))
  }, [nodes])
  return (
    <ViewportPortal>
      {boxes.map((b) => (
        <div
          key={b.name}
          style={{
            position: 'absolute',
            transform: `translate(${b.x0 - 14}px, ${b.y0 - 26}px)`,
            width: b.x1 - b.x0 + 28,
            height: b.y1 - b.y0 + 40,
            border: `2px dashed ${b.color}`,
            background: `${b.color}0d`,
            borderRadius: 10,
            pointerEvents: 'none',
          }}
        >
          <span style={{ position: 'absolute', left: 8, top: 2, fontSize: 12, fontWeight: 600, color: b.color }}>{b.name}</span>
        </div>
      ))}
    </ViewportPortal>
  )
}

/** Ad, etiket veya gruba göre ekipman arar; seçince şemada o ekipmana gider (Ctrl+K). */
function NodeSearch() {
  const nodes = useStore((s) => s.nodes)
  const selectNode = useStore((s) => s.selectNode)
  const { fitView } = useReactFlow()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const t = q.trim().toLocaleLowerCase('tr')
    if (!t) return []
    return nodes
      .filter((n) => `${n.data.ad} ${n.data.etiket} ${n.data.grup}`.toLocaleLowerCase('tr').includes(t))
      .slice(0, 8)
  }, [nodes, q])

  const go = (id: string) => {
    selectNode(id)
    void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.2, padding: 1.5 })
    setOpen(false)
    setQ('')
    ref.current?.blur()
  }

  return (
    <div className="relative ml-2">
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].id)
          if (e.key === 'Escape') {
            setQ('')
            ref.current?.blur()
          }
        }}
        placeholder={tr.canvas.searchPlaceholder}
        aria-label={tr.canvas.searchPlaceholder}
        className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm"
      />
      {open && q.trim() && (
        <ul className="absolute left-0 top-full z-10 mt-1 max-h-64 w-72 overflow-auto rounded border border-slate-300 bg-white text-xs shadow-lg">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-slate-500">{tr.canvas.noMatch}</li>
          ) : (
            results.map((n) => (
              <li key={n.id}>
                <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-100" onMouseDown={(e) => e.preventDefault()} onClick={() => go(n.id)}>
                  <span className="truncate font-medium">{n.data.ad}</span>
                  <span className="ml-auto shrink-0 text-slate-400">{EQUIPMENT[n.data.kind].label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function CanvasInner() {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const onNodesChange = useStore((s) => s.onNodesChange)
  const onEdgesChange = useStore((s) => s.onEdgesChange)
  const onConnect = useStore((s) => s.onConnect)
  const isValidConnection = useStore((s) => s.isValidConnection)
  const addNode = useStore((s) => s.addNode)
  const viewTick = useStore((s) => s.viewTick)
  const nodeView = useStore((s) => s.nodeView)
  const setNodeView = useStore((s) => s.setNodeView)
  const flowAnim = useStore((s) => s.flowAnim)
  const setFlowAnim = useStore((s) => s.setFlowAnim)
  const { screenToFlowPosition, getViewport, fitView } = useReactFlow()
  const [selectBox, setSelectBox] = useState(false)
  const [showGroups, setShowGroups] = useState(true)

  // Proje yüklenince çizimi görünür alana sığdır. fitView kimliği değişebildiği
  // için ref üzerinden çağrılır; yoksa her düğüm eklemede görünüm kayar.
  const fitRef = useRef(fitView)
  fitRef.current = fitView
  useEffect(() => {
    // Boş çizimde sığdıracak bir şey yok (ve ilk düğüm eklenirken görünüm kaymasın).
    if (useStore.getState().nodes.length === 0) return
    const t = setTimeout(() => void fitRef.current({ padding: 0.2, maxZoom: 1 }), 50)
    return () => clearTimeout(t)
  }, [viewTick])

  const snap = (v: number) => Math.round(v / GRID) * GRID

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData(DND_MIME) as EquipmentType
      if (!EQUIPMENT_TYPES.includes(type)) return
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNode(type, snap(p.x), snap(p.y))
    },
    [addNode, screenToFlowPosition],
  )

  // Paletten tıklayınca: görünür alanın ortasına, üst üste binmemesi için kademeli koy.
  const addAtCenter = useCallback(
    (type: EquipmentType) => {
      const { x, y, zoom } = getViewport()
      const offset = (useStore.getState().nodes.length % 8) * GRID
      const cx = (window.innerWidth / 2 - 240 - x) / zoom
      const cy = (window.innerHeight / 2 - 120 - y) / zoom
      addNode(type, snap(cx + offset), snap(cy + offset))
    },
    [addNode, getViewport],
  )

  return (
    <>
      <Palette onAdd={addAtCenter} />
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          selectionOnDrag={selectBox}
          panOnDrag={selectBox ? [1, 2] : true}
          selectionMode={SelectionMode.Partial}
          snapToGrid
          snapGrid={[GRID, GRID]}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={GRID} />
          {showGroups && <GroupBoxes />}
          <Panel position="top-left">
            <div className="flex items-center">
            <div role="group" aria-label={tr.nodeView.title} className="flex overflow-hidden rounded border border-slate-300 bg-white text-xs shadow-sm">
              {(['icon', 'card'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setNodeView(v)}
                  aria-pressed={nodeView === v}
                  className={`px-2.5 py-1 ${nodeView === v ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {tr.nodeView[v]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFlowAnim(!flowAnim)}
              aria-pressed={flowAnim}
              className={`ml-2 rounded border px-2.5 py-1 text-xs shadow-sm ${flowAnim ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {tr.sim.flowAnim} {flowAnim ? '▶' : '❚❚'}
            </button>
            <button
              type="button"
              onClick={() => setSelectBox(!selectBox)}
              aria-pressed={selectBox}
              title={tr.canvas.selectBoxHint}
              className={`ml-2 rounded border px-2.5 py-1 text-xs shadow-sm ${selectBox ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              ▭ {tr.canvas.selectBox}
            </button>
            <button
              type="button"
              onClick={() => setShowGroups(!showGroups)}
              aria-pressed={showGroups}
              className={`ml-2 rounded border px-2.5 py-1 text-xs shadow-sm ${showGroups ? 'border-slate-500 bg-slate-100' : 'border-slate-300 bg-white text-slate-500'}`}
            >
              {tr.canvas.groups}
            </button>
            <NodeSearch />
            </div>
          </Panel>
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => EQUIPMENT[(n.data as { kind: EquipmentType }).kind].color}
          />
        </ReactFlow>
      </div>
    </>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
