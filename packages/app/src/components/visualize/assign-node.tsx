export function AssignNode(props: {
  x: number
  y: number
  onClick: () => void
  index?: number
}) {
  return (
    <div
      class="absolute"
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
        animation: `popIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
        "animation-delay": `${(props.index ?? 0) * 60 + 120}ms`,
        opacity: "0",
      }}
      data-no-pan
    >
      <button
        class="w-[300px] border-2 border-dashed border-[#2A9D8F33] rounded-xl bg-[#0a1514]/60 hover:bg-[#2A9D8F08] hover:border-[#2A9D8F55] transition-all duration-200 group cursor-pointer"
        onClick={props.onClick}
      >
        <div class="px-6 py-8 flex flex-col items-center gap-3">
          {/* Icon */}
          <div class="w-12 h-12 rounded-full bg-[#2A9D8F11] border border-[#2A9D8F22] flex items-center justify-center group-hover:bg-[#2A9D8F22] group-hover:border-[#2A9D8F44] group-hover:scale-110 transition-all duration-200">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2A9D8F" stroke-width="1.5" class="opacity-60 group-hover:opacity-100 transition-opacity">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>

          {/* Text */}
          <div class="text-center">
            <p class="text-[12px] font-medium text-gray-300 group-hover:text-[#2A9D8F] transition-colors">
              Assign new task to team
            </p>
            <p class="text-[10px] text-gray-600 mt-1 group-hover:text-gray-500 transition-colors">
              Orchestrator will delegate work to subagents
            </p>
          </div>
        </div>
      </button>
    </div>
  )
}
