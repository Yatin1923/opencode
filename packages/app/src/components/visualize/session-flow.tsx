import { createMemo, For, Show } from "solid-js"
import type { Store } from "solid-js/store"
import type { State } from "@/context/global-sync/types"

// Agent colors
const AGENT_COLORS: Record<string, string> = {
  orchestrator: "#2A9D8F",
  planner: "#6366F1",
  "senior-developer": "#F59E0B",
  "test-engineer": "#10B981",
  "code-reviewer": "#06B6D4",
  "security-scanner": "#EF4444",
  "db-agent": "#F97316",
  "infra-agent": "#84CC16",
  "doc-agent": "#A78BFA",
  refactor: "#EC4899",
}

function getColor(id: string): string {
  if (AGENT_COLORS[id]) return AGENT_COLORS[id]
  if (id.startsWith("developer")) {
    const num = parseInt(id.replace(/\D/g, "")) || 0
    const colors = ["#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B"]
    return colors[num % colors.length]
  }
  return "#3B82F6"
}

export interface AgentNode {
  id: string
  name: string
  state: "idle" | "active" | "complete" | "error"
  task?: string
}

export interface DelegationEdge {
  from: string
  to: string
  active: boolean
}

export function extractFlow(store: Store<State>, sessionID: string): { nodes: AgentNode[]; edges: DelegationEdge[] } {
  const messages = store.message[sessionID]
  if (!messages) return { nodes: [], edges: [] }

  const nodes = new Map<string, AgentNode>()
  const edges: DelegationEdge[] = []
  const seenEdges = new Set<string>()

  for (const msg of messages) {
    const parts = store.part[msg.id]
    if (!parts) continue
    const agent = (msg as any).agent || "orchestrator"

    if (!nodes.has(agent)) {
      nodes.set(agent, { id: agent, name: formatName(agent), state: "idle" })
    }

    for (const part of parts) {
      if ((part as any).type !== "tool" || (part as any).tool !== "task") continue
      const input = (part as any).state?.input
      const subagent = input?.subagent_type || input?.agent || input?.description || "subagent"
      const normalized = subagent.toLowerCase().replace(/\s+/g, "-")

      if (!nodes.has(normalized)) {
        nodes.set(normalized, { id: normalized, name: formatName(normalized), state: "idle" })
      }

      const key = `${agent}->${normalized}`
      if (!seenEdges.has(key)) {
        seenEdges.add(key)
        edges.push({ from: agent, to: normalized, active: (part as any).state?.status === "running" })
      }

      const status = (part as any).state?.status
      if (status === "running") {
        nodes.get(normalized)!.state = "active"
        nodes.get(normalized)!.task = input?.description || input?.prompt?.slice(0, 60) || ""
      } else if (status === "completed") {
        nodes.get(normalized)!.state = "complete"
      } else if (status === "error") {
        nodes.get(normalized)!.state = "error"
      }
    }
  }

  if (nodes.size > 0 && ![...nodes.values()].some((n) => n.state === "active")) {
    const first = nodes.values().next().value!
    first.state = "active"
  }

  return { nodes: Array.from(nodes.values()), edges }
}

function formatName(id: string): string {
  return id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

// Layout: hierarchical BFS
function layoutNodes(nodes: AgentNode[], edges: DelegationEdge[]) {
  if (nodes.length === 0) return [] as AgentNode[][]
  const children = new Map<string, Set<string>>()
  const hasParent = new Set<string>()
  for (const e of edges) {
    if (!children.has(e.from)) children.set(e.from, new Set())
    children.get(e.from)!.add(e.to)
    hasParent.add(e.to)
  }
  const layers: AgentNode[][] = []
  const visited = new Set<string>()
  let queue = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id)
  if (queue.length === 0) queue = [nodes[0].id]

  while (queue.length > 0) {
    const layer: AgentNode[] = []
    const next: string[] = []
    for (const id of queue) {
      if (visited.has(id)) continue
      visited.add(id)
      const node = nodes.find((n) => n.id === id)
      if (node) layer.push(node)
      for (const child of children.get(id) || []) {
        if (!visited.has(child)) next.push(child)
      }
    }
    if (layer.length > 0) layers.push(layer)
    queue = next
  }
  const unvisited = nodes.filter((n) => !visited.has(n.id))
  if (unvisited.length > 0) layers.push(unvisited)
  return layers
}

const CARD_W = 130
const CARD_H = 50
const GAP_X = 14
const GAP_Y = 32

/**
 * Pure agent flow visualization — nodes + SVG edges. No outer card/header.
 * Used inside SessionNode.
 */
export function AgentFlowVisualization(props: {
  store: Store<State>
  sessionID: string
  onAgentClick?: (agentId: string) => void
}) {
  const flow = createMemo(() => extractFlow(props.store, props.sessionID))
  const layers = createMemo(() => layoutNodes(flow().nodes, flow().edges))
  const hasFlow = createMemo(() => flow().nodes.length > 0)

  const nodePositions = createMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    const ls = layers()
    for (let ly = 0; ly < ls.length; ly++) {
      const layer = ls[ly]
      const layerW = layer.length * CARD_W + (layer.length - 1) * GAP_X
      const offsetX = -layerW / 2
      for (let ni = 0; ni < layer.length; ni++) {
        pos.set(layer[ni].id, {
          x: offsetX + ni * (CARD_W + GAP_X) + CARD_W / 2,
          y: ly * (CARD_H + GAP_Y) + CARD_H / 2,
        })
      }
    }
    return pos
  })

  const svgW = createMemo(() => {
    const ls = layers()
    const maxW = Math.max(...ls.map((l) => l.length), 1)
    return maxW * CARD_W + (maxW - 1) * GAP_X + 30
  })
  const svgH = createMemo(() => layers().length * (CARD_H + GAP_Y) - GAP_Y + 10)

  return (
    <Show when={hasFlow()}>
      <div class="relative" style={{ "min-height": `${svgH()}px`, "min-width": `${svgW()}px` }}>
        {/* SVG edges */}
        <svg
          class="absolute inset-0 pointer-events-none"
          width={svgW()}
          height={svgH()}
          style={{ left: "50%", transform: "translateX(-50%)" }}
        >
          <defs>
            <marker id="viz-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#374151" />
            </marker>
            <marker id="viz-arrow-active" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#2A9D8F" />
            </marker>
          </defs>
          <For each={flow().edges}>
            {(edge) => {
              const fromPos = () => nodePositions().get(edge.from)
              const toPos = () => nodePositions().get(edge.to)
              return (
                <Show when={fromPos() && toPos()}>
                  {(() => {
                    const fx = () => fromPos()!.x + svgW() / 2
                    const fy = () => fromPos()!.y + CARD_H / 2
                    const tx = () => toPos()!.x + svgW() / 2
                    const ty = () => toPos()!.y - CARD_H / 2
                    const midY = () => (fy() + ty()) / 2
                    const d = () => `M ${fx()} ${fy()} C ${fx()} ${midY()}, ${tx()} ${midY()}, ${tx()} ${ty()}`
                    return (
                      <path
                        d={d()}
                        fill="none"
                        stroke={edge.active ? "#2A9D8F" : "#374151"}
                        stroke-width={edge.active ? 1.5 : 1}
                        stroke-dasharray={edge.active ? "6 3" : "3 2"}
                        marker-end={edge.active ? "url(#viz-arrow-active)" : "url(#viz-arrow)"}
                        style={{
                          filter: edge.active ? "drop-shadow(0 0 4px #2A9D8F50)" : "none",
                          animation: edge.active ? "dashFlow 1s linear infinite" : "none",
                        }}
                      />
                    )
                  })()}
                </Show>
              )
            }}
          </For>
        </svg>

        {/* Agent node cards */}
        <div class="relative flex flex-col items-center" style={{ gap: `${GAP_Y}px` }}>
          <For each={layers()}>
            {(layer) => (
              <div class="flex items-start justify-center" style={{ gap: `${GAP_X}px` }}>
                <For each={layer}>
                  {(node) => (
                    <button
                      class="rounded-md overflow-hidden transition-all duration-200 hover:scale-105 cursor-pointer"
                      style={{
                        width: `${CARD_W}px`,
                        height: `${CARD_H}px`,
                        "background-color": node.state === "active" ? `${getColor(node.id)}12` : "#111827",
                        border: `1px solid ${node.state === "active" ? getColor(node.id) : node.state === "complete" ? `${getColor(node.id)}55` : node.state === "error" ? "#EF444488" : "#1f2937"}`,
                        "box-shadow": node.state === "active" ? `0 0 16px ${getColor(node.id)}30` : "none",
                      }}
                      onClick={(e) => { e.stopPropagation(); props.onAgentClick?.(node.id) }}
                      title={`Click to see ${node.name}'s thinking process`}
                    >
                      <div class="px-2 py-1.5 text-left">
                        <div class="flex items-center gap-1.5">
                          <div
                            class="w-2 h-2 rounded-full shrink-0"
                            style={{
                              "background-color": node.state === "active" ? getColor(node.id) : node.state === "complete" ? "#22C55E" : node.state === "error" ? "#EF4444" : "#374151",
                              "box-shadow": node.state === "active" ? `0 0 6px ${getColor(node.id)}` : "none",
                              animation: node.state === "active" ? "pulse 1.5s infinite" : "none",
                            }}
                          />
                          <span class="text-[9px] font-semibold truncate" style={{ color: node.state === "idle" ? "#6B7280" : getColor(node.id) }}>
                            {node.name}
                          </span>
                          <Show when={node.state === "complete"}>
                            <span class="text-[7px] ml-auto text-green-400">&#10003;</span>
                          </Show>
                          <Show when={node.state === "error"}>
                            <span class="text-[7px] ml-auto text-red-400">&#10007;</span>
                          </Show>
                        </div>
                        <Show when={node.task}>
                          <p class="text-[7px] text-gray-500 mt-0.5 truncate pl-3.5">{node.task}</p>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

// Re-export for backward compat
export { extractFlow as extractSessionFlow }
