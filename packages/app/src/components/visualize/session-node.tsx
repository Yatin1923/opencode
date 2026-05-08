import { createMemo, createSignal, Show, onCleanup, onMount } from "solid-js"
import type { Store } from "solid-js/store"
import type { State } from "@/context/global-sync/types"
import { extractFlow, AgentFlowVisualization } from "./session-flow"

function ElapsedTime(props: { since: number }) {
  const [now, setNow] = createSignal(Date.now())
  let timer: ReturnType<typeof setInterval>
  onMount(() => { timer = setInterval(() => setNow(Date.now()), 1000) })
  onCleanup(() => clearInterval(timer))
  const elapsed = () => {
    const diff = Math.max(0, now() - props.since)
    const mins = Math.floor(diff / 60000)
    const secs = Math.floor((diff % 60000) / 1000)
    if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
    if (mins > 0) return `${mins}m ${secs}s`
    return `${secs}s`
  }
  return <span class="text-[10px] text-gray-400 font-mono tabular-nums">{elapsed()}</span>
}

export function SessionNode(props: {
  store: Store<State>
  sessionID: string
  title: string
  createdAt: number
  x: number
  y: number
  index: number
  onDragStart?: (e: PointerEvent) => void
  onStop?: () => void
  onAgentClick?: (agentId: string) => void
}) {
  const flow = createMemo(() => extractFlow(props.store, props.sessionID))
  const [showStopConfirm, setShowStopConfirm] = createSignal(false)

  const completedCount = createMemo(() => flow().nodes.filter((n) => n.state === "complete").length)
  const totalCount = createMemo(() => Math.max(flow().nodes.length, 1))
  const progress = createMemo(() => (completedCount() / totalCount()) * 100)
  const isActive = createMemo(() => flow().nodes.some((n) => n.state === "active"))

  return (
    <div
      class="absolute"
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
        animation: `popIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
        "animation-delay": `${props.index * 60}ms`,
        opacity: "0",
      }}
      data-no-pan
    >
      <div class="w-[340px] bg-[#0d1514]/95 border border-[#2A9D8F33] rounded-xl shadow-xl shadow-black/30 overflow-hidden backdrop-blur-sm hover:border-[#2A9D8F55] hover:shadow-[0_0_40px_#2A9D8F12] transition-all duration-300">
        {/* Header — drag handle */}
        <div
          class="px-4 py-3 border-b border-[#2A9D8F22] flex items-center gap-2.5 cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => { e.stopPropagation(); props.onDragStart?.(e) }}
        >
          <div
            class="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              "background-color": isActive() ? "#2A9D8F" : "#374151",
              "box-shadow": isActive() ? "0 0 10px #2A9D8F, 0 0 20px #2A9D8F40" : "none",
              animation: isActive() ? "pulse 2s infinite" : "none",
            }}
          />

          <div class="flex-1 min-w-0">
            <p class="text-[12px] font-medium text-gray-200 truncate">{props.title}</p>
            <div class="flex items-center gap-2 mt-0.5">
              <ElapsedTime since={props.createdAt} />
              <span class="text-[9px] text-gray-600">&middot;</span>
              <span class="text-[9px] text-gray-500">{completedCount()}/{totalCount()} done</span>
            </div>
          </div>

          {/* Stop button */}
          <div class="relative">
            <button
              class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/15 transition-colors group"
              onClick={(e) => { e.stopPropagation(); setShowStopConfirm(!showStopConfirm()) }}
              title="Stop session"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="#EF4444" stroke-width="1.5" class="opacity-50 group-hover:opacity-100 transition-opacity" />
              </svg>
            </button>

            <Show when={showStopConfirm()}>
              <div class="absolute top-8 right-0 z-50 bg-[#1a2523] border border-[#EF444433] rounded-lg p-3 shadow-xl min-w-[200px]">
                <p class="text-[10px] text-gray-300 mb-2.5">Stop this session? All running agents will be cancelled.</p>
                <div class="flex gap-2 justify-end">
                  <button
                    class="text-[10px] px-2.5 py-1.5 rounded-md bg-[#1f2937] text-gray-400 hover:text-gray-200 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setShowStopConfirm(false) }}
                  >
                    Cancel
                  </button>
                  <button
                    class="text-[10px] px-2.5 py-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 font-medium transition-colors"
                    onClick={(e) => { e.stopPropagation(); setShowStopConfirm(false); props.onStop?.() }}
                  >
                    Stop session
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* Progress bar */}
        <div class="h-[3px] bg-[#111827]">
          <div
            class="h-full transition-all duration-700 ease-out"
            style={{
              width: `${progress()}%`,
              background: isActive()
                ? "linear-gradient(90deg, #2A9D8F, #3BB5A7)"
                : progress() >= 100 ? "#22C55E" : "#374151",
              "box-shadow": isActive() ? "0 0 8px #2A9D8F50" : "none",
            }}
          />
        </div>

        {/* Agent flow visualization */}
        <div class="p-3 flex justify-center">
          <AgentFlowVisualization
            store={props.store}
            sessionID={props.sessionID}
            onAgentClick={props.onAgentClick}
          />
        </div>
      </div>
    </div>
  )
}
