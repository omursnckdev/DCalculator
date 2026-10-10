import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
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
          snapToGrid
          snapGrid={[GRID, GRID]}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={GRID} />
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
