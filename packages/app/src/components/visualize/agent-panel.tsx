import { createMemo, createEffect, For, Show, onMount } from "solid-js"
import type { Store } from "solid-js/store"
import type { State } from "@/context/global-sync/types"

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
  if (id.startsWith("developer")) return "#3B82F6"
  return "#3B82F6"
}

function formatName(id: string): string {
  return id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

interface AgentMessage {
  id: string
  role: string
  content: string
  toolCalls: { tool: string; description?: string; status?: string }[]
  time?: number
}

export function AgentPanel(props: {
  store: Store<State>
  sessionID: string
  agentId: string
  onClose: () => void
}) {
  let scrollRef: HTMLDivElement | undefined

  const color = () => getColor(props.agentId)

  const agentMessages = createMemo((): AgentMessage[] => {
    const messages = props.store.message[props.sessionID]
    if (!messages) return []

    const result: AgentMessage[] = []
    for (const msg of messages) {
      if ((msg as any).agent !== props.agentId && props.agentId !== "orchestrator") continue
      if (props.agentId === "orchestrator" && (msg as any).agent && (msg as any).agent !== "orchestrator") continue

      const parts = props.store.part[msg.id] || []
      const textParts: string[] = []
      const toolCalls: { tool: string; description?: string; status?: string }[] = []

      for (const part of parts) {
        if ((part as any).type === "text") {
          textParts.push((part as any).content || (part as any).text || "")
        } else if ((part as any).type === "tool") {
          toolCalls.push({
            tool: (part as any).tool || "unknown",
            description: (part as any).state?.input?.description || (part as any).state?.input?.command?.slice(0, 80) || (part as any).state?.input?.filePath || "",
            status: (part as any).state?.status,
          })
        }
      }

      if (textParts.length > 0 || toolCalls.length > 0) {
        result.push({
          id: msg.id,
          role: (msg as any).role || "assistant",
          content: textParts.join("\n"),
          toolCalls,
          time: (msg as any).time?.created,
        })
      }
    }
    return result
  })

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    agentMessages()
    if (scrollRef) {
      setTimeout(() => scrollRef!.scrollTop = scrollRef!.scrollHeight, 50)
    }
  })

  return (
    <div class="fixed inset-y-0 right-0 w-[400px] z-50 flex flex-col animate-slideIn" data-no-pan>
      {/* Backdrop */}
      <div class="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10" onClick={props.onClose} />

      {/* Panel */}
      <div class="h-full bg-[#0d1514] border-l border-[#2A9D8F33] flex flex-col shadow-2xl shadow-black/50">
        {/* Header */}
        <div class="shrink-0 px-4 py-3 border-b border-[#2A9D8F22] flex items-center gap-3">
          <div
            class="w-3 h-3 rounded-full"
            style={{ "background-color": color(), "box-shadow": `0 0 8px ${color()}50` }}
          />
          <div class="flex-1">
            <h3 class="text-sm font-semibold" style={{ color: color() }}>{formatName(props.agentId)}</h3>
            <p class="text-[9px] text-gray-500">Thinking process &middot; {agentMessages().length} messages</p>
          </div>
          <button
            class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#1f2937] transition-colors"
            onClick={props.onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9CA3AF" stroke-width="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Message stream */}
        <div ref={scrollRef} class="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
          <Show when={agentMessages().length === 0}>
            <div class="text-center py-8">
              <p class="text-[11px] text-gray-500">No messages yet from this agent</p>
              <p class="text-[9px] text-gray-600 mt-1">Messages will appear here as the agent works</p>
            </div>
          </Show>

          <For each={agentMessages()}>
            {(msg) => (
              <div class="group">
                {/* User message */}
                <Show when={msg.role === "user"}>
                  <div class="bg-[#1a2523] border border-[#2A9D8F22] rounded-lg px-3 py-2">
                    <p class="text-[10px] text-gray-400 whitespace-pre-wrap break-words line-clamp-4">{msg.content}</p>
                  </div>
                </Show>

                {/* Assistant message */}
                <Show when={msg.role === "assistant"}>
                  <div class="space-y-1.5">
                    {/* Text content */}
                    <Show when={msg.content}>
                      <div class="bg-[#111827] border border-[#1f2937] rounded-lg px-3 py-2">
                        <p class="text-[10px] text-gray-300 whitespace-pre-wrap break-words line-clamp-6">{msg.content}</p>
                      </div>
                    </Show>

                    {/* Tool calls */}
                    <For each={msg.toolCalls}>
                      {(tool) => (
                        <div class="flex items-center gap-2 px-3 py-1.5 rounded bg-[#0a0f0e] border border-[#1f2937]">
                          <div
                            class="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              "background-color": tool.status === "running" ? "#F59E0B" : tool.status === "completed" ? "#22C55E" : tool.status === "error" ? "#EF4444" : "#374151",
                            }}
                          />
                          <span class="text-[9px] font-mono text-gray-400">{tool.tool}</span>
                          <Show when={tool.description}>
                            <span class="text-[8px] text-gray-600 truncate flex-1">{tool.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* Footer */}
        <div class="shrink-0 px-4 py-2 border-t border-[#2A9D8F11]">
          <p class="text-[9px] text-gray-600 text-center">Live stream of agent reasoning and tool usage</p>
        </div>
      </div>
    </div>
  )
}
