import { createMemo, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useSync } from "@/context/sync"

// A horizontal flow visualization for an orchestrator session and its delegated subagents.
// Recursively renders parent -> children -> grandchildren as connected columns,
// so users can see the full delegation pipeline at a glance.

type Node = { session: Session; children: Node[] }

const WARNING_COLOR = "var(--color-status-warning, #E9C46A)"
const SUCCESS_COLOR = "var(--color-status-success, #2A9D8F)"

function statusColor(type: string) {
  if (type === "busy") return SUCCESS_COLOR
  if (type === "retry") return WARNING_COLOR
  if (type === "error") return "var(--color-status-error, #E76F51)"
  return "var(--color-text-weak)"
}

function statusLabel(type: string) {
  if (type === "busy") return "running"
  if (type === "retry") return "retrying"
  return type
}

function formatRelative(ts?: number) {
  if (!ts) return ""
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function cleanTitle(s: Session) {
  const t = s.title || "Untitled"
  return t.replace(/\s*\(@[^)]+\s+subagent\)\s*$/, "")
}

function agentName(s: Session) {
  if (s.agent) return s.agent
  const m = (s.title || "").match(/\(@([^)]+?)\s+subagent\)/)
  return m?.[1] || "agent"
}

// Attention type: question/permission need user input, completed means idle + unviewed.
type AttentionKind = "question" | "permission" | "completed" | false

export function OrchestratorFlow(props: {
  root: Session
  onOpen?: (sessionID: string) => void
  onStop?: (sessionID: string) => void
  onDelete?: (sessionID: string) => void
  idledAt?: Map<string, number>
  flowViewedAt?: Map<string, number>
}) {
  const sync = useSync()
  const navigate = useNavigate()
  const params = useParams()
  const open = (id: string) => {
    if (props.onOpen) props.onOpen(id)
    else navigate(`/${params.dir}/session/${id}`)
  }

  const tree = createMemo<Node>(() => {
    const sessions = sync.data.session ?? []
    const byParent = new Map<string, Session[]>()
    for (const s of sessions) {
      if (!s.parentID) continue
      const arr = byParent.get(s.parentID)
      if (arr) arr.push(s)
      else byParent.set(s.parentID, [s])
    }
    const build = (s: Session): Node => ({
      session: s,
      children: (byParent.get(s.id) ?? [])
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
        .map(build),
    })
    return build(props.root)
  })

  const totalAgents = createMemo(() => {
    let count = 0
    const walk = (n: Node) => {
      count += 1
      n.children.forEach(walk)
    }
    walk(tree())
    return count
  })

  const anyBusy = createMemo(() => {
    const status = sync.data.session_status
    let busy = false
    const walk = (n: Node) => {
      if (busy) return
      const t = status[n.session.id]?.type
      if (t === "busy" || t === "retry") {
        busy = true
        return
      }
      n.children.forEach(walk)
    }
    walk(tree())
    return busy
  })

  // Check the highest-priority attention across the flow:
  // question > permission > completed (idle after busy, not yet viewed)
  const flowAttention = createMemo<AttentionKind>(() => {
    const questions = sync.data.question
    const permissions = sync.data.permission
    const idled = props.idledAt ?? new Map()
    const viewed = props.flowViewedAt?.get(props.root.id)
    let hasPermission = false
    let hasCompleted = false
    let hasQuestion = false
    const walk = (n: Node) => {
      if (hasQuestion) return
      const id = n.session.id
      if ((questions[id]?.length ?? 0) > 0) { hasQuestion = true; return }
      if ((permissions[id]?.length ?? 0) > 0) hasPermission = true
      const ts = idled.get(id)
      if (ts !== undefined && (viewed === undefined || viewed < ts)) hasCompleted = true
      n.children.forEach(walk)
    }
    walk(tree())
    if (hasQuestion) return "question"
    if (hasPermission) return "permission"
    if (hasCompleted) return "completed"
    return false
  })

  const flowAttentionColor = () => {
    const a = flowAttention()
    if (a === "question" || a === "permission") return WARNING_COLOR
    if (a === "completed") return SUCCESS_COLOR
    return null
  }

  const flowAttentionLabel = () => {
    const a = flowAttention()
    if (a === "question") return "Needs answer"
    if (a === "permission") return "Needs approval"
    if (a === "completed") return "Task complete"
    return null
  }

  return (
    <div
      class="rounded-lg border bg-background-strong p-4 flex flex-col gap-3 transition-colors"
      classList={{ "border-border-base": !flowAttention() }}
      style={flowAttentionColor() ? { "border-color": flowAttentionColor()! } : undefined}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <div
            class="size-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(42,157,140,0.15)", color: "#2A9D8F" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
          </div>
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-13-medium text-text-strong truncate">{cleanTitle(props.root)}</span>
              <Show when={flowAttention()}>
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-10-medium shrink-0"
                  style={{ background: `${flowAttentionColor()!}20`, color: flowAttentionColor()! }}
                >
                  <span
                    class="size-1.5 rounded-full oc-flow-dot-pulse"
                    style={{ background: flowAttentionColor()! }}
                  />
                  {flowAttentionLabel()}
                </span>
              </Show>
            </div>
            <span class="text-11-regular text-text-weak">
              Orchestrator · {totalAgents()} agent{totalAgents() === 1 ? "" : "s"} · {formatRelative(props.root.time?.updated)}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={anyBusy() && props.onStop}>
            <button
              type="button"
              aria-label="Stop flow"
              title="Stop all agents in this flow"
              onClick={(e) => {
                e.stopPropagation()
                props.onStop?.(props.root.id)
              }}
              class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-11-medium text-text-weak hover:text-status-warning hover:bg-background-base border border-border-base transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
              Stop
            </button>
          </Show>
          <Show when={props.onDelete}>
            <button
              type="button"
              aria-label="Delete flow"
              title="Delete this flow and all subagent sessions"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete this orchestrator flow and all ${totalAgents()} session${totalAgents() === 1 ? "" : "s"}?`)) {
                  props.onDelete?.(props.root.id)
                }
              }}
              class="inline-flex items-center gap-1 px-2 h-7 rounded-md text-11-medium text-text-weak hover:text-status-error hover:bg-background-base border border-border-base transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M2 4h12M6 4V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V4M4 4l.5 9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4" />
              </svg>
              Delete
            </button>
          </Show>
        </div>
      </div>

      <div class="overflow-x-auto -mx-4 px-4">
        <FlowColumns
          node={tree()}
          depth={0}
          onOpen={open}
          idledAt={props.idledAt}
          flowViewedAt={props.flowViewedAt?.get(props.root.id)}
        />
      </div>

      <style>{`
        @keyframes oc-dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .oc-flow-dot-pulse {
          animation: oc-dot-pulse 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

function FlowColumns(props: {
  node: Node
  depth: number
  onOpen: (id: string) => void
  idledAt?: Map<string, number>
  flowViewedAt?: number
}) {
  const sync = useSync()
  const status = () => sync.data.session_status[props.node.session.id]?.type ?? "idle"
  const isRoot = () => props.depth === 0
  const hasQuestion = () => (sync.data.question[props.node.session.id]?.length ?? 0) > 0
  const hasPermission = () => (sync.data.permission[props.node.session.id]?.length ?? 0) > 0
  const isCompleted = () => {
    const ts = (props.idledAt ?? new Map()).get(props.node.session.id)
    if (ts === undefined) return false
    return props.flowViewedAt === undefined || props.flowViewedAt < ts
  }

  const attention = (): AttentionKind => {
    if (hasQuestion()) return "question"
    if (hasPermission()) return "permission"
    if (isCompleted()) return "completed"
    return false
  }

  const effectiveColor = () => {
    const a = attention()
    if (a === "question" || a === "permission") return WARNING_COLOR
    if (a === "completed") return SUCCESS_COLOR
    return statusColor(status())
  }

  const effectiveLabel = () => {
    const a = attention()
    if (a === "question") return "needs answer"
    if (a === "permission") return "needs approval"
    if (a === "completed") return "completed"
    return statusLabel(status())
  }

  const highlighted = () => !!attention()

  return (
    <div class="flex items-stretch gap-4 min-w-fit">
      <div
        role="button"
        tabindex="0"
        onClick={(e) => {
          e.stopPropagation()
          props.onOpen(props.node.session.id)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            props.onOpen(props.node.session.id)
          }
        }}
        class="text-left rounded-md border bg-background-base p-3 flex flex-col gap-2 hover:border-border-strong transition-colors w-[220px] shrink-0 cursor-pointer"
        classList={{ "border-border-base": !highlighted() }}
        style={highlighted() ? { "border-color": effectiveColor() } : undefined}
      >
        <div class="flex items-center gap-2">
          <span
            class="text-10-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{
              background: isRoot() ? "rgba(42,157,140,0.15)" : "rgba(148,163,184,0.15)",
              color: isRoot() ? "#2A9D8F" : "var(--color-text-base)",
            }}
          >
            {isRoot() ? "orchestrator" : `@${agentName(props.node.session)}`}
          </span>
        </div>
        <span class="text-12-medium text-text-strong line-clamp-2">{cleanTitle(props.node.session)}</span>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-10-medium"
            style={{ background: `${effectiveColor()}20`, color: effectiveColor() }}
          >
            <span
              class="size-1.5 rounded-full"
              classList={{ "oc-flow-dot-pulse": attention() === "question" || attention() === "permission" }}
              style={{ background: effectiveColor() }}
            />
            {effectiveLabel()}
          </span>
          <span class="text-10-regular text-text-weak ml-auto">
            {formatRelative(props.node.session.time?.updated)}
          </span>
        </div>
      </div>

      <Show when={props.node.children.length > 0}>
        <div class="flex items-center shrink-0">
          <svg width="20" height="2" viewBox="0 0 20 2">
            <line x1="0" y1="1" x2="20" y2="1" stroke="var(--color-border-strong)" stroke-width="1" stroke-dasharray="3 2" />
          </svg>
        </div>
        <div class="flex flex-col gap-3 justify-center">
          <For each={props.node.children}>
            {(child) => (
              <FlowColumns
                node={child}
                depth={props.depth + 1}
                onOpen={props.onOpen}
                idledAt={props.idledAt}
                flowViewedAt={props.flowViewedAt}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
