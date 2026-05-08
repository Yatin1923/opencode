import { createMemo } from "solid-js"
import type { Store } from "solid-js/store"
import type { State } from "@/context/global-sync/types"

export function ProjectCard(props: {
  name: string
  directory: string
  store: Store<State>
  onDragStart?: (e: PointerEvent) => void
  onClick?: () => void
}) {
  const activeSessions = createMemo(() => {
    const sessions = props.store.session || []
    return sessions.filter((s) => {
      const status = props.store.session_status[s.id]
      return status && (status as any).type === "busy"
    })
  })

  const sessionCount = createMemo(() => activeSessions().length)
  const totalSessions = createMemo(() => (props.store.session || []).length)

  return (
    <div data-no-pan>
      <div
        class="w-[320px] border border-[#2A9D8F33] rounded-xl bg-[#0a1514]/95 backdrop-blur-sm shadow-xl shadow-black/30 cursor-pointer hover:border-[#2A9D8F66] hover:shadow-[0_0_30px_#2A9D8F15] transition-all duration-300 group overflow-hidden"
        onClick={() => props.onClick?.()}
      >
        {/* Header — drag handle */}
        <div
          class="px-4 py-3.5 flex items-center gap-3 cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => { e.stopPropagation(); props.onDragStart?.(e) }}
        >
          <div class="w-10 h-10 rounded-lg bg-[#2A9D8F15] flex items-center justify-center border border-[#2A9D8F22] group-hover:bg-[#2A9D8F25] group-hover:border-[#2A9D8F44] transition-all duration-300">
            <span class="text-[#2A9D8F] text-base font-bold group-hover:scale-110 transition-transform duration-300">
              {props.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-[13px] font-semibold text-gray-200 group-hover:text-white transition-colors">{props.name}</h3>
            <p class="text-[9px] text-gray-500 truncate mt-0.5">{props.directory}</p>
          </div>
          <div class="flex flex-col items-end gap-0.5">
            <div class="flex items-center gap-1.5">
              <div
                class="w-2.5 h-2.5 rounded-full transition-all duration-300"
                style={{
                  "background-color": sessionCount() > 0 ? "#2A9D8F" : "#374151",
                  "box-shadow": sessionCount() > 0 ? "0 0 10px #2A9D8F, 0 0 20px #2A9D8F30" : "none",
                  animation: sessionCount() > 0 ? "pulse 2s infinite" : "none",
                }}
              />
              <span class="text-[12px] font-mono font-bold" style={{ color: sessionCount() > 0 ? "#2A9D8F" : "#6B7280" }}>
                {sessionCount()}
              </span>
            </div>
            <span class="text-[9px] text-gray-600">active</span>
          </div>
        </div>

        {/* Activity preview */}
        <div class="px-4 pb-3.5 pt-0">
          <div class="border-t border-[#2A9D8F11] pt-3">
            {sessionCount() > 0 ? (
              <div class="space-y-1.5">
                {activeSessions().slice(0, 3).map((session) => (
                  <div class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#111827]/60">
                    <div class="w-1.5 h-1.5 rounded-full bg-[#2A9D8F] shrink-0" style={{ "box-shadow": "0 0 4px #2A9D8F" }} />
                    <span class="text-[10px] text-gray-300 truncate flex-1">{session.title || "Working..."}</span>
                  </div>
                ))}
                {sessionCount() > 3 && (
                  <p class="text-[9px] text-gray-600 pl-2">+{sessionCount() - 3} more</p>
                )}
              </div>
            ) : (
              <div class="text-center py-3">
                <p class="text-[10px] text-gray-500">No active agents</p>
                <p class="text-[9px] text-gray-600 mt-0.5">{totalSessions()} total sessions</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom accent */}
        <div class="h-[2px] bg-gradient-to-r from-transparent via-[#2A9D8F33] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
    </div>
  )
}
