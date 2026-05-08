import { createSignal, Show } from "solid-js"

export function AssignTaskModal(props: {
  projectName: string
  directory: string
  onSubmit: (prompt: string) => void
  onClose: () => void
}) {
  const [prompt, setPrompt] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  function handleSubmit() {
    const text = prompt().trim()
    if (!text || submitting()) return
    setSubmitting(true)
    props.onSubmit(text)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
    if (e.key === "Escape") {
      props.onClose()
    }
  }

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center" data-no-pan>
      {/* Backdrop */}
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={props.onClose} />

      {/* Modal */}
      <div class="relative w-full max-w-lg mx-4 bg-[#0d1514] border border-[#2A9D8F44] rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-scaleIn">
        {/* Header */}
        <div class="px-6 py-4 border-b border-[#2A9D8F22] flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-[#2A9D8F22] flex items-center justify-center border border-[#2A9D8F33]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2A9D8F" stroke-width="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div>
            <h2 class="text-sm font-semibold text-gray-200">Assign Task to Team</h2>
            <p class="text-[10px] text-gray-500">{props.projectName} &middot; Orchestrator will delegate to subagents</p>
          </div>
          <button
            class="ml-auto w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#1f2937] transition-colors"
            onClick={props.onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9CA3AF" stroke-width="1.5">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div class="px-6 py-4">
          <label class="block text-[11px] text-gray-400 mb-2 font-medium">What should the team work on?</label>
          <textarea
            class="w-full h-32 bg-[#111827] border border-[#2A9D8F22] rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-[#2A9D8F66] focus:ring-1 focus:ring-[#2A9D8F33] transition-all"
            placeholder="Describe the task... e.g. 'Fix the login bug where users get redirected to 404 page after OAuth callback'"
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autofocus
          />
          <p class="text-[9px] text-gray-600 mt-2">
            Press <kbd class="px-1 py-0.5 bg-[#1f2937] rounded text-gray-400 font-mono">Cmd+Enter</kbd> to submit
          </p>
        </div>

        {/* Footer */}
        <div class="px-6 py-3 border-t border-[#2A9D8F11] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-[#2A9D8F]" />
            <span class="text-[10px] text-gray-400">Agent: <span class="text-[#2A9D8F] font-medium">Orchestrator</span></span>
          </div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-gray-200 bg-[#1f2937] hover:bg-[#2a3441] transition-colors"
              onClick={props.onClose}
            >
              Cancel
            </button>
            <button
              class="px-4 py-1.5 rounded-lg text-[11px] font-medium text-white bg-[#2A9D8F] hover:bg-[#238b7f] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              onClick={handleSubmit}
              disabled={!prompt().trim() || submitting()}
            >
              <Show when={!submitting()} fallback="Assigning...">
                Assign to Team
              </Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
