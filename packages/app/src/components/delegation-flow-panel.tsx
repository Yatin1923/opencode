import { createMemo, createSignal, For, Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSync } from "@/context/sync"

// Agent colors (matching crewup)
const AGENT_COLORS: Record<string, string> = {
  orchestrator: "#8B5CF6",
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
const DEFAULT_COLOR = "#3B82F6"

function getAgentColor(id: string): string {
  if (AGENT_COLORS[id]) return AGENT_COLORS[id]
  // For developer-N agents, cycle through colors
  if (id.startsWith("developer")) {
    const num = parseInt(id.replace(/\D/g, "")) || 0
    const devColors = ["#3B82F6", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B"]
    return devColors[num % devColors.length]
  }
  return DEFAULT_COLOR
}

// Types
interface AgentNode {
  id: string
  name: string
  role: string
  state: "idle" | "active" | "complete" | "error"
  task?: string
}

interface DelegationEdge {
  from: string
  to: string
  active: boolean
}

function formatAgentName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function getAgentRole(id: string): string {
  const roles: Record<string, string> = {
    orchestrator: "Tech Lead",
    planner: "Planner",
    "senior-developer": "Senior Dev",
    "test-engineer": "Test Engineer",
    "code-reviewer": "Code Reviewer",
    "security-scanner": "Security",
    "db-agent": "Database",
    "infra-agent": "Infrastructure",
    "doc-agent": "Documentation",
    refactor: "Refactoring",
  }
  if (roles[id]) return roles[id]
  if (id.startsWith("developer")) return "Developer"
  return "Agent"
}

// Extract delegation data from session messages
function extractFlow(messages: any[]): { nodes: AgentNode[]; edges: DelegationEdge[] } {
  const nodes = new Map<string, AgentNode>()
  const edges: DelegationEdge[] = []
  const seenEdges = new Set<string>()

  for (const msg of messages) {
    if (!msg.parts) continue
    const agent = msg.info?.agent || "orchestrator"

    if (!nodes.has(agent)) {
      nodes.set(agent, { id: agent, name: formatAgentName(agent), role: getAgentRole(agent), state: "idle" })
    }

    for (const part of msg.parts) {
      if (part.type !== "tool" || part.tool !== "task") continue

      const input = part.state?.input
      const subagent = input?.subagent_type || input?.agent || input?.description || "subagent"
      const normalizedAgent = subagent.toLowerCase().replace(/\s+/g, "-")

      if (!nodes.has(normalizedAgent)) {
        nodes.set(normalizedAgent, {
          id: normalizedAgent,
          name: formatAgentName(normalizedAgent),
          role: getAgentRole(normalizedAgent),
          state: "idle",
        })
      }

      const edgeKey = `${agent}->${normalizedAgent}`
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey)
        edges.push({ from: agent, to: normalizedAgent, active: part.state?.status === "running" })
      }

      // Update states
      if (part.state?.status === "running") {
        nodes.get(agent)!.state = "idle"
        const child = nodes.get(normalizedAgent)!
        child.state = "active"
        child.task = input?.description || input?.prompt?.slice(0, 60) || ""
      } else if (part.state?.status === "completed") {
        nodes.get(normalizedAgent)!.state = "complete"
        nodes.get(agent)!.state = "active"
      } else if (part.state?.status === "error") {
        nodes.get(normalizedAgent)!.state = "error"
      }
    }
  }

  // If only orchestrator exists and no delegations happened, mark as active
  if (nodes.size > 0) {
    const hasActive = [...nodes.values()].some((n) => n.state === "active")
    if (!hasActive) {
      const first = nodes.values().next().value!
      first.state = "active"
    }
  }

  return { nodes: Array.from(nodes.values()), edges }
}

// Layout: simple hierarchical (root at top, children below)
function layoutNodes(nodes: AgentNode[], edges: DelegationEdge[]) {
  if (nodes.length === 0) return { layers: [] as AgentNode[][], width: 0 }

  const children = new Map<string, Set<string>>()
  const hasParent = new Set<string>()
  for (const edge of edges) {
    if (!children.has(edge.from)) children.set(edge.from, new Set())
    children.get(edge.from)!.add(edge.to)
    hasParent.add(edge.to)
  }

  // BFS layers
  const layers: AgentNode[][] = []
  const visited = new Set<string>()
  const roots = nodes.filter((n) => !hasParent.has(n.id))
  if (roots.length === 0) roots.push(nodes[0])

  let queue = roots.map((n) => n.id)
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

  // Add unvisited nodes
  const unvisited = nodes.filter((n) => !visited.has(n.id))
  if (unvisited.length > 0) layers.push(unvisited)

  const maxLayerWidth = Math.max(...layers.map((l) => l.length))
  return { layers, width: maxLayerWidth }
}

// Agent Card Component (matching crewup style)
function AgentCard(props: { node: AgentNode }) {
  const color = () => getAgentColor(props.node.id)
  const state = () => props.node.state

  return (
    <div
      class="relative rounded-lg overflow-hidden transition-all duration-300"
      style={{
        width: "170px",
        "min-height": "75px",
        "background-color": state() === "active" ? `${color()}15` : state() === "complete" ? `${color()}08` : "#111827",
        border: `1.5px solid ${state() === "active" ? color() : state() === "complete" ? `${color()}66` : state() === "error" ? "#EF4444" : "#1f2937"}`,
        "box-shadow": state() === "active" ? `0 0 24px ${color()}50, 0 0 48px ${color()}20` : "none",
        animation: state() === "active" ? "cardPulse 2s ease-in-out infinite" : "none",
      }}
    >
      {/* Left accent bar */}
      <div
        class="absolute left-0 top-0 bottom-0 w-1"
        style={{ "background-color": state() === "idle" ? `${color()}33` : color() }}
      />

      {/* Content */}
      <div class="pl-3.5 pr-3 py-2.5">
        <div class="flex items-center gap-2">
          {/* Status dot */}
          <div
            class="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              "background-color":
                state() === "active" ? color() : state() === "complete" ? "#22C55E" : state() === "error" ? "#EF4444" : "#374151",
              "box-shadow": state() === "active" ? `0 0 8px ${color()}` : "none",
              animation: state() === "active" ? "dotPulse 1.5s ease-in-out infinite" : "none",
            }}
          />
          {/* Agent name */}
          <span
            class="text-xs font-bold leading-tight truncate"
            style={{
              color: state() === "idle" ? "#6B7280" : state() === "error" ? "#EF4444" : color(),
            }}
          >
            {props.node.name}
          </span>
          {/* Status indicators */}
          <Show when={state() === "complete"}>
            <span class="text-[10px] ml-auto" style={{ color: "#22C55E" }}>✓</span>
          </Show>
          <Show when={state() === "error"}>
            <span class="text-[10px] ml-auto text-red-500">✗</span>
          </Show>
        </div>
        {/* Role */}
        <p class="text-[10px] text-gray-500 mt-0.5 truncate pl-4">{props.node.role}</p>
        {/* Current task */}
        <Show when={props.node.task}>
          <p
            class="text-[9px] mt-1.5 pl-4 truncate"
            style={{ color: state() === "active" ? `${color()}cc` : "#4B5563" }}
          >
            {props.node.task}
          </p>
        </Show>
      </div>
    </div>
  )
}

// SVG Edge with curved path
function FlowEdge(props: {
  fromX: number
  fromY: number
  toX: number
  toY: number
  active: boolean
  color: string
}) {
  const path = createMemo(() => {
    const { fromX, fromY, toX, toY } = props
    const midY = (fromY + toY) / 2
    return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`
  })

  return (
    <path
      d={path()}
      fill="none"
      stroke={props.active ? props.color : "#374151"}
      stroke-width={props.active ? 2 : 1.5}
      stroke-dasharray={props.active ? "none" : "4 2"}
      marker-end={props.active ? "url(#arrow-active)" : "url(#arrow)"}
      style={{ filter: props.active ? `drop-shadow(0 0 4px ${props.color}50)` : "none" }}
    />
  )
}

// Main panel
export function DelegationFlowPanel(props: { sessionID?: string }) {
  const sync = useSync()
  const [collapsed, setCollapsed] = createSignal(false)

  const messages = createMemo(() => {
    if (!props.sessionID) return []
    const sessionMessages = sync.data.message[props.sessionID]
    if (!sessionMessages) return []
    return sessionMessages.map((msg) => {
      const parts = sync.data.part[msg.id]
      return { info: msg, parts: parts || [] }
    })
  })

  const flow = createMemo(() => extractFlow(messages()))
  const { layers: flowLayers } = (() => {
    const result = createMemo(() => layoutNodes(flow().nodes, flow().edges))
    return { layers: () => result().layers }
  })()

  const hasFlow = createMemo(() => flow().nodes.length > 1)

  // Card positions for edge rendering
  const CARD_W = 170
  const CARD_H = 75
  const GAP_X = 24
  const GAP_Y = 48

  const nodePositions = createMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    const layers = flowLayers()
    for (let ly = 0; ly < layers.length; ly++) {
      const layer = layers[ly]
      const layerW = layer.length * CARD_W + (layer.length - 1) * GAP_X
      const offsetX = -layerW / 2
      for (let ni = 0; ni < layer.length; ni++) {
        const x = offsetX + ni * (CARD_W + GAP_X) + CARD_W / 2
        const y = ly * (CARD_H + GAP_Y) + CARD_H / 2
        positions.set(layer[ni].id, { x, y })
      }
    }
    return positions
  })

  const svgWidth = createMemo(() => {
    const layers = flowLayers()
    const maxW = Math.max(...layers.map((l) => l.length), 1)
    return maxW * CARD_W + (maxW - 1) * GAP_X + 60
  })

  const svgHeight = createMemo(() => {
    const layers = flowLayers()
    return layers.length * (CARD_H + GAP_Y) - GAP_Y + 20
  })

  return (
    <Show when={hasFlow()}>
      {/* Inject keyframes */}
      <style>{`
        @keyframes cardPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        @keyframes dotPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }
      `}</style>

      <div data-component="delegation-flow-panel" class="border-b border-border-weaker-base bg-[#0a0a0f]">
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2">
          <div class="flex items-center gap-2.5">
            <div class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span class="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
              Agent Flow
            </span>
            <span class="text-[10px] text-gray-600">
              {flow().nodes.length} agents
            </span>
          </div>
          <IconButton
            icon="chevron-down"
            variant="ghost"
            class={`h-5 w-5 transition-transform ${collapsed() ? "" : "rotate-180"}`}
            onClick={() => setCollapsed(!collapsed())}
          />
        </div>

        {/* Flow visualization */}
        <Show when={!collapsed()}>
          <div class="overflow-x-auto overflow-y-hidden px-4 pb-4">
            <div class="relative" style={{ "min-height": `${svgHeight() + 10}px` }}>
              {/* SVG edges layer */}
              <svg
                class="absolute inset-0 pointer-events-none"
                width={svgWidth()}
                height={svgHeight() + 10}
                style={{ left: "50%", transform: "translateX(-50%)" }}
              >
                <defs>
                  <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#374151" />
                  </marker>
                  <marker id="arrow-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#3B82F6" />
                  </marker>
                </defs>
                <For each={flow().edges}>
                  {(edge) => {
                    const fromPos = () => nodePositions().get(edge.from)
                    const toPos = () => nodePositions().get(edge.to)
                    return (
                      <Show when={fromPos() && toPos()}>
                        <FlowEdge
                          fromX={fromPos()!.x + svgWidth() / 2}
                          fromY={fromPos()!.y + CARD_H / 2}
                          toX={toPos()!.x + svgWidth() / 2}
                          toY={toPos()!.y - CARD_H / 2}
                          active={edge.active}
                          color={getAgentColor(edge.from)}
                        />
                      </Show>
                    )
                  }}
                </For>
              </svg>

              {/* Card layers */}
              <div class="relative flex flex-col items-center" style={{ gap: `${GAP_Y}px` }}>
                <For each={flowLayers()}>
                  {(layer) => (
                    <div class="flex items-start justify-center" style={{ gap: `${GAP_X}px` }}>
                      <For each={layer}>
                        {(node) => <AgentCard node={node} />}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
